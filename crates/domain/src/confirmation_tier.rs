//! How strongly a deployment's success is actually confirmed (piclist §18).
//!
//! ## The problem this answers
//!
//! `DeploymentStatus::Online` meant exactly one thing: the provider accepted the write
//! (`status = if outcome.error.is_none() { Online }`). That is the equation section eighteen
//! objects to - "API returned 200 = success". A copy can be accepted by an API and still be
//! absent when you look, present with different bytes, or unreachable at its public URL.
//! Callers had no way to ask how well founded the confidence was, so a freshly uploaded but
//! never re-checked copy looked exactly as good as one whose SHA came back matching.
//!
//! ## Why this is derived rather than stored
//!
//! Section seventeen already put four clocks on the row, each writable by exactly one kind of
//! evidence. Those clocks are the record of what has been observed; a fifth column saying
//! "tier" would be a second source of truth for the same fact, and the two would drift. So
//! the tier is computed from the clocks and never persisted. The payoff is structural: it is
//! impossible to store a tier that the evidence does not support, because there is nowhere to
//! store it.
//!
//! ## What is deliberately missing
//!
//! `PubliclyReachable` has an enum slot and no producer. Nothing in this application has ever
//! issued an HTTP request against a stored public URL, so claiming that level would
//! reintroduce precisely the defect this module exists to remove - a confident label with no
//! observation behind it. It is named here so the ladder shows its own gap instead of
//! pretending to end at ContentVerified.

use crate::deployment_timestamps::DeploymentTimestamps;

/// How well founded a deployment's success is, ordered so that higher implies lower.
///
/// The discriminants are explicit rather than inferred from declaration order because the
/// numbers appear in journal payloads and eventually in the UI; a reordering that silently
/// renumbered them would rewrite history's meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum ConfirmationTier {
    /// Nothing has ever been recorded about this copy. Not "failed" - unobserved.
    Unknown = 0,
    /// An upload completed without error. This is all `status = Online` has ever meant.
    Uploaded = 1,
    /// A later lookup independently found the object on the remote. Presence, not content.
    RemoteObserved = 2,
    /// Content was compared against an expectation and matched.
    ContentVerified = 3,
    /// The public URL was fetched and served the object. **No producer exists yet**; see the
    /// module note. Derivation never returns this level.
    PubliclyReachable = 4,
}

/// How much a reader should trust a copy at this level, for the colour a UI shows.
///
/// Three buckets over five levels because that is what the distinction buys: `Uploaded` and
/// `RemoteObserved` both mean "we have not looked at the bytes", so painting them differently
/// would imply the difference is about trust when it is about kind. Unconfirmed is its own
/// bucket rather than weak, because absence of evidence must not read as evidence of a problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TierStrength {
    /// Content was compared and matched.
    Strong,
    /// A write was accepted or the object was seen remote, but nothing compared content.
    Weak,
    /// Nothing is known either way.
    Unconfirmed,
}

impl TierStrength {
    /// Stable spelling for IPC.
    pub fn as_str(self) -> &'static str {
        match self {
            TierStrength::Strong => "strong",
            TierStrength::Weak => "weak",
            TierStrength::Unconfirmed => "unconfirmed",
        }
    }
}

impl ConfirmationTier {
    /// The trust bucket for display.
    pub fn strength(self) -> TierStrength {
        match self {
            ConfirmationTier::ContentVerified | ConfirmationTier::PubliclyReachable => {
                TierStrength::Strong
            }
            ConfirmationTier::Uploaded | ConfirmationTier::RemoteObserved => TierStrength::Weak,
            ConfirmationTier::Unknown => TierStrength::Unconfirmed,
        }
    }

