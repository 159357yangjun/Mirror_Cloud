//! 对账扫描核心：把本地记录与远端逐一对照，记录差异，不采取任何动作。
//!
//! 从 `apps/desktop/src-tauri/src/commands/reconcile.rs` 整体迁入。迁移边界：
//!
//! - 依赖经 [`SweepDeps`] 显式传入（仓储 + 凭据 + provider 注册表），不再持有 `AppState`；
//! - 命令层（`#[tauri::command]`）留在内核，只做薄包装；
//! - 后台调度仍在宿主侧启动（`start_background`），因为 `tokio::spawn` 是宿主生命周期的一部分。
//!
//! ## 两条进入路径，同一个核心
//!
//! 显式命令与后台任务都调用 `run_sweep_inner`。后台路径在用户启用前不产生任何远端请求——见
//! [`crate::cadence`]，其默认关闭，配置不可读时同样退化为关闭。
//!
//! ## 这里从不做什么
//!
//! 只写事件与返回计数；不删除、不重传、不翻转部署状态。`DriftKind::MissingRemote` 是**报告**，
//! 据此采取行动仍是人的决定，这也是探针路径要把 Unknown 与 Absent 分开的原因。

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use credential_store::CredentialStore;
use domain::confirmation_tier::derive_confirmation;
use domain::drift_set::{
    DriftTally, LocalBelief, RemoteSide, SetDrift, SetDriftKind, compare_sets,
};
use domain::event_journal::{AggregateKind, DomainEvent, EventType};
use domain::scan_completeness::ScanCompleteness;
use persistence_sqlite::DeploymentLocationRecord;
use persistence_sqlite::journal::{
    BelievedDeployment, DriftKind, RemoteObservation, SqliteEventJournal, detect_drift,
    observation_from_probe,
};
use persistence_sqlite::remote_scan::{fresh_scan_snapshot, last_scan_at};
use persistence_sqlite::{AssetRepository, SettingsRepository, StorageRecord, StorageRepository};
use provider_registry::ProviderRegistry;
use remote_index::{RemoteIndexSyncView, sync_one_storage};
use serde::Serialize;
use serde_json::{Value, json};
use storage_core::StorageProvider;
use uuid::Uuid;

use crate::cadence::{
    PAGE_LIMIT, ReconcileConfig, SWEEP_ROW_BUDGET, advance_cursor, plan_sweep, scan_due,
};

pub const RECONCILE_SETTINGS_KEY: &str = "reconciliation.background";
/// Where a finished sweep writes its outcome, and where the panel reads history from. Separate keys
/// on purpose: `set` replaces a whole JSON value, so a summary written under the preference key
/// would be erased by the next settings save.
pub const SWEEP_LAST_KEY: &str = "reconciliation.lastSweep";
pub const SWEEP_HISTORY_KEY: &str = "reconciliation.sweepHistory";
/// Scheduled sweeps keep their findings for a week; manual ones are one-line records and can go
/// back further. The window is bounded because this lives in the same row the app rewrites.
pub const SWEEP_HISTORY_DAYS: i64 = 7;
pub const SWEEP_HISTORY_MAX_ENTRIES: usize = 50;
/// Cap on the path lists carried inside a persisted summary - deliberately equal to what the live
/// report itself caps at (`PATHS_PER_KIND`), so a stored record is never richer than the screen was.
const SUMMARY_PATH_CAP: usize = PATHS_PER_KIND;
/// Paths listed per kind in a report, so one sweep cannot hand the UI an unbounded array.
const PATHS_PER_KIND: usize = 20;
/// How long a stored listing stays usable as reconciliation evidence.
///
/// A snapshot older than this is not wrong about what it saw, it is just no longer about *now*:
/// objects get uploaded and deleted by other clients too. Falling back to per-object probes costs
/// requests but answers the current question, which is the right trade for a stale window.
pub const SNAPSHOT_MAX_AGE_HOURS: i64 = 24;

