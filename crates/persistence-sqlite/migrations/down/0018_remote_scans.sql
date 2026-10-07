-- Reverse of 0018_remote_scans.sql.
--
-- The index is dropped first so the downgrade reads as an unwind of the upgrade rather than relying
-- on DROP TABLE cascading to remove dependent indexes.

DROP INDEX IF EXISTS idx_remote_scans_storage_started;
DROP TABLE IF EXISTS remote_scans;
