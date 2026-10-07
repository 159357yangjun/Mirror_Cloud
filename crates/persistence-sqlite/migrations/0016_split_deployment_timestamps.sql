-- Split the single deployment timestamp into four, each with one legitimate cause.
--
-- Why a split rather than another rename: `recorded_at` (formerly `verified_at`) is written by every
-- path that touches the row - publish success, publish failure, remote-index sync, status change,
-- repair. One column therefore carries three distinct facts (we tried / we looked / we proved), and
-- no reader can tell them apart. piclist §15 recorded the concrete symptom: `status = Failed` could
-- sit next to a fresh "verified" timestamp, so the field could not support the sentence "this copy
-- was verified at this time".
--
-- The old values are all of the "row was written locally" variety, so they migrate into
-- `last_attempted_at`: it is the only one of the four whose meaning covers every prior write. They do
-- NOT migrate into `last_verified_at`, which would carry the original lie forward into a column whose
-- whole purpose is to stop telling it.
--
-- `deployed_at` already exists and already means "first landed", so it stays as it is; the backfill
-- below seeds it from rows that are currently online, since those demonstrably did deploy.
--
-- DOWN: migrations/down/0016_split_deployment_timestamps.sql drops the three new columns. It does not
-- restore `recorded_at`'s value, so a downgrade loses "when was this row last written" for every row.
-- Back up publisher.sqlite3 first. This is DATA-LOSS-WARNING, not IRREVERSIBLE: the schema shape
-- round-trips, and no user content is destroyed.

ALTER TABLE deployments ADD COLUMN last_attempted_at TEXT;
ALTER TABLE deployments ADD COLUMN last_observed_at TEXT;
ALTER TABLE deployments ADD COLUMN last_verified_at TEXT;

-- Carry the honest part of the old column forward: every previous write was an attempt or a local
-- bookkeeping touch, never a proof.
UPDATE deployments SET last_attempted_at = recorded_at WHERE last_attempted_at IS NULL;

