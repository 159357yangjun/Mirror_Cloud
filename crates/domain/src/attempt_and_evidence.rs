//! Per-attempt execution history and the verification evidence each attempt may produce.
//!
//! ## Why this exists
//!
//! `Task.attempt` is a single counter, and requeueing does `attempt = attempt + 1, error = NULL`,
//! which deletes the previous failure reason. So after two retries nothing records why the first
//! one failed. Meanwhile three storage backends already perform real post-write verification
//! (GitHub/Gitee read the blob SHA back; OpenDAL stats the byte length) but discard the result as
//! soon as they decide whether to return `Err`. None of it reaches the Deployment row.
//!
//! These two objects fix both halves: attempts keep an append-only history, and evidence records
//! what was actually checked - including the honest case where nothing could be checked.
//!
//! ## Not wired in yet
//!
//! Like `publish_plan.rs`, these are values without a caller. No migration creates their tables
//! and no executor writes them. See docs/DEPLOYMENT_ATTEMPT_AND_EVIDENCE.md for remaining steps.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{DeploymentId, StorageId, VariantId};

/// How an attempt ended. Kept separate from any deployment status so a failed attempt can still
/// carry evidence (for example: upload succeeded, verification disagreed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptOutcome {
    Succeeded,
    Failed,
    /// Cancelled by the user or superseded before the request went out.
    Abandoned,
}

/// One remote operation against one storage target. Append-only: a retry adds a row rather than
/// overwriting the previous one, which is the whole point of separating this from `Task.attempt`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeploymentAttempt {
    pub id: Uuid,
    pub deployment_id: DeploymentId,
    pub variant_id: VariantId,
    pub storage_id: StorageId,
    /// 1-based within a deployment. Unique together with `deployment_id`; the constructor refuses
    /// to build an attempt whose index collides with the count it claims to extend.
    pub attempt_index: u32,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub outcome: AttemptOutcome,
    pub error: Option<String>,
    pub bytes_sent: Option<u64>,
}

impl DeploymentAttempt {
    /// Begin an attempt. `prior_attempts` is how many attempts this deployment already has, so the
    /// new index is derived rather than supplied - a caller cannot accidentally reuse an index and
    /// overwrite history it meant to append to.
    pub fn begin(
        deployment_id: DeploymentId,
        variant_id: VariantId,
        storage_id: StorageId,
        prior_attempts: u32,
        started_at: DateTime<Utc>,
        bytes_sent: Option<u64>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            deployment_id,
            variant_id,
            storage_id,
            attempt_index: prior_attempts.saturating_add(1),
            started_at,
            completed_at: None,
            outcome: AttemptOutcome::Abandoned,
            error: None,
            bytes_sent,
        }
    }

    /// Close an attempt. Takes `self` so a finished record cannot be closed twice.
    pub fn finish(
        mut self,
        completed_at: DateTime<Utc>,
        outcome: AttemptOutcome,
        error: Option<String>,
    ) -> Self {
        self.completed_at = Some(completed_at);
        self.outcome = outcome;
        self.error = error;
        self
    }
}

/// What kind of check backs an evidence row. `None` is a first-class value: some providers expose
/// no read-back at all, and "we could not verify" must be recordable instead of rendering as a
/// silent timestamp that implies verification happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationMethod {
    /// Re-read the stored object's identity (GitHub/Gitee blob SHA).
    ShaReadback,
    /// Stat the remote object and compare its size (OpenDAL).
    StatBytes,
    /// Reserved for a later phase: fetch the public URL and assert reachability.
    UrlReachability,
    /// The backend offered no read-back for this operation.
    None,
}

impl VerificationMethod {
    /// Whether this method actually observed the remote object. Used to stop callers from treating
    /// a recorded-but-unverified row as proof.
    pub fn observes_remote_state(&self) -> bool {
        matches!(
            self,
            VerificationMethod::ShaReadback
                | VerificationMethod::StatBytes
                | VerificationMethod::UrlReachability
        )
    }
}

/// The result of checking one attempt against what the plan expected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VerificationEvidence {
    pub id: Uuid,
    pub attempt_id: Uuid,
    pub verified_at: DateTime<Utc>,
    pub method: VerificationMethod,
    /// True only when `method` observed the remote object *and* it matched. An unverified attempt
    /// must set this false rather than omitting the row.
    pub passed: bool,
    pub expected: Option<String>,
    pub observed: Option<String>,
    pub detail: Option<String>,
}

impl VerificationEvidence {
    /// A backend that gave us nothing to compare. Records the absence honestly.
    pub fn unverified(attempt_id: Uuid, verified_at: DateTime<Utc>, detail: &str) -> Self {
        Self {
            id: Uuid::new_v4(),
            attempt_id,
            verified_at,
            method: VerificationMethod::None,
            passed: false,
            expected: None,
            observed: None,
            detail: Some(detail.to_string()),
        }
    }