    /// Stable spelling for IPC, so the frontend never switches on a numeric level.
    pub fn as_str(self) -> &'static str {
        match self {
            ConfirmationTier::Unknown => "unknown",
            ConfirmationTier::Uploaded => "uploaded",
            ConfirmationTier::RemoteObserved => "remote_observed",
            ConfirmationTier::ContentVerified => "content_verified",
            ConfirmationTier::PubliclyReachable => "publicly_reachable",
        }
    }

    /// Which clock is missing at this level, phrased as what would raise it.
    ///
    /// Written against the ladder's rules rather than the derived value: `RemoteObserved` needs
    /// both an attempt and an observation, and reporting only the absent one would hide that an
    /// upload timestamp is also missing. That case is reachable - the remote-index import creates
    /// rows with an observation and no attempt - and telling such a row only "no verification yet"
    /// would send a reader to look for a verification feature instead of understanding that this
    /// build never uploaded the object.
    pub fn missing_evidence(self) -> &'static str {
        match self {
            ConfirmationTier::Unknown => "没有任何记录：既没上传过，也没在远端看到过",
            ConfirmationTier::Uploaded => "缺独立复核：还没有一次事后查询确认对象仍在远端",
            ConfirmationTier::RemoteObserved => "缺内容比对：还没把字节和预期对过",
            ConfirmationTier::ContentVerified => "已是本应用能给出的最强结论",
            ConfirmationTier::PubliclyReachable => "本应用不会抓取公开 URL，这一级没有生产者",
        }
    }

    /// Whether reaching this tier requires evidence the application cannot currently produce.
    pub fn is_unimplemented(self) -> bool {
        matches!(self, ConfirmationTier::PubliclyReachable)
    }

    /// Numeric level, for journal payloads and ordering comparisons made outside Rust.
    pub fn level(self) -> u8 {
        self as u8
    }
}

