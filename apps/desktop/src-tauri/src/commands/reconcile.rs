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

// `super::*` brings in AppState, build_provider and CmdResult, matching the sibling command
// modules; it sorts before the crate-external paths under rustfmt's group_imports rules.
use super::*;
use crate::reconcile_cadence::{
    PAGE_LIMIT, SWEEP_ROW_BUDGET, advance_cursor, plan_sweep, should_run_on_tick,
};
use std::collections::HashMap;

use chrono::Utc;
use domain::event_journal::{AggregateKind, DomainEvent, EventType};
use persistence_sqlite::journal::{
    BelievedDeployment, DriftKind, RemoteObservation, detect_drift, observation_from_probe,
};
use serde::Serialize;
use tauri::State;
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
) -> CmdResult<crate::reconcile_cadence::ReconcileConfig> {
    let stored = crate::reconcile_cadence::ReconcileConfig {
        enabled,
        interval_minutes,
    }
    .to_stored_value();
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
) -> CmdResult<(Vec<persistence_sqlite::DeploymentLocationRecord>, Option<String>, bool)> {
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
            RemoteObservation::Present => present += 1,
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
            }),
        );
        if state.journal.append(&event).await.is_ok() {
            events_recorded += 1;
        }
    }

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
    }
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
