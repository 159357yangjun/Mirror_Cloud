DROP INDEX IF EXISTS idx_variants_hash;
CREATE INDEX IF NOT EXISTS idx_variants_hash ON asset_variants(content_hash);
