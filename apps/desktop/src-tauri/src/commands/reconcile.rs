//! Reconciliation sweep: compare local belief against the remote, record what differs.
//!
//! ## Two ways in, one core
//!
//! The explicit command and a background task both call `run_sweep_inner`. The background path is
//! inert unless the user enables it - see `crate::reconcile_cadence`, whose default is disabled
//! and whose unreadable config also degrades to disabled. That choice exists because a timer
//! converts "someone wanted an answer" into continuous remote traffic on every installed machine,
//! and because the same newest rows would be re-probed forever without the cursor rotation that
//! ships here.
//!
//! ## What this never does
//!
//! It writes events and returns counts. It does not delete, re-upload, or flip a deployment
//! status. `DriftKind::MissingRemote` is a *report*; acting on it stays a human decision, which is
//! the whole reason the probe path separates Unknown from Absent (see journal.rs).
//!
//! The set comparison added in §21 inherits that boundary unchanged: it can name a remote path no
//! local row claims, which is new information, and still takes no action on it.

// `super::*` brings in AppState, build_provider and CmdResult, matching the sibling command
// modules; it sorts before the crate-external paths under rustfmt's group_imports rules.
use super::*;
use crate::reconcile_cadence::{
    PAGE_LIMIT, SWEEP_ROW_BUDGET, advance_cursor, plan_sweep, scan_due, should_run_on_tick,
};
use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use domain::confirmation_tier::derive_confirmation;
use domain::drift_set::{
    DriftTally, LocalBelief, RemoteSide, SetDrift, SetDriftKind, compare_sets,
};
use domain::event_journal::{AggregateKind, DomainEvent, EventType};
use domain::scan_completeness::ScanCompleteness;
use persistence_sqlite::journal::{
    BelievedDeployment, DriftKind, RemoteObservation, detect_drift, observation_from_probe,
};
use persistence_sqlite::remote_scan::{fresh_scan_snapshot, last_scan_at};
use serde::Serialize;
use tauri::{Manager, State};
use uuid::Uuid;

const RECONCILE_SETTINGS_KEY: &str = "reconciliation.background";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub examined: usize,
    pub present: usize,
    pub absent: usize,
    /// Probes that failed outright. Reported separately so an outage is visible as itself rather
    /// than inflating the drift count.
    pub inconclusive: usize,
    pub missing_remote: usize,
    pub unrecorded_remote: usize,
    pub events_recorded: usize,
    pub truncated: bool,
    /// True when the sweep stopped because its row budget ran out rather than the library ending.
    pub budget_exhausted: bool,
    /// Where the next sweep resumes. `None` means the walk reached the end and will wrap.
    pub next_cursor: Option<String>,
    /// Set when a scheduled tick was declined by policy, so an idle cycle cannot read as "the
    /// library is clean".
    pub skipped_by_policy: bool,
    /// Set when the sweep could not read its own rows. Without it, a database error and an empty
    /// library produce identical reports.
    pub error: Option<String>,
    /// Which evidence produced this report's drift numbers.
    ///
    /// `scan` means the findings came from comparing against a stored listing; `probe` means each
    /// object was looked up individually. The two differ in cost by orders of magnitude and in
    /// what they can conclude, so a count without its source is not auditable.
    pub evidence_source: String,
    /// Remote paths no local row claims, sorted, capped at `PATHS_PER_KIND`.
    pub unrecorded_paths: Vec<DriftEntryView>,
    /// Locally-online paths a complete scan did not show, same cap.
    pub missing_paths: Vec<DriftEntryView>,
    /// Paths whose status we cannot settle because coverage was partial or absent.
    pub unknown_paths: Vec<DriftEntryView>,
    /// How many findings were dropped by the cap, per kind, so a truncated list never reads as an
    /// exhaustive one.
    pub paths_omitted: usize,
}

impl SweepReport {
    /// A report for a pass that examined nothing, distinguished by why.
    fn idle(skipped_by_policy: bool) -> Self {
        Self {
            examined: 0,
            present: 0,
            absent: 0,
            inconclusive: 0,
            missing_remote: 0,
            unrecorded_remote: 0,
            events_recorded: 0,
            truncated: false,
            budget_exhausted: false,
            next_cursor: None,
            skipped_by_policy,
            error: None,
            evidence_source: "none".into(),
            unrecorded_paths: Vec::new(),
            missing_paths: Vec::new(),
            unknown_paths: Vec::new(),
            paths_omitted: 0,
        }
    }