/// Compute the confirmation tier from the evidence clocks.
///
/// Each rung demands its own clock - an upper-level timestamp never promotes a missing lower
/// one. That matters because the clocks are written by different code paths at different times:
/// a reconciliation probe can set `last_observed_at` on a row whose upload we never performed
/// (the remote-index import creates exactly such rows), and reading "observed" as "uploaded"
/// would credit this build with a write it did not do.
pub fn derive_confirmation(stamps: &DeploymentTimestamps) -> ConfirmationTier {
    // Ordered checks, lowest evidence first, so the result is monotone in evidence: adding a
    // clock can raise the tier and can never lower it.
    let uploaded = stamps.last_attempted_at.is_some();
    let observed = stamps.last_observed_at.is_some();
    let verified = stamps.last_verified_at.is_some();

    if verified {
        return ConfirmationTier::ContentVerified;
    }
    if observed && uploaded {
        return ConfirmationTier::RemoteObserved;
    }
    if uploaded {
        return ConfirmationTier::Uploaded;
    }
    ConfirmationTier::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DeploymentRole, DeploymentStatus};
    use chrono::{DateTime, Utc};
    use uuid::Uuid;

    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .expect("fixed instant")
            .with_timezone(&Utc)
            + chrono::Duration::seconds(seconds)
    }

    fn stamps(
        attempted: Option<DateTime<Utc>>,
        observed: Option<DateTime<Utc>>,
        verified: Option<DateTime<Utc>>,
    ) -> DeploymentTimestamps {
        // deployed_at stays None here on purpose. Deriving it from `attempted` would make every
        // fixture silently claim a first-success date it never asserted, and the row built from
        // stamps(None, Some(..), None) is the "we saw it but did not write it" case that
        // must not look deployed.
        DeploymentTimestamps {
            deployed_at: None,
            last_attempted_at: attempted,
            last_observed_at: observed,
            last_verified_at: verified,
        }
    }

    #[test]
    fn levels_are_the_numbered_ladder_and_never_reach_the_unimplemented_one() {
        assert_eq!(ConfirmationTier::Unknown.level(), 0);
        assert_eq!(ConfirmationTier::Uploaded.level(), 1);
        assert_eq!(ConfirmationTier::RemoteObserved.level(), 2);
        assert_eq!(ConfirmationTier::ContentVerified.level(), 3);
        assert_eq!(ConfirmationTier::PubliclyReachable.level(), 4);
        // The ceiling of what derivation can produce today, stated as a number so a reader sees
        // the gap rather than inferring it from absence.
        let best = derive_confirmation(&stamps(Some(at(1)), Some(at(2)), Some(at(3))));
        assert_eq!(best.level(), 3);
        assert!(best.level() < ConfirmationTier::PubliclyReachable.level());
    }

    #[test]
    fn a_row_with_no_evidence_is_unobserved_not_failed() {
        assert_eq!(
            derive_confirmation(&DeploymentTimestamps::default()),
            ConfirmationTier::Unknown,
            "absence of evidence must read as absence of knowledge, not as success or failure"
        );
    }

    #[test]
    fn an_attempt_alone_reaches_only_uploaded() {
        // This is the whole point of §18: the old binary status stopped here and called it
        // done.
        let tier = derive_confirmation(&stamps(Some(at(1)), None, None));
        assert_eq!(tier, ConfirmationTier::Uploaded);
        assert_ne!(
            tier,
            ConfirmationTier::ContentVerified,
            "an accepted write must not outrank itself into verification"
        );
    }

    #[test]
    fn an_observation_after_an_attempt_reaches_remote_observed() {
        let tier = derive_confirmation(&stamps(Some(at(1)), Some(at(50)), None));
        assert_eq!(tier, ConfirmationTier::RemoteObserved);
    }

    #[test]
    fn verification_is_the_highest_derivable_tier() {
        let tier = derive_confirmation(&stamps(Some(at(1)), Some(at(50)), Some(at(80))));
        assert_eq!(tier, ConfirmationTier::ContentVerified);
    }

    #[test]
    fn each_rung_requires_its_own_evidence_and_not_the_next_one() {
        // Verified alone (no attempt, no observation) still reports ContentVerified, because
        // content comparison is strictly stronger evidence than either earlier look. Asserting
        // this direction explicitly keeps a future edit from demanding a full chain before
        // crediting a proof.
        assert_eq!(
            derive_confirmation(&stamps(None, None, Some(at(80)))),
            ConfirmationTier::ContentVerified
        );
        // Observed without any upload of ours: presence proved, but this build never wrote it,
        // so it cannot claim more than the observation itself supports.
        assert_eq!(
            derive_confirmation(&stamps(None, Some(at(50)), None)),
            ConfirmationTier::Unknown,
            "an observation of a copy we did not upload proves nothing about our own success"
        );
    }

    #[test]
    fn adding_evidence_never_lowers_the_tier() {
        // Monotonicity: the property that makes the ladder safe to display as a progress bar.
        let sequence = [
            stamps(None, None, None),
            stamps(Some(at(1)), None, None),
            stamps(Some(at(1)), Some(at(2)), None),
            stamps(Some(at(1)), Some(at(2)), Some(at(3))),
        ];
        let tiers: Vec<ConfirmationTier> = sequence.iter().map(derive_confirmation).collect();
        assert_eq!(
            tiers,
            vec![
                ConfirmationTier::Unknown,
                ConfirmationTier::Uploaded,
                ConfirmationTier::RemoteObserved,
                ConfirmationTier::ContentVerified,
            ]
        );
        for pair in tiers.windows(2) {
            assert!(pair[1] >= pair[0], "{pair:?} is not monotone");
        }
    }

    #[test]
    fn strength_buckets_group_by_trust_not_by_kind() {
        // Two-sided per bucket: a mapping putting Uploaded in Strong would still show a green chip
        // for the majority of rows and nobody would notice from the passing tests alone.
        assert_eq!(
            ConfirmationTier::ContentVerified.strength(),
            TierStrength::Strong
        );
        assert_eq!(
            ConfirmationTier::PubliclyReachable.strength(),
            TierStrength::Strong,
            "the unimplemented level must not read as weaker than verification"
        );
        for tier in [ConfirmationTier::Uploaded, ConfirmationTier::RemoteObserved] {
            assert_eq!(tier.strength(), TierStrength::Weak, "{tier:?}");
        }
        assert_eq!(
            ConfirmationTier::Unknown.strength(),
            TierStrength::Unconfirmed,
            "unobserved is not the same claim as observed-and-weak"
        );
    }

    #[test]
    fn every_level_names_what_evidence_it_still_lacks() {
        let levels = [
            ConfirmationTier::Unknown,
            ConfirmationTier::Uploaded,
            ConfirmationTier::RemoteObserved,
            ConfirmationTier::ContentVerified,
            ConfirmationTier::PubliclyReachable,
        ];
        for &tier in &levels {
            assert!(
                !tier.missing_evidence().is_empty(),
                "{tier:?} must explain itself, not render an empty reason"
            );
            assert!(
                !levels
                    .iter()
                    .filter(|other| other.missing_evidence() == tier.missing_evidence())
                    .any(|other| *other != tier),
                "two levels sharing one reason text would make the column unreadable at {tier:?}"
            );
        }
    }

    #[test]
    fn strength_spellings_are_stable_and_distinct() {
        // The UI picks its colour from these three strings, so a rename changes which rows look
        // trustworthy without failing any other check.
        assert_eq!(TierStrength::Strong.as_str(), "strong");
        assert_eq!(TierStrength::Weak.as_str(), "weak");
        assert_eq!(TierStrength::Unconfirmed.as_str(), "unconfirmed");
        assert_ne!(TierStrength::Strong.as_str(), TierStrength::Weak.as_str());
        assert_ne!(
            TierStrength::Weak.as_str(),
            TierStrength::Unconfirmed.as_str()
        );
    }

    #[test]
    fn tier_spellings_are_stable_and_distinct() {
        // The frontend switches on these strings, so a rename is an IPC break and must be chosen.
        assert_eq!(ConfirmationTier::Unknown.as_str(), "unknown");
        assert_eq!(ConfirmationTier::Uploaded.as_str(), "uploaded");
        assert_eq!(ConfirmationTier::RemoteObserved.as_str(), "remote_observed");
        assert_eq!(
            ConfirmationTier::ContentVerified.as_str(),
            "content_verified"
        );
        assert_eq!(
            ConfirmationTier::PubliclyReachable.as_str(),
            "publicly_reachable"
        );
        let all = [
            ConfirmationTier::Unknown,
            ConfirmationTier::Uploaded,
            ConfirmationTier::RemoteObserved,
            ConfirmationTier::ContentVerified,
            ConfirmationTier::PubliclyReachable,
        ];
        for left in all {
            for right in all {
                if left != right {
                    assert_ne!(left.as_str(), right.as_str());
                }
            }
        }
    }

    #[test]
    fn publicly_reachable_has_no_producer() {
        // If derivation ever starts returning this level, the ladder is lying again: nobody
        // fetches public URLs in this application. This assertion is the tripwire for that
        // change.
        let strongest = stamps(Some(at(1)), Some(at(2)), Some(at(3)));
        assert_ne!(
            derive_confirmation(&strongest),
            ConfirmationTier::PubliclyReachable
        );
        assert!(ConfirmationTier::PubliclyReachable.is_unimplemented());
        assert!(!ConfirmationTier::ContentVerified.is_unimplemented());
    }

    #[test]
    fn the_tier_orders_by_strength_not_by_declaration() {
        assert!(ConfirmationTier::ContentVerified > ConfirmationTier::RemoteObserved);
        assert!(ConfirmationTier::RemoteObserved > ConfirmationTier::Uploaded);
        assert!(ConfirmationTier::Uploaded > ConfirmationTier::Unknown);
    }

    #[test]
    fn a_failed_upload_still_reports_only_what_evidence_supports() {
        // The §17 invariant expressed in §18 terms: recording an attempt is honest, and it caps
        // out at Uploaded no matter how many retries follow.
        let mut current = DeploymentTimestamps::default();
        for seconds in 1..4 {
            current = current.with(
                crate::deployment_timestamps::TimestampCause::Attempted,
                at(seconds),
            );
        }
        assert_eq!(derive_confirmation(&current), ConfirmationTier::Uploaded);
        assert_eq!(current.last_verified_at, None);
    }

    #[test]
    fn tier_survives_the_status_field_being_online_without_verification() {
        // Guards the exact combination the old code produced and could not describe: a row that
        // says Online while nothing ever checked it. The tier names the gap instead of hiding
        // it.
        use crate::Deployment;
        let deployment = Deployment {
            id: Uuid::new_v4(),
            variant_id: Uuid::new_v4(),
            storage_id: Uuid::new_v4(),
            role: DeploymentRole::Primary,
            remote_path: "assets/blog/u0123456789abcdef0123456789abcdef.png".into(),
            public_url: Some("https://example.invalid/x.png".into()),
            status: DeploymentStatus::Online,
            timestamps: stamps(Some(at(1)), None, None),
        };
        assert_eq!(
            derive_confirmation(&deployment.timestamps),
            ConfirmationTier::Uploaded,
            "a public URL in hand is not evidence the object is reachable"
        );
    }
}
