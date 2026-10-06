-- One row per remote listing pass, carrying how much of the remote it actually covered.
--
-- Why this table exists: `sync_storage_asset_index` walks directories and reports six counters plus a
-- bag of sentences. Stopping early produced exactly the same shape as finishing, so a caller could not
-- tell "the remote holds 2000 files" from "the remote holds 15000 and we browsed 2000". piclist §19
-- calls this the world layer treating an incomplete observation as complete fact; §20 asks that an
-- observation carry its own credibility. This is that credibility, persisted.
--
-- completeness is the load-bearing column and takes three values only:
--   complete - every directory listed, nothing truncated, no budget reached
--   partial  - we chose to stop at our own file or directory limit
--   unknown  - something was unobservable without us choosing it (a read failed, or the provider cut
--              a directory short)
-- Only `complete` may ever support concluding that an object is absent.
--
-- Unlike domain_events.event_type, this column IS constrained by CHECK. The difference is who reads
-- it: event_type is only replayed back into Rust, while completeness will be filtered in SQL by any
-- future consumer asking "is there a complete scan of this storage?" - and a CHECK-free typo would
-- answer that question wrongly in silence rather than fail. Adding a fourth level means adding a
-- migration on purpose.
--
-- Rows accumulate rather than overwrite. A storage's coverage over time is the useful signal ("when
-- did we last see the whole thing?"), and keeping history means a later bad scan cannot retroactively
-- launder an earlier good one.
--
-- DOWN: migrations/down/0018_remote_scans.sql drops the table.
-- DATA-LOSS-WARNING: a downgrade discards scan history. It is reconstructible by scanning again, but
-- "when was this last fully observed" is lost, so back up publisher.sqlite3 first.

CREATE TABLE IF NOT EXISTS remote_scans (
    id TEXT PRIMARY KEY NOT NULL,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    -- Directories actually listed, including ones whose contents were skipped as non-images.
    directories_listed INTEGER NOT NULL DEFAULT 0,
    -- Entries the walk saw before any limit stopped it. Not the number imported.
    entries_seen INTEGER NOT NULL DEFAULT 0,
    completeness TEXT NOT NULL
        CHECK (completeness IN ('complete', 'partial', 'unknown')),
    stop_reason TEXT NOT NULL
        CHECK (stop_reason IN ('exhausted', 'file_limit', 'directory_limit',
                               'provider_error', 'api_truncation')),
    -- How many directories hit a provider-side cap we did not choose.
    truncated_dirs INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
);

-- "What is the most recent scan of this storage, and can I trust it?"
CREATE INDEX IF NOT EXISTS idx_remote_scans_storage_started
    ON remote_scans(storage_id, started_at DESC);