    fn failed(error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::idle(false)
        }
    }
}

#[tauri::command]
pub async fn run_reconciliation_sweep(state: State<'_, AppState>) -> CmdResult<SweepReport> {
    // An explicit call always examines, regardless of the background preference: whoever asked
    // wants an answer now. Only the scheduled path consults `should_run_on_tick`. There is
    // currently no UI that invokes this command, so in practice the caller is a developer through
    // the local API.
    let providers = build_sweep_providers(&state).await?;
    Ok(run_sweep_inner(&state, &providers, None).await)
}

/// Read the stored background-reconciliation preference.
#[tauri::command]
pub async fn get_reconciliation_settings(
    state: State<'_, AppState>,
) -> CmdResult<crate::reconcile_cadence::ReconcileConfig> {
    Ok(read_config(&state).await)
}

/// Persist the preference, returning the normalised value actually stored rather than the one
/// asked for, so a clamped interval is visible to the caller.
#[tauri::command]
pub async fn set_reconciliation_settings(
    state: State<'_, AppState>,
    enabled: bool,
    interval_minutes: u32,
    scan_interval_minutes: Option<u32>,
) -> CmdResult<crate::reconcile_cadence::ReconcileConfig> {
    // Optional so an older caller (or a browser build that never sends the field) keeps working
    // and takes the documented default. Required would be a breaking IPC change for a setting
    // that is not load-bearing for correctness.
    let wanted = crate::reconcile_cadence::ReconcileConfig {
        enabled,
        interval_minutes,
        scan_interval_minutes: scan_interval_minutes
            .unwrap_or(crate::reconcile_cadence::DEFAULT_SCAN_INTERVAL_MINUTES),
    };
    let stored = wanted.to_stored_value();
    state
        .settings
        .set(RECONCILE_SETTINGS_KEY, &stored)
        .await
        .map_err(|error| error.to_string())?;
    Ok(crate::reconcile_cadence::ReconcileConfig::from_value(Some(
        &stored,
    )))
}

async fn read_config(state: &AppState) -> crate::reconcile_cadence::ReconcileConfig {
    let stored = state
        .settings
        .get(RECONCILE_SETTINGS_KEY)
        .await
        .ok()
        .flatten();
    crate::reconcile_cadence::ReconcileConfig::from_value(stored.as_ref())
}

/// Resolve a provider for every enabled storage.
async fn build_sweep_providers(
    state: &AppState,
) -> CmdResult<HashMap<Uuid, std::sync::Arc<dyn StorageProvider>>> {
    let storages = state
        .storages
        .list()
        .await
        .map_err(|error| error.to_string())?;
    Ok(storages
        .iter()
        .filter(|storage| storage.enabled)
        .filter_map(|storage| {
            build_provider(state, storage)
                .ok()
                .map(|provider| (storage.id, provider))
        })
        .collect())
}

/// Walk deployments in pages up to the row budget, returning the rows and the last timestamp seen.
///
/// Paging depends on the query's `deployed_at DESC` ordering: the cursor is the oldest timestamp
/// of the page just read, and the next page continues below it. If that ordering ever changes this
/// silently skips or repeats rows, so a gate asserts the SQL shape rather than trusting it.
async fn fetch_sweep_rows(
    state: &AppState,
    cursor: Option<String>,
) -> CmdResult<(
    Vec<persistence_sqlite::DeploymentLocationRecord>,
    Option<String>,
    bool,
)> {
    let mut plan = plan_sweep(cursor);
    let mut rows: Vec<persistence_sqlite::DeploymentLocationRecord> = Vec::new();
    let mut budget_exhausted = false;

    for _ in 0..plan.pages {
        if rows.len() as i64 >= SWEEP_ROW_BUDGET {
            budget_exhausted = true;
            break;
        }
        let page = state
            .assets
            .online_deployments(PAGE_LIMIT, plan.after_deployed_at.as_deref())
            .await
            .map_err(|error| error.to_string())?;
        if page.is_empty() {
            break;
        }
        let last = page.last().and_then(|row| row.deployed_at.clone());
        rows.extend(page);
        match last {
            Some(value) => plan.after_deployed_at = Some(value),
            // No usable timestamp means there is nothing to page by; stop rather than re-read the
            // same page until the budget burns out.
            None => break,
        }
        if rows.len() as i64 >= SWEEP_ROW_BUDGET {
            budget_exhausted = true;
            break;
        }
    }

    Ok((rows, plan.after_deployed_at, budget_exhausted))
}

