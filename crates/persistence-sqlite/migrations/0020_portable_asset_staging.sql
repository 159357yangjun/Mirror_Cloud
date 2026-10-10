-- P2: quarantine for imported image metadata.
-- This table family is deliberately NOT referenced by assets, asset_variants or deployments;
-- no reconciler, share, delete or repair process enumerates staged records.
CREATE TABLE IF NOT EXISTS portable_asset_batches (
    id TEXT PRIMARY KEY NOT NULL,
    source_exported_at TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    storage_mappings_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state = 'pending')
);
CREATE TABLE IF NOT EXISTS portable_asset_staged_items (
    id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL REFERENCES portable_asset_batches(id) ON DELETE CASCADE,
    source_asset_id TEXT NOT NULL,
    source_variant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    review_status TEXT NOT NULL CHECK (review_status IN ('blocked_duplicate','blocked_path','needs_rebind','awaiting_verification')),
    entry_json TEXT NOT NULL,
    resolved_copies INTEGER NOT NULL DEFAULT 0,
    missing_copies INTEGER NOT NULL DEFAULT 0,
    UNIQUE(batch_id, source_asset_id, source_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_portable_asset_items_batch
ON portable_asset_staged_items(batch_id);
