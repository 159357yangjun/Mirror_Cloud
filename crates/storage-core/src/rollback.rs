//! Pure rollback-point filtering for a publish plan.
//!
//! ## Why this lives next to `is_safe_compensation_path` and not inside an executor
//!
//! Compensating a partial publish means deleting remote objects, and the set of objects this
//! program is allowed to delete is narrower than "everything we just uploaded". Legacy configured
//! paths (a fixed key with no unique segment) collide with objects that predate this build, so
//! deleting one destroys a file the current publisher never created. Both publish entry points
//! guarded against exactly that by checking each outcome's path at delete time.
//!
//! Moving the guard to plan-build time keeps the executor trivially correct - it deletes what is
//! in the plan, and nothing unsafe can ever be in the plan - but the guard itself must stay, or
//! "simpler" becomes data loss. This module is where that decision is recorded as code rather
//! than as a comment in two call sites.
//!
//! No async, no I/O, no dependency on which backend answers: the whole function is a predicate
//! over strings, which is what makes it testable without a provider or a database.

use crate::{StorageError, StorageProvider, is_safe_compensation_path};
use uuid::Uuid;

/// One object that a failed publish may lawfully compensate by deleting.
///
/// Carries the identifiers needed to both find the backend (`storage_id`) and write a journal
/// event about the result (`variant_id`). No `asset_id`: nothing reads it, and a field that only
/// travels through the plan invites a later change to assume it was meaningful. Deliberately
/// carries no timestamp either: the
/// journal stamps history, and a plan that stored its own clock would let two disagreeing times
/// reach the same event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollbackPoint {
    pub variant_id: Uuid,
    pub storage_id: Uuid,
    pub remote_path: String,
    /// Display name for failure text; `None` falls back to the storage id.
    pub label: Option<String>,
}

/// Keep only the uploads this program is allowed to delete.
///
/// The filter is a whitelist, not a blacklist: an unrecognised path shape yields no point, so a
/// future change to path templates fails toward "leave the remote object alone" rather than
/// toward deleting it.
pub fn safe_rollback_points(
    uploads: impl IntoIterator<Item = RollbackPoint>,
) -> Vec<RollbackPoint> {
    uploads
        .into_iter()
        .filter(|point| is_safe_compensation_path(&point.remote_path))
        .collect()
}

/// Outcome of one compensation pass, counted from the deletes actually attempted.
///
/// There is deliberately no `skipped_count`: unsafe paths never enter the plan, so an executor
/// that never saw them cannot report on them. The caller that built the plan owns that number, and
/// keeping it out of this struct stops a summary from accounting for objects it never observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RollbackSummary {
    pub points_count: usize,
    pub deleted_count: usize,
    pub failed_count: usize,
}

impl RollbackSummary {
    /// Every point must land in exactly one bucket. A delete that neither succeeded nor failed
    /// would silently orphan a remote object, so the identity is checked rather than assumed.
    pub fn accounting_is_complete(&self) -> bool {
        self.deleted_count + self.failed_count == self.points_count
    }
}

/// Delete every planned point, best-effort, returning the paths each outcome applies to.
///
/// ## Why failures do not stop the pass
///
/// A rollback exists to leave no orphans. Abandoning the remaining points because one delete
/// failed trades one unreachable object for several, after the user has already lost the
/// publish. So a failure is recorded and the loop continues; the summary is what the caller
/// surfaces.
///
/// ## Why the resolver is injected
///
/// The desktop entry point builds providers from `AppState`, the CLI from `CliContext`. Taking a
/// closure over storage id keeps this free of either call site's state, which is also what lets it
/// be tested against a fake provider with no database.
///
/// ## Why nothing is journalled here
///
/// storage-core has no persistence dependency, and adding one would invert the existing edge. The
/// caller writes events from the returned partition, so the mapping from outcome to event type
/// stays visible at the point where the journal is reachable.
pub async fn execute_rollback(
    points: &[RollbackPoint],
    mut resolve: impl FnMut(Uuid) -> Result<std::sync::Arc<dyn StorageProvider>, StorageError>,
) -> (
    Vec<RollbackPoint>,
    Vec<(RollbackPoint, String)>,
    RollbackSummary,
) {
    let mut deleted = Vec::new();
    let mut failures = Vec::new();

    for point in points {
        // An unresolvable storage is a rollback failure like any other: the object stays
        // remote, so it must reach the same bucket instead of being skipped as if handled.
        let outcome = match resolve(point.storage_id) {
            Ok(provider) => provider.delete(&point.remote_path).await,
            Err(error) => Err(error),
        };
        match outcome {
            Ok(()) => deleted.push(point.clone()),
            Err(error) => failures.push((point.clone(), error.to_string())),
        }
    }

    let summary = RollbackSummary {
        points_count: points.len(),
        deleted_count: deleted.len(),
        failed_count: failures.len(),
    };
    (deleted, failures, summary)
}