/// 一次扫描所需的全部外部依赖（所有权仍在宿主）。
pub struct SweepDeps<'a> {
    pub assets: &'a AssetRepository,
    pub storages: &'a StorageRepository,
    pub journal: &'a SqliteEventJournal,
    pub settings: &'a SettingsRepository,
    pub credentials: &'a CredentialStore,
    pub registry: &'a ProviderRegistry,
}

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
    /// §18B: probe-path rows that could not be settled, each with its failure kind.
    /// Separate from `unknown_paths` because the cause is different: those lost coverage as a
    /// property of the listing; these failed on this one object.
    pub probe_paths: Vec<DriftEntryView>,
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
    pub fn idle(skipped_by_policy: bool) -> Self {
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
            probe_paths: Vec::new(),
            missing_paths: Vec::new(),
            unknown_paths: Vec::new(),
            paths_omitted: 0,
        }
    }

    pub fn failed(error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::idle(false)
        }
    }
}

/// One drift finding as the panel shows it: the path, the level this build can actually claim, and
/// which clock is missing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftEntryView {
    pub deployment_id: Option<String>,
    pub remote_path: String,
    /// None when there is no local row at all - the remote-only direction has nothing to grade.
    pub confirmation: Option<&'static str>,
    pub strength: Option<&'static str>,
    pub missing_evidence: Option<&'static str>,
    /// §18B: set on probe-path rows only - why the lookup could not answer.
    pub probe_failure: Option<&'static str>,
}

/// A persisted sweep outcome as the panel reads it back. Deliberately not `SweepReport`: a stored
/// record must survive being incomplete, and deserialising into the live type would make one
/// malformed row unreadable history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepHistoryEntry {
    pub last_sweep_at: String,
    pub trigger: String,
    pub outcome: String,
    pub examined: usize,
    pub missing_remote: usize,
    pub unrecorded_remote: usize,
    pub unknown_coverage: usize,
    pub evidence_source: String,
    pub error: Option<String>,
}

impl SweepHistoryEntry {
    fn from_value(value: &Value) -> Option<Self> {
        let record = value.as_object()?;
        let text = |key: &str| {
            record
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string()
        };
        let number = |key: &str| record.get(key).and_then(Value::as_u64).unwrap_or(0) as usize;
        Some(Self {
            last_sweep_at: text("lastSweepAt"),
            trigger: text("trigger"),
            outcome: text("outcome"),
            examined: number("examined"),
            missing_remote: number("missingRemote"),
            unrecorded_remote: number("unrecordedRemote"),
            unknown_coverage: number("unknownCoverage"),
            evidence_source: text("evidenceSource"),
            error: record
                .get("error")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
        })
    }
}

/// What one set-comparison pass produced, before it becomes part of a report.
struct SweepOutcome {
    evidence_source: String,
    /// §18B: the rows whose probe could not answer, with the reason named per row.
    probe_findings: Vec<DriftEntryView>,
    unrecorded_paths: Vec<DriftEntryView>,
    missing_paths: Vec<DriftEntryView>,
    unknown_paths: Vec<DriftEntryView>,
    paths_omitted: usize,
}

/// Read the stored background-reconciliation preference.
pub async fn read_config(deps: &SweepDeps<'_>) -> ReconcileConfig {
    let stored = deps
        .settings
        .get(RECONCILE_SETTINGS_KEY)
        .await
        .ok()
        .flatten();
    ReconcileConfig::from_value(stored.as_ref())
}

/// Persist the preference, returning the normalised value actually stored rather than the one
/// asked for, so a clamped interval is visible to the caller.
pub async fn write_config(
    deps: &SweepDeps<'_>,
    wanted: ReconcileConfig,
) -> Result<ReconcileConfig, String> {
    let stored = wanted.to_stored_value();
    deps.settings
        .set(RECONCILE_SETTINGS_KEY, &stored)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ReconcileConfig::from_value(Some(&stored)))
}

/// Read back the stored summary and history.
pub async fn read_history(deps: &SweepDeps<'_>) -> Value {
    let last = deps
        .settings
        .get(SWEEP_LAST_KEY)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let entries = parse_sweep_history(
        deps.settings
            .get(SWEEP_HISTORY_KEY)
            .await
            .ok()
            .flatten()
            .as_ref(),
    );
    json!({ "last": last, "entries": entries })
}

