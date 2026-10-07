//! The four timestamps on a Deployment, and which events are allowed to set each.
//!
//! ## Why this is a separate module rather than four loose fields
//!
//! `deployments` carried one column, `verified_at`, that every write path stamped with `now`.
//! That made the name a lie: a failed upload produced `status = Failed` alongside `verified_at =
//! Some(now)`, so no reader could tell "this copy was checked and matched" from "a row was
//! written about this copy". Renaming it to `recorded_at` fixed the name but kept the collision -
//! one field still meant three different things (we tried, we looked, we proved).
//!
//! Splitting into four fields only helps if each has exactly one legitimate cause. Those causes
//! are enumerated here as [`TimestampCause`], and [`Deployment::record`] is the single place that
//! decides which field a cause writes. Callers cannot set a field directly, so "Failed implies
//! verified" cannot be expressed at all - there is no code path that produces it.
//!
//! ## The invariant this exists to hold
//!
//! A failed attempt must never leave the deployment looking verified. `last_verified_at` advances
//! only on Proved, and Proved requires a content comparison that passed.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// What just happened to a deployment, as the only vocabulary callers may use to move a timestamp.
///
/// Each variant maps to exactly one field. The mapping is deliberately not configurable: letting
/// a caller choose the field is how `verified_at` ended up meaning "touched".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimestampCause {
    /// An upload finished successfully for the first time. Sets `deployed_at` once and never
    /// again, because "when did this first land" is a historical fact, not a running clock.
    FirstSuccess,
    /// An upload was attempted, whether it succeeded or failed. Sets `last_attempted_at`.
    Attempted,
    /// The remote object's existence was observed without checking its content. Sets
    /// `last_observed_at`. This is what a reconciliation probe does.
    Observed,
    /// Content was compared and matched. Sets `last_verified_at`.
    Proved,
    /// Content was compared and disagreed. Advances nothing: a failed check is not evidence of
    /// correctness, and leaving the previous verification in place would let a stale pass outrank
    /// a fresh mismatch.
    Disproved,
}

/// The four timestamps, grouped so the invariant can be stated over one value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentTimestamps {
    pub deployed_at: Option<DateTime<Utc>>,
    pub last_attempted_at: Option<DateTime<Utc>>,
    pub last_observed_at: Option<DateTime<Utc>>,
    pub last_verified_at: Option<DateTime<Utc>>,
}

impl DeploymentTimestamps {
    /// Apply one cause. Returns the new state; the caller decides when to persist it.
    pub fn with(self, cause: TimestampCause, at: DateTime<Utc>) -> Self {
        match cause {
            // Idempotent by design: a re-upload or repair must not rewrite the original date.
            TimestampCause::FirstSuccess => Self {
                deployed_at: Some(self.deployed_at.unwrap_or(at)),
                last_attempted_at: Some(at),
                ..self
            },
            TimestampCause::Attempted => Self {
                last_attempted_at: Some(at),
                ..self
            },
            TimestampCause::Observed => Self {
                last_observed_at: Some(at),
                ..self
            },
            TimestampCause::Proved => Self {
                last_verified_at: Some(at),
                ..self
            },
            TimestampCause::Disproved => self,
        }
    }

    /// Whether this state contradicts itself: claiming verification without ever having deployed.
    ///
    /// Reachable only through hand-written SQL or a migration bug, which is exactly why it gets a
    /// named predicate instead of being assumed impossible.
    pub fn is_inconsistent(&self) -> bool {
        self.last_verified_at.is_some() && self.deployed_at.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Deployment, DeploymentRole, DeploymentStatus};
    use uuid::Uuid;

    fn moment(seconds: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .expect("fixed instant")
            .with_timezone(&Utc)
            + chrono::Duration::seconds(seconds)
    }

    fn deployment(status: DeploymentStatus, stamps: DeploymentTimestamps) -> Deployment {
        Deployment {
            id: Uuid::new_v4(),
            variant_id: Uuid::new_v4(),
            storage_id: Uuid::new_v4(),
            role: DeploymentRole::Primary,
            remote_path: "assets/blog/u0123456789abcdef0123456789abcdef.png".into(),
            public_url: None,
            status,
            timestamps: stamps,
        }
    }

