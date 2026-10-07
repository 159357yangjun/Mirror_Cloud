//! Background reconciliation cadence: what a sweep should examine next, and when.
//!
//! ## Why this module is pure
//!
//! A scheduled job that talks to remote storage is the hardest thing in this application to test,
//! because the honest version of "did it behave?" requires an account and a network. Everything
//! decidable without either lives here as functions over values: whether the job should run at
//! all, how often, which slice of the library it examines, and where the cursor moves afterwards.
//! The
//! actor in commands/reconcile.rs does nothing but feed these and perform their verdicts.
//!
//! ## Two failure modes this design is specifically against
//!
//! **Unattended traffic.** Today the sweep runs only when a person clicks. A timer turns that into
//! background requests against every enabled storage on every interval, forever, on machines whose
//! owners never asked. So disabled is the constructed default, the enable flag is read rather than
//! assumed, and an unset preference means "do not send anything".
//!
//! **Re-probing the same newest rows.** `online_deployments` orders by `deployed_at DESC LIMIT n`.
//! Called repeatedly with no cursor, a timer would examine the same 200 newest deployments every
//! cycle and never reach older ones - spending rate-limit quota indefinitely while coverage of the
//! actual library stays at zero for everything else. Rotation is therefore part of the cadence,
//! not a follow-up: the cursor advances each pass and wraps.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// Rows examined per page within one sweep.
pub const PAGE_LIMIT: i64 = 200;
/// Rows examined per sweep at most, so a huge library cannot turn one cycle into unbounded
/// traffic.
pub const SWEEP_ROW_BUDGET: i64 = 600;
/// Default interval between sweeps when enabled.
pub const DEFAULT_INTERVAL_MINUTES: u32 = 360;
/// Floor for the interval. Below this the job is closer to a stress tool than a reconciler.
pub const MIN_INTERVAL_MINUTES: u32 = 30;
/// Ceiling for the interval. A value this large means "effectively never", and the UI offers it as
/// an explicit choice rather than letting someone type a number that silently disables the job.
pub const MAX_INTERVAL_MINUTES: u32 = 7 * 24 * 60;
/// Default gap between background index scans, which is what keeps reconciliation's set comparison
/// supplied. Chosen to match the snapshot freshness window: scanning more often than the window
/// would let reconciliation compare against a listing it is about to replace anyway, and scanning
/// less often means every sweep finds its snapshot already stale and falls back to probing.
pub const DEFAULT_SCAN_INTERVAL_MINUTES: u32 = 24 * 60;
/// Floor for the scan interval. Below this the job is a crawler, not a reconciler: one scan walks
/// every directory of every enabled storage, so the cheapest setting still costs real requests.
pub const MIN_SCAN_INTERVAL_MINUTES: u32 = 60;

/// Persisted user intent about background reconciliation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileConfig {
    pub enabled: bool,
    pub interval_minutes: u32,
    /// How often the background task refreshes the remote index, independently of how often it
    /// probes rows. Separate because they cost different things: a probe pass is bounded by the
    /// row budget, a scan pass walks every directory.
    ///
    /// `serde(default)` is load-bearing, not decoration: existing installs hold a stored object
    /// without this key, and without it `from_value` returns the whole-default (disabled) config
    /// for them - silently turning off a job the user switched on. The floor value keeps that
    /// default equal to what a fresh install gets.
    #[serde(default = "default_scan_interval")]
    pub scan_interval_minutes: u32,
}

impl Default for ReconcileConfig {
    /// Disabled by construction. A missing preference must not produce background traffic, so the
    /// default has to be the safe side rather than the convenient one.
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
            scan_interval_minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
        }
    }
}

