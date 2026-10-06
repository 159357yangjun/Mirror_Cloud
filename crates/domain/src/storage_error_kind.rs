//! What a storage failure means for the person who just hit it.
//!
//! ## Why this exists separately from the error message
//!
//! `StorageError` already carries a human-readable explanation, and those strings are good - they
//! name the token scope to fix, they say whether a batch will keep going. But a string cannot be
//! branched on without pattern matching prose, so every consumer that wanted to decide "retry, or
//! tell the user to edit their config?" had to re-derive it by reading text. Worse, the funnel in
//! `application::PublisherCore::upload_member` called `.to_string()` on the error, which discarded
//! the enum variant entirely: by the time a failure reached the database, "your token expired" and
//! "the network flinched" were the same kind of thing - a sentence.
//!
//! ## The axis this classifies on
//!
//! Not transport (HTTP status) and not cause (which syscall failed), but **what the user should do
//! next**. Two failures with identical status codes land in different kinds when one is fixable by
//! editing settings and the other resolves itself on retry, because that difference is the one a
//! person can act on:
//!
//! | kind | meaning | next step |
//! |---|---|---|
//! | authentication | provider knows us and refuses | replace or re-scope the credential |
//! | network | never got a verdict | wait and retry; change nothing |
//! | rate_limited | asked too often | back off; retrying immediately makes it worse |
//! | not_found | named target does not exist | fix the configuration; retrying cannot help |
//! | conflict | someone else moved the branch | transient; safe to retry |
//! | rejected | provider refused for another reason | read the message |
//! | unsupported | this provider cannot do the operation | pick another provider |
//! | not_implemented | our code has a gap | report it; nothing the user can change helps |
//!
//! ## Why unknown input degrades to `rejected` rather than failing
//!
//! A persisted kind can predate a rename, or be hand-edited. Returning `None` would push every
//! caller to invent its own fallback, and an invented fallback for "we don't know what went wrong"
//! tends to be optimistic. `rejected` is the honest floor: something was refused, and we cannot
//! say how it should be handled. It never claims recoverability.

use serde::{Deserialize, Serialize};

/// The eight ways a storage operation can fail, named by the user's next action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageErrorKind {
    /// The provider recognised the request and refused it on identity or scope grounds.
    Authentication,
    /// No verdict was ever received: connection, DNS, TLS or timeout.
    Network,
    /// The provider throttled us explicitly.
    RateLimited,
    /// The addressed repository, branch, bucket or object does not exist.
    NotFound,
    /// A concurrent write invalidated ours. Transient by nature.
    Conflict,
    /// Refused for a reason not otherwise classified.
    Rejected,
    /// The provider does not support this operation at all.
    Unsupported,
    /// Our own code path is incomplete.
    NotImplemented,
}