    #[test]
    fn a_failed_deployment_is_never_recorded_as_verified() {
        // The §15 bug in one assertion. Before the split, this combination was reachable through
        // the ordinary publish path, because one `now` filled both fields.
        let failed = deployment(DeploymentStatus::Failed, DeploymentTimestamps::default())
            .record(TimestampCause::Attempted, moment(0));
        assert_eq!(failed.status, DeploymentStatus::Failed);
        assert_eq!(
            failed.timestamps.last_attempted_at,
            Some(moment(0)),
            "the attempt must still be recorded"
        );
        assert_eq!(
            failed.timestamps.last_verified_at, None,
            "a failure must not read as a completed verification"
        );
        assert_eq!(failed.timestamps.deployed_at, None);
    }

    #[test]
    fn a_successful_upload_sets_deployed_at() {
        let fresh = deployment(DeploymentStatus::Online, DeploymentTimestamps::default())
            .record(TimestampCause::FirstSuccess, moment(10));
        assert_eq!(fresh.timestamps.deployed_at, Some(moment(10)));
        assert_eq!(fresh.timestamps.last_attempted_at, Some(moment(10)));
        assert_eq!(
            fresh.timestamps.last_verified_at, None,
            "an accepted upload is not yet a content proof"
        );
    }

    #[test]
    fn deployed_at_survives_a_later_reupload() {
        let first = deployment(DeploymentStatus::Online, DeploymentTimestamps::default())
            .record(TimestampCause::FirstSuccess, moment(10));
        let again = first.record(TimestampCause::FirstSuccess, moment(999));
        assert_eq!(again.timestamps.deployed_at, Some(moment(10)));
        assert_eq!(again.timestamps.last_attempted_at, Some(moment(999)));
    }

    #[test]
    fn a_reconciliation_probe_observes_without_verifying() {
        // Existence proves presence, not content. Conflating these is what makes a provider that
        // returns 200 for a deleted key look like a healthy copy.
        let online = deployment(DeploymentStatus::Online, DeploymentTimestamps::default())
            .record(TimestampCause::FirstSuccess, moment(1));
        let probed = online.record(TimestampCause::Observed, moment(50));
        assert_eq!(probed.timestamps.last_observed_at, Some(moment(50)));
        assert_eq!(probed.timestamps.last_verified_at, None);
    }

    #[test]
    fn only_a_passed_content_check_advances_verification() {
        let base = deployment(DeploymentStatus::Online, DeploymentTimestamps::default())
            .record(TimestampCause::FirstSuccess, moment(1));
        let proved = base.clone().record(TimestampCause::Proved, moment(80));
        assert_eq!(proved.timestamps.last_verified_at, Some(moment(80)));

        // Capture the clock before consuming `base`: Deployment is not Copy and .record() moves it,
        // while its timestamps are Copy, so the comparison reads a snapshot rather than a borrow of
        // the value that was just moved.
        let attempted_before = base.timestamps.last_attempted_at;
        let disproved = base.record(TimestampCause::Disproved, moment(80));
        assert_eq!(disproved.timestamps.last_verified_at, None);
        assert_eq!(
            disproved.timestamps.last_attempted_at, attempted_before,
            "a failed check must not touch any success timestamp"
        );
    }

    #[test]
    fn a_stale_pass_does_not_outrank_a_fresh_mismatch() {
        let verified = deployment(DeploymentStatus::Online, DeploymentTimestamps::default())
            .record(TimestampCause::FirstSuccess, moment(1))
            .record(TimestampCause::Proved, moment(10));
        let after_mismatch = verified.record(TimestampCause::Disproved, moment(20));
        assert_eq!(
            after_mismatch.timestamps.last_verified_at,
            Some(moment(10)),
            "the earlier proof stays true history; Disproved changes nothing"
        );
    }

    #[test]
    fn verification_without_deployment_is_flagged_inconsistent() {
        let broken = DeploymentTimestamps {
            last_verified_at: Some(moment(5)),
            ..Default::default()
        };
        assert!(broken.is_inconsistent());
        assert!(!DeploymentTimestamps::default().is_inconsistent());
    }

    #[test]
    fn each_cause_touches_only_its_own_field() {
        // Guards against a future edit folding two meanings back into one column.
        let start = DeploymentTimestamps::default();
        let attempted = start.with(TimestampCause::Attempted, moment(1));
        assert_eq!(attempted.deployed_at, None);
        assert_eq!(attempted.last_observed_at, None);
        assert_eq!(attempted.last_verified_at, None);

        let observed = start.with(TimestampCause::Observed, moment(1));
        assert_eq!(observed.last_attempted_at, None);
        assert_eq!(observed.deployed_at, None);

        let proved = start.with(TimestampCause::Proved, moment(1));
        assert_eq!(proved.last_attempted_at, None);
        assert_eq!(proved.last_observed_at, None);
    }
}
