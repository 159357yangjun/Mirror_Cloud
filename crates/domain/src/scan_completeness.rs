//! Whether a remote listing actually covered the remote.
//!
//! ## The defect this exists to stop
//!
//! `sync_storage_asset_index` walks directories and imports what it finds, and its result was six
//! counters plus a bag of Chinese sentences. A caller could not tell "the remote holds 2000 files"
//! from "the remote holds 15000 and we stopped at 2000", because stopping early produced exactly
//! the same shape as finishing. piclist §19 names this precisely: the world layer treating an
//! incomplete observation as complete fact.
//!
//! Three independent things can truncate a scan, and they are easy to conflate:
//!
//! | source | detected how | honest verdict |
//! |---|---|---|
//! | provider API cap (Contents returns <=1000 entries per dir) | `list_truncated` | unknown |
//! | our own per-storage file budget | limit reached | partial |
//! | a directory that failed to read and was skipped | error recorded mid-walk | unknown |
//!
//! The middle one is *partial* because we know exactly where we stopped; the outer two are
//! *unknown* because we do not know what the unread portion contains. Collapsing them would be the
//! same mistake in a new uniform.
//!
//! ## Why `Unknown` outranks `Partial`
//!
//! When both happen - we hit our budget *and* some directory errored - the result is reported as
//! unknown. Partial asserts "everything past this point is simply unbrowsed"; an errored directory
//! makes even that claim unsafe: the failure may have been transient and the directory may
//! be empty. Ordering the merge by confidence rather than by recency keeps weaker evidence
//! from inheriting the stronger one's guarantee.
//!
//! ## What completeness may never be used for
//!
//! Only `Complete` supports concluding that something is absent from the remote. That rule
//! lives here as a predicate so no call site can quietly reason from a partial scan to a
//! deletion decision.

use serde::{Deserialize, Serialize};

/// How much of a storage a single listing pass actually covered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanCompleteness {
    /// Every directory was listed, none reported truncation, no budget was reached.
    Complete,
    /// We chose to stop: our own file or directory budget ran out. Where we stopped is known.
    Partial,
    /// Something was unobservable without us choosing it: a read failed, or the provider cut a
    /// directory short. What lies in the unread portion is genuinely unknown.
    Unknown,
}

impl ScanCompleteness {
    pub fn as_str(self) -> &'static str {
        match self {
            ScanCompleteness::Complete => "complete",
            ScanCompleteness::Partial => "partial",
            ScanCompleteness::Unknown => "unknown",
        }
    }

    /// Read back a stored value. Anything unrecognised becomes `Unknown`.
    ///
    /// This is the opposite default from the deployment-error parser, which falls back to
    /// `Rejected`: there, guessing low means "read the message". Here a corrupt row must not be
    /// allowed to imply coverage nobody observed, because the only safe direction is toward less
    /// confidence.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "complete" => ScanCompleteness::Complete,
            "partial" => ScanCompleteness::Partial,
            _ => ScanCompleteness::Unknown,
        }
    }

    /// Whether absence may be concluded from a scan at this level.
    pub fn supports_absence_conclusion(self) -> bool {
        self == ScanCompleteness::Complete
    }
}

/// Why a scan stopped where it did. Persisted beside the level so a reader can act on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanStopReason {
    /// Finished normally; nothing was left behind.
    Exhausted,
    /// `MAX_REMOTE_FILES_PER_STORAGE` was reached.
    FileLimit,
    /// `MAX_REMOTE_DIRECTORIES_PER_STORAGE` was reached.
    DirectoryLimit,
    /// At least one directory could not be read.
    ProviderError,
    /// At least one directory hit a provider-side cap we did not choose.
    ApiTruncation,
}

impl ScanStopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            ScanStopReason::Exhausted => "exhausted",
            ScanStopReason::FileLimit => "file_limit",
            ScanStopReason::DirectoryLimit => "directory_limit",
            ScanStopReason::ProviderError => "provider_error",
            ScanStopReason::ApiTruncation => "api_truncation",
        }
    }

    /// Read back a stored value; anything unrecognised becomes `ProviderError`.
    ///
    /// There is no `Unknown` spelling here, so the fallback has to borrow from completeness'
    /// vocabulary: an unreadable reason must not decode as `Exhausted`, because that would tell a
    /// reader the walk finished normally when all we know is that its record is damaged.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "exhausted" => ScanStopReason::Exhausted,
            "file_limit" => ScanStopReason::FileLimit,
            "directory_limit" => ScanStopReason::DirectoryLimit,
            "api_truncation" => ScanStopReason::ApiTruncation,
            _ => ScanStopReason::ProviderError,
        }
    }
}

/// Accumulates events during a walk and yields the honest verdict afterwards.
///
/// A struct rather than a boolean because three distinct signals arrive at different times
/// during a BFS, and any one of them must be able to downgrade the outcome permanently.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScanObservation {
    file_budget_hit: bool,
    directory_budget_hit: bool,
    read_failed: bool,
    read_failures: i64,
    api_truncated_dirs: usize,
    directories_listed: i64,
    entries_seen: i64,
}

