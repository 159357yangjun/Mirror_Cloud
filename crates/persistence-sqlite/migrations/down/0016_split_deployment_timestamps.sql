-- Reverse of 0016_split_deployment_timestamps.sql.
--
-- Drops the three columns that migration added and restores `recorded_at` as the only write clock,
-- which is the shape the schema had before. `recorded_at` itself was never dropped by 0016, so no
-- value has to be reconstructed - see the note in the up file about why keeping it is deliberate.
--
-- DATA-LOSS-WARNING: the backfilled `last_attempted_at` history is discarded on the way down. It came
-- from `recorded_at`, which survives, so re-applying 0016 reproduces the same values. What cannot be
-- recovered is any `last_observed_at` / `last_verified_at` written between upgrading and downgrading:
-- those recorded probes and proofs that `recorded_at` never held. Back up publisher.sqlite3 first.

ALTER TABLE deployments DROP COLUMN last_attempted_at;
ALTER TABLE deployments DROP COLUMN last_observed_at;
ALTER TABLE deployments DROP COLUMN last_verified_at;
