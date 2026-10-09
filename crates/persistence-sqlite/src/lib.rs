use std::path::Path;

pub mod journal;
pub mod remote_scan;

use chrono::{DateTime, Utc};
use domain::{
    Asset, AssetVariant, Deployment, DeploymentRole, DeploymentStatus, StorageCategory, Task,
    TaskStatus, Workflow,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
};
use uuid::Uuid;

pub async fn connect(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}

pub async fn connect_path(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageRecord {
    pub id: Uuid,
    pub name: String,
    pub provider_key: String,
    pub category: String,
    pub credential_ref: Option<String>,
    pub config_json: Value,
    pub capabilities_json: Value,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct StorageRepository {
    pool: SqlitePool,
}

impl StorageRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, record: &StorageRecord) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO storages (id,name,provider_key,category,credential_ref,config_json,capabilities_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(record.id.to_string())
            .bind(&record.name)
            .bind(&record.provider_key)
            .bind(&record.category)
            .bind(&record.credential_ref)
            .bind(record.config_json.to_string())
            .bind(record.capabilities_json.to_string())
            .bind(if record.enabled { 1 } else { 0 })
            .bind(record.created_at.to_rfc3339())
            .bind(record.updated_at.to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<StorageRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT id,name,provider_key,category,credential_ref,config_json,capabilities_json,enabled,created_at,updated_at FROM storages WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(parse_storage_row).transpose()
    }

    pub async fn list(&self) -> Result<Vec<StorageRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,provider_key,category,credential_ref,config_json,capabilities_json,enabled,created_at,updated_at FROM storages ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(parse_storage_row).collect()
    }

    pub async fn usage_counts(&self, id: Uuid) -> Result<(i64, i64, i64), sqlx::Error> {
        let id_text = id.to_string();
        let deployments: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM deployments WHERE storage_id=?")
                .bind(&id_text)
                .fetch_one(&self.pool)
                .await?;
        let groups: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM storage_group_members WHERE storage_id=?")
                .bind(&id_text)
                .fetch_one(&self.pool)
                .await?;
        let workflows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM workflows WHERE steps_json LIKE ?")
                .bind(format!("%{id_text}%"))
                .fetch_one(&self.pool)
                .await?;
        Ok((deployments, groups, workflows))
    }

    pub async fn delete(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM storages WHERE id=?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn parse_storage_row(row: SqliteRow) -> Result<StorageRecord, sqlx::Error> {
    let id: String = row.try_get("id")?;
    let config_json: String = row.try_get("config_json")?;
    let capabilities_json: String = row.try_get("capabilities_json")?;
    let created_at: String = row.try_get("created_at")?;
    let updated_at: String = row.try_get("updated_at")?;
    Ok(StorageRecord {
        id: parse_uuid(&id)?,
        name: row.try_get("name")?,
        provider_key: row.try_get("provider_key")?,
        category: row.try_get("category")?,
        credential_ref: row.try_get("credential_ref")?,
        config_json: parse_json(&config_json)?,
        capabilities_json: parse_json(&capabilities_json)?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        created_at: parse_dt(&created_at)?,
        updated_at: parse_dt(&updated_at)?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: Uuid,
    pub kind: String,
    pub status: String,
    pub progress: u8,
    pub payload_json: Value,
    pub attempt: u32,
    pub max_attempts: u32,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct TaskRepository {
    pool: SqlitePool,
}

impl TaskRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, task: &Task, payload: &Value) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO tasks (id,kind,status,progress,payload_json,attempt,max_attempts,error,created_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .bind(task.id.to_string())
            .bind(&task.kind)
            .bind(task_status_str(&task.status))
            .bind(task.progress as i64)
            .bind(payload.to_string())
            .bind(task.attempt as i64)
            .bind(task.max_attempts as i64)
            .bind(&task.error)
            .bind(task.created_at.to_rfc3339())
            .bind(task.started_at.map(|value| value.to_rfc3339()))
            .bind(task.finished_at.map(|value| value.to_rfc3339()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_status(
        &self,
        id: Uuid,
        status: TaskStatus,
        progress: u8,
        error: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let started = matches!(status, TaskStatus::Preparing | TaskStatus::Running);
        let finished = matches!(
            status,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
        );
        // Cancellation is user intent, so a worker that finishes after a cancel must not rewrite
        // the row back to running/completed/failed. Without this clause every mark_running,
        // complete and fail call below revives a cancelled task.
        sqlx::query("UPDATE tasks SET status=?, progress=?, error=?, started_at=COALESCE(started_at, CASE WHEN ? THEN ? ELSE NULL END), finished_at=CASE WHEN ? THEN ? ELSE finished_at END WHERE id=? AND status <> 'cancelled'")
            .bind(task_status_str(&status))
            .bind(progress.min(100) as i64)
            .bind(error)
            .bind(started)
            .bind(&now)
            .bind(finished)
            .bind(&now)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn recover_interrupted(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("UPDATE tasks SET status='failed', progress=100, error=COALESCE(error, '应用上次退出，任务已中断'), finished_at=? WHERE status IN ('queued','preparing','running')")
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<TaskRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT * FROM tasks WHERE id=?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(parse_task_record).transpose()
    }

    pub async fn cancel(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query("UPDATE tasks SET status='cancelled', error=COALESCE(error, '用户取消任务'), finished_at=? WHERE id=? AND status IN ('queued','preparing','running','paused')")
            .bind(now)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn is_cancelled(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM tasks WHERE id=?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        Ok(matches!(status.as_deref(), Some("cancelled")))
    }

    pub async fn update_running_progress_if_active(
        &self,
        id: Uuid,
        progress: u8,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query("UPDATE tasks SET status='running', progress=?, started_at=COALESCE(started_at, ?) WHERE id=? AND status IN ('queued','preparing','running')")
            .bind(progress.min(99) as i64)
            .bind(now)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn requeue_for_retry(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("UPDATE tasks SET status='queued', progress=0, attempt=attempt+1, error=NULL, started_at=NULL, finished_at=NULL WHERE id=? AND status IN ('failed','cancelled') AND attempt < max_attempts")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list(&self, limit: i64) -> Result<Vec<TaskRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(parse_task_record).collect()
    }
}

fn parse_task_record(row: SqliteRow) -> Result<TaskRecord, sqlx::Error> {
    let id: String = row.try_get("id")?;
    let payload: String = row.try_get("payload_json")?;
    let created: String = row.try_get("created_at")?;
    let started: Option<String> = row.try_get("started_at")?;
    let finished: Option<String> = row.try_get("finished_at")?;
    Ok(TaskRecord {
        id: parse_uuid(&id)?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        progress: row.try_get::<i64, _>("progress")? as u8,
        payload_json: parse_json(&payload)?,
        attempt: row.try_get::<i64, _>("attempt")? as u32,
        max_attempts: row.try_get::<i64, _>("max_attempts")? as u32,
        error: row.try_get("error")?,
        created_at: parse_dt(&created)?,
        started_at: started.as_deref().map(parse_dt).transpose()?,
        finished_at: finished.as_deref().map(parse_dt).transpose()?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRecord {
    pub workflow: Workflow,
    pub description: String,
    pub source_recipe: Option<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct WorkflowRepository {
    pool: SqlitePool,
}

impl WorkflowRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        &self,
        workflow: &Workflow,
        description: &str,
        source_recipe: Option<&str>,
        is_default: bool,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if is_default {
            sqlx::query("UPDATE workflows SET is_default=0")
                .execute(&mut *tx)
                .await?;
        }
        let now = Utc::now().to_rfc3339();
        let steps = serde_json::to_string(&workflow.steps)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
        sqlx::query("INSERT INTO workflows (id,name,steps_json,is_default,created_at,updated_at,description,source_recipe) VALUES (?,?,?,?,?,?,?,?)")
            .bind(workflow.id.to_string())
            .bind(&workflow.name)
            .bind(steps)
            .bind(if is_default { 1 } else { 0 })
            .bind(&now)
            .bind(&now)
            .bind(description)
            .bind(source_recipe)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn upsert_system_default(
        &self,
        workflow: &Workflow,
        description: &str,
        source_recipe: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE workflows SET is_default=0")
            .execute(&mut *tx)
            .await?;
        let now = Utc::now().to_rfc3339();
        let steps = serde_json::to_string(&workflow.steps)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
        let existing = sqlx::query("SELECT id FROM workflows WHERE source_recipe=? LIMIT 1")
            .bind(source_recipe)
            .fetch_optional(&mut *tx)
            .await?;
        if let Some(row) = existing {
            let id: String = row.try_get("id")?;
            sqlx::query("UPDATE workflows SET name=?,steps_json=?,is_default=1,updated_at=?,description=? WHERE id=?")
                .bind(&workflow.name)
                .bind(&steps)
                .bind(&now)
                .bind(description)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("INSERT INTO workflows (id,name,steps_json,is_default,created_at,updated_at,description,source_recipe) VALUES (?,?,?,?,?,?,?,?)")
                .bind(workflow.id.to_string())
                .bind(&workflow.name)
                .bind(&steps)
                .bind(1)
                .bind(&now)
                .bind(&now)
                .bind(description)
                .bind(source_recipe)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<WorkflowRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT id,name,steps_json,is_default,created_at,updated_at,description,source_recipe FROM workflows WHERE id=?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(parse_workflow_row).transpose()
    }

    pub async fn list(&self) -> Result<Vec<WorkflowRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,steps_json,is_default,created_at,updated_at,description,source_recipe FROM workflows ORDER BY is_default DESC, updated_at DESC")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(parse_workflow_row).collect()
    }

    pub async fn set_default(&self, id: Uuid) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE workflows SET is_default=0")
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE workflows SET is_default=1, updated_at=? WHERE id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(id.to_string())
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn delete(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM workflows WHERE id=?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn parse_workflow_row(row: SqliteRow) -> Result<WorkflowRecord, sqlx::Error> {
    let id: String = row.try_get("id")?;
    let steps_raw: String = row.try_get("steps_json")?;
    let created_at: String = row.try_get("created_at")?;
    let updated_at: String = row.try_get("updated_at")?;
    let steps =
        serde_json::from_str(&steps_raw).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    Ok(WorkflowRecord {
        workflow: Workflow {
            id: parse_uuid(&id)?,
            name: row.try_get("name")?,
            steps,
        },
        description: row.try_get("description")?,
        source_recipe: row.try_get("source_recipe")?,
        is_default: row.try_get::<i64, _>("is_default")? != 0,
        created_at: parse_dt(&created_at)?,
        updated_at: parse_dt(&updated_at)?,
    })
}

#[derive(Clone)]
pub struct SettingsRepository {
    pool: SqlitePool,
}

impl SettingsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, key: &str) -> Result<Option<Value>, sqlx::Error> {
        let row = sqlx::query("SELECT value_json FROM app_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let raw: String = row.try_get("value_json")?;
            parse_json(&raw)
        })
        .transpose()
    }

    pub async fn set(&self, key: &str, value: &Value) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO app_settings (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at")
            .bind(key)
            .bind(value.to_string())
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewStorageGroupMember {
    pub storage_id: Uuid,
    pub role: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGroupMemberRecord {
    pub storage_id: Uuid,
    pub storage_name: String,
    pub provider_key: String,
    pub role: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGroupRecord {
    pub id: Uuid,
    pub name: String,
    pub strategy: String,
    pub members: Vec<StorageGroupMemberRecord>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct StorageGroupRepository {
    pool: SqlitePool,
}

impl StorageGroupRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(
        &self,
        id: Uuid,
        name: &str,
        strategy: &str,
        members: &[NewStorageGroupMember],
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO storage_groups (id,name,strategy,created_at,updated_at) VALUES (?,?,?,?,?)")
            .bind(id.to_string())
            .bind(name)
            .bind(strategy)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        for member in members {
            sqlx::query("INSERT INTO storage_group_members (group_id,storage_id,role,priority) VALUES (?,?,?,?)")
                .bind(id.to_string())
                .bind(member.storage_id.to_string())
                .bind(&member.role)
                .bind(member.priority)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<StorageGroupRecord>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT id,name,strategy,created_at,updated_at FROM storage_groups WHERE id=?",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        Ok(Some(self.group_from_row(row).await?))
    }

    pub async fn list(&self) -> Result<Vec<StorageGroupRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,strategy,created_at,updated_at FROM storage_groups ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            groups.push(self.group_from_row(row).await?);
        }
        Ok(groups)
    }

    async fn group_from_row(&self, row: SqliteRow) -> Result<StorageGroupRecord, sqlx::Error> {
        let id_raw: String = row.try_get("id")?;
        let id = parse_uuid(&id_raw)?;
        let name: String = row.try_get("name")?;
        let strategy: String = row.try_get("strategy")?;
        let created_at: String = row.try_get("created_at")?;
        let updated_at: String = row.try_get("updated_at")?;
        let member_rows = sqlx::query("SELECT m.storage_id,s.name AS storage_name,s.provider_key,m.role,m.priority FROM storage_group_members m JOIN storages s ON s.id=m.storage_id WHERE m.group_id=? ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'mirror' THEN 1 ELSE 2 END, m.priority ASC")
            .bind(id.to_string())
            .fetch_all(&self.pool)
            .await?;
        let members = member_rows
            .into_iter()
            .map(|member| {
                let storage_id: String = member.try_get("storage_id")?;
                Ok(StorageGroupMemberRecord {
                    storage_id: parse_uuid(&storage_id)?,
                    storage_name: member.try_get("storage_name")?,
                    provider_key: member.try_get("provider_key")?,
                    role: member.try_get("role")?,
                    priority: member.try_get("priority")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;
        Ok(StorageGroupRecord {
            id,
            name,
            strategy,
            members,
            created_at: parse_dt(&created_at)?,
            updated_at: parse_dt(&updated_at)?,
        })
    }

    pub async fn delete(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM storage_groups WHERE id=?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentWriteRecord {
    pub deployment: Deployment,
    pub last_error: Option<String>,
    /// Structured failure category, stored beside the message so a reader can branch on it without
    /// matching prose. `None` means "not recorded", which includes rows predating this column - it
    /// does not mean "no error".
    pub error_kind: Option<domain::StorageErrorKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentLocationRecord {
    pub deployment_id: Uuid,
    pub storage_id: Uuid,
    pub remote_path: String,
    pub public_url: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
    /// Ordering key the reconciliation cursor walks. The query already sorts by it; exposing it
    /// lets a sweep continue past the page it read instead of re-reading the newest rows.
    pub deployed_at: Option<String>,
    /// The three evidence clocks behind `derive_confirmation`. Read with `try_get` so a query that
    /// does not select them yields None rather than a row-decode error: three call sites share
    /// this parser and only the reconciliation one needs them.
    pub last_attempted_at: Option<String>,
    pub last_observed_at: Option<String>,
    pub last_verified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeploymentSummaryRecord {
    pub deployment_id: Uuid,
    pub storage_id: Uuid,
    pub storage_name: String,
    pub provider_key: String,
    /// Stored intent from R2 config_json, not a remotely proven privacy verdict.
    pub access_mode: String,
    pub role: String,
    pub status: String,
    pub remote_path: String,
    pub public_url: Option<String>,
    pub last_error: Option<String>,
    /// Structured reason for `last_error`, or None when nothing recorded one.
    pub error_kind: Option<domain::StorageErrorKind>,
    /// Evidence clocks, read out the database so the confirmation tier is derived rather than
    /// stored. A tier computed here cannot disagree with the row it came from.
    pub timestamps: domain::DeploymentTimestamps,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedAssetRecord {
    pub id: Uuid,
    pub name: String,
    pub variant_id: Uuid,
    pub mime_type: String,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
    pub deployments: Vec<DeploymentSummaryRecord>,
    pub plugin_outputs: Vec<AssetPluginOutputRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRepairRecord {
    pub asset_id: Uuid,
    pub name: String,
    pub mime_type: String,
    pub content_hash: String,
    pub deployments: Vec<DeploymentLocationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetPluginOutputRecord {
    pub plugin_id: String,
    pub plugin_name: String,
    pub plugin_kind: String,
    pub text: String,
    pub data_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct AssetRepository {
    pool: SqlitePool,
}

impl AssetRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_published(
        &self,
        asset: &Asset,
        variant: &AssetVariant,
        deployment: &Deployment,
    ) -> Result<(), sqlx::Error> {
        self.insert_published_many(
            asset,
            variant,
            &[DeploymentWriteRecord {
                deployment: deployment.clone(),
                last_error: None,
                error_kind: None,
            }],
        )
        .await
    }

    pub async fn insert_published_many(
        &self,
        asset: &Asset,
        variant: &AssetVariant,
        deployments: &[DeploymentWriteRecord],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO assets (id,name,kind,created_at,updated_at) VALUES (?,?,?,?,?)")
            .bind(asset.id.to_string())
            .bind(&asset.name)
            .bind("image")
            .bind(asset.created_at.to_rfc3339())
            .bind(asset.updated_at.to_rfc3339())
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO asset_variants (id,asset_id,label,mime_type,size_bytes,width,height,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(variant.id.to_string())
            .bind(variant.asset_id.to_string())
            .bind(&variant.label)
            .bind(&variant.mime_type)
            .bind(variant.size_bytes as i64)
            .bind(variant.width.map(|value| value as i64))
            .bind(variant.height.map(|value| value as i64))
            .bind(&variant.content_hash)
            .bind(variant.created_at.to_rfc3339())
            .execute(&mut *tx)
            .await?;
        for record in deployments {
            let deployment = &record.deployment;
            sqlx::query(
                "INSERT INTO deployments (id,variant_id,storage_id,role,remote_path,public_url,status,deployed_at,last_attempted_at,last_observed_at,last_verified_at,last_error,last_error_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(deployment.id.to_string())
            .bind(deployment.variant_id.to_string())
            .bind(deployment.storage_id.to_string())
            .bind(deployment_role_str(&deployment.role))
            .bind(&deployment.remote_path)
            .bind(&deployment.public_url)
            .bind(deployment_status_str(&deployment.status))
            .bind(deployment.timestamps.deployed_at.map(|value| value.to_rfc3339()))
            .bind(deployment.timestamps.last_attempted_at.map(|value| value.to_rfc3339()))
            .bind(deployment.timestamps.last_observed_at.map(|value| value.to_rfc3339()))
            .bind(deployment.timestamps.last_verified_at.map(|value| value.to_rfc3339()))
            .bind(&record.last_error)
            .bind(record.error_kind.map(|kind| kind.as_str()))
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn list(&self, limit: i64) -> Result<Vec<PublishedAssetRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT a.id,a.name,a.created_at,v.id AS variant_id,v.mime_type,v.size_bytes,v.width,v.height,v.content_hash FROM assets a JOIN asset_variants v ON v.asset_id=a.id ORDER BY a.created_at DESC LIMIT ?")
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::new();
        for row in rows {
            let id_raw: String = row.try_get("id")?;
            let variant_raw: String = row.try_get("variant_id")?;
            let created: String = row.try_get("created_at")?;
            let variant_id = parse_uuid(&variant_raw)?;
            let dep_rows = sqlx::query("SELECT d.id AS deployment_id,d.storage_id,s.name AS storage_name,s.provider_key,s.config_json AS storage_config_json,d.role,d.status,d.remote_path,d.public_url,d.last_error,d.last_error_kind,                         d.deployed_at,d.last_attempted_at,d.last_observed_at,d.last_verified_at                          FROM deployments d JOIN storages s ON s.id=d.storage_id WHERE d.variant_id=?                          ORDER BY CASE d.role WHEN 'primary' THEN 0 WHEN 'mirror' THEN 1 ELSE 2 END")
                .bind(variant_id.to_string())
                .fetch_all(&self.pool)
                .await?;
            let deployments = dep_rows
                .into_iter()
                .map(|deployment| {
                    let deployment_id: String = deployment.try_get("deployment_id")?;
                    let storage_id: String = deployment.try_get("storage_id")?;
                    let config_raw: String = deployment.try_get("storage_config_json")?;
                    let config: Value = parse_json(&config_raw)?;
                    let provider_key: String = deployment.try_get("provider_key")?;
                    let access_mode = if provider_key == "r2"
                        && config.get("access_mode").and_then(Value::as_str) == Some("private_requested")
                    {
                        "private_requested"
                    } else {
                        "unknown"
                    };
                    Ok(DeploymentSummaryRecord {
                        deployment_id: parse_uuid(&deployment_id)?,
                        storage_id: parse_uuid(&storage_id)?,
                        storage_name: deployment.try_get("storage_name")?,
                        provider_key,
                        access_mode: access_mode.to_string(),
                        role: deployment.try_get("role")?,
                        status: deployment.try_get("status")?,
                        remote_path: deployment.try_get("remote_path")?,
                        public_url: deployment.try_get("public_url")?,
                        last_error: deployment.try_get("last_error")?,
                        error_kind: parse_stored_error_kind(deployment.try_get("last_error_kind")?),
                        timestamps: read_clocks(&deployment)?,
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?;
            let output_rows = sqlx::query("SELECT plugin_id,plugin_name,plugin_kind,text,data_json,created_at FROM asset_plugin_outputs WHERE asset_id=? ORDER BY created_at ASC")
                .bind(&id_raw)
                .fetch_all(&self.pool)
                .await?;
            let plugin_outputs = output_rows
                .into_iter()
                .map(|output| {
                    let data_raw: String = output.try_get("data_json")?;
                    let created_raw: String = output.try_get("created_at")?;
                    Ok(AssetPluginOutputRecord {
                        plugin_id: output.try_get("plugin_id")?,
                        plugin_name: output.try_get("plugin_name")?,
                        plugin_kind: output.try_get("plugin_kind")?,
                        text: output.try_get("text")?,
                        data_json: parse_json(&data_raw)?,
                        created_at: parse_dt(&created_raw)?,
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?;
            out.push(PublishedAssetRecord {
                id: parse_uuid(&id_raw)?,
                name: row.try_get("name")?,
                variant_id,
                mime_type: row.try_get("mime_type")?,
                size_bytes: row.try_get::<i64, _>("size_bytes")? as u64,
                width: row
                    .try_get::<Option<i64>, _>("width")?
                    .map(|value| value as u32),
                height: row
                    .try_get::<Option<i64>, _>("height")?
                    .map(|value| value as u32),
                content_hash: row.try_get("content_hash")?,
                created_at: parse_dt(&created)?,
                deployments,
                plugin_outputs,
            });
        }
        Ok(out)
    }

    pub async fn replace_plugin_outputs(
        &self,
        asset_id: Uuid,
        outputs: &[AssetPluginOutputRecord],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM asset_plugin_outputs WHERE asset_id=?")
            .bind(asset_id.to_string())
            .execute(&mut *tx)
            .await?;
        for output in outputs {
            sqlx::query("INSERT INTO asset_plugin_outputs (id,asset_id,plugin_id,plugin_name,plugin_kind,text,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
                .bind(Uuid::new_v4().to_string())
                .bind(asset_id.to_string())
                .bind(&output.plugin_id)
                .bind(&output.plugin_name)
                .bind(&output.plugin_kind)
                .bind(&output.text)
                .bind(output.data_json.to_string())
                .bind(output.created_at.to_rfc3339())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn name(&self, asset_id: Uuid) -> Result<Option<String>, sqlx::Error> {
        let row = sqlx::query("SELECT name FROM assets WHERE id=?")
            .bind(asset_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| row.try_get("name")).transpose()
    }

    pub async fn deployment_locations(
        &self,
        asset_id: Uuid,
    ) -> Result<Vec<DeploymentLocationRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT d.id AS deployment_id,d.storage_id,d.remote_path,d.public_url,d.status,d.last_error FROM deployments d JOIN asset_variants v ON v.id=d.variant_id WHERE v.asset_id=? ORDER BY d.deployed_at")
            .bind(asset_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(parse_deployment_location).collect()
    }

    /// Deployments believed to be live, newest first, capped by `limit`.
    ///
    /// A reconciliation sweep needs "everything the app thinks is online", which no existing query
    /// provides: deployment_locations is scoped to one asset and repair_context to one variant.
    /// Without this the scheduler would have to enumerate every asset first, turning a bounded
    /// scan into an unbounded one.
    ///
    /// The limit is required rather than advisory - a large library must not be probed in a single
    /// pass, both for memory and because each row costs a remote request later on. Callers page by
    /// advancing `after_deployed_at`.
    pub async fn online_deployments(
        &self,
        limit: i64,
        after_deployed_at: Option<&str>,
    ) -> Result<Vec<DeploymentLocationRecord>, sqlx::Error> {
        let rows = match after_deployed_at {
            Some(cursor) => sqlx::query(
                "SELECT d.id AS deployment_id,d.storage_id,d.remote_path,d.public_url,d.status,                 d.last_error,d.deployed_at FROM deployments d WHERE d.status IN ('online','degraded')                  AND d.deployed_at < ? ORDER BY d.deployed_at DESC LIMIT ?",
            )
            .bind(cursor)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?,
            None => sqlx::query(
                "SELECT d.id AS deployment_id,d.storage_id,d.remote_path,d.public_url,d.status,                 d.last_error,d.deployed_at FROM deployments d WHERE d.status IN ('online','degraded')                  ORDER BY d.deployed_at DESC LIMIT ?",
            )
            .bind(limit)
            .fetch_all(&self.pool)
            .await?,
        };
        rows.into_iter().map(parse_deployment_location).collect()
    }

    /// Every non-deleted deployment row for one storage, whatever its status.
    ///
    /// Reconciliation's second direction needs this and could not have it: the sweep used to read
    /// `online_deployments`, which filters to online/degraded, so a failed row was never fed to a
    /// comparison that has a branch for "the object is there but our row says it is not". That
    /// branch existed and was unreachable. Widening the row source is what makes it fire;
    /// `status_online` carries the distinction instead of the WHERE clause.
    ///
    /// `deleted` stays excluded on purpose. A tombstone is not a belief about the remote, and
    /// including it would report every deliberately removed object as drift forever.
    pub async fn all_deployment_beliefs(
        &self,
        storage_id: Uuid,
    ) -> Result<Vec<DeploymentLocationRecord>, sqlx::Error> {
        let rows = sqlx::query(BELIEF_QUERY)
            .bind(storage_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(parse_deployment_location).collect()
    }

    pub async fn repair_context(
        &self,
        asset_id: Uuid,
    ) -> Result<Option<AssetRepairRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT a.name,v.mime_type,v.content_hash FROM assets a JOIN asset_variants v ON v.asset_id=a.id WHERE a.id=? ORDER BY v.created_at ASC LIMIT 1")
            .bind(asset_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else { return Ok(None) };
        Ok(Some(AssetRepairRecord {
            asset_id,
            name: row.try_get("name")?,
            mime_type: row.try_get("mime_type")?,
            content_hash: row.try_get("content_hash")?,
            deployments: self.deployment_locations(asset_id).await?,
        }))
    }

    pub async fn deployment_ids_for_remote(
        &self,
        storage_id: Uuid,
        remote_path: &str,
    ) -> Result<Vec<Uuid>, sqlx::Error> {
        let rows = sqlx::query("SELECT id FROM deployments WHERE storage_id=? AND remote_path=? AND status <> 'deleted'")
            .bind(storage_id.to_string())
            .bind(remote_path)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                parse_uuid(&id)
            })
            .collect()
    }

    pub async fn active_deployment_reference_count(
        &self,
        storage_id: Uuid,
        remote_path: &str,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar("SELECT COUNT(*) FROM deployments WHERE storage_id=? AND remote_path=? AND status <> 'deleted'")
            .bind(storage_id.to_string())
            .bind(remote_path)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn update_deployments_remote_location(
        &self,
        storage_id: Uuid,
        old_remote_path: &str,
        new_remote_path: &str,
        public_url: Option<String>,
    ) -> Result<u64, sqlx::Error> {
        // Re-indexing observed the object at a new path; that is presence, not content proof.
        let result = sqlx::query("UPDATE deployments SET remote_path=?, public_url=?, last_observed_at=? WHERE storage_id=? AND remote_path=? AND status <> 'deleted'")
            .bind(new_remote_path)
            .bind(public_url)
            .bind(Utc::now().to_rfc3339())
            .bind(storage_id.to_string())
            .bind(old_remote_path)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn update_deployment_status(
        &self,
        deployment_id: Uuid,
        status: DeploymentStatus,
    ) -> Result<(), sqlx::Error> {
        // A status change is an attempt, never a proof: this write used to stamp `verified_at` on
        // failures. Verification advances only where a content comparison actually passed.
        sqlx::query("UPDATE deployments SET status=?, last_attempted_at=? WHERE id=?")
            .bind(deployment_status_str(&status))
            .bind(Utc::now().to_rfc3339())
            .bind(deployment_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Record that a reconciliation pass looked at this deployment's remote object.
    ///
    /// Presence only: a probe answers "is something there", which is weaker than a content check.
    /// It must not move `last_verified_at`, or a provider serving a placeholder for a deleted key
    /// would mark the copy verified.
    pub async fn record_deployment_observation(
        &self,
        deployment_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE deployments SET last_observed_at=? WHERE id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(deployment_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Advance `last_verified_at` for a deployment whose content comparison passed.
    ///
    /// Kept apart from the status and result updates deliberately: those run on every attempt,
    /// failures included. Folding it into either would recreate the old defect where a failed
    /// upload left its row looking verified.
    pub async fn record_deployment_verification(
        &self,
        deployment_id: Uuid,
        passed: bool,
    ) -> Result<(), sqlx::Error> {
        if !passed {
            // A mismatch records nothing here. The journal keeps the failed check as history; this
            // column answers only "was the last content check a pass, and when".
            return Ok(());
        }
        sqlx::query("UPDATE deployments SET last_verified_at=? WHERE id=?")
            .bind(Utc::now().to_rfc3339())
            .bind(deployment_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_deployment_result(
        &self,
        deployment_id: Uuid,
        status: DeploymentStatus,
        public_url: Option<String>,
        last_error: Option<String>,
        error_kind: Option<domain::StorageErrorKind>,
    ) -> Result<(), sqlx::Error> {
        // The kind is written unconditionally rather than COALESCE'd: carrying an old failure's
        // category forward under a new message would mislabel the row, which is the mistake this
        // column exists to stop.
        sqlx::query("UPDATE deployments SET status=?, public_url=COALESCE(?, public_url), last_error=?, last_error_kind=?, last_attempted_at=? WHERE id=?")
            .bind(deployment_status_str(&status))
            .bind(public_url)
            .bind(last_error)
            .bind(error_kind.map(|kind| kind.as_str()))
            .bind(Utc::now().to_rfc3339())
            .bind(deployment_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_asset(&self, asset_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM assets WHERE id=?")
            .bind(asset_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

/// Read a persisted kind, mapping absent or unrecognised to None.
///
/// `parse` alone folds an unknown spelling into `Rejected`, right for a value written
/// deliberately but wrong for NULL: no row means "never recorded", not "recorded as refused".
fn parse_stored_error_kind(raw: Option<String>) -> Option<domain::StorageErrorKind> {
    raw.map(|value| domain::StorageErrorKind::parse(&value))
}

/// Read the four evidence clocks out of a row, tolerating absent values.
///
/// Unparseable timestamps become None rather than an error. Deliberate but not free: a corrupt
/// value then reads as "less evidence", never as "more", so a bad row degrades toward
/// Unknown instead of inventing a verification.
fn read_clocks(row: &SqliteRow) -> Result<domain::DeploymentTimestamps, sqlx::Error> {
    Ok(domain::DeploymentTimestamps {
        deployed_at: parse_optional_time(row.try_get("deployed_at")?),
        last_attempted_at: parse_optional_time(row.try_get("last_attempted_at")?),
        last_observed_at: parse_optional_time(row.try_get("last_observed_at")?),
        last_verified_at: parse_optional_time(row.try_get("last_verified_at")?),
    })
}

fn parse_optional_time(raw: Option<String>) -> Option<chrono::DateTime<Utc>> {
    raw.and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.with_timezone(&Utc))
}

const BELIEF_QUERY: &str = concat!(
    "SELECT d.id AS deployment_id,d.storage_id,d.remote_path,d.public_url,",
    "d.status,d.last_error,d.deployed_at,d.last_attempted_at,d.last_observed_at,",
    "d.last_verified_at FROM deployments d ",
    "WHERE d.storage_id = ? AND d.status <> 'deleted' ORDER BY d.remote_path"
);

/// Read a text column that some queries in this file do not select.
///
/// `try_get` on a missing column is an error, and treating it as one would make
/// `deployment_locations` fail for a field it never asked for. Absent means "no evidence", which
/// is exactly what None says, so the fallback is honest rather than convenient.
fn optional_column(row: &SqliteRow, name: &str) -> Option<String> {
    match row.try_get::<Option<String>, _>(name) {
        Ok(value) => value,
        Err(_) => None,
    }
}

fn parse_deployment_location(row: SqliteRow) -> Result<DeploymentLocationRecord, sqlx::Error> {
    let deployment_id: String = row.try_get("deployment_id")?;
    let storage_id: String = row.try_get("storage_id")?;
    Ok(DeploymentLocationRecord {
        deployment_id: parse_uuid(&deployment_id)?,
        storage_id: parse_uuid(&storage_id)?,
        remote_path: row.try_get("remote_path")?,
        public_url: row.try_get("public_url")?,
        status: row.try_get("status")?,
        last_error: row.try_get("last_error")?,
        deployed_at: row.try_get("deployed_at")?,
        last_attempted_at: optional_column(&row, "last_attempted_at"),
        last_observed_at: optional_column(&row, "last_observed_at"),
        last_verified_at: optional_column(&row, "last_verified_at"),
    })
}

fn task_status_str(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Queued => "queued",
        TaskStatus::Preparing => "preparing",
        TaskStatus::Running => "running",
        TaskStatus::Paused => "paused",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Cancelled => "cancelled",
    }
}

fn deployment_role_str(role: &DeploymentRole) -> &'static str {
    match role {
        DeploymentRole::Primary => "primary",
        DeploymentRole::Mirror => "mirror",
        DeploymentRole::Backup => "backup",
    }
}

fn deployment_status_str(status: &DeploymentStatus) -> &'static str {
    match status {
        DeploymentStatus::Pending => "pending",
        DeploymentStatus::Online => "online",
        DeploymentStatus::Degraded => "degraded",
        DeploymentStatus::Failed => "failed",
        DeploymentStatus::Deleted => "deleted",
    }
}

#[allow(dead_code)]
fn category_str(category: &StorageCategory) -> &'static str {
    match category {
        StorageCategory::Object => "object",
        StorageCategory::Repository => "repository",
        StorageCategory::Protocol => "protocol",
        StorageCategory::Custom => "custom",
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, sqlx::Error> {
    Uuid::parse_str(value).map_err(|error| sqlx::Error::Decode(Box::new(error)))
}

fn parse_dt(value: &str) -> Result<DateTime<Utc>, sqlx::Error> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}

fn parse_json(value: &str) -> Result<Value, sqlx::Error> {
    serde_json::from_str(value).map_err(|error| sqlx::Error::Decode(Box::new(error)))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub manifest_json: Value,
    pub config_json: Value,
    pub granted_permissions_json: Value,
    pub enabled_hooks_json: Value,
    pub enabled: bool,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginExecutionLogRecord {
    pub id: Uuid,
    pub plugin_id: String,
    pub plugin_name: String,
    pub hook: String,
    pub status: String,
    pub duration_ms: i64,
    pub message: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct PluginRepository {
    pool: SqlitePool,
}
impl PluginRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
    pub async fn list(&self) -> Result<Vec<PluginRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,version,manifest_json,config_json,granted_permissions_json,enabled_hooks_json,enabled,source,created_at,updated_at FROM plugins ORDER BY created_at DESC").fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                let manifest: String = row.try_get("manifest_json")?;
                let config: String = row.try_get("config_json")?;
                let grants: String = row.try_get("granted_permissions_json")?;
                let hooks: String = row.try_get("enabled_hooks_json")?;
                let created: String = row.try_get("created_at")?;
                let updated: String = row.try_get("updated_at")?;
                Ok(PluginRecord {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    version: row.try_get("version")?,
                    manifest_json: parse_json(&manifest)?,
                    config_json: parse_json(&config)?,
                    granted_permissions_json: parse_json(&grants)?,
                    enabled_hooks_json: parse_json(&hooks)?,
                    enabled: row.try_get::<i64, _>("enabled")? != 0,
                    source: row.try_get("source")?,
                    created_at: parse_dt(&created)?,
                    updated_at: parse_dt(&updated)?,
                })
            })
            .collect()
    }
    pub async fn get(&self, id: &str) -> Result<Option<PluginRecord>, sqlx::Error> {
        let row=sqlx::query("SELECT id,name,version,manifest_json,config_json,granted_permissions_json,enabled_hooks_json,enabled,source,created_at,updated_at FROM plugins WHERE id=?").bind(id).fetch_optional(&self.pool).await?;
        row.map(|row| {
            let manifest: String = row.try_get("manifest_json")?;
            let config: String = row.try_get("config_json")?;
            let grants: String = row.try_get("granted_permissions_json")?;
            let hooks: String = row.try_get("enabled_hooks_json")?;
            let created: String = row.try_get("created_at")?;
            let updated: String = row.try_get("updated_at")?;
            Ok(PluginRecord {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                version: row.try_get("version")?,
                manifest_json: parse_json(&manifest)?,
                config_json: parse_json(&config)?,
                granted_permissions_json: parse_json(&grants)?,
                enabled_hooks_json: parse_json(&hooks)?,
                enabled: row.try_get::<i64, _>("enabled")? != 0,
                source: row.try_get("source")?,
                created_at: parse_dt(&created)?,
                updated_at: parse_dt(&updated)?,
            })
        })
        .transpose()
    }
    pub async fn upsert(&self, record: &PluginRecord) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO plugins (id,name,version,manifest_json,config_json,granted_permissions_json,enabled_hooks_json,enabled,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,manifest_json=excluded.manifest_json,config_json=excluded.config_json,granted_permissions_json=excluded.granted_permissions_json,enabled_hooks_json=excluded.enabled_hooks_json,enabled=excluded.enabled,source=excluded.source,updated_at=excluded.updated_at")
          .bind(&record.id).bind(&record.name).bind(&record.version).bind(record.manifest_json.to_string()).bind(record.config_json.to_string()).bind(record.granted_permissions_json.to_string()).bind(record.enabled_hooks_json.to_string()).bind(if record.enabled {1}else{0}).bind(&record.source).bind(record.created_at.to_rfc3339()).bind(record.updated_at.to_rfc3339()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE plugins SET enabled=?, updated_at=? WHERE id=?")
            .bind(if enabled { 1 } else { 0 })
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn set_granted_permissions(
        &self,
        id: &str,
        permissions: &Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE plugins SET granted_permissions_json=?, updated_at=? WHERE id=?")
            .bind(permissions.to_string())
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn set_config(&self, id: &str, config: &Value) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE plugins SET config_json=?, updated_at=? WHERE id=?")
            .bind(config.to_string())
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn set_enabled_hooks(&self, id: &str, hooks: &Value) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE plugins SET enabled_hooks_json=?, updated_at=? WHERE id=?")
            .bind(hooks.to_string())
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM plugins WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn record_execution(
        &self,
        plugin_id: &str,
        plugin_name: &str,
        hook: &str,
        status: &str,
        duration_ms: i64,
        message: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO plugin_execution_logs (id,plugin_id,plugin_name,hook,status,duration_ms,message,created_at) VALUES (?,?,?,?,?,?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(plugin_id).bind(plugin_name).bind(hook).bind(status).bind(duration_ms.max(0)).bind(message).bind(Utc::now().to_rfc3339()).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn list_execution_logs(
        &self,
        limit: i64,
    ) -> Result<Vec<PluginExecutionLogRecord>, sqlx::Error> {
        let rows=sqlx::query("SELECT id,plugin_id,plugin_name,hook,status,duration_ms,message,created_at FROM plugin_execution_logs ORDER BY created_at DESC LIMIT ?").bind(limit.clamp(1,500)).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                let id: String = row.try_get("id")?;
                let created: String = row.try_get("created_at")?;
                Ok(PluginExecutionLogRecord {
                    id: parse_uuid(&id)?,
                    plugin_id: row.try_get("plugin_id")?,
                    plugin_name: row.try_get("plugin_name")?,
                    hook: row.try_get("hook")?,
                    status: row.try_get("status")?,
                    duration_ms: row.try_get("duration_ms")?,
                    message: row.try_get("message")?,
                    created_at: parse_dt(&created)?,
                })
            })
            .collect()
    }
}
