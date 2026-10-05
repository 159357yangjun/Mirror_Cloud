//! Manual reconciliation sweep: compare local belief against the remote, record what differs.
//!
//! ## Why this is a command and not a timer yet
//!
//! A periodic loop is the stated goal, but wiring one before the sweep has itself been run once
//! against real storage would ship an unattended process whose only observable behaviour is
//! whatever it gets wrong first. This exposes the sweep as an explicit action; scheduling it is a
//! small change in lib.rs once the sweep has produced evidence on a real account.
//!
//! ## What this never does
//!
//! It writes events and returns counts. It does not delete, re-upload, or flip a deployment
//! status. `DriftKind::MissingRemote` is a *report*; acting on it stays a human decision, which is
//! the whole reason the probe path separates Unknown from Absent (see journal.rs).

// `super::*` brings in AppState, build_provider and CmdResult, matching the sibling command
// modules; it sorts before the crate-external paths under rustfmt's group_imports rules.
use super::*;
use std::collections::HashMap;

use chrono::Utc;
use domain::event_journal::{AggregateKind, DomainEvent, EventType};
use persistence_sqlite::journal::{
    BelievedDeployment, DriftKind, RemoteObservation, detect_drift, observation_from_probe,
};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

/// Rows examined per sweep. Bounded so a large library cannot turn one click into thousands of
/// remote requests; paging across sweeps is a follow-up, not silently dropped work.
const SWEEP_BATCH: i64 = 200;

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
}

#[tauri::command]
pub async fn run_reconciliation_sweep(
    state: State<'_, AppState>,
) -> CmdResult<SweepReport> {
    let storages = state
        .storages
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let providers: HashMap<Uuid, _> = storages
        .iter()
        .filter(|storage| storage.enabled)
        .filter_map(|storage| {
            build_provider(&state, storage)
                .ok()
                .map(|provider| (storage.id, provider))
        })
        .collect();

    let rows = state
        .assets
        .online_deployments(SWEEP_BATCH, None)
        .await
        .map_err(|error| error.to_string())?;

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

    Ok(SweepReport {
        examined: rows.len(),
        present,
        absent,
        inconclusive,
        missing_remote,
        unrecorded_remote,
        events_recorded,
        truncated: rows.len() as i64 == SWEEP_BATCH,
    })
}