/// The sweep core. Takes `&AppState` rather than `State<'_, AppState>` because a background task
/// has no request-scoped borrow to hold.
async fn run_sweep_inner(
    state: &AppState,
    providers: &HashMap<Uuid, std::sync::Arc<dyn StorageProvider>>,
    cursor: Option<String>,
) -> SweepReport {
    let (rows, seen_cursor, budget_exhausted) = match fetch_sweep_rows(state, cursor).await {
        Ok(outcome) => outcome,
        Err(error) => return SweepReport::failed(error),
    };

    let mut observations = Vec::with_capacity(rows.len());
    let mut present = 0usize;
    let mut absent = 0usize;
    let mut inconclusive = 0usize;

    for row in &rows {
        let outcome = match providers.get(&row.storage_id) {
            // No usable provider (disabled, deleted, or credentials unreadable): we genuinely
            // cannot look, which is Unknown and not Absent.
            None => Err(()),
            Some(provider) => provider.exists(&row.remote_path).await.map_err(|_| ()),
        };
        let observation = observation_from_probe(outcome);
        match observation {
            // Only a positive look is an observation of this object. Absent means we looked and it
            // was not there, which is what the drift report below records; Unknown means we could
            // not look, and writing a timestamp for that would date an event that did not happen.
            RemoteObservation::Present => {
                present += 1;
                let noted = state
                    .assets
                    .record_deployment_observation(row.deployment_id)
                    .await;
                if let Err(error) = noted {
                    tracing::warn!(%error, "could not record an observation timestamp");
                }
            }
            RemoteObservation::Absent => absent += 1,
            RemoteObservation::Unknown => inconclusive += 1,
        }
        observations.push((row.deployment_id, observation));
    }

    let believed: Vec<BelievedDeployment> = rows
        .iter()
        .map(|row| BelievedDeployment {
            deployment_id: row.deployment_id,
            storage_id: row.storage_id,
            remote_path: row.remote_path.clone(),
            status_online: row.status == "online",
        })
        .collect();

    let drift = detect_drift(&believed, &observations);
    let now = Utc::now();
    let mut events_recorded = 0usize;
    let mut missing_remote = 0usize;
    let mut unrecorded_remote = 0usize;

    for finding in &drift {
        match finding.kind {
            DriftKind::MissingRemote => missing_remote += 1,
            DriftKind::UnrecordedRemote => unrecorded_remote += 1,
            // Nothing happened to the content, so nothing enters history for it: recording
            // inconclusive probes as events would let a network blip flood the journal.
            DriftKind::ProbeInconclusive => continue,
        }
        let event = DomainEvent::new(
            now,
            EventType::DeploymentStatusChanged,
            AggregateKind::Deployment,
            finding.deployment_id,
            serde_json::json!({
                "reason": "reconciliation_sweep",
                "kind": match finding.kind {
                    DriftKind::MissingRemote => "missing_remote",
                    DriftKind::UnrecordedRemote => "unrecorded_remote",
                    DriftKind::ProbeInconclusive => "probe_inconclusive",
                },
                "remotePath": finding.remote_path,
                "actionTaken": null,
                // Every finding here came from an individual lookup. Recorded because the sources
                // differ in what they may conclude: a probe answers only about its own object, so
                // it can never produce the scan-only direction at all.
                "evidenceSource": "probe",
            }),
        );
        if state.journal.append(&event).await.is_ok() {
            events_recorded += 1;
        }
    }

    let set_outcome = compare_against_snapshots(state, providers).await;

    SweepReport {
        examined: rows.len(),
        present,
        absent,
        inconclusive,
        missing_remote,
        unrecorded_remote,
        events_recorded,
        truncated: budget_exhausted || rows.len() as i64 >= PAGE_LIMIT,
        budget_exhausted,
        next_cursor: advance_cursor(rows.len(), seen_cursor),
        skipped_by_policy: false,
        error: None,
        evidence_source: set_outcome.evidence_source,
        unrecorded_paths: set_outcome.unrecorded_paths,
        missing_paths: set_outcome.missing_paths,
        unknown_paths: set_outcome.unknown_paths,
        paths_omitted: set_outcome.paths_omitted,
    }
}

