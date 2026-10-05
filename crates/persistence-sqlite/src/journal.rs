//! SQLite-backed event journal and the reconciliation engine that reads it.
//!
//! ## Two layers in one file, deliberately
//!
//! `SqliteEventJournal` is the storage half of `domain::event_journal::EventJournal`. The
//! reconciliation logic next to it is pure: it takes already-fetched observations and returns a
//! verdict. Keeping the decision function free of I/O is what lets it be tested without a
//! database, and what stops a future caller from quietly reconciling against a stale snapshot.
//!
//! ## Why the trait is not implemented here
//!
//! `EventJournal` is synchronous; sqlx pools are async. Implementing the sync trait over an async
//! pool would require blocking on `.await` inside `append`, which is illegal on a tokio worker and
//! would deadlock rather than fail loudly. So this type exposes async methods with the same
//! contract instead, and the sync trait stays reserved for in-memory/test journals. That trade-off
//! is recorded here because "why didn't you just impl the trait" is the obvious question.
//!
//! ## Sequence assignment and its concurrency limit (read before raising the connection count)
//!
//! `append` reads `MAX(sequence)+1` for the aggregate, then inserts. Two statements, so two
//! concurrent publishers on the *same* aggregate can both compute N; the UNIQUE index then rejects
//! one with an error rather than letting it write a duplicate position. The failure is loud and no
//! history is corrupted, but the loser must retry.
//!
//! This is safe under the pool's current configuration (`connect`/`connect_path` cap at
//! max_connections(5), and SQLite serialises writers), and it is correct-by-construction across
//! different aggregates because their sequences are independent by definition. A single-statement
//! form exists - `INSERT ... SELECT COALESCE(MAX(sequence),0)+1 ... ` with a correlated subquery -
//! and should replace this if journal writes ever move onto a shared async path where two tasks
//! can target one aggregate. Not done here: that path does not exist yet, and today's failure is
//! observable rather than silent.

use chrono::{DateTime, Utc};
use domain::DeploymentStatus;
use domain::event_journal::{AggregateKind, DomainEvent, EventType, JournalError};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

fn event_type_str(kind: EventType) -> &'static str {
    match kind {
        EventType::AssetPublished => "asset_published",
        EventType::DeploymentStatusChanged => "deployment_status_changed",
        EventType::UploadAttemptCompleted => "upload_attempt_completed",
        EventType::UploadAttemptFailed => "upload_attempt_failed",
        EventType::VerificationRecorded => "verification_recorded",
        EventType::TaskStatusChanged => "task_status_changed",
        EventType::StorageConfigured => "storage_configured",
        EventType::CredentialRotated => "credential_rotated",
    }
}

fn parse_event_type(raw: &str) -> Result<EventType, JournalError> {
    Ok(match raw {
        "asset_published" => EventType::AssetPublished,
        "deployment_status_changed" => EventType::DeploymentStatusChanged,
        "upload_attempt_completed" => EventType::UploadAttemptCompleted,
        "upload_attempt_failed" => EventType::UploadAttemptFailed,
        "verification_recorded" => EventType::VerificationRecorded,
        "task_status_changed" => EventType::TaskStatusChanged,
        "storage_configured" => EventType::StorageConfigured,
        "credential_rotated" => EventType::CredentialRotated,
        other => {
            return Err(JournalError::Storage(format!(
                "unknown persisted event type {other}"
            )));
        }
    })
}

fn aggregate_kind_str(kind: AggregateKind) -> &'static str {
    match kind {
        AggregateKind::Asset => "asset",
        AggregateKind::Variant => "variant",
        AggregateKind::Deployment => "deployment",
        AggregateKind::Task => "task",
        AggregateKind::Storage => "storage",
        AggregateKind::Plugin => "plugin",
    }
}

fn parse_aggregate_kind(raw: &str) -> Result<AggregateKind, JournalError> {
    Ok(match raw {
        "asset" => AggregateKind::Asset,
        "variant" => AggregateKind::Variant,
        "deployment" => AggregateKind::Deployment,
        "task" => AggregateKind::Task,
        "storage" => AggregateKind::Storage,
        "plugin" => AggregateKind::Plugin,
        other => {
            return Err(JournalError::Storage(format!(
                "unknown persisted aggregate kind {other}"
            )));
        }
    })
}

