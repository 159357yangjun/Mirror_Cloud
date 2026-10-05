-- Durable domain event journal (piclist #39 piece three's storage half).
--
-- Why a table now: the trait and values shipped without persistence, so nothing could answer
-- "which state transitions happened, in what order". Reconciliation needs that history to tell
-- "the remote object is gone" apart from "we never uploaded it".
--
-- Ordering is assigned by the journal, not the caller. The UNIQUE index below is what makes that
-- claim real: two writers racing for the same (aggregate_kind, aggregate_id, sequence) collide on
-- the constraint instead of silently producing a history with a hole in it.
CREATE TABLE IF NOT EXISTS domain_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    aggregate_kind TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    -- Per-aggregate monotonic position. 1-based; 0 is reserved for "not yet persisted" and must
    -- never reach this table.
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    payload_json TEXT NOT NULL DEFAULT '{}'
);

-- The uniqueness rule that makes gap detection meaningful.
CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_aggregate_sequence
    ON domain_events(aggregate_kind, aggregate_id, sequence);

-- Replay and catch-up read globally ordered rows.
CREATE INDEX IF NOT EXISTS idx_domain_events_sequence
    ON domain_events(sequence);

-- "Everything that happened to this asset", in order.
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate_occurred
    ON domain_events(aggregate_id, occurred_at);

-- DATA-LOSS-WARNING: the down file drops this table, so a downgrade returns the schema cleanly but
-- destroys every recorded event. Back up publisher.sqlite3 first. This is not an IRREVERSIBLE
-- marker: the schema change itself round-trips.
