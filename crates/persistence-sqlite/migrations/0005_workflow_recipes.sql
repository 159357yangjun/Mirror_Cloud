ALTER TABLE workflows ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE workflows ADD COLUMN source_recipe TEXT;
CREATE INDEX IF NOT EXISTS idx_workflows_default_updated ON workflows(is_default DESC, updated_at DESC);