impl ScanObservation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn file_budget_exhausted(&mut self) {
        self.file_budget_hit = true;
    }

    pub fn directory_budget_exhausted(&mut self) {
        self.directory_budget_hit = true;
    }

    pub fn record_read_failure(&mut self) {
        self.read_failed = true;
        self.read_failures += 1;
    }

    /// How many directory reads failed. The sweep reports this as its error count: a read failure
    /// is the only kind of failure this walk can neither recover from nor describe honestly with a
    /// bare "some errors happened", and keeping one counter instead of two stops the two numbers
    /// from disagreeing in a stored row.
    pub fn read_failure_count(&self) -> i64 {
        self.read_failures
    }

    pub fn record_api_truncation(&mut self) {
        self.api_truncated_dirs += 1;
    }

    /// Counts one directory whose listing was actually fetched. A failed read is not counted: it
    /// was attempted, not covered.
    pub fn record_directory_listed(&mut self) {
        self.directories_listed += 1;
    }

    pub fn directories_listed(&self) -> i64 {
        self.directories_listed
    }

    /// Entries returned by a successful listing, before any filtering by extension.
    pub fn record_entries_seen(&mut self, count: i64) {
        self.entries_seen += count;
    }

    pub fn entries_seen(&self) -> i64 {
        self.entries_seen
    }

    pub fn truncated_dirs(&self) -> usize {
        self.api_truncated_dirs
    }

    /// The level this walk earned. See the module note for why unknown dominates partial.
    pub fn completeness(&self) -> ScanCompleteness {
        if self.read_failed || self.api_truncated_dirs > 0 {
            return ScanCompleteness::Unknown;
        }
        if self.file_budget_hit || self.directory_budget_hit {
            return ScanCompleteness::Partial;
        }
        ScanCompleteness::Complete
    }

    /// The single reason to report. Chosen by severity, not by which flag was set last, so the
    /// persisted explanation stays stable when several conditions co-occur.
    pub fn stop_reason(&self) -> ScanStopReason {
        if self.read_failed {
            return ScanStopReason::ProviderError;
        }
        if self.api_truncated_dirs > 0 {
            return ScanStopReason::ApiTruncation;
        }
        if self.file_budget_hit {
            return ScanStopReason::FileLimit;
        }
        if self.directory_budget_hit {
            return ScanStopReason::DirectoryLimit;
        }
        ScanStopReason::Exhausted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_walk_reports_complete() {
        let observation = ScanObservation::new();
        assert_eq!(observation.completeness(), ScanCompleteness::Complete);
        assert_eq!(observation.stop_reason(), ScanStopReason::Exhausted);
    }

    #[test]
    fn hitting_our_file_budget_is_partial_not_complete() {
        // The §19 case: 15000 files exist, we browsed 2000. Counters alone looked finished.
        let mut observation = ScanObservation::new();
        observation.file_budget_exhausted();
        assert_eq!(observation.completeness(), ScanCompleteness::Partial);
        assert_eq!(observation.stop_reason(), ScanStopReason::FileLimit);
        assert!(
            !observation.completeness().supports_absence_conclusion(),
            "a scan that stopped early cannot prove anything is absent"
        );
    }

    #[test]
    fn hitting_the_directory_budget_is_also_partial() {
        let mut observation = ScanObservation::new();
        observation.directory_budget_exhausted();
        assert_eq!(observation.completeness(), ScanCompleteness::Partial);
        assert_eq!(observation.stop_reason(), ScanStopReason::DirectoryLimit);
    }

    #[test]
    fn a_skipped_unreadable_directory_is_unknown_not_partial() {
        // We did not choose to stop; we lost sight of a region. "Partial" would imply we
        // know where the coverage ends, which an errored directory makes untrue.
        let mut observation = ScanObservation::new();
        observation.record_read_failure();
        assert_eq!(observation.completeness(), ScanCompleteness::Unknown);
        assert_eq!(observation.stop_reason(), ScanStopReason::ProviderError);
    }

    #[test]
    fn a_provider_side_cap_is_unknown() {
        let mut observation = ScanObservation::new();
        observation.record_api_truncation();
        assert_eq!(observation.completeness(), ScanCompleteness::Unknown);
        assert_eq!(observation.stop_reason(), ScanStopReason::ApiTruncation);
        assert_eq!(observation.truncated_dirs(), 1);
    }

    #[test]
    fn unknown_outranks_partial_when_both_occurred() {
        let mut observation = ScanObservation::new();
        observation.file_budget_exhausted();
        observation.record_read_failure();
        assert_eq!(
            observation.completeness(),
            ScanCompleteness::Unknown,
            "an unchosen blind spot must not inherit the certainty of a chosen stopping point"
        );
        // Reason reports the dominant cause, not whichever flag was set last.
        assert_eq!(observation.stop_reason(), ScanStopReason::ProviderError);
    }

    #[test]
    fn flags_are_sticky_and_order_of_arrival_does_not_matter() {
        let mut first = ScanObservation::new();
        first.record_read_failure();
        first.file_budget_exhausted();
        let mut second = ScanObservation::new();
        second.file_budget_exhausted();
        second.record_read_failure();
        assert_eq!(first.completeness(), second.completeness());
        assert_eq!(first.stop_reason(), second.stop_reason());
    }

    #[test]
    fn counting_truncated_directories_accumulates() {
        let mut observation = ScanObservation::new();
        observation.record_api_truncation();
        observation.record_api_truncation();
        observation.record_api_truncation();
        assert_eq!(observation.truncated_dirs(), 3);
    }

    #[test]
    fn every_level_round_trips_except_unknown_which_is_the_fallback() {
        for level in [
            ScanCompleteness::Complete,
            ScanCompleteness::Partial,
            ScanCompleteness::Unknown,
        ] {
            assert_eq!(ScanCompleteness::parse(level.as_str()), level);
        }
        // Unreadable input degrades downward, never upward.
        for junk in ["", "COMPLETE", "definitely-complete", "complet"] {
            assert_eq!(
                ScanCompleteness::parse(junk),
                ScanCompleteness::Unknown,
                "{junk:?}"
            );
        }
    }

    #[test]
    fn only_a_complete_scan_may_conclude_absence() {
        assert!(ScanCompleteness::Complete.supports_absence_conclusion());
        assert!(!ScanCompleteness::Partial.supports_absence_conclusion());
        assert!(!ScanCompleteness::Unknown.supports_absence_conclusion());
    }

    #[test]
    fn stop_reason_spellings_are_distinct_from_completeness_spellings() {
        // Both are stored as text in the same row; a collision would make a reader ambiguous.
        let reasons = [
            ScanStopReason::Exhausted,
            ScanStopReason::FileLimit,
            ScanStopReason::DirectoryLimit,
            ScanStopReason::ProviderError,
            ScanStopReason::ApiTruncation,
        ];
        let levels = [
            ScanCompleteness::Complete,
            ScanCompleteness::Partial,
            ScanCompleteness::Unknown,
        ];
        for reason in reasons {
            for level in levels {
                assert_ne!(reason.as_str(), level.as_str());
            }
        }
    }

    #[test]
    fn a_fresh_observation_never_starts_at_a_downgraded_level() {
        // Guards against a refactor that flips the default: a scan with no recorded events is
        // complete, and silently defaulting to unknown would make every scan look suspicious.
        assert_eq!(
            ScanObservation::default().completeness(),
            ScanCompleteness::Complete
        );
    }

    #[test]
    fn the_error_count_counts_reads_not_messages() {
        // The sweep persists this as `error_count`. If it counted anything else - a write failure,
        // or one message per failed directory plus one per retried entry - the stored number would
        // stop meaning "directories we could not see into".
        let mut observation = ScanObservation::new();
        assert_eq!(observation.read_failure_count(), 0);
        observation.record_read_failure();
        observation.record_read_failure();
        assert_eq!(observation.read_failure_count(), 2);
        assert_eq!(observation.completeness(), ScanCompleteness::Unknown);
        // A budget hit is our own choice and not a read failure; conflating them would make every
        // large library look like an outage.
        observation.file_budget_exhausted();
        assert_eq!(observation.read_failure_count(), 2);
    }

    #[test]
    fn completeness_spellings_round_trip_and_damage_suggests_less_confidence() {
        for level in [
            ScanCompleteness::Complete,
            ScanCompleteness::Partial,
            ScanCompleteness::Unknown,
        ] {
            assert_eq!(ScanCompleteness::parse(level.as_str()), level);
        }
        assert_eq!(
            ScanCompleteness::parse("definitely-all-of-it"),
            ScanCompleteness::Unknown,
            "an unrecognised coverage claim must decode as the weakest one"
        );
    }

    #[test]
    fn stop_reason_round_trips_and_never_decodes_damage_as_exhausted() {
        // `Exhausted` is the one spelling that would make a damaged record look like a finished
        // walk, so it must not be reachable from an unrecognised value.
        for reason in [
            ScanStopReason::Exhausted,
            ScanStopReason::FileLimit,
            ScanStopReason::DirectoryLimit,
            ScanStopReason::ProviderError,
            ScanStopReason::ApiTruncation,
        ] {
            assert_eq!(ScanStopReason::parse(reason.as_str()), reason);
        }
        assert_eq!(
            ScanStopReason::parse(""),
            ScanStopReason::ProviderError,
            "a blank reason decodes as 'something went wrong', never as 'we finished'"
        );
        assert_eq!(
            ScanStopReason::parse("complete"),
            ScanStopReason::ProviderError,
            "feeding the other column's spelling in must not silently pick a benign reason"
        );
    }
}
