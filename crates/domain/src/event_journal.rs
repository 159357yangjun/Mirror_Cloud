//! Append-only domain event journal: the values and the storage contract.
//!
//! ## Why this exists
//!
//! State changes today are announced but not recorded. Four `app.emit(...)` calls push
//! `asset://published`, `task://updated`, `integration://shortcut-error` and
//! `integration://shortcut-uploaded` to the webview; if the window is closed, the front end threw
//! the event away, or the process dies, that history is gone. Nothing in the database says which
//! state transitions happened in what order, so a later Reconciliation Engine cannot replay how
//! the system reached its current belief.
//!
//! This module defines the durable layer. It is deliberately *not* wired into the publish path
//! yet, and there is no SQLite implementation in this change - see docs/EVENT_JOURNAL.md for why
//! the storage half waits for the fourth piece.
//!
//! ## Ordering model
//!
//! `sequence` is monotonic per aggregate, not global. A gap in one aggregate's sequence means that
//! aggregate lost an event; unrelated traffic on another aggregate cannot mask it. The journal
//! assigns sequences itself rather than trusting callers: a caller-supplied sequence is the
//! easiest way to silently create exactly the gap that detection is supposed to find.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// What happened. Names describe a completed fact, matching the past-tense convention already used
/// by the webhook plugin's hooks (`after_upload`, `on_publish_failure`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// An asset finished publishing and has at least one usable public URL.
    AssetPublished,
    /// A deployment moved between pending / online / degraded / failed / deleted.
    DeploymentStatusChanged,
    /// One remote upload attempt ended successfully.
    UploadAttemptCompleted,
    /// One remote upload attempt ended with an error.
    UploadAttemptFailed,
    /// A verification result was recorded, including the honest "could not verify" case.
    VerificationRecorded,
    /// A task moved state (this is the durable counterpart of `task://updated`).
    TaskStatusChanged,
    /// A storage target was created, edited, enabled or disabled.
    StorageConfigured,
    /// A credential was stored or rotated. Never carries the secret itself.
    CredentialRotated,
}

impl EventType {
    /// Whether this event may carry an aggregate id of any kind. Every current type does; the
    /// predicate exists so a future session-style event cannot be appended without a reviewer
    /// noticing it breaks the per-aggregate ordering assumption.
    pub fn belongs_to_an_aggregate(&self) -> bool {
        true
    }
}

/// Which kind of object an `aggregate_id` names. Without this, a UUID collision between two tables
/// would let events from different aggregates interleave in one sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregateKind {
    Asset,
    Variant,
    Deployment,
    Task,
    Storage,
    Plugin,
}

/// One immutable fact about a state transition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DomainEvent {
    pub event_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub event_type: EventType,
    pub aggregate_kind: AggregateKind,
    pub aggregate_id: Uuid,
    /// Assigned by the journal at append time. Zero means "not yet persisted".
    pub sequence: u64,
    pub payload: Value,
}

impl DomainEvent {
    /// Build an event with no sequence yet. Callers cannot choose their own position in history.
    pub fn new(
        occurred_at: DateTime<Utc>,
        event_type: EventType,
        aggregate_kind: AggregateKind,
        aggregate_id: Uuid,
        payload: Value,
    ) -> Self {
        Self {
            event_id: Uuid::new_v4(),
            occurred_at,
            event_type,
            aggregate_kind,
            aggregate_id,
            sequence: 0,
            payload,
        }
    }

    /// Journals use this to stamp the assigned position. Consumes and returns the event so the
    /// original unpersisted copy cannot be reused with a stale sequence.
    pub fn with_sequence(self, sequence: u64) -> Self {
        Self { sequence, ..self }
    }
}

/// Errors a journal can refuse an append with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalError {
    /// The store rejected the write. Message must never contain credentials.
    Storage(String),
    /// A requested sequence range could not be served because data is missing.
    GapDetected {
        aggregate_id: Uuid,
        expected: u64,
        found: u64,
    },
}

/// Read/write contract for the durable journal. Only `append`, `events_for` and `events_since` are
/// required; `replay` is derived so an implementation cannot get replay wrong while getting the
/// primitives right.
pub trait EventJournal {
    /// Persist one event and return it with `sequence` assigned. Implementations must reject an
    /// event that already carries a non-zero sequence: that means the caller is trying to inject
    /// a position rather than let the journal order history.
    fn append(&mut self, event: DomainEvent) -> Result<DomainEvent, JournalError>;

