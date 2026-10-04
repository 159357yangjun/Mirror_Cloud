CREATE TABLE IF NOT EXISTS plugin_execution_logs (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    plugin_name TEXT NOT NULL,
    hook TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_execution_logs_created_at
    ON plugin_execution_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_execution_logs_plugin_id_created_at
    ON plugin_execution_logs(plugin_id, created_at DESC);
