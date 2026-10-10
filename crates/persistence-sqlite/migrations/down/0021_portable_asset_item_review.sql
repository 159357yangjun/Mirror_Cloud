-- SQLite DROP COLUMN support is required by the migration toolchain.
-- DATA-LOSS-WARNING: removes operator decisions and per-row remappings only.
-- Does not delete pending batches/items or active image data.
ALTER TABLE portable_asset_staged_items DROP COLUMN reviewed_at;
ALTER TABLE portable_asset_staged_items DROP COLUMN revision;
ALTER TABLE portable_asset_staged_items DROP COLUMN binding_overrides_json;
ALTER TABLE portable_asset_staged_items DROP COLUMN operator_decision;