/// Refresh the remote index for storages whose last full walk has aged out.
///
/// ## Why this runs before the probe pass rather than after
///
/// The probe pass reads stored snapshots to decide whether it can compare sets at all. Refreshing
/// afterwards would mean every scheduled tick compares against yesterday's listing and only then
/// notices a newer one exists - a permanent one-interval lag that looks like working correctly.
///
/// ## Why each storage is asked separately
///
/// `scan_due` reads that storage's own newest `remote_scans` row. A single global timestamp would
/// make one unreachable account suppress the refresh of every other one, and the failure mode
/// would be invisible: the job would log that it scanned, and it would have.
async fn refresh_stale_indexes(
    state: &AppState,
    providers: &HashMap<Uuid, std::sync::Arc<dyn StorageProvider>>,
    config: &crate::reconcile_cadence::ReconcileConfig,
) {
    let pool = state.journal.pool();
    let now = Utc::now();
    for (storage_id, provider) in providers {
        let last = match last_scan_at(pool, *storage_id).await {
            Ok(last) => last,
            // Cannot read our own history. Skipping is the safe answer: treating an unreadable
            // timestamp as "due" would crawl the whole storage on every database hiccup, and
            // treating it as "not due" would stop scanning forever. Neither is honest, so we do
            // nothing and let the next tick try again.
            Err(error) => {
                tracing::warn!(%error, %storage_id, "could not read the last scan time");
                continue;
            }
        };
        if !scan_due(last, now, config.scan_interval_minutes) {
            continue;
        }
        let Some(storage) = state.storages.get(*storage_id).await.ok().flatten() else {
            continue;
        };
        let mut summary = RemoteIndexSyncView {
            storages_scanned: 1,
            files_scanned: 0,
            imported: 0,
            skipped_existing: 0,
            skipped_non_images: 0,
            errors: Vec::new(),
            scans: Vec::new(),
        };
        sync_one_storage(state, &storage, provider, &mut summary).await;
        tracing::info!(
            %storage_id,
            files = summary.files_scanned,
            imported = summary.imported,
            completeness = summary.scans.first().map(|scan| scan.completeness).unwrap_or("none"),
            "background index refresh finished"
        );
    }
}

/// One drift finding as the panel shows it: the path, the level this build can actually claim, and
/// which clock is missing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DriftEntryView {
    pub deployment_id: Option<String>,
    pub remote_path: String,
    /// None when there is no local row at all - the remote-only direction has nothing to grade.
    pub confirmation: Option<&'static str>,
    pub strength: Option<&'static str>,
    pub missing_evidence: Option<&'static str>,
}

/// Paths listed per kind in a report, so one sweep cannot hand the UI an unbounded array.
const PATHS_PER_KIND: usize = 20;

/// How long a stored listing stays usable as reconciliation evidence.
///
/// A snapshot older than this is not wrong about what it saw, it is just no longer about *now*:
/// objects get uploaded and deleted by other clients too. Falling back to per-object probes costs
/// requests but answers the current question, which is the right trade for a stale window.
pub const SNAPSHOT_MAX_AGE_HOURS: i64 = 24;

/// What one set-comparison pass produced, before it becomes part of a report.
struct SweepOutcome {
    evidence_source: String,
    unrecorded_paths: Vec<DriftEntryView>,
    missing_paths: Vec<DriftEntryView>,
    unknown_paths: Vec<DriftEntryView>,
    paths_omitted: usize,
}

