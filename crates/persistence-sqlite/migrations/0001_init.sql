PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_variants (
    id TEXT PRIMARY KEY NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_asset_id ON asset_variants(asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_hash ON asset_variants(content_hash, mime_type, size_bytes);

CREATE TABLE IF NOT EXISTS storages (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    category TEXT NOT NULL,
    credential_ref TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY NOT NULL,
    variant_id TEXT NOT NULL REFERENCES asset_variants(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    public_url TEXT,
    status TEXT NOT NULL,
    deployed_at TEXT,
    verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deployments_variant ON deployments(variant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_storage ON deployments(storage_id);

CREATE TABLE IF NOT EXISTS storage_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_group_members (
    group_id TEXT NOT NULL REFERENCES storage_groups(id) ON DELETE CASCADE,
    storage_id TEXT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(group_id, storage_id)
);

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC);
