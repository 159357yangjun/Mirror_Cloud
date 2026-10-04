use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type AssetId = Uuid;
pub type VariantId = Uuid;
pub type DeploymentId = Uuid;
pub type StorageId = Uuid;
pub type TaskId = Uuid;
pub type WorkflowId = Uuid;
pub type StorageGroupId = Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: AssetId,
    pub name: String,
    pub kind: AssetKind,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetVariant {
    pub id: VariantId,
    pub asset_id: AssetId,
    pub label: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageCategory {
    Object,
    Repository,
    Protocol,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageCapabilities {
    pub upload: bool,
    pub download: bool,
    pub delete: bool,
    pub list: bool,
    pub move_object: bool,
    pub public_url: bool,
    pub versioning: bool,
    pub streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageProfile {
    pub id: StorageId,
    pub name: String,
    pub provider_key: String,
    pub category: StorageCategory,
    pub capabilities: StorageCapabilities,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentRole {
    Primary,
    Mirror,
    Backup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StorageGroupStrategy {
    MirrorAll,
    PrimaryWithBackups,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGroupMember {
    pub storage_id: StorageId,
    pub role: DeploymentRole,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGroup {
    pub id: StorageGroupId,
    pub name: String,
    pub strategy: StorageGroupStrategy,
    pub members: Vec<StorageGroupMember>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentStatus {
    Pending,
    Online,
    Degraded,
    Failed,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deployment {
    pub id: DeploymentId,
    pub variant_id: VariantId,
    pub storage_id: StorageId,
    pub role: DeploymentRole,
    pub remote_path: String,
    pub public_url: Option<String>,
    pub status: DeploymentStatus,
    pub deployed_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Preparing,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: TaskId,
    pub kind: String,
    pub status: TaskStatus,
    pub progress: u8,
    pub attempt: u32,
    pub max_attempts: u32,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: WorkflowId,
    pub name: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PublishTarget {
    Storage { storage_id: Uuid },
    StorageGroup { storage_group_id: Uuid },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowStep {
    Resize { max_width: u32, max_height: u32 },
    Convert { format: String, quality: u8 },
    Rename { template: String },
    Publish { target: PublishTarget },
    Output { template: String },
}