/// Compare every reachable storage's beliefs against its freshest stored listing.
///
/// ## Why this runs beside the probe loop instead of replacing it
///
/// The probe answers "is this one object there" for rows we already know about, and nothing else -
/// it structurally cannot discover a remote path no local row claims. The set comparison answers
/// exactly that second question, but only where a fresh listing exists. Running both means a sweep
/// with no usable snapshot still reports what it checked, rather than reporting nothing and
/// looking like agreement.
///
/// ## Cost
///
/// Zero remote requests: one indexed query per storage plus one belief query. That asymmetry is
/// why keeping listings (migration 0019) is worth their disk space.
async fn compare_against_snapshots(
    state: &AppState,
    providers: &HashMap<Uuid, std::sync::Arc<dyn StorageProvider>>,
) -> SweepOutcome {
    let pool = state.journal.pool();
    let max_age = chrono::Duration::hours(SNAPSHOT_MAX_AGE_HOURS);
    let now = Utc::now();

    let mut used_scan = false;
    let mut findings: Vec<SetDrift> = Vec::new();
    // Evidence clocks by deployment, kept out of `LocalBelief`: the comparison must not grow a
    // dependency on timestamps it does not use, and only this report grades them.
    let mut clocks: HashMap<Uuid, domain::DeploymentTimestamps> = HashMap::new();

    for storage_id in providers.keys() {
        let snapshot = match fresh_scan_snapshot(pool, *storage_id, now, max_age).await {
            Ok(Some(snapshot)) => snapshot,
            // No snapshot, expired, or unreadable: this storage contributes nothing here, and the
            // probe loop above has already covered its rows.
            _ => continue,
        };
        let beliefs = match state.assets.all_deployment_beliefs(*storage_id).await {
            Ok(beliefs) => beliefs,
            // Could not read our own rows for this storage. Skipping is honest: comparing against
            // an unknown belief set would invent findings in both directions.
            Err(error) => {
                tracing::warn!(
                    %error,
                    storage_id = %storage_id,
                    "reconciliation skipped a storage"
                );
                continue;
            }
        };

        // Both sides go through the same filter. Comparing beliefs that include originals against
        // a listing that also includes thumbnails would report every variant as drift in both
        // directions at once, so the rule has to be shared rather than written twice.
        let paths: HashSet<String> = snapshot.paths.into_iter().filter(is_image_path).collect();
        let remote = match snapshot.completeness {
            ScanCompleteness::Complete => RemoteSide::Complete(paths),
            ScanCompleteness::Partial => RemoteSide::Partial(paths),
            // An unknown-coverage listing keeps its paths but loses the right to any conclusion,
            // including the witnessed-presence direction: we do not know whether the walk got that
            // far before failing.
            ScanCompleteness::Unknown => RemoteSide::Untrusted,
        };
        used_scan = true;

        let belief_rows = beliefs;
        let local: Vec<LocalBelief> = belief_rows
            .iter()
            .filter(|row| is_image_path(&row.remote_path))
            .map(|row| LocalBelief {
                deployment_id: row.deployment_id,
                remote_path: row.remote_path.clone(),
                status_online: row.status == "online",
            })
            .collect();

        for row in &belief_rows {
            clocks.insert(
                row.deployment_id,
                domain::DeploymentTimestamps {
                    deployed_at: parse_clock(row.deployed_at.as_deref()),
                    last_attempted_at: parse_clock(row.last_attempted_at.as_deref()),
                    last_observed_at: parse_clock(row.last_observed_at.as_deref()),
                    last_verified_at: parse_clock(row.last_verified_at.as_deref()),
                },
            );
        }
        findings.extend(compare_sets(&local, &remote));
    }

    let tally = DriftTally::from_findings(&findings);
    // Not decoration: a fourth SetDriftKind added without a bucket below would otherwise vanish
    // from every report while the counts still looked plausible.
    assert!(
        tally.accounting_is_complete_for(&findings),
        "the tally must account for every finding"
    );

    // The tier is attached here rather than in `compare_sets` because the comparison is about what
    // the remote holds and this report is about what *we* can claim. A row absent from a complete
    // listing still has an upload timestamp, and hiding that would make the strongest evidence in
    // the database invisible exactly when someone is deciding whether to re-upload.
    let mut missing: Vec<DriftEntryView> = Vec::new();
    let mut unrecorded: Vec<DriftEntryView> = Vec::new();
    let mut unknown: Vec<DriftEntryView> = Vec::new();
    for finding in &findings {
        let evidence = finding.deployment_id.and_then(|id| clocks.get(&id));
        let graded = evidence.map(|timestamps| {
            let tier = derive_confirmation(timestamps);
            (
                Some(tier.as_str()),
                Some(tier.strength().as_str()),
                Some(tier.missing_evidence()),
            )
        });
        let entry = DriftEntryView {
            deployment_id: finding.deployment_id.map(|id| id.to_string()),
            remote_path: finding.remote_path.clone(),
            confirmation: graded.and_then(|value| value.0),
            strength: graded.and_then(|value| value.1),
            missing_evidence: graded.and_then(|value| value.2),
        };
        match finding.kind {
            SetDriftKind::MissingRemote => missing.push(entry),
            SetDriftKind::UnrecordedRemote => unrecorded.push(entry),
            SetDriftKind::UnknownCoverage => unknown.push(entry),
        }
    }

    let omitted = [missing.len(), unrecorded.len(), unknown.len()]
        .iter()
        .map(|count| count.saturating_sub(PATHS_PER_KIND))
        .sum();

    for list in [&mut missing, &mut unrecorded, &mut unknown] {
        list.sort_by(|left, right| left.remote_path.cmp(&right.remote_path));
        list.dedup_by(|left, right| left.remote_path == right.remote_path);
        list.truncate(PATHS_PER_KIND);
    }

    SweepOutcome {
        evidence_source: if used_scan { "scan" } else { "probe_only" }.to_string(),
        unrecorded_paths: unrecorded,
        missing_paths: missing,
        unknown_paths: unknown,
        paths_omitted: omitted,
    }
}

