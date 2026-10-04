CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storages_provider ON storages(provider_key, enabled);
CREATE INDEX IF NOT EXISTS idx_deployments_status_storage ON deployments(status, storage_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