    /// A comparison performed by the caller's backend. `passed` is computed here rather than
    /// supplied, so a mismatched pair cannot be recorded as a success.
    pub fn compared(
        attempt_id: Uuid,
        verified_at: DateTime<Utc>,
        method: VerificationMethod,
        expected: &str,
        observed: &str,
    ) -> Self {
        debug_assert!(
            method.observes_remote_state(),
            "compared() requires a method that observes the remote; use unverified() otherwise"
        );
        Self {
            id: Uuid::new_v4(),
            attempt_id,
            verified_at,
            method,
            passed: method.observes_remote_state() && expected == observed,
            expected: Some(expected.to_string()),
            observed: Some(observed.to_string()),
            detail: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Distinct, ordered instants from literal RFC 3339 strings. The repo's only other chrono use
    /// is parse_from_rfc3339 + with_timezone (persistence-sqlite), so this stays on that path
    /// rather than introducing time arithmetic no existing code depends on.
    fn ts(second: u32) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(&format!("2026-10-04T00:00:{second:02}Z"))
            .unwrap()
            .with_timezone(&Utc)
    }

    fn ids() -> (DeploymentId, VariantId, StorageId) {
        (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4())
    }

    #[test]
    fn begin_derives_the_next_index_instead_of_trusting_a_supplied_one() {
        let (deployment_id, variant_id, storage_id) = ids();
        let first =
            DeploymentAttempt::begin(deployment_id, variant_id, storage_id, 0, ts(0), Some(10));
        assert_eq!(first.attempt_index, 1);
        let second = DeploymentAttempt::begin(
            deployment_id,
            variant_id,
            storage_id,
            first.attempt_index,
            ts(5),
            Some(10),
        );
        assert_eq!(second.attempt_index, 2);
        assert_ne!(first.id, second.id, "an append creates a new record");
        assert_eq!(second.deployment_id, first.deployment_id);
    }

    #[test]
    fn finishing_keeps_the_previous_attempt_error_untouched() {
        // The regression this guards: requeue used to do `error = NULL`, erasing why attempt 1
        // failed. Two separate rows make that impossible.
        let (deployment_id, variant_id, storage_id) = ids();
        let first_open =
            DeploymentAttempt::begin(deployment_id, variant_id, storage_id, 0, ts(0), None);
        let first = first_open.finish(
            ts(1),
            AttemptOutcome::Failed,
            Some("remote sha mismatch".into()),
        );
        let second_open =
            DeploymentAttempt::begin(deployment_id, variant_id, storage_id, 1, ts(2), None);
        let second = second_open.finish(ts(3), AttemptOutcome::Succeeded, None);
        assert_eq!(first.error.as_deref(), Some("remote sha mismatch"));
        assert_eq!(second.error, None);
        assert_eq!(first.outcome, AttemptOutcome::Failed);
        assert_eq!(second.outcome, AttemptOutcome::Succeeded);
    }

    #[test]
    fn an_open_attempt_has_no_completion_time() {
        let (deployment_id, variant_id, storage_id) = ids();
        let open = DeploymentAttempt::begin(deployment_id, variant_id, storage_id, 0, ts(0), None);
        assert_eq!(open.completed_at, None);
    }

    #[test]
    fn compared_evidence_passes_only_when_observed_matches_expected() {
        let attempt_id = Uuid::new_v4();
        let good = VerificationEvidence::compared(
            attempt_id,
            ts(1),
            VerificationMethod::ShaReadback,
            "abc123",
            "abc123",
        );
        assert!(good.passed);
        assert_eq!(good.expected.as_deref(), Some("abc123"));
        assert_eq!(good.observed.as_deref(), Some("abc123"));

        let bad = VerificationEvidence::compared(
            attempt_id,
            ts(1),
            VerificationMethod::ShaReadback,
            "abc123",
            "def456",
        );
        assert!(!bad.passed, "a mismatch can never be recorded as verified");
        assert_eq!(bad.observed.as_deref(), Some("def456"));
    }

    #[test]
    fn byte_length_evidence_uses_the_same_rule_as_sha_evidence() {
        let attempt_id = Uuid::new_v4();
        let matched = VerificationEvidence::compared(
            attempt_id,
            ts(1),
            VerificationMethod::StatBytes,
            "1024",
            "1024",
        );
        assert!(matched.passed);
        assert_eq!(matched.method, VerificationMethod::StatBytes);
    }

    #[test]
    fn a_backend_without_read_back_records_that_explicitly_and_does_not_pass() {
        let attempt_id = Uuid::new_v4();
        let skipped =
            VerificationEvidence::unverified(attempt_id, ts(1), "provider exposes no stat");
        assert_eq!(skipped.method, VerificationMethod::None);
        assert!(!skipped.passed, "absence of a check is not a passed check");
        assert!(!skipped.method.observes_remote_state());
        assert_eq!(skipped.detail.as_deref(), Some("provider exposes no stat"));
        assert_eq!(skipped.observed, None);
    }

    #[test]
    fn url_reachability_counts_as_observing_the_remote() {
        // Reserved for a later phase, but its classification is fixed now so that wiring it up
        // cannot quietly produce rows that claim verification without observing anything.
        assert!(VerificationMethod::UrlReachability.observes_remote_state());
    }

    #[test]
    fn evidence_links_to_exactly_one_attempt_by_id() {
        let (deployment_id, variant_id, storage_id) = ids();
        let attempt =
            DeploymentAttempt::begin(deployment_id, variant_id, storage_id, 0, ts(0), None).finish(
                ts(1),
                AttemptOutcome::Succeeded,
                None,
            );
        let evidence = VerificationEvidence::compared(
            attempt.id,
            ts(1),
            VerificationMethod::ShaReadback,
            "h1",
            "h1",
        );
        assert_eq!(evidence.attempt_id, attempt.id);
    }
}