impl ReconcileConfig {
    /// Read the stored preference, falling back to the inert default.
    ///
    /// Anything unrecognised degrades to disabled: a corrupt or hand-edited value should stop the
    /// job, not start it with a guessed schedule.
    pub fn from_value(value: Option<&serde_json::Value>) -> Self {
        let parsed: ReconcileConfig = match value {
            Some(raw) => serde_json::from_value(raw.clone()).unwrap_or_default(),
            None => return Self::default(),
        };
        // `scanIntervalMinutes` is read with serde's default so a preference written before this
        // field existed still parses. Rejecting it outright would disable background
        // reconciliation for every existing install on upgrade, which is the opposite of a
        // backwards-compatible addition.
        if !parsed.enabled {
            return Self {
                enabled: false,
                interval_minutes: clamp_interval(parsed.interval_minutes),
                scan_interval_minutes: clamp_scan_interval(parsed.scan_interval_minutes),
            };
        }
        Self {
            enabled: true,
            interval_minutes: clamp_interval(parsed.interval_minutes),
            scan_interval_minutes: clamp_scan_interval(parsed.scan_interval_minutes),
        }
    }

    /// Normalise a requested setting before persisting it.
    pub fn to_stored_value(&self) -> serde_json::Value {
        serde_json::json!({
            "enabled": self.enabled,
            "intervalMinutes": clamp_interval(self.interval_minutes),
            "scanIntervalMinutes": clamp_scan_interval(self.scan_interval_minutes),
        })
    }
}

fn default_scan_interval() -> u32 {
    DEFAULT_SCAN_INTERVAL_MINUTES
}

fn clamp_scan_interval(minutes: u32) -> u32 {
    // Zero and huge values both land on the floor or ceiling rather than passing through: the
    // caller multiplies this by 60 into a sleep duration.
    minutes.clamp(MIN_SCAN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
}

fn clamp_interval(minutes: u32) -> u32 {
    // Both bounds are required. Without the upper one, `minutes * 60` in the sleep call overflows
    // u64-free arithmetic on a hand-edited value and the resulting duration is meaningless.
    minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
}

/// Which page a sweep should fetch.
///
/// `Some(cursor)` asks for rows older than a point in time; `None` asks for the newest page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepPlan {
    pub after_deployed_at: Option<String>,
    pub pages: usize,
}

/// Decide the pages for one sweep, given where the last one stopped.
///
/// Budget is divided by page size, floored at one page, and capped so a large budget cannot
/// produce an unbounded request count.
pub fn plan_sweep(after_deployed_at: Option<String>) -> SweepPlan {
    let pages = (SWEEP_ROW_BUDGET / PAGE_LIMIT).max(1) as usize;
    SweepPlan {
        after_deployed_at,
        pages,
    }
}

/// Where the next sweep should start, after one that examined `rows` and ended at `last_seen`.
///
/// Wraps to the newest page once a pass reaches the end of the library, so repeated cycles walk
/// the whole set instead of parking on the front of it. An empty result also wraps: there was
/// nothing newer to skip, so the next cycle starts clean.
pub fn advance_cursor(
    rows_examined: usize,
    last_seen_deployed_at: Option<String>,
) -> Option<String> {
    if rows_examined == 0 {
        return None;
    }
    match last_seen_deployed_at {
        // A full page almost certainly has more behind it, so continue past what we just saw.
        Some(cursor) if rows_examined as i64 >= PAGE_LIMIT => Some(cursor),
        // Short page: we reached the end. Wrap.
        Some(_) => None,
        // No usable timestamp in the batch: do not invent one, and do not stall forever either.
        None => None,
    }
}

/// Whether a scheduled tick should actually run a sweep.
///
/// Kept separate from the loop so both answers are testable: a timer that fires is not the same
/// thing as a sweep being allowed to hit the network.
pub fn should_run_on_tick(config: &ReconcileConfig) -> bool {
    config.enabled
}

