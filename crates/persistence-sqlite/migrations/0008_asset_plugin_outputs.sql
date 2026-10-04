CREATE TABLE IF NOT EXISTS asset_plugin_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  plugin_name TEXT NOT NULL,
  plugin_kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_plugin_outputs_asset ON asset_plugin_outputs(asset_id, created_at ASC);