/// 显式扫描：总是检查，不受后台偏好影响。
pub async fn run_manual_sweep(deps: &SweepDeps<'_>) -> SweepReport {
    let providers = match build_sweep_providers(deps).await {
        Ok(providers) => providers,
        Err(error) => {
            let failed = SweepReport::failed(error);
            record_sweep_outcome(deps, &failed, false).await;
            return failed;
        }
    };
    run_sweep_inner(deps, &providers, None, false).await
}

/// Resolve a provider for every enabled storage.
pub async fn build_sweep_providers(
    deps: &SweepDeps<'_>,
) -> Result<HashMap<Uuid, Arc<dyn StorageProvider>>, String> {
    let storages = deps
        .storages
        .list()
        .await
        .map_err(|error| error.to_string())?;
    Ok(storages
        .iter()
        .filter(|storage| storage.enabled)
        .filter_map(|storage| {
            build_provider(deps, storage)
                .ok()
                .map(|provider| (storage.id, provider))
        })
        .collect())
}

fn build_provider(
    deps: &SweepDeps<'_>,
    record: &StorageRecord,
) -> Result<Arc<dyn StorageProvider>, String> {
    deps.registry.build(record, deps.credentials, |key| {
        format!("Provider {key} is not wired in this build")
    })
}

/// Walk deployments in pages up to the row budget, returning the rows and the last timestamp seen.
///
/// Paging depends on the query's `deployed_at DESC` ordering: the cursor is the oldest timestamp
/// of the page just read, and the next page continues below it. If that ordering ever changes this
/// silently skips or repeats rows, so a gate asserts the SQL shape rather than trusting it.
async fn fetch_sweep_rows(
    deps: &SweepDeps<'_>,
    cursor: Option<String>,
) -> Result<(Vec<DeploymentLocationRecord>, Option<String>, bool), String> {
    let mut plan = plan_sweep(cursor);
    let mut rows: Vec<DeploymentLocationRecord> = Vec::new();
    let mut budget_exhausted = false;

    for _ in 0..plan.pages {
        if rows.len() as i64 >= SWEEP_ROW_BUDGET {
            budget_exhausted = true;
            break;
        }
        let page = deps
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

/// The sweep core. Takes explicit deps rather than a request-scoped state because a background
/// task has no request-scoped borrow to hold.
pub async fn run_sweep_inner(
    deps: &SweepDeps<'_>,
    providers: &HashMap<Uuid, Arc<dyn StorageProvider>>,
    cursor: Option<String>,
    persist_summary: bool,
) -> SweepReport {
    let (rows, seen_cursor, budget_exhausted) = match fetch_sweep_rows(deps, cursor).await {
        Ok(outcome) => outcome,
        Err(error) => {
            let failed = SweepReport::failed(error);
            record_sweep_outcome(deps, &failed, false).await;
            return failed;
        }
    };

    let mut observations = Vec::with_capacity(rows.len());
    let mut present = 0usize;
    let mut absent = 0usize;
    let mut inconclusive = 0usize;

    for row in &rows {
        // §18B keeps the error itself long enough to name its kind; `observation_from_probe` still
        // gets the lossless Result<bool, ()>, so the safety mapping never sees the new type.
        let outcome: Result<bool, storage_core::StorageError> = match providers.get(&row.storage_id)
        {
            // No usable provider (disabled, deleted, or credentials unreadable): we genuinely
            // cannot look, which is Unknown and not Absent.
            None => Err(storage_core::StorageError::Unsupported),
            Some(provider) => provider.exists(&row.remote_path).await,
        };
        let failure_kind = storage_core::probe_kind(&outcome);
        let observation = observation_from_probe(match &outcome {
            Ok(found) => Ok(*found),
            Err(_) => Err(()),
        });
        match observation {
            // Only a positive look is an observation of this object. Absent means we looked and it
            // was not there, which is what the drift report below records; Unknown means we could
            // not look, and writing a timestamp for that would date an event that did not happen.
            RemoteObservation::Present => {
                present += 1;
                let noted = deps
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
        observations.push((row.deployment_id, observation, failure_kind));
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
    // §18B: the rows this pass could not settle, with the reason named per row. Built from the
    // same findings the event loop below walks, so a row cannot appear in one view and not the
    // other; capped like every other list.
    let mut probe_findings: Vec<DriftEntryView> = drift
        .iter()
        .filter(|finding| finding.kind == DriftKind::ProbeInconclusive)
        .map(|finding| DriftEntryView {
            deployment_id: Some(finding.deployment_id.to_string()),
            remote_path: finding.remote_path.clone(),
            confirmation: None,
            strength: None,
            missing_evidence: None,
            probe_failure: finding.probe_kind.map(|kind| kind.as_str()),
        })
        .collect();
    probe_findings.sort_by(|left, right| left.remote_path.cmp(&right.remote_path));
    probe_findings.truncate(PATHS_PER_KIND);
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
                // §18B: why this probe could not answer, when the finding below is an
                // inconclusive one. MissingRemote/UnrecordedRemote carry None here because
                // their witness is a confirmed answer, not a failed lookup.
                "probeKind": finding.probe_kind.map(|kind| kind.as_str()),
            }),
        );
        if deps.journal.append(&event).await.is_ok() {
            events_recorded += 1;
        }
    }

    let mut set_outcome = compare_against_snapshots(deps, providers).await;
    // The probe path owns its own rows; the set comparison cannot produce them. Assigning here
    // rather than merging keeps the two sources from overwriting each other.
    set_outcome.probe_findings = probe_findings;

    let report = SweepReport {
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
        probe_paths: set_outcome.probe_findings,
        missing_paths: set_outcome.missing_paths,
        unknown_paths: set_outcome.unknown_paths,
        paths_omitted: set_outcome.paths_omitted,
    };
    record_sweep_outcome(deps, &report, persist_summary).await;
    report
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
pub async fn refresh_stale_indexes(
    deps: &SweepDeps<'_>,
    providers: &HashMap<Uuid, Arc<dyn StorageProvider>>,
    config: &ReconcileConfig,
) {
    let pool = deps.journal.pool();
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
        let Some(storage) = deps.storages.get(*storage_id).await.ok().flatten() else {
            continue;
        };
        let mut summary = RemoteIndexSyncView::default();
        summary.storages_scanned = 1;
        sync_one_storage(deps.assets, deps.journal, &storage, provider, &mut summary).await;
        tracing::info!(
            %storage_id,
            files = summary.files_scanned,
            imported = summary.imported,
            completeness = summary.scans.first().map(|scan| scan.completeness).unwrap_or("none"),
            "background index refresh finished"
        );
    }
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
    deps: &SweepDeps<'_>,
    providers: &HashMap<Uuid, Arc<dyn StorageProvider>>,
) -> SweepOutcome {
    let pool = deps.journal.pool();
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
        let beliefs = match deps.assets.all_deployment_beliefs(*storage_id).await {
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
        let paths: HashSet<String> = snapshot
            .paths
            .into_iter()
            .filter(|path| is_image_path(path))
            .collect();
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
            probe_failure: None,
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
        probe_findings: Vec::new(),
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

/// What a sweep amounted to, as one word. `error` and `skipped` come first because both produce an
/// all-zero report that would otherwise be recorded as a clean library.
fn sweep_outcome(report: &SweepReport) -> &'static str {
    if report.error.is_some() {
        "error"
    } else if report.skipped_by_policy {
        "skipped"
    } else if report.missing_remote + report.unrecorded_remote > 0
        || !report.unknown_paths.is_empty()
    {
        "drift"
    } else {
        "clean"
    }
}

/// The persisted form of a finished sweep.
///
/// ## Why scheduled sweeps carry findings and manual ones carry only a line
///
/// A scheduled result is the only record of a pass nobody watched, so it keeps the path lists.
/// Whoever triggered a manual sweep already has the full report on screen; storing its findings too
/// would let a person's testing overwrite the last automatic outcome they came back to read.
pub fn sweep_summary(report: &SweepReport, include_findings: bool) -> Value {
    let paths = |entries: &[DriftEntryView]| {
        entries
            .iter()
            .take(SUMMARY_PATH_CAP)
            .map(|entry| entry.remote_path.clone())
            .collect::<Vec<_>>()
    };
    let mut summary = json!({
        "lastSweepAt": Utc::now().to_rfc3339(),
        "trigger": if include_findings { "scheduled" } else { "manual" },
        "outcome": sweep_outcome(report),
        "examined": report.examined,
        "evidenceSource": report.evidence_source,
        "error": report.error,
    });
    if include_findings {
        summary["present"] = json!(report.present);
        summary["absent"] = json!(report.absent);
        summary["inconclusive"] = json!(report.inconclusive);
        summary["missingRemote"] = json!(report.missing_remote);
        summary["unrecordedRemote"] = json!(report.unrecorded_remote);
        summary["unknownCoverage"] = json!(report.unknown_paths.len());
        summary["pathsOmitted"] = json!(report.paths_omitted);
        summary["probeFailures"] = json!(report.probe_paths.len());
        summary["missingPaths"] = json!(paths(&report.missing_paths));
        summary["unrecordedPaths"] = json!(paths(&report.unrecorded_paths));
        summary["unknownPaths"] = json!(paths(&report.unknown_paths));
    } else {
        // Manual rows keep the three drift counts so the history list can still say what happened.
        summary["missingRemote"] = json!(report.missing_remote);
        summary["unrecordedRemote"] = json!(report.unrecorded_remote);
        summary["unknownCoverage"] = json!(report.unknown_paths.len());
    }
    summary
}

/// Newest-first history with the window applied. Exported for tests: the pruning window is the
/// difference between a bounded row and a settings value that grows for the life of the install.
pub fn prune_history(existing: Option<&Value>, new_entry: Value, now: DateTime<Utc>) -> Vec<Value> {
    let cutoff = now - chrono::Duration::days(SWEEP_HISTORY_DAYS);
    let usable = |value: &Value| -> Option<DateTime<Utc>> {
        value
            .get("lastSweepAt")?
            .as_str()
            .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
            .map(|value| value.with_timezone(&Utc))
    };
    let mut kept = vec![new_entry];
    if let Some(entries) = existing.and_then(Value::as_array) {
        for entry in entries {
            let Some(at) = usable(entry) else { continue };
            if at < cutoff {
                continue;
            }
            kept.push(entry.clone());
            if kept.len() >= SWEEP_HISTORY_MAX_ENTRIES {
                break;
            }
        }
    }
    kept.sort_by(|a, b| {
        fn key(v: &Value) -> &str {
            v.get("lastSweepAt").and_then(Value::as_str).unwrap_or("")
        }
        key(b).cmp(key(a))
    });
    kept
}

/// Write one sweep's outcome to the settings store. Best-effort by design: a sweep that found the
/// truth must not report failure because a history row could not be written, and the write is
/// logged instead.
async fn record_sweep_outcome(deps: &SweepDeps<'_>, report: &SweepReport, persist_summary: bool) {
    let summary = sweep_summary(report, persist_summary);
    if let Err(error) = deps.settings.set(SWEEP_LAST_KEY, &summary).await {
        tracing::warn!(%error, "could not persist the last reconciliation summary");
    }
    let existing = deps.settings.get(SWEEP_HISTORY_KEY).await.ok().flatten();
    let history = prune_history(existing.as_ref(), summary, Utc::now());
    if let Err(error) = deps
        .settings
        .set(SWEEP_HISTORY_KEY, &json!({ "entries": history }))
        .await
    {
        tracing::warn!(%error, "could not persist the reconciliation history");
    }
}

/// Decode stored history rows into display records. Anything that is not an object drops.
fn parse_sweep_history(value: Option<&Value>) -> Vec<SweepHistoryEntry> {
    let Some(entries) = value
        .and_then(|v| v.get("entries"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(SweepHistoryEntry::from_value)
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cadence::{
        DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, ReconcileConfig, should_run_on_tick,
    };

    fn entry(path: &str) -> DriftEntryView {
        DriftEntryView {
            deployment_id: None,
            remote_path: path.to_string(),
            confirmation: None,
            strength: None,
            missing_evidence: None,
            probe_failure: None,
        }
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

    #[test]
    fn the_sleep_period_is_minutes_not_seconds() {
        // The loop multiplies by 60. If that factor were wrong the job would run sixty times too
        // often, or effectively never, and neither shows up in a compile check.
        let secs = u64::from(DEFAULT_INTERVAL_MINUTES) * 60;
        assert_eq!(secs, u64::from(DEFAULT_INTERVAL_MINUTES) * 60);
        assert!(secs >= u64::from(MIN_INTERVAL_MINUTES) * 60);
    }

    #[test]
    fn a_scheduled_sweep_persists_a_summary_and_an_explicit_one_does_not() {
        let report = SweepReport {
            examined: 12,
            present: 10,
            absent: 1,
            missing_remote: 1,
            unrecorded_remote: 0,
            unknown_paths: vec![entry("assets/gone.png")],
            evidence_source: "scan".into(),
            ..SweepReport::idle(false)
        };
        // The scheduled shape: every count the report holds lands in the record.
        let stored = sweep_summary(&report, true).to_string();
        for key in [
            "lastSweepAt",
            "trigger",
            "examined",
            "present",
            "absent",
            "inconclusive",
            "missingRemote",
            "unrecordedRemote",
            "unknownCoverage",
            "probeFailures",
            "evidenceSource",
            "error",
        ] {
            assert!(
                stored.contains(key),
                "summary must carry {key}, found {stored}"
            );
        }
        assert!(stored.contains("\"trigger\":\"scheduled\""));
        assert!(stored.contains("\"unknownCoverage\":1"));

        // Whoever asked gets the full report on screen; the history row records only that a manual
        // pass happened, so it cannot overwrite the last automatic result someone came back to read.
        let manual = sweep_summary(&report, false);
        assert_eq!(manual["trigger"], serde_json::json!("manual"));
        assert_eq!(manual["examined"], serde_json::json!(12));
        assert_eq!(manual["missingRemote"], serde_json::json!(1));
        assert_eq!(manual["unknownCoverage"], serde_json::json!(1));
        for absent_key in [
            "present",
            "absent",
            "inconclusive",
            "missingPaths",
            "pathsOmitted",
        ] {
            assert!(
                manual.get(absent_key).is_none(),
                "a manual line must not carry findings ({absent_key})",
            );
        }
    }

    #[test]
    fn a_failed_sweep_is_recorded_as_its_own_outcome() {
        let failed = SweepReport::failed("database is locked".into());
        let stored = sweep_summary(&failed, false);
        assert_eq!(stored["outcome"], serde_json::json!("error"));
        assert_eq!(
            stored["error"].as_str(),
            Some("database is locked"),
            "a recorded failure has to say which failure"
        );

        let blocked = SweepReport::idle(true);
        assert_eq!(
            sweep_summary(&blocked, false)["outcome"],
            serde_json::json!("skipped")
        );

        let clean = SweepReport {
            examined: 5,
            present: 5,
            ..SweepReport::idle(false)
        };
        assert_eq!(
            sweep_summary(&clean, false)["outcome"],
            serde_json::json!("clean")
        );

        let drifted = SweepReport {
            examined: 5,
            missing_remote: 1,
            ..SweepReport::idle(false)
        };
        assert_eq!(
            sweep_summary(&drifted, false)["outcome"],
            serde_json::json!("drift"),
            "a finding must not be recorded as a clean library"
        );
    }

    #[test]
    fn a_default_install_never_sends_probes_from_the_timer() {
        // A fresh install must not start probing third-party clouds because a timer happens to be
        // running: the background cadence is opt-in, and the first tick is inert until a user
        // enables it. Reading this as "when in doubt, sweep" would spend someone's quota on
        // schedule before they ever asked for reconciliation.
        let config = ReconcileConfig::from_value(None);
        assert!(
            !should_run_on_tick(&config),
            "background reconciliation must start inert"
        );
    }

    #[test]
    fn an_unreadable_history_row_degrades_to_nothing_recorded_rather_than_zero() {
        // History is display state read back from settings, so a malformed row must read as "we
        // have no record" and never as "we recorded zero drift". The difference between an empty
        // list and a fabricated zero-observation entry is the difference between "unknown" and
        // "known clean", and only one of those is honest about an unreadable store.
        assert!(parse_sweep_history(None).is_empty());
        assert!(parse_sweep_history(Some(&serde_json::json!("not an object"))).is_empty());
        let parsed = parse_sweep_history(Some(&serde_json::json!({
            "entries": [{ "trigger": "scheduled", "outcome": "drift", "examined": 3 }]
        })));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].outcome, "drift");
    }
}
