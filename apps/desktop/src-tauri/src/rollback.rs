//! Plan-driven compensation for a partially failed publish, wired to the journal.
//!
//! ## Why this lives at the composition root
//!
//! Deleting a remote object needs a concrete `StorageProvider`, and recording that it happened
//! needs the SQLite journal. Those live in crates that may not reach each other:
//! persistence-sqlite must not learn about storage backends, and storage-core has no database.
//! src-tauri already
//! depends on both, so the step that joins them belongs here instead of inventing a cross-crate
//! dependency just to host it.
//!
//! The loop itself - resolve a backend, delete, partition the results - is in
//! `storage_core::rollback::execute_rollback`, tested there against a fake provider. What remains
//! here is only the mapping from a partitioned outcome to a domain event.
//!
//! ## What moved out of the two entry points
//!
//! Desktop publish and the Typsto CLI each carried their own copy of "loop over successful uploads
//! and delete them", and the copies had already drifted: one reported skipped legacy paths as
//! "为避免误删旧版固定路径对象，未自动回滚", the other as "rollback skipped for legacy/non-unique
//! path". That is what a duplicated safety rule looks like when nobody owns it. The predicate now
//! has one definition (`storage_core::is_safe_compensation_path`) and one filter
//! (`storage_core::rollback::safe_rollback_points`), so an unsafe path cannot reach this code at
//! all. No second guard is left here to forget.

use chrono::Utc;
use domain::event_journal::{AggregateKind, DomainEvent, EventType};
use std::sync::Arc;
use storage_core::StorageProvider;
use storage_core::rollback::{RollbackPoint, RollbackSummary, execute_rollback};
use uuid::Uuid;

/// Which event a single rollback result produces.
///
/// Split from the loop so both directions are testable without a database: a variant mapping
/// nobody exercises is a variant that eventually gets written backwards.
pub fn rollback_event_type(failed: bool) -> EventType {
    if failed {
        EventType::RollbackFailed
    } else {
        EventType::RollbackCompleted
    }
}

/// Build the events for one compensation pass.
///
/// Aggregates are keyed by variant id because a rollback compensates the uploads belonging to one
/// published variant; keying by deployment id would scatter one pass across N histories and make
/// "did this variant get cleaned up" unreadable.
pub fn rollback_events(
    deleted: &[RollbackPoint],
    failures: &[(RollbackPoint, String)],
) -> Vec<DomainEvent> {
    let now = Utc::now();
    let mut events = Vec::with_capacity(deleted.len() + failures.len());
    for point in deleted {
        events.push(DomainEvent::new(
            now,
            rollback_event_type(false),
            AggregateKind::Deployment,
            point.variant_id,
            serde_json::json!({
                "storageId": point.storage_id.to_string(),
                "variantId": point.variant_id.to_string(),
                "remotePath": point.remote_path,
            }),
        ));
    }
    for (point, reason) in failures {
        events.push(DomainEvent::new(
            now,
            rollback_event_type(true),
            AggregateKind::Deployment,
            point.variant_id,
            serde_json::json!({
                "storageId": point.storage_id.to_string(),
                "variantId": point.variant_id.to_string(),
                "remotePath": point.remote_path,
                "error": reason,
            }),
        ));
    }
    events
}

/// Delete the planned points and append one event per outcome.
///
/// Journal write failures are logged rather than propagated: by then the deletes have already
/// happened remotely, and returning an error would report a finished rollback as still pending.
pub async fn run_rollback(
    journal: &persistence_sqlite::journal::SqliteEventJournal,
    points: &[RollbackPoint],
    resolve: impl FnMut(Uuid) -> Result<Arc<dyn StorageProvider>, storage_core::StorageError>,
) -> RollbackSummary {
    let (deleted, failures, summary) = execute_rollback(points, resolve).await;
    for event in rollback_events(&deleted, &failures) {
        if let Err(error) = journal.append(&event).await {
            tracing::warn!(%error, "could not record a rollback event");
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(path: &str) -> RollbackPoint {
        RollbackPoint {
            variant_id: Uuid::new_v4(),
            storage_id: Uuid::new_v4(),
            remote_path: path.into(),
            label: Some("fake".into()),
        }
    }

    #[test]
    fn a_rollback_result_maps_to_its_own_event_type_in_both_directions() {
        assert_eq!(rollback_event_type(false), EventType::RollbackCompleted);
        assert_eq!(rollback_event_type(true), EventType::RollbackFailed);
    }

    #[test]
    fn every_outcome_becomes_exactly_one_event_and_failures_carry_the_reason() {
        let kept = point("a/u0123456789abcdef0123456789abcdef.png");
        let lost = point("b/u0123456789abcdef0123456789abcdee.png");
        let failures = vec![(lost.clone(), "boom".to_string())];
        let events = rollback_events(&[kept], &failures);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, EventType::RollbackCompleted);
        assert_eq!(events[1].event_type, EventType::RollbackFailed);
        // A failure event without its reason cannot be diagnosed later.
        assert_eq!(events[1].payload["error"], "boom");
        assert_eq!(
            events[0].payload.get("error"),
            None,
            "a successful delete must not look like a failure"
        );
        assert_eq!(
            events[1].aggregate_id, lost.variant_id,
            "the event must be about the variant whose object survived"
        );
    }

    #[test]
    fn a_point_that_neither_deleted_nor_failed_breaks_the_identity() {
        let broken = RollbackSummary {
            points_count: 3,
            deleted_count: 1,
            failed_count: 1,
        };
        assert!(!broken.accounting_is_complete());
    }
}