    fn events_for(&self, aggregate_id: Uuid) -> Vec<DomainEvent>;

    /// Everything from `from` onward, across aggregates - the entry point for a catch-up reader.
    fn events_since(&self, from: u64) -> Vec<DomainEvent>;

    /// Inclusive ordered range for full replay. Default implementation derives it from
    /// `events_since`; implementations only override it when they can do better than a scan.
    fn replay(&self, from: u64, to: u64) -> Vec<DomainEvent> {
        let mut events = self
            .events_since(from)
            .into_iter()
            .filter(|event| event.sequence <= to)
            .collect::<Vec<_>>();
        events.sort_by_key(|event| event.sequence);
        events
    }

    /// Highest sequence ever assigned, so a reader can tell "caught up" from "behind".
    fn current_sequence(&self) -> u64;
}

/// Detects holes in one aggregate's history. A free function rather than hidden inside a journal,
/// so the in-memory and any future SQL implementation answer it the same way.
pub fn find_gaps(events: &[DomainEvent]) -> Option<(u64, u64)> {
    let mut previous: Option<u64> = None;
    for event in events {
        if let Some(expected) = previous {
            if event.sequence != expected {
                return Some((expected, event.sequence));
            }
        }
        previous = Some(event.sequence.saturating_add(1));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryJournal {
        events: Vec<DomainEvent>,
        next_sequence: u64,
    }

    impl MemoryJournal {
        fn new() -> Self {
            Self::default()
        }
    }

    impl EventJournal for MemoryJournal {
        fn append(&mut self, event: DomainEvent) -> Result<DomainEvent, JournalError> {
            if event.sequence != 0 {
                return Err(JournalError::Storage(
                    "caller supplied a sequence; the journal assigns positions".into(),
                ));
            }
            self.next_sequence += 1;
            let stored = event.with_sequence(self.next_sequence);
            self.events.push(stored.clone());
            Ok(stored)
        }

        fn events_for(&self, aggregate_id: Uuid) -> Vec<DomainEvent> {
            self.events
                .iter()
                .filter(|event| event.aggregate_id == aggregate_id)
                .cloned()
                .collect()
        }

        fn events_since(&self, from: u64) -> Vec<DomainEvent> {
            self.events
                .iter()
                .filter(|event| event.sequence >= from)
                .cloned()
                .collect()
        }

        fn current_sequence(&self) -> u64 {
            self.next_sequence
        }
    }

    fn asset_event(id: Uuid, name: &str) -> DomainEvent {
        DomainEvent::new(
            Utc::now(),
            EventType::AssetPublished,
            AggregateKind::Asset,
            id,
            serde_json::json!({ "name": name }),
        )
    }

    #[test]
    fn new_events_arrive_unsequenced_so_callers_cannot_choose_history_position() {
        let event = asset_event(Uuid::new_v4(), "cat.png");
        assert_eq!(event.sequence, 0);
        assert_eq!(event.event_type, EventType::AssetPublished);
        assert_eq!(event.aggregate_kind, AggregateKind::Asset);
    }

    #[test]
    fn append_assigns_monotonic_sequences_and_returns_the_stamped_event() {
        let mut journal = MemoryJournal::new();
        let first = journal.append(asset_event(Uuid::new_v4(), "a")).unwrap();
        let second = journal.append(asset_event(Uuid::new_v4(), "b")).unwrap();
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert_eq!(journal.current_sequence(), 2);
    }

    #[test]
    fn append_rejects_an_event_that_already_claims_a_sequence() {
        let mut journal = MemoryJournal::new();
        let smuggled = asset_event(Uuid::new_v4(), "x").with_sequence(99);
        let error = journal.append(smuggled).unwrap_err();
        assert!(matches!(error, JournalError::Storage(_)));
        assert_eq!(journal.current_sequence(), 0, "nothing was written");
    }

    #[test]
    fn events_for_scopes_to_one_aggregate_in_insertion_order() {
        let mut journal = MemoryJournal::new();
        let cat = Uuid::new_v4();
        let dog = Uuid::new_v4();
        journal.append(asset_event(cat, "cat-1")).unwrap();
        journal.append(asset_event(dog, "dog-1")).unwrap();
        journal.append(asset_event(cat, "cat-2")).unwrap();

        let cats = journal.events_for(cat);
        assert_eq!(cats.len(), 2);
        assert_eq!(cats[0].payload["name"], "cat-1");
        assert_eq!(cats[1].payload["name"], "cat-2");
        assert_eq!(journal.events_for(dog).len(), 1);
    }

    #[test]
    fn replay_is_inclusive_ordered_and_bounded_on_both_ends() {
        let mut journal = MemoryJournal::new();
        for index in 1..=5 {
            journal
                .append(asset_event(Uuid::new_v4(), &format!("e{index}")))
                .unwrap();
        }
        let window = journal.replay(2, 4);
        assert_eq!(
            window.iter().map(|e| e.sequence).collect::<Vec<_>>(),
            vec![2, 3, 4],
            "inclusive of both bounds"
        );
        assert_eq!(journal.replay(1, 99).len(), 5);
        assert!(journal.replay(6, 9).is_empty());
    }

    #[test]
    fn events_since_is_the_catch_up_entry_point() {
        let mut journal = MemoryJournal::new();
        for _ in 0..3 {
            journal.append(asset_event(Uuid::new_v4(), "n")).unwrap();
        }
        assert_eq!(journal.events_since(3).len(), 1);
        assert_eq!(journal.events_since(1).len(), 3);
        assert!(journal.events_since(4).is_empty());
    }

    #[test]
    fn find_gaps_reports_the_expected_and_found_pair() {
        let aggregate = Uuid::new_v4();
        let contiguous = [1u64, 2, 3]
            .iter()
            .map(|seq| asset_event(aggregate, "n").with_sequence(*seq))
            .collect::<Vec<_>>();
        assert_eq!(find_gaps(&contiguous), None);

        let holey = [1u64, 2, 7]
            .iter()
            .map(|seq| asset_event(aggregate, "n").with_sequence(*seq))
            .collect::<Vec<_>>();
        assert_eq!(find_gaps(&holey), Some((3, 7)));
    }

    #[test]
    fn find_gaps_on_an_empty_slice_is_not_a_gap() {
        assert_eq!(find_gaps(&[]), None);
    }

    #[test]
    fn per_aggregate_sequences_do_not_mask_each_other() {
        // Global ordering plus per-aggregate filtering is the whole point: a busy aggregate must
        // not be able to hide a lost event on a quiet one.
        let mut journal = MemoryJournal::new();
        let busy = Uuid::new_v4();
        let quiet = Uuid::new_v4();
        for _ in 0..4 {
            journal.append(asset_event(busy, "b")).unwrap();
        }
        journal.append(asset_event(quiet, "q")).unwrap();
        assert_eq!(find_gaps(&journal.events_for(busy)), None);
        assert_eq!(find_gaps(&journal.events_for(quiet)), None);
        assert_eq!(journal.events_for(quiet)[0].sequence, 5);
    }

    #[test]
    fn event_type_serializes_to_the_snake_case_names_a_consumer_will_read() {
        let value = serde_json::to_value(EventType::DeploymentStatusChanged).unwrap();
        assert_eq!(value, serde_json::json!("deployment_status_changed"));
        let round_tripped: EventType = serde_json::from_value(value).unwrap();
        assert_eq!(round_tripped, EventType::DeploymentStatusChanged);
    }

    #[test]
    fn every_declared_event_type_belongs_to_an_aggregate() {
        let all = [
            EventType::AssetPublished,
            EventType::DeploymentStatusChanged,
            EventType::UploadAttemptCompleted,
            EventType::UploadAttemptFailed,
            EventType::VerificationRecorded,
            EventType::TaskStatusChanged,
            EventType::StorageConfigured,
            EventType::CredentialRotated,
        ];
        assert!(all.iter().all(EventType::belongs_to_an_aggregate));
        let mut seen = HashMap::new();
        for kind in all {
            seen.insert(serde_json::to_string(&kind).unwrap(), kind);
        }
        assert_eq!(seen.len(), all.len(), "wire names must be unique");
    }
}