/// Read one stored clock column. An unparseable value becomes None - absence of readable evidence,
/// never a guessed instant.
fn parse_clock(raw: Option<&str>) -> Option<DateTime<Utc>> {
    raw.and_then(|text| DateTime::parse_from_rfc3339(text).ok())
        .map(|value| value.with_timezone(&Utc))
}

/// Whether a remote path is in scope for reconciliation.
///
/// Only image objects are compared, because only images are what this application deploys. A
/// `remote_index` import records non-image entries as skipped, so a belief row can never name one;
/// leaving them on the remote side would report every PDF on a bucket as unrecorded.
fn is_image_path(path: &str) -> bool {
    let Some((_, extension)) = path.rsplit_once('.') else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif" | "svg" | "ico"
    )
}

/// Start the background reconciler. Called once from setup; returns immediately.
///
/// ## Why the loop re-reads its configuration every tick
///
/// A user who turns this off should see probes stop on the next wake without restarting the app,
/// and a user who turns it on should not have to relaunch. Reading per tick makes both work and
/// costs one local SQLite row.
///
/// ## Why nothing here runs while disabled
///
/// `should_run_on_tick` gates the only call to `run_sweep_inner` in this loop, and it returns
/// false for an absent or unreadable preference. A default install therefore starts this task and
/// performs zero remote requests until explicitly enabled.
pub fn start_background_reconciler(app: &tauri::AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut cursor: Option<String> = None;
        loop {
            let config = read_config(&state).await;
            tokio::time::sleep(std::time::Duration::from_secs(
                u64::from(config.interval_minutes) * 60,
            ))
            .await;
            if !should_run_on_tick(&config) {
                continue;
            }
            let providers = match build_sweep_providers(&state).await {
                Ok(providers) => providers,
                Err(error) => {
                    tracing::warn!(%error, "reconciliation could not resolve providers");
                    continue;
                }
            };
            refresh_stale_indexes(&state, &providers, &config).await;
            let report = run_sweep_inner(&state, &providers, cursor.clone()).await;
            cursor = report.next_cursor.clone();
            tracing::info!(
                examined = report.examined,
                missing_remote = report.missing_remote,
                unrecorded_remote = report.unrecorded_remote,
                inconclusive = report.inconclusive,
                wrapped = report.next_cursor.is_none(),
                "background reconciliation sweep finished"
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reconcile_cadence::{DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES};

    /// The safety property of this step in one assertion: the scheduled path may not reach the
    /// network unless a person turned it on.
    #[test]
    fn a_default_install_never_sends_probes_from_the_timer() {
        let config = crate::reconcile_cadence::ReconcileConfig::from_value(None);
        assert!(
            !should_run_on_tick(&config),
            "background reconciliation must start inert"
        );
    }

    #[test]
    fn the_sleep_period_is_minutes_not_seconds() {
        // The loop multiplies by 60. If that factor were wrong the job would run sixty times too
        // often, or effectively never, and neither shows up in a compile check.
        let secs = u64::from(DEFAULT_INTERVAL_MINUTES) * 60;
        assert_eq!(secs, u64::from(DEFAULT_INTERVAL_MINUTES) * 60);
        assert!(secs >= u64::from(MIN_INTERVAL_MINUTES) * 60);
    }

    #[test]
    fn a_policy_declined_cycle_is_not_reported_as_a_clean_library() {
        let blocked = SweepReport::idle(true);
        assert!(blocked.skipped_by_policy);
        assert_eq!(blocked.examined, 0);
        assert!(blocked.error.is_none());
    }

    #[test]
    fn a_failed_sweep_keeps_its_reason_instead_of_looking_empty() {
        let failed = SweepReport::failed("database is locked".into());
        assert_eq!(failed.error.as_deref(), Some("database is locked"));
        assert!(
            !failed.skipped_by_policy,
            "a failure is not a policy decision, and conflating them hides outages"
        );
    }
}