/// Async journal over the shared pool. See the module note for why this does not implement the
/// synchronous `EventJournal` trait.
#[derive(Clone)]
pub struct SqliteEventJournal {
    pool: SqlitePool,
}

impl SqliteEventJournal {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Persist one event, returning it with the sequence the database assigned.
    ///
    /// An event carrying a non-zero sequence is refused: history position belongs to the journal.
    pub async fn append(&self, event: &DomainEvent) -> Result<DomainEvent, JournalError> {
        if event.sequence != 0 {
            return Err(JournalError::Storage(
                "caller supplied a sequence; the journal assigns positions".into(),
            ));
        }
        let payload = serde_json::to_string(&event.payload)
            .map_err(|error| JournalError::Storage(error.to_string()))?;
        let next_sequence: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM domain_events \
             WHERE aggregate_kind = ? AND aggregate_id = ?",
        )
        .bind(aggregate_kind_str(event.aggregate_kind))
        .bind(event.aggregate_id.to_string())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| JournalError::Storage(error.to_string()))?;

        sqlx::query(
            "INSERT INTO domain_events (event_id, occurred_at, event_type, \
             aggregate_kind, aggregate_id, sequence, payload_json) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(event.event_id.to_string())
        .bind(event.occurred_at.to_rfc3339())
        .bind(event_type_str(event.event_type))
        .bind(aggregate_kind_str(event.aggregate_kind))
        .bind(event.aggregate_id.to_string())
        .bind(next_sequence)
        .bind(payload)
        .execute(&self.pool)
        .await
        .map_err(|error| JournalError::Storage(error.to_string()))?;

        Ok(event.clone().with_sequence(next_sequence as u64))
    }

    pub async fn events_for(&self, aggregate_id: Uuid) -> Result<Vec<DomainEvent>, JournalError> {
        let rows = sqlx::query(
            "SELECT event_id, occurred_at, event_type, aggregate_kind, aggregate_id, sequence, \
             payload_json FROM domain_events WHERE aggregate_id = ? ORDER BY sequence",
        )
        .bind(aggregate_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| JournalError::Storage(error.to_string()))?;
        rows.iter().map(row_to_event).collect()
    }

    /// Global ordered tail for a reader catching up after downtime.
    ///
    /// Note the two different orderings in this file: `sequence` is per-aggregate and answers "did
    /// this asset lose an event"; global catch-up cannot use it (aggregate A's sequence 3 may have
    /// happened long after aggregate B's sequence 1), so this walks insertion order via rowid.
    pub async fn events_after_rowid(
        &self,
        last_seen_rowid: i64,
    ) -> Result<Vec<(i64, DomainEvent)>, JournalError> {
        let rows = sqlx::query(
            "SELECT rowid AS seen_rowid, event_id, occurred_at, event_type, aggregate_kind, \
             aggregate_id, sequence, payload_json FROM domain_events \
             WHERE rowid > ? ORDER BY rowid",
        )
        .bind(last_seen_rowid)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| JournalError::Storage(error.to_string()))?;
        rows.iter()
            .map(|row| {
                let seen = row.try_get::<i64, _>("seen_rowid").map_err(map_row_error)?;
                Ok((seen, row_to_event(row)?))
            })
            .collect()
    }

    pub async fn highest_sequence_for(&self, aggregate_id: Uuid) -> Result<u64, JournalError> {
        let value: Option<i64> =
            sqlx::query_scalar("SELECT MAX(sequence) FROM domain_events WHERE aggregate_id = ?")
                .bind(aggregate_id.to_string())
                .fetch_one(&self.pool)
                .await
                .map_err(|error| JournalError::Storage(error.to_string()))?;
        Ok(value.unwrap_or(0) as u64)
    }
}