/// The user-facing reason a point was excluded, for the message the publish error surfaces.
///
/// Split out so the wording stays in one place across the desktop and CLI entry points instead of
/// drifting into two near-identical strings.
pub fn skipped_legacy_path_message(point: &RollbackPoint) -> String {
    format!(
        "{}: 为避免误删旧版固定路径对象，未自动回滚 {}",
        point.storage_label(),
        point.remote_path
    )
}

impl RollbackPoint {
    /// Human-readable storage name for failure text. Falls back to the id when the caller has no
    /// label, because an orphan report that says only "unknown" is not actionable.
    pub fn storage_label(&self) -> String {
        self.label
            .clone()
            .unwrap_or_else(|| self.storage_id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_path() -> String {
        // The shape the current publishers generate: 'u' + 32 hex characters.
        "assets/blog/u0123456789abcdef0123456789abcdef.png".to_string()
    }

    fn point(remote_path: String) -> RollbackPoint {
        RollbackPoint {
            variant_id: Uuid::new_v4(),
            storage_id: Uuid::new_v4(),
            remote_path,
            label: Some("github-primary".into()),
        }
    }

    #[test]
    fn a_unique_path_becomes_a_rollback_point() {
        let points = safe_rollback_points([point(unique_path())]);
        assert_eq!(
            points.len(),
            1,
            "a uniquely named upload must be compensable"
        );
    }

    #[test]
    fn a_legacy_fixed_path_never_becomes_a_rollback_point() {
        // This is the data-loss guard. If it ever passes, publishing to a group that still holds
        // a legacy fixed path would delete an object this build did not create.
        for legacy in [
            "assets/blog/fixed-name.png",
            "assets/blog/u0123456789abcdef0123456789abcde.png",
            "assets/blog/v0123456789abcdef0123456789abcdef.png",
            "assets/blog/u0123456789abcdef0123456789abcdeg.png",
        ] {
            let points = safe_rollback_points([point(legacy.to_string())]);
            assert!(
                points.is_empty(),
                "{legacy} is not a this-build-unique path and must not be queued for deletion"
            );
        }
    }

    #[test]
    fn filtering_drops_only_the_unsafe_member() {
        let safe = point(unique_path());
        let expected_path = safe.remote_path.clone();
        let expected_storage_id = safe.storage_id;
        let unsafe_point = point("assets/blog/legacy.png".into());
        let points = safe_rollback_points([unsafe_point, safe]);
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].remote_path, expected_path);
        assert_eq!(
            points[0].storage_id, expected_storage_id,
            "the surviving point must be the safe one, not merely some one"
        );
    }

    /// Counts deletes and fails on a chosen ordinal, so "N points caused N deletes" is observable.
    struct FakeProvider {
        calls: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        fail_on_call: usize,
    }