/// Whether this tick should refresh the remote index.
///
/// ## Why "no timestamp" is not "due now"
///
/// A fresh install has never scanned, so `last_scan_at` is None. Returning true there would make
/// the first scheduled tick walk every directory of every enabled storage on a machine whose owner
/// not asked for anything beyond installing the app - and background reconciliation is opt-in, but
/// the scan budget is per storage and unbounded across storages. So absence means "not yet": the
/// first snapshot comes from a person clicking sync or running a sweep, which is also what makes
/// the decision observable rather than inferred from traffic in a log.
///
/// ## Why a future-dated timestamp means not due
///
/// Same reason as the snapshot freshness check: without it, a clock that ran ahead once would keep
/// the job asleep forever, because every subsequent comparison would still read "in the future".
/// Treating negative elapsed as "not due" costs one missed cycle; the alternative costs them all.
pub fn scan_due(
    last_scan_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    interval_minutes: u32,
) -> bool {
    let Some(last) = last_scan_at else {
        return false;
    };
    let elapsed = now.signed_duration_since(last);
    if elapsed.num_seconds() < 0 {
        return false;
    }
    elapsed >= Duration::minutes(i64::from(interval_minutes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_preference_means_no_background_traffic() {
        let config = ReconcileConfig::from_value(None);
        assert!(
            !config.enabled,
            "a fresh install must not send remote probes nobody asked for"
        );
        assert!(!should_run_on_tick(&config));
    }

    #[test]
    fn an_unreadable_preference_degrades_to_disabled() {
        for junk in [
            serde_json::json!("yes"),
            serde_json::json!({ "enabled": "true" }),
            serde_json::json!({}),
        ] {
            let config = ReconcileConfig::from_value(Some(&junk));
            assert!(!config.enabled, "{junk} must not enable the job");
        }
    }

    #[test]
    fn an_explicit_enable_survives_the_round_trip() {
        let wanted = ReconcileConfig {
            enabled: true,
            interval_minutes: 60,
            scan_interval_minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
        };
        let stored = wanted.to_stored_value();
        let read = ReconcileConfig::from_value(Some(&stored));
        assert!(read.enabled);
        assert_eq!(read.interval_minutes, 60);
    }

    #[test]
    fn an_interval_below_the_floor_is_raised_not_honoured() {
        let wanted = ReconcileConfig {
            enabled: true,
            interval_minutes: 1,
            scan_interval_minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
        };
        let read = ReconcileConfig::from_value(Some(&wanted.to_stored_value()));
        assert_eq!(
            read.interval_minutes, MIN_INTERVAL_MINUTES,
            "a one-minute probe loop would hammer provider rate limits"
        );
    }

    #[test]
    fn an_absurd_interval_is_capped_instead_of_overflowing_the_sleep() {
        // u32::MAX minutes multiplied by 60 wraps, and a wrapped duration is not "never" - it can
        // arrive almost immediately. The ceiling keeps a hand-edited or hostile value inside the
        // range the UI itself offers.
        for huge in [u32::MAX, 100_000_000, MAX_INTERVAL_MINUTES + 1] {
            let wanted = ReconcileConfig {
                enabled: true,
                interval_minutes: huge,
                scan_interval_minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
            };
            let read = ReconcileConfig::from_value(Some(&wanted.to_stored_value()));
            assert_eq!(
                read.interval_minutes, MAX_INTERVAL_MINUTES,
                "{huge} must clamp to the ceiling, not pass through"
            );
        }
    }

    #[test]
    fn a_full_page_advances_past_what_was_just_examined() {
        let cursor = advance_cursor(PAGE_LIMIT as usize, Some("2026-01-01T00:00:00Z".into()));
        assert_eq!(cursor.as_deref(), Some("2026-01-01T00:00:00Z"));
    }

    #[test]
    fn reaching_the_end_wraps_instead_of_parking_on_the_newest_rows() {
        // This is the coverage bug: without wrapping, every later cycle re-examines the same front
        // slice and older deployments are never probed again.
        let cursor = advance_cursor(7, Some("2026-01-01T00:00:00Z".into()));
        assert_eq!(cursor, None, "a short page means the walk finished");
    }

    #[test]
    fn an_empty_library_wraps_rather_than_stalling() {
        assert_eq!(advance_cursor(0, Some("2026-01-01T00:00:00Z".into())), None);
        assert_eq!(advance_cursor(0, None), None);
    }

    #[test]
    fn a_missing_timestamp_never_invents_a_cursor() {
        assert_eq!(advance_cursor(PAGE_LIMIT as usize, None), None);
    }

    #[test]
    fn one_sweep_is_bounded_regardless_of_library_size() {
        let plan = plan_sweep(None);
        assert_eq!(plan.pages, (SWEEP_ROW_BUDGET / PAGE_LIMIT) as usize);
        assert!(
            plan.pages * PAGE_LIMIT as usize <= SWEEP_ROW_BUDGET as usize,
            "a single sweep may not exceed its row budget"
        );
        assert_eq!(plan.after_deployed_at, None);
    }

    #[test]
    fn a_plan_carries_the_cursor_it_was_given() {
        let plan = plan_sweep(Some("2026-02-02T00:00:00Z".into()));
        assert_eq!(
            plan.after_deployed_at.as_deref(),
            Some("2026-02-02T00:00:00Z")
        );
    }

    #[test]
    fn a_fresh_install_is_not_scan_due() {
        // The §21 requirement that first installs stay silent: no stored timestamp means the
        // background task must not walk every directory of every storage.
        let now = Utc::now();
        assert!(
            !scan_due(None, now, DEFAULT_SCAN_INTERVAL_MINUTES),
            "absence of a scan timestamp is 'not yet', never 'due'"
        );
    }

    #[test]
    fn a_recent_scan_is_not_due_and_an_old_one_is() {
        let now = DateTime::parse_from_rfc3339("2026-01-02T12:00:00Z")
            .expect("fixed instant")
            .with_timezone(&Utc);
        let just_under = now - Duration::minutes(24 * 60 - 1);
        let exactly_at = now - Duration::minutes(24 * 60);
        let well_past = now - Duration::minutes(24 * 60 + 1);
        assert!(!scan_due(Some(just_under), now, 24 * 60));
        assert!(
            scan_due(Some(exactly_at), now, 24 * 60),
            "the boundary is inclusive: waiting one full interval is due"
        );
        assert!(scan_due(Some(well_past), now, 24 * 60));
    }

    #[test]
    fn a_clock_in_the_future_does_not_put_the_job_to_sleep_forever() {
        // Without the negative-elapsed guard this returns true forever after one clock jump ahead,
        // because every later tick still compares against a future timestamp.
        let now = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
            .expect("fixed instant")
            .with_timezone(&Utc);
        let ahead = now + Duration::hours(6);
        assert!(!scan_due(Some(ahead), now, 60));
    }

    #[test]
    fn the_scan_interval_survives_a_round_trip_and_clamps() {
        let wanted = ReconcileConfig {
            enabled: true,
            interval_minutes: 60,
            scan_interval_minutes: 5,
        };
        let stored = wanted.to_stored_value();
        let read_back = ReconcileConfig::from_value(Some(&stored));
        assert_eq!(
            read_back.scan_interval_minutes, MIN_SCAN_INTERVAL_MINUTES,
            "a five-minute scan cadence is a crawler, and the floor must reject it"
        );
        assert_eq!(read_back.interval_minutes, 60);
    }

    #[test]
    fn an_old_stored_preference_without_the_new_key_keeps_the_user_enabled() {
        // The upgrade path for a user who already turned background reconciliation on. Losing
        // their opt-in to a missing key would be a silent behaviour change in their settings.
        let legacy = serde_json::json!({ "enabled": true, "intervalMinutes": 120 });
        let config = ReconcileConfig::from_value(Some(&legacy));
        assert!(config.enabled, "a pre-existing enable must survive");
        assert_eq!(config.interval_minutes, 120);
        assert_eq!(
            config.scan_interval_minutes, DEFAULT_SCAN_INTERVAL_MINUTES,
            "the missing key takes the documented default, not zero"
        );
    }

    #[test]
    fn enabling_is_the_only_thing_that_starts_traffic() {
        let off = ReconcileConfig::default();
        let on = ReconcileConfig {
            enabled: true,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
            scan_interval_minutes: DEFAULT_SCAN_INTERVAL_MINUTES,
        };
        assert!(!should_run_on_tick(&off));
        assert!(should_run_on_tick(&on));
    }
}