fn row_to_event(row: &sqlx::sqlite::SqliteRow) -> Result<DomainEvent, JournalError> {
    let raw_type: String = row.try_get("event_type").map_err(map_row_error)?;
    let raw_kind: String = row.try_get("aggregate_kind").map_err(map_row_error)?;
    let raw_occurred: String = row.try_get("occurred_at").map_err(map_row_error)?;
    let raw_event_id: String = row.try_get("event_id").map_err(map_row_error)?;
    let raw_aggregate: String = row.try_get("aggregate_id").map_err(map_row_error)?;
    let payload_text: String = row.try_get("payload_json").map_err(map_row_error)?;
    let sequence: i64 = row.try_get("sequence").map_err(map_row_error)?;

    Ok(DomainEvent {
        event_id: Uuid::parse_str(&raw_event_id)
            .map_err(|error| JournalError::Storage(error.to_string()))?,
        occurred_at: DateTime::parse_from_rfc3339(&raw_occurred)
            .map(|value| value.with_timezone(&Utc))
            .map_err(|error| JournalError::Storage(error.to_string()))?,
        event_type: parse_event_type(&raw_type)?,
        aggregate_kind: parse_aggregate_kind(&raw_kind)?,
        aggregate_id: Uuid::parse_str(&raw_aggregate)
            .map_err(|error| JournalError::Storage(error.to_string()))?,
        sequence: sequence as u64,
        payload: serde_json::from_str::<Value>(&payload_text)
            .map_err(|error| JournalError::Storage(error.to_string()))?,
    })
}

fn map_row_error(error: sqlx::Error) -> JournalError {
    JournalError::Storage(error.to_string())
}

/// Record the events that follow a successful publish, for both entry points.
///
/// Failures are swallowed into a warning rather than propagated: an event log that can fail a
/// publish is worse than an occasional missing event, because the user would lose an upload they
/// already paid for. That asymmetry is why this returns nothing instead of a Result.
///
/// Shared by desktop (commands.rs) and Typora (cli.rs) on purpose: a journal that records only
/// one of the two entry points produces gaps that read like real history.
pub async fn record_publish_events(
    journal: &SqliteEventJournal,
    asset_id: Uuid,
    variant_id: Uuid,
    deployment_records: &[crate::DeploymentWriteRecord],
    published_url: Option<&str>,
) {
    let now = Utc::now();
    let outcome = DomainEvent::new(
        now,
        EventType::AssetPublished,
        AggregateKind::Asset,
        asset_id,
        serde_json::json!({
            "variantId": variant_id.to_string(),
            "publicUrl": published_url,
            "deployments": deployment_records.len(),
        }),
    );
    if let Err(error) = journal.append(&outcome).await {
        tracing::warn!(%error, "journal append failed for asset publish");
    }
    for record in deployment_records {
        let online = matches!(record.deployment.status, DeploymentStatus::Online);
        let event = DomainEvent::new(
            now,
            EventType::DeploymentStatusChanged,
            AggregateKind::Deployment,
            record.deployment.id,
            serde_json::json!({
                "status": if online { "online" } else { "failed" },
                "storageId": record.deployment.storage_id.to_string(),
                "remotePath": record.deployment.remote_path,
                "lastError": record.last_error,
            }),
        );
        if let Err(error) = journal.append(&event).await {
            tracing::warn!(%error, "journal append failed for deployment status change");
        }
    }
}

/// What the local database believes about one deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BelievedDeployment {
    pub deployment_id: Uuid,
    pub storage_id: Uuid,
    pub remote_path: String,
    pub status_online: bool,
}

/// What a probe of the actual remote says. `absent` means "we looked and it is not there"; a probe
/// that could not run must produce `Unknown`, never `Absent` - conflating those two is how a
/// network blip turns into mass false deletions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteObservation {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriftKind {
    /// Locally online, remotely gone.
    MissingRemote,
    /// Locally failed or pending, but the object exists remotely.
    UnrecordedRemote,
    /// We could not look, so nothing is claimed either way.
    ProbeInconclusive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drift {
    pub deployment_id: Uuid,
    pub kind: DriftKind,
    pub remote_path: String,
}