    #[async_trait::async_trait]
    impl StorageProvider for FakeProvider {
        fn provider_key(&self) -> &'static str {
            "fake"
        }
        fn capabilities(&self) -> domain::StorageCapabilities {
            domain::StorageCapabilities::default()
        }
        async fn test_connection(&self) -> Result<crate::ConnectionReport, StorageError> {
            Err(StorageError::Unsupported)
        }
        async fn upload(
            &self,
            _request: crate::UploadRequest,
        ) -> Result<crate::UploadResult, StorageError> {
            Err(StorageError::Unsupported)
        }
        async fn delete(&self, path: &str) -> Result<(), StorageError> {
            let mut calls = self.calls.lock().unwrap();
            calls.push(path.to_string());
            if calls.len() == self.fail_on_call {
                return Err(StorageError::Provider("boom".into()));
            }
            Ok(())
        }
    }

    fn fake(fail_on_call: usize) -> (FakeProvider, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        (
            FakeProvider {
                calls: std::sync::Arc::clone(&calls),
                fail_on_call,
            },
            calls,
        )
    }

    #[tokio::test]
    async fn every_point_produces_exactly_one_delete() {
        let (provider, calls) = fake(usize::MAX);
        let points = vec![
            point("a/u0123456789abcdef0123456789abcdef.png"),
            point("b/u0123456789abcdef0123456789abcdee.png"),
            point("c/u0123456789abcdef0123456789abcdef.png"),
        ];
        let provider: std::sync::Arc<dyn StorageProvider> = std::sync::Arc::new(provider);
        let (_deleted, failures, summary) =
            execute_rollback(&points, move |_id| Ok(std::sync::Arc::clone(&provider))).await;
        assert_eq!(summary.points_count, 3);
        assert_eq!(summary.deleted_count, 3);
        assert!(failures.is_empty());
        assert_eq!(
            calls.lock().unwrap().len(),
            3,
            "delete calls must equal the number of points"
        );
        assert!(summary.accounting_is_complete());
    }

    #[tokio::test]
    async fn a_failed_delete_does_not_stop_the_remaining_points() {
        let (provider, calls) = fake(2);
        let points = vec![
            point("a/u0123456789abcdef0123456789abcdef.png"),
            point("b/u0123456789abcdef0123456789abcdee.png"),
            point("c/u0123456789abcdef0123456789abcdef.png"),
        ];
        let provider: std::sync::Arc<dyn StorageProvider> = std::sync::Arc::new(provider);
        let (deleted, failures, summary) =
            execute_rollback(&points, move |_id| Ok(std::sync::Arc::clone(&provider))).await;
        assert_eq!(summary.failed_count, 1);
        assert_eq!(
            summary.deleted_count, 2,
            "the pass must continue past the failure"
        );
        assert_eq!(failures[0].1, "provider rejected request: boom");
        assert_eq!(calls.lock().unwrap().len(), 3);
        assert_eq!(deleted[0].remote_path, points[0].remote_path);
        assert_eq!(deleted[1].remote_path, points[2].remote_path);
        assert!(summary.accounting_is_complete());
    }

    #[tokio::test]
    async fn an_unresolvable_storage_counts_as_a_failed_point() {
        // If a missing backend were skipped rather than counted, the summary would claim every
        // point was handled while an object stayed remote.
        let points = vec![point("a/u0123456789abcdef0123456789abcdef.png")];
        // Constructed per call rather than moved out of a binding: StorageError does not implement
        // Clone, and an owned error would be consumed by the resolver's first invocation.
        let (deleted, failures, summary) = execute_rollback(&points, |_id| {
            let absent: Result<std::sync::Arc<dyn StorageProvider>, StorageError> =
                Err(StorageError::Authentication("gone".to_string()));
            absent
        })
        .await;
        assert_eq!(summary.failed_count, 1);
        assert_eq!(summary.deleted_count, 0);
        assert!(deleted.is_empty());
        assert_eq!(failures[0].1, "authentication failed: gone");
        assert!(summary.accounting_is_complete());
    }

    #[tokio::test]
    async fn an_empty_plan_touches_no_backend() {
        let (provider, calls) = fake(usize::MAX);
        let provider: std::sync::Arc<dyn StorageProvider> = std::sync::Arc::new(provider);
        let (_deleted, _failures, summary) =
            execute_rollback(&[], move |_id| Ok(std::sync::Arc::clone(&provider))).await;
        assert_eq!(summary.points_count, 0);
        assert!(summary.accounting_is_complete());
        assert!(
            calls.lock().unwrap().is_empty(),
            "no points means no deletes"
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

    #[test]
    fn skipping_a_point_still_produces_an_orphan_report() {
        // A filtered point is not silently forgotten: the caller reports that it left a file
        // behind, otherwise "we chose not to delete" reads to the user as "nothing to clean up".
        let message = skipped_legacy_path_message(&point("assets/blog/legacy.png".into()));
        assert!(message.contains("legacy.png"), "{message}");
        assert!(message.contains("github-primary"), "{message}");
    }
}
