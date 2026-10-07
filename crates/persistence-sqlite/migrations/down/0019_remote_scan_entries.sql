-- Reverse of 0019_remote_scan_entries.sql.
--
-- Index first, then table: the downgrade unwinds the upgrade instead of relying on DROP TABLE to
-- remove a dependent index.

DROP INDEX IF EXISTS idx_remote_scan_entries_path;
DROP TABLE IF EXISTS remote_scan_entries;
