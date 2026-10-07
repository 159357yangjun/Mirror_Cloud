-- Reversible counterpart of 0015_domain_events.sql.
--
-- Drops the journal added by that migration. Indexes go with the table, so no separate DROP INDEX.
-- See docs/MIGRATION_REVERSIBILITY.md for the policy this follows, and for why a downgrade still
-- needs a file backup: the schema round-trips, but recorded events do not come back.
DROP TABLE IF EXISTS domain_events;
