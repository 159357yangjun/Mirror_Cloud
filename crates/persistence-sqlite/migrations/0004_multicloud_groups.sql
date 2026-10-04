ALTER TABLE deployments ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_storage_group_members_priority
    ON storage_group_members(group_id, priority, role);
CREATE INDEX IF NOT EXISTS idx_deployments_status
    ON deployments(status);