impl StorageErrorKind {
    /// Stable persisted spelling. Kept apart from `Serialize` so a future serde attribute change
    /// cannot silently rewrite rows already on disk.
    pub fn as_str(self) -> &'static str {
        match self {
            StorageErrorKind::Authentication => "authentication",
            StorageErrorKind::Network => "network",
            StorageErrorKind::RateLimited => "rate_limited",
            StorageErrorKind::NotFound => "not_found",
            StorageErrorKind::Conflict => "conflict",
            StorageErrorKind::Rejected => "rejected",
            StorageErrorKind::Unsupported => "unsupported",
            StorageErrorKind::NotImplemented => "not_implemented",
        }
    }

    /// Read back a persisted kind. Unrecognised input becomes `Rejected`, never an error.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "authentication" => StorageErrorKind::Authentication,
            "network" => StorageErrorKind::Network,
            "rate_limited" => StorageErrorKind::RateLimited,
            "not_found" => StorageErrorKind::NotFound,
            "conflict" => StorageErrorKind::Conflict,
            "unsupported" => StorageErrorKind::Unsupported,
            "not_implemented" => StorageErrorKind::NotImplemented,
            _ => StorageErrorKind::Rejected,
        }
    }

    /// Whether trying again could plausibly succeed without anyone changing anything.
    ///
    /// Used by retry and messaging decisions. False for `not_found` on purpose: retrying a typo is
    /// how a batch burns a rate limit while producing nothing.
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            StorageErrorKind::Network
                | StorageErrorKind::RateLimited
                | StorageErrorKind::Conflict
        )
    }

    /// Whether the fix lives in the user's settings rather than in luck or in our code.
    pub fn is_config_actionable(self) -> bool {
        matches!(
            self,
            StorageErrorKind::Authentication | StorageErrorKind::NotFound
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [StorageErrorKind; 8] = [
        StorageErrorKind::Authentication,
        StorageErrorKind::Network,
        StorageErrorKind::RateLimited,
        StorageErrorKind::NotFound,
        StorageErrorKind::Conflict,
        StorageErrorKind::Rejected,
        StorageErrorKind::Unsupported,
        StorageErrorKind::NotImplemented,
    ];

    #[test]
    fn every_kind_round_trips_through_its_persisted_spelling() {
        for kind in ALL {
            assert_eq!(
                StorageErrorKind::parse(kind.as_str()),
                kind,
                "{} does not survive its own name",
                kind.as_str()
            );
        }
    }

    #[test]
    fn persisted_spellings_are_unique() {
        // Two kinds sharing a spelling would make stored rows ambiguous, and the round-trip test
        // above would still pass because parse picks one of them consistently.
        let names: Vec<&str> = ALL.iter().map(|kind| kind.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "{names:?}");
    }

    #[test]
    fn an_unreadable_stored_kind_degrades_to_rejected_not_a_guess() {
        // Covers rows written by a future version, hand-edits, and truncation. None of them may
        // produce a kind that claims recoverability the evidence does not support.
        for junk in ["", "AUTHENTICATION", "timeout", "who_knows", "not-found"] {
            assert_eq!(
                StorageErrorKind::parse(junk),
                StorageErrorKind::Rejected,
                "{junk:?} must not resolve to anything more specific"
            );
        }
    }

    #[test]
    fn retry_is_suggested_only_where_trying_again_can_help() {
        assert!(StorageErrorKind::Network.is_retryable());
        assert!(StorageErrorKind::RateLimited.is_retryable());
        assert!(StorageErrorKind::Conflict.is_retryable());
        // The load-bearing negatives.
        assert!(!StorageErrorKind::NotFound.is_retryable());
        assert!(!StorageErrorKind::Authentication.is_retryable());
        assert!(!StorageErrorKind::NotImplemented.is_retryable());
    }

    #[test]
    fn configuration_advice_is_offered_only_where_the_user_can_act() {
        assert!(StorageErrorKind::Authentication.is_config_actionable());
        assert!(StorageErrorKind::NotFound.is_config_actionable());
        // Telling someone to check their token because the wifi dropped is worse than silence.
        assert!(!StorageErrorKind::Network.is_config_actionable());
        assert!(!StorageErrorKind::RateLimited.is_config_actionable());
        assert!(!StorageErrorKind::Unsupported.is_config_actionable());
    }

    #[test]
    fn the_two_axes_do_not_claim_the_same_failure_twice() {
        // Retryable and config-actionable are meant to be different questions. If one kind were in
        // both sets, a UI driven by these predicates would give contradictory advice.
        for kind in ALL {
            assert!(
                !(kind.is_retryable() && kind.is_config_actionable()),
                "{:?} is both retryable and actionable",
                kind
            );
        }
    }

    #[test]
    fn rejected_is_the_floor_and_claims_nothing() {
        assert!(!StorageErrorKind::Rejected.is_retryable());
        assert!(!StorageErrorKind::Rejected.is_config_actionable());
    }

    #[test]
    fn snake_case_spellings_match_the_serde_representation() {
        // Two independent spellings for the same value in the same row would be a trap; asserting
        // they agree turns that into a compile-visible contract.
        for kind in ALL {
            let json = serde_json::to_value(kind).expect("serialises");
            assert_eq!(json.as_str(), Some(kind.as_str()), "{kind:?}");
        }
    }
}
