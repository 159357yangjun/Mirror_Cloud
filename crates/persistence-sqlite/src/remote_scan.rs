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

use chrono::{DateTime, Duration, Utc};
use domain::scan_completeness::{ScanCompleteness, ScanStopReason};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// A recorded sweep. Mirrors the `remote_scans` columns (migration 0018).
#[derive(Debug, Clone)]
pub struct RemoteScanRecord {
    /// Assigned by the caller. Kept in the record rather than generated inside `insert_scan`
    /// because the entries written next need the same id, and a second call would have no way to
    /// learn which scan row it belongs to.
    pub id: Uuid,
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

/// Store the paths one sweep saw, so a later reconciliation can differ sets without re-listing.
///
/// Written by the index sync right after `insert_scan`. If it fails the scan row still exists with
/// its coverage verdict, and a reader that finds no entries simply treats the scan as unusable for
/// comparison rather than as "the remote is empty".
/// That degradation direction is the whole point of keeping completeness attached to the set.
pub async fn insert_scan_entries(
    pool: &SqlitePool,
    scan_id: Uuid,
    paths: &[String],
) -> Result<usize, sqlx::Error> {
    let mut stored = 0usize;
    for path in paths {
        // INSERT OR IGNORE on the (scan_id, remote_path) primary key: a BFS can reach one path via
        // two directory spellings, and an unignored duplicate would abort the batch mid-way and
        // leave a half-stored listing - which reads exactly like a truncated one.
        let result = sqlx::query(
            "INSERT OR IGNORE INTO remote_scan_entries (scan_id, remote_path) VALUES (?, ?)",
        )
        .bind(scan_id.to_string())
        .bind(path)
        .execute(pool)
        .await?;
        stored += result.rows_affected() as usize;
    }
    Ok(stored)
}

const SCAN_SNAPSHOT_QUERY: &str = "SELECT id, started_at, finished_at, completeness "
    + "FROM remote_scans WHERE storage_id = ? ORDER BY started_at DESC LIMIT 1";

/// The freshest usable listing for a storage, if one exists inside `max_age`.
///
/// Returns None when there is no scan, the newest one is older than the window, or it carries no
/// entries. Callers treat None as `Untrusted`: absence of a snapshot must never become an empty
/// set, because an empty set is the strongest possible claim about a remote never looked at.
pub async fn fresh_scan_snapshot(
    pool: &SqlitePool,
    storage_id: Uuid,
    now: DateTime<Utc>,
    max_age: Duration,
) -> Result<Option<ScanSnapshot>, sqlx::Error> {
    let row = sqlx::query(SCAN_SNAPSHOT_QUERY)
        .bind(storage_id.to_string())
        .fetch_optional(pool)
        .await?;

    let Some(row) = row else { return Ok(None) };
    let scan_id: String = row.try_get("id")?;
    let started_raw: String = row.try_get("started_at")?;
    let raw_completeness: String = row.try_get("completeness")?;

    let started_at = DateTime::parse_from_rfc3339(&started_raw)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| sqlx::Error::Decode(error.to_string().into()))?;

    // Freshness is measured against the row's own timestamp rather than trusting clock agreement:
    // agreement: a scan recorded by a machine whose clock was ahead would otherwise stay "fresh"
    // forever, since age would compute negative and every negative is under any limit.
    let age = now.signed_duration_since(started_at);
    if age > max_age || age < chrono::Duration::zero() {
        return Ok(None);
    }

    let completeness = ScanCompleteness::parse(&raw_completeness);
    let rows = sqlx::query("SELECT remote_path FROM remote_scan_entries WHERE scan_id = ?")
        .bind(scan_id.clone())
        .fetch_all(pool)
        .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    let paths = rows
        .iter()
        .map(|entry| entry.try_get::<String, _>("remote_path"))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(ScanSnapshot {
        scan_id: Uuid::parse_str(&scan_id).unwrap_or_default(),
        started_at,
        completeness,
        paths,
    }))
}

/// A listing kept from a previous sweep, with the coverage verdict that qualifies it.
#[derive(Debug, Clone)]
pub struct ScanSnapshot {
    pub scan_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub completeness: ScanCompleteness,
    pub paths: Vec<String>,
}

/// When this storage was last walked, from the scan history itself.
///
/// Read from `remote_scans` rather than a settings row so there is one source for "when did we
/// look". A second timestamp written by the scheduler could disagree with the row the snapshot
/// carries, and that disagreement is precisely what decides whether background traffic happens.
///
/// Returns None when no scan has ever been recorded, which the caller reads as "not yet due" - see
/// `scan_due` in reconcile_cadence for why absence is not a licence to crawl.
pub async fn last_scan_at(
    pool: &SqlitePool,
    storage_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let raw: Option<String> = sqlx::query_scalar(LAST_SCAN_QUERY)
        .bind(storage_id.to_string())
        .fetch_optional(pool)
        .await?;
    match raw {
        Some(text) => DateTime::parse_from_rfc3339(&text)
            .map(|value| Some(value.with_timezone(&Utc)))
            .map_err(|error| sqlx::Error::Decode(error.to_string().into())),
        None => Ok(None),
    }
}

const LAST_SCAN_QUERY: &str = "SELECT started_at FROM remote_scans WHERE storage_id = ? "
    + "ORDER BY started_at DESC LIMIT 1";

pub async fn insert_scan(pool: &SqlitePool, record: &RemoteScanRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO remote_scans (id, storage_id, started_at, finished_at, directories_listed, \
         entries_seen, completeness, stop_reason, truncated_dirs, error_count) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(record.id.to_string())
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
            id: Uuid::new_v4(),
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
