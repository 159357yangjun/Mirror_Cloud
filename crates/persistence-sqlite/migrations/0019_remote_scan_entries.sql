-- 0019: the paths one remote scan actually saw.
--
-- ## Why a second table and not a column on remote_scans
--
-- `remote_scans` answers "how much did we cover". Reconciliation needs the other half - *which*
-- paths - because comparing local belief against a sweep is a set difference, and a count cannot be
-- differenced. Storing the list as text on the scan row would put thousands of paths in one value
-- that SQL cannot join or filter against, so the comparison would have to happen in Rust after
-- loading a blob whose size nobody can bound.
--
-- ## Why this history is kept at all instead of re-listing on demand
--
-- Re-listing costs one remote request per directory, every sweep. The listing already happened when
-- the index sync ran; keeping its result turns reconciliation from "walk the storage again" into a
-- database query. That is also why freshness matters (§21): a stale snapshot must not be used as if
-- it were current, so the reader joins back to remote_scans.started_at before trusting these rows.
--
-- ## Why entries are dropped together with their scan
--
-- ON DELETE CASCADE: an entry list without its coverage verdict is exactly the §19 hazard - a bare
-- set of paths silently implying completeness. The cascade makes it impossible to keep the set while
-- losing the caveat that qualifies it.
--
-- ## No CHECK here
--
-- Unlike 0018's completeness column, `remote_path` has no legal-value vocabulary to constrain.
--
-- DOWN: migrations/down/0019_remote_scan_entries.sql.
-- DATA-LOSS-WARNING: downgrading discards every stored listing. Nothing user-created is lost - the
-- objects remain remote - but reconciliation falls back to per-object probing until the next scan.

CREATE TABLE IF NOT EXISTS remote_scan_entries (
    scan_id TEXT NOT NULL REFERENCES remote_scans(id) ON DELETE CASCADE,
    remote_path TEXT NOT NULL,
    PRIMARY KEY (scan_id, remote_path)
);

-- Reads are always "the entries of one scan", which the PK already covers; this serves the opposite
-- direction - "has this path ever been seen in a scan of this storage" - which reconciliation uses
-- to attach a remote-only path to the storage it belongs to.
CREATE INDEX IF NOT EXISTS idx_remote_scan_entries_path
    ON remote_scan_entries(remote_path);
