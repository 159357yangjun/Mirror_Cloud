//! One row per remote index sweep: what was walked, and how much of it we can trust.
//!
//! ## Why completeness is stored instead of derived at read time
//!
//! The alternative is to re-derive "was this scan complete" from `domain_events` when someone
//! asks. That cannot work: the events record what changed, not what was *looked at*. A sweep that
//! found nothing produces zero events, and a sweep cut off at the file budget also produces zero
//! events - the two are indistinguishable in the journal, which is precisely the §19 failure this
//! table exists to end. Completeness is a property of the observation, so it has to be captured
//! while the observation is happening.
//!
//! ## Why rows accumulate
//!
//! One row per sweep rather than one row per storage, because the difference between two sweeps is
//! the only way to see an entry count plateau at the page ceiling - which is how a silently
//! truncated directory announces itself over time rather than never. No reader exists yet; the
//! reconciliation layer that will ask "is this object really gone?" needs the previous rows to
//! answer, and appending-only is the shape that cannot be written wrong later.
//!
//! ## Free functions over the pool, not a repository method
//!
//! The existing repositories each own one table's CRUD against a local `pool` field. This data is
//! written by exactly one call site (the index sweep) and read by one or two, so functions taking
//! `&SqlitePool` avoid a struct whose only job is holding a clone of a pool the caller already
//! has.

use chrono::{DateTime, Utc};
use domain::scan_completeness::{ScanCompleteness, ScanStopReason};
use sqlx::SqlitePool;
use uuid::Uuid;

/// A recorded sweep. Mirrors the `remote_scans` columns (migration 0018).
#[derive(Debug, Clone)]
pub struct RemoteScanRecord {
    pub storage_id: Uuid,
    pub started_at: DateTime<Utc>,
    /// When the walk ended. The schema makes this NOT NULL because every row is written after the
    /// sweep it describes has already finished; a row that could not be closed would have to be
    /// inferred from an absent row, which is indistinguishable from a storage never scanned.
    pub finished_at: DateTime<Utc>,
    pub directories_listed: i64,
    pub entries_seen: i64,
    pub completeness: ScanCompleteness,
    pub stop_reason: ScanStopReason,
    pub truncated_dirs: i64,
    pub error_count: i64,
}

impl RemoteScanRecord {
    /// Whether an absence conclusion may be drawn from this sweep.
    ///
    /// Delegates to the domain predicate rather than re-checking `completeness == Complete` here:
    /// the rule "only a complete scan proves absence" must have one definition, and this crate is
    /// where a future caller would be tempted to write a second, weaker one.
    pub fn supports_absence_conclusion(&self) -> bool {
        self.completeness.supports_absence_conclusion()
    }
}

pub async fn insert_scan(pool: &SqlitePool, record: &RemoteScanRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO remote_scans (id, storage_id, started_at, finished_at, directories_listed, \
         entries_seen, completeness, stop_reason, truncated_dirs, error_count) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(record.storage_id.to_string())
    .bind(record.started_at.to_rfc3339())
    .bind(record.finished_at.to_rfc3339())
    .bind(record.directories_listed)
    .bind(record.entries_seen)
    .bind(record.completeness.as_str())
    .bind(record.stop_reason.as_str())
    .bind(record.truncated_dirs)
    .bind(record.error_count)
    .execute(pool)
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(completeness: ScanCompleteness, stop_reason: ScanStopReason) -> RemoteScanRecord {
        RemoteScanRecord {
            storage_id: Uuid::new_v4(),
            started_at: Utc::now(),
            finished_at: Utc::now(),
            directories_listed: 12,
            entries_seen: 2000,
            completeness,
            stop_reason,
            truncated_dirs: 0,
            error_count: 0,
        }
    }

    #[test]
    fn only_a_complete_sweep_supports_an_absence_conclusion() {
        // Two-sided on purpose: checking only the negative case would pass for a predicate written
        // as `!= Partial`, which lets Unknown prove absence.
        assert!(
            !record(ScanCompleteness::Partial, ScanStopReason::FileLimit)
                .supports_absence_conclusion()
        );
        assert!(
            !record(ScanCompleteness::Unknown, ScanStopReason::ProviderError)
                .supports_absence_conclusion()
        );
        assert!(
            record(ScanCompleteness::Complete, ScanStopReason::Exhausted)
                .supports_absence_conclusion()
        );
    }

    #[test]
    fn the_record_delegates_to_the_domain_predicate_not_a_local_copy() {
        // If this type grew its own comparison, the two rules could drift apart while both stayed
        // green. Sweeping every level and asserting they move together is what makes that drift a
        // test failure rather than a silent divergence.
        for completeness in [
            ScanCompleteness::Complete,
            ScanCompleteness::Partial,
            ScanCompleteness::Unknown,
        ] {
            let reason = ScanStopReason::DirectoryLimit;
            assert_eq!(
                record(completeness, reason).supports_absence_conclusion(),
                completeness.supports_absence_conclusion(),
                "the record must agree with the domain rule for {completeness:?}"
            );
        }
    }
}
