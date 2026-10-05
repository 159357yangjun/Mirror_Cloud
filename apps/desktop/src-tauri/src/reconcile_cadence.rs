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

/// Persisted user intent about background reconciliation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileConfig {
    pub enabled: bool,
    pub interval_minutes: u32,
}

impl Default for ReconcileConfig {
    /// Disabled by construction. A missing preference must not produce background traffic, so the
    /// default has to be the safe side rather than the convenient one.
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
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
        if !parsed.enabled {
            return Self {
                enabled: false,
                interval_minutes: clamp_interval(parsed.interval_minutes),
            };
        }
        Self {
            enabled: true,
            interval_minutes: clamp_interval(parsed.interval_minutes),
        }
    }

    /// Normalise a requested setting before persisting it.
    pub fn to_stored_value(&self) -> serde_json::Value {
        serde_json::json!({
            "enabled": self.enabled,
            "intervalMinutes": clamp_interval(self.interval_minutes),
        })
    }
}

fn clamp_interval(minutes: u32) -> u32 {
    if minutes < MIN_INTERVAL_MINUTES {
        MIN_INTERVAL_MINUTES
    } else {
        minutes
    }
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
        };
        let read = ReconcileConfig::from_value(Some(&wanted.to_stored_value()));
        assert_eq!(
            read.interval_minutes, MIN_INTERVAL_MINUTES,
            "a one-minute probe loop would hammer provider rate limits"
        );
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
        assert_eq!(plan.after_deployed_at.as_deref(), Some("2026-02-02T00:00:00Z"));
    }

    #[test]
    fn enabling_is_the_only_thing_that_starts_traffic() {
        let off = ReconcileConfig::default();
        let on = ReconcileConfig {
            enabled: true,
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
        };
        assert!(!should_run_on_tick(&off));
        assert!(should_run_on_tick(&on));
    }
}