/// Map a completed-or-failed probe onto the three-state observation.
///
/// The safety property lives here: a failed lookup must become `Unknown`, never `Absent`. A
/// backend that rejects credentials, rate-limits, or loses connectivity is answering "I could not
/// tell you"; reading that as "the file is gone" would let an outage drive a reconciler to delete
/// or re-upload content that is fine.
///
/// Takes a plain outcome rather than a storage error type on purpose: persistence must not depend
/// on the storage abstraction, so whoever probes translates its error into `Err(())` first.
/// Backends already keep NotFound separate from every other failure, which makes that translation
/// lossless here.
pub fn observation_from_probe(probe: Result<bool, ()>) -> RemoteObservation {
    match probe {
        Ok(true) => RemoteObservation::Present,
        Ok(false) => RemoteObservation::Absent,
        Err(()) => RemoteObservation::Unknown,
    }
}

/// Compare belief against observation for a set of deployments.
///
/// Pure by design: no pool, no async, no side effects. A repair action is *proposed*, never taken
/// here, because auto-deleting user content from a comparison is exactly the kind of irreversible
/// move this codebase gates behind an explicit decision.
pub fn detect_drift(
    believed: &[BelievedDeployment],
    observations: &[(Uuid, RemoteObservation)],
) -> Vec<Drift> {
    let mut found = Vec::new();
    for deployment in believed {
        let observation = observations
            .iter()
            .find(|(id, _)| *id == deployment.deployment_id)
            .map(|(_, value)| *value);
        match observation {
            // Never probed: treat as inconclusive rather than assuming the remote matches us.
            None => found.push(Drift {
                deployment_id: deployment.deployment_id,
                kind: DriftKind::ProbeInconclusive,
                remote_path: deployment.remote_path.clone(),
            }),
            Some(RemoteObservation::Unknown) => found.push(Drift {
                deployment_id: deployment.deployment_id,
                kind: DriftKind::ProbeInconclusive,
                remote_path: deployment.remote_path.clone(),
            }),
            Some(RemoteObservation::Absent) if deployment.status_online => found.push(Drift {
                deployment_id: deployment.deployment_id,
                kind: DriftKind::MissingRemote,
                remote_path: deployment.remote_path.clone(),
            }),
            Some(RemoteObservation::Present) if !deployment.status_online => found.push(Drift {
                deployment_id: deployment.deployment_id,
                kind: DriftKind::UnrecordedRemote,
                remote_path: deployment.remote_path.clone(),
            }),
            Some(_) => {}
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn believed(id: Uuid, online: bool) -> BelievedDeployment {
        BelievedDeployment {
            deployment_id: id,
            storage_id: Uuid::new_v4(),
            remote_path: "assets/blog/x.png".into(),
            status_online: online,
        }
    }

    #[test]
    fn a_failed_probe_never_becomes_absent() {
        // The single most dangerous mis-mapping in this layer: treating "could not look" as
        // "not there" turns an outage into a deletion decision.
        assert_eq!(observation_from_probe(Err(())), RemoteObservation::Unknown);
    }

    #[test]
    fn only_a_confirmed_negative_probe_reads_as_absent() {
        assert_eq!(observation_from_probe(Ok(true)), RemoteObservation::Present);
        assert_eq!(observation_from_probe(Ok(false)), RemoteObservation::Absent);
        // Absent may drive MissingRemote; a failed lookup may not.
        let id = Uuid::new_v4();
        let from_absent = detect_drift(&[believed(id, true)], &[(id, RemoteObservation::Absent)]);
        assert_eq!(from_absent[0].kind, DriftKind::MissingRemote);
        let from_failure = detect_drift(
            &[believed(id, true)],
            &[(id, observation_from_probe(Err(())))],
        );
        assert_eq!(from_failure[0].kind, DriftKind::ProbeInconclusive);
    }

    #[test]
    fn a_matching_probe_produces_no_drift() {
        let id = Uuid::new_v4();
        let online = detect_drift(&[believed(id, true)], &[(id, RemoteObservation::Present)]);
        assert!(online.is_empty());
        let other = Uuid::new_v4();
        let observations = [(other, RemoteObservation::Absent)];
        let offline = detect_drift(&[believed(other, false)], &observations);
        assert!(offline.is_empty());
    }

    #[test]
    fn online_but_absent_is_missing_remote() {
        let id = Uuid::new_v4();
        let drift = detect_drift(&[believed(id, true)], &[(id, RemoteObservation::Absent)]);
        assert_eq!(drift.len(), 1);
        assert_eq!(drift[0].kind, DriftKind::MissingRemote);
        assert_eq!(drift[0].deployment_id, id);
    }

    #[test]
    fn offline_but_present_is_unrecorded_remote() {
        let id = Uuid::new_v4();
        let drift = detect_drift(&[believed(id, false)], &[(id, RemoteObservation::Present)]);
        assert_eq!(drift.len(), 1);
        assert_eq!(drift[0].kind, DriftKind::UnrecordedRemote);
    }

    #[test]
    fn an_inconclusive_probe_is_never_reported_as_missing() {
        // The property that keeps a network blip from becoming mass deletion.
        let id = Uuid::new_v4();
        let drift = detect_drift(&[believed(id, true)], &[(id, RemoteObservation::Unknown)]);
        assert_eq!(drift.len(), 1);
        assert_eq!(drift[0].kind, DriftKind::ProbeInconclusive);
        assert_ne!(drift[0].kind, DriftKind::MissingRemote);
    }

    #[test]
    fn never_probing_is_also_inconclusive_not_agreement() {
        let id = Uuid::new_v4();
        let drift = detect_drift(&[believed(id, true)], &[]);
        assert_eq!(drift.len(), 1);
        assert_eq!(drift[0].kind, DriftKind::ProbeInconclusive);
    }

    #[test]
    fn each_deployment_is_evaluated_against_its_own_observation() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let observations = [
            (a, RemoteObservation::Absent),
            (b, RemoteObservation::Present),
        ];
        let beliefs = [believed(a, true), believed(b, false)];
        let drift = detect_drift(&beliefs, &observations);
        assert_eq!(drift.len(), 2);
        let by_id: std::collections::HashMap<_, _> = drift
            .iter()
            .map(|item| (item.deployment_id, item.kind.clone()))
            .collect();
        assert_eq!(by_id[&a], DriftKind::MissingRemote);
        assert_eq!(by_id[&b], DriftKind::UnrecordedRemote);
    }

    #[test]
    fn empty_belief_yields_no_findings_regardless_of_observations() {
        let findings = detect_drift(&[], &[(Uuid::new_v4(), RemoteObservation::Absent)]);
        assert!(findings.is_empty());
    }

    #[test]
    fn event_type_strings_round_trip_through_their_persisted_form() {
        let all = [
            EventType::AssetPublished,
            EventType::DeploymentStatusChanged,
            EventType::UploadAttemptCompleted,
            EventType::UploadAttemptFailed,
            EventType::VerificationRecorded,
            EventType::TaskStatusChanged,
            EventType::StorageConfigured,
            EventType::CredentialRotated,
        ];
        for kind in all {
            let text = event_type_str(kind);
            assert_eq!(
                parse_event_type(text).unwrap(),
                kind,
                "round trip for {text}"
            );
        }
    }

    #[test]
    fn aggregate_kind_strings_round_trip_and_stay_unique() {
        let all = [
            AggregateKind::Asset,
            AggregateKind::Variant,
            AggregateKind::Deployment,
            AggregateKind::Task,
            AggregateKind::Storage,
            AggregateKind::Plugin,
        ];
        let mut seen = std::collections::HashSet::new();
        for kind in all {
            let text = aggregate_kind_str(kind);
            let fresh = seen.insert(text);
            assert!(fresh, "duplicate persisted name for {text}");
            assert_eq!(parse_aggregate_kind(text).unwrap(), kind);
        }
    }

    #[test]
    fn an_unknown_persisted_label_is_rejected_not_defaulted() {
        // Silently mapping an unrecognised row to some default would turn a schema/code skew into
        // plausible-looking history.
        assert!(matches!(
            parse_event_type("asset_publishd"),
            Err(JournalError::Storage(_))
        ));
        assert!(matches!(
            parse_aggregate_kind("agset"),
            Err(JournalError::Storage(_))
        ));
    }
}
