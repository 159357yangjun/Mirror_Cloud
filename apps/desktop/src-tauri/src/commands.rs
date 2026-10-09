use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use application::{CloudMutationCore, PublishMember, PublisherCore};
use bytes::Bytes;
use chrono::Utc;
use domain::{
    Asset, AssetKind, AssetVariant, Deployment, DeploymentRole, DeploymentStatus, PublishTarget,
    StorageGroupStrategy, Workflow, WorkflowStep,
};
use persistence_sqlite::{
    AssetPluginOutputRecord, DeploymentWriteRecord, NewStorageGroupMember, PluginRecord,
    PublishedAssetRecord, StorageGroupRecord, StorageRecord, TaskRecord, WorkflowRecord,
};
use plugin_runtime::{PluginContext, PluginHook, PluginManifest, PluginPermission};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use storage_core::{StorageEntry, StorageError, StorageProvider, UploadRequest};
use storage_gitee::{GiteeCredentials, GiteeStorage, GiteeStorageConfig};
use storage_github::{GitHubCredentials, GitHubStorage, GitHubStorageConfig};
use storage_opendal::{
    CosCredentials, CosStorageConfig, ObjectAccessMode, OpenDalStorage, OssCredentials,
    OssStorageConfig, S3Credentials, S3StorageConfig, WebDavCredentials, WebDavStorageConfig,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;
use workflow_engine::prepare_asset;

use crate::AppState;

pub(crate) mod integrations;
pub(crate) mod plugins;
pub(crate) mod reconcile;
pub(crate) mod remote_index;
pub(crate) mod storage_entries;
pub(crate) mod updater;
pub use plugins::*;
pub use remote_index::*;
pub use storage_entries::*;

pub(crate) type CmdResult<T> = Result<T, String>;
pub(crate) const OUTPUT_PREFERENCES_KEY: &str = "output.preferences";
const DEFAULT_TARGET_KEY: &str = "publish.default_target";
const SYSTEM_PIPELINE_SOURCE: &str = "__system_default__";
const AI_SETTINGS_KEY: &str = "ai.provider";
const AI_CREDENTIAL_KEY: &str = "ai:provider";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    recommended_for: &'static str,
    setup_minutes: u8,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapSnapshot {
    app_name: &'static str,
    version: &'static str,
    providers: Vec<ProviderSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TyporaIntegrationInfo {
    pub command: String,
    pub executable: String,
    pub data_dir: String,
    pub default_workflow: Option<String>,
    pub ready: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPublishTargetView {
    pub kind: String,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateS3StorageInput {
    pub provider_key: String,
    pub name: String,
    pub account_id: Option<String>,
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub bucket: String,
    pub root: Option<String>,
    pub public_base_url: Option<String>,
    #[serde(default)]
    pub access_mode: ObjectAccessMode,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateObjectStorageInput {
    pub provider_key: String,
    pub name: String,
    pub endpoint: String,
    pub bucket: String,
    pub root: Option<String>,
    pub public_base_url: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWebDavStorageInput {
    pub name: String,
    pub endpoint: String,
    pub root: Option<String>,
    pub public_base_url: Option<String>,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepositoryStorageInput {
    pub provider_key: String,
    pub name: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub root: Option<String>,
    pub public_base_url: Option<String>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputPreferences {
    pub default_format: String,
    pub custom_template: String,
    #[serde(default = "default_auto_copy")]
    pub auto_copy_after_publish: bool,
    #[serde(default = "default_image_format")]
    pub image_format: String,
}

fn default_auto_copy() -> bool {
    true
}

fn default_image_format() -> String {
    "webp".into()
}

impl Default for OutputPreferences {
    fn default() -> Self {
        Self {
            default_format: "markdown".into(),
            custom_template: "![{name}]({url})".into(),
            auto_copy_after_publish: true,
            image_format: default_image_format(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageView {
    pub id: String,
    pub name: String,
    pub provider_key: String,
    pub category: String,
    pub enabled: bool,
    pub detail: String,
    pub public_base_url: Option<String>,
    pub public_hint: String,
    pub access_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntryView {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
    pub public_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStorageFailureView {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStorageOperationView {
    pub succeeded: usize,
    pub deployments_updated: usize,
    pub failures: Vec<BatchStorageFailureView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub reachable: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub progress: u8,
    pub attempt: u32,
    pub max_attempts: u32,
    pub can_cancel: bool,
    pub can_retry: bool,
    pub created_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStorageGroupMemberInput {
    pub storage_id: String,
    pub role: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStorageGroupInput {
    pub name: String,
    pub strategy: String,
    pub members: Vec<CreateStorageGroupMemberInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageGroupMemberView {
    pub storage_id: String,
    pub storage_name: String,
    pub provider_key: String,
    pub role: String,
    pub priority: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageGroupView {
    pub id: String,
    pub name: String,
    pub strategy: String,
    pub members: Vec<StorageGroupMemberView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDeploymentView {
    pub storage: String,
    pub storage_id: String,
    pub remote_path: String,
    pub provider_key: String,
    pub access_mode: String,
    pub role: String,
    pub ok: bool,
    pub error: Option<String>,
    /// How strongly this copy's success is confirmed (piclist section eighteen), 0-3. `ok` says
    /// the provider accepted the write; this says how far the claim has been checked since. A copy
    /// can stay `ok: true` at level 1 until a probe or content check raises it, which is the
    /// distinction the old boolean could not express.
    pub confirmation_level: u8,
    /// Category of `error`, when one was recorded. Lets the UI explain what to do without reading
    /// the message back out of a sentence.
    pub error_kind: Option<domain::StorageErrorKind>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginExecutionView {
    pub plugin_id: String,
    pub plugin_name: String,
    pub plugin_kind: String,
    pub text: String,
    pub data: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetView {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub public_url: String,
    pub status: String,
    pub created_at: String,
    pub deployments: Vec<AssetDeploymentView>,
    pub plugin_outputs: Vec<PluginExecutionView>,
}

#[derive(Debug, Clone)]
struct RecipeDefinition {
    key: &'static str,
    name: &'static str,
    description: &'static str,
    badge: &'static str,
    format: &'static str,
    quality: u8,
    max_width: Option<u32>,
    max_height: Option<u32>,
    rename_template: &'static str,
    recommended: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeView {
    pub key: String,
    pub name: String,
    pub description: String,
    pub badge: String,
    pub format: String,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub rename_template: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkflowFromRecipeInput {
    pub recipe_key: String,
    pub name: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    pub set_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomWorkflowInput {
    pub name: String,
    pub description: Option<String>,
    pub format: String,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub rename_template: String,
    pub target_kind: String,
    pub target_id: String,
    pub set_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_recipe: Option<String>,
    pub is_default: bool,
    pub format: String,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub rename_template: String,
    pub target_kind: String,
    pub target_id: String,
    pub target_name: String,
}

fn builtin_recipes() -> Vec<RecipeDefinition> {
    vec![
        RecipeDefinition {
            key: "blog_balanced",
            name: "博客 · WebP 均衡",
            description: "限制长边到 2560px，WebP 82%，适合博客、Markdown 与日常图片。",
            badge: "推荐",
            format: "webp",
            quality: 82,
            max_width: Some(2560),
            max_height: Some(2560),
            rename_template: "images/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
            recommended: true,
        },
        RecipeDefinition {
            key: "docs_crisp",
            name: "文档 · 清晰优先",
            description: "限制到 1920px，WebP 90%，更适合截图、教程和项目文档。",
            badge: "文档",
            format: "webp",
            quality: 90,
            max_width: Some(1920),
            max_height: Some(1920),
            rename_template: "docs/{year}/{month}/{hash:12}-u{uuid}.{ext}",
            recommended: false,
        },
        RecipeDefinition {
            key: "small_fast",
            name: "分享 · 小体积",
            description: "限制到 1600px，WebP 72%，优先减少上传时间和公网流量。",
            badge: "极速",
            format: "webp",
            quality: 72,
            max_width: Some(1600),
            max_height: Some(1600),
            rename_template: "share/{year}/{month}/{hash:12}-u{uuid}.{ext}",
            recommended: false,
        },
        RecipeDefinition {
            key: "original_keep",
            name: "原图 · 不转换",
            description: "不改变图片内容，仅统一远端命名；适合需要保留原始编码的资源。",
            badge: "原图",
            format: "original",
            quality: 100,
            max_width: None,
            max_height: None,
            rename_template: "original/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
            recommended: false,
        },
    ]
}

fn publish_target_to_setting(target: &PublishTarget) -> Value {
    match target {
        PublishTarget::Storage { storage_id } => {
            json!({"kind":"storage","id":storage_id.to_string()})
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            json!({"kind":"group","id":storage_group_id.to_string()})
        }
    }
}

fn workflow_publish_target(workflow: &Workflow) -> Option<PublishTarget> {
    workflow.steps.iter().find_map(|step| match step {
        WorkflowStep::Publish { target } => Some(target.clone()),
        _ => None,
    })
}

fn publish_target_matches(left: &PublishTarget, right: &PublishTarget) -> bool {
    match (left, right) {
        (PublishTarget::Storage { storage_id: a }, PublishTarget::Storage { storage_id: b }) => {
            a == b
        }
        (
            PublishTarget::StorageGroup {
                storage_group_id: a,
            },
            PublishTarget::StorageGroup {
                storage_group_id: b,
            },
        ) => a == b,
        _ => false,
    }
}

async fn cleanup_legacy_workflows_referencing_target(
    state: &AppState,
    target: &PublishTarget,
) -> CmdResult<usize> {
    let workflows = state
        .workflows
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let mut removed = 0usize;
    for record in workflows {
        if record.source_recipe.as_deref() == Some(SYSTEM_PIPELINE_SOURCE) {
            continue;
        }
        let Some(workflow_target) = workflow_publish_target(&record.workflow) else {
            continue;
        };
        if publish_target_matches(&workflow_target, target) {
            state
                .workflows
                .delete(record.workflow.id)
                .await
                .map_err(|error| error.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

async fn validate_target_exists(state: &AppState, target: &PublishTarget) -> CmdResult<String> {
    match target {
        PublishTarget::Storage { storage_id } => state
            .storages
            .get(*storage_id)
            .await
            .map_err(|e| e.to_string())?
            .map(|v| v.name)
            .ok_or_else(|| "默认上传存储已不存在".into()),
        PublishTarget::StorageGroup { storage_group_id } => state
            .groups
            .get(*storage_group_id)
            .await
            .map_err(|e| e.to_string())?
            .map(|v| v.name)
            .ok_or_else(|| "默认多云组已不存在".into()),
    }
}

async fn resolve_default_publish_target(
    state: &AppState,
) -> CmdResult<Option<(PublishTarget, String)>> {
    if let Some(setting) = state
        .settings
        .get(DEFAULT_TARGET_KEY)
        .await
        .map_err(|e| e.to_string())?
    {
        let kind = setting.get("kind").and_then(Value::as_str).unwrap_or("");
        let id = setting.get("id").and_then(Value::as_str).unwrap_or("");
        if let Ok(uuid) = Uuid::parse_str(id) {
            let target = match kind {
                "storage" => Some(PublishTarget::Storage { storage_id: uuid }),
                "group" => Some(PublishTarget::StorageGroup {
                    storage_group_id: uuid,
                }),
                _ => None,
            };
            if let Some(target) = target {
                if let Ok(name) = validate_target_exists(state, &target).await {
                    return Ok(Some((target, name)));
                }
            }
        }
    }

    if let Some(default) = state
        .workflows
        .list()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|row| row.is_default)
    {
        if let Some(target) = workflow_publish_target(&default.workflow) {
            if let Ok(name) = validate_target_exists(state, &target).await {
                state
                    .settings
                    .set(DEFAULT_TARGET_KEY, &publish_target_to_setting(&target))
                    .await
                    .map_err(|e| e.to_string())?;
                return Ok(Some((target, name)));
            }
        }
    }

    if let Some(storage) = state
        .storages
        .list()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.enabled)
    {
        let target = PublishTarget::Storage {
            storage_id: storage.id,
        };
        state
            .settings
            .set(DEFAULT_TARGET_KEY, &publish_target_to_setting(&target))
            .await
            .map_err(|e| e.to_string())?;
        return Ok(Some((target, storage.name)));
    }
    Ok(None)
}

async fn sync_system_default_pipeline(
    state: &AppState,
    preferred: Option<PublishTarget>,
) -> CmdResult<WorkflowRecord> {
    let (target, _) = if let Some(target) = preferred {
        let name = validate_target_exists(state, &target).await?;
        state
            .settings
            .set(DEFAULT_TARGET_KEY, &publish_target_to_setting(&target))
            .await
            .map_err(|e| e.to_string())?;
        (target, name)
    } else {
        resolve_default_publish_target(state)
            .await?
            .ok_or("请先连接至少一个云端存储")?
    };
    let workflow = workflow_from_fields(
        "自动上传链".into(),
        "webp",
        90,
        Some(1920),
        Some(1920),
        "uploads/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
        target,
    )?;
    state
        .workflows
        .upsert_system_default(
            &workflow,
            "由 Publisher 自动维护；用户只需要选择默认云端并开关插件。",
            SYSTEM_PIPELINE_SOURCE,
        )
        .await
        .map_err(|e| e.to_string())?;
    state
        .workflows
        .list()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|row| row.is_default)
        .ok_or_else(|| "默认上传链创建失败".into())
}

async fn ensure_default_pipeline_after_storage(
    state: &AppState,
    storage_id: Uuid,
) -> CmdResult<()> {
    match resolve_default_publish_target(state).await {
        Ok(Some(_)) => {
            sync_system_default_pipeline(state, None).await?;
        }
        Ok(None) | Err(_) => {
            sync_system_default_pipeline(state, Some(PublishTarget::Storage { storage_id }))
                .await?;
        }
    }
    Ok(())
}

async fn persist_new_storage(state: &AppState, record: &StorageRecord) -> CmdResult<()> {
    if let Err(error) = state.storages.insert(record).await {
        if let Some(key) = record.credential_ref.as_deref() {
            let _ = state.credentials.delete(key);
        }
        return Err(error.to_string());
    }
    if let Err(error) = ensure_default_pipeline_after_storage(state, record.id).await {
        let storage_rollback = state
            .storages
            .delete(record.id)
            .await
            .err()
            .map(|value| value.to_string());
        if let Some(key) = record.credential_ref.as_deref() {
            let _ = state.credentials.delete(key);
        }
        return Err(match storage_rollback {
            None => format!("云端连接测试已通过，但自动上传链初始化失败，已回滚连接：{error}"),
            Some(rollback_error) => format!(
                "云端连接测试已通过，但自动上传链初始化失败：{error}；连接回滚也失败，可能留下未完成配置：{rollback_error}"
            ),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn get_default_publish_target(
    state: State<'_, AppState>,
) -> CmdResult<Option<DefaultPublishTargetView>> {
    let Some((target, name)) = resolve_default_publish_target(state.inner()).await? else {
        return Ok(None);
    };
    let (kind, id) = match target {
        PublishTarget::Storage { storage_id } => ("storage", storage_id.to_string()),
        PublishTarget::StorageGroup { storage_group_id } => ("group", storage_group_id.to_string()),
    };
    Ok(Some(DefaultPublishTargetView {
        kind: kind.into(),
        id,
        name,
    }))
}

#[tauri::command]
pub async fn set_default_publish_target(
    state: State<'_, AppState>,
    target_kind: String,
    target_id: String,
) -> CmdResult<DefaultPublishTargetView> {
    let target = validate_publish_target(state.inner(), &target_kind, &target_id).await?;
    let name = validate_target_exists(state.inner(), &target).await?;
    sync_system_default_pipeline(state.inner(), Some(target.clone())).await?;
    Ok(DefaultPublishTargetView {
        kind: target_kind,
        id: target_id,
        name,
    })
}

#[tauri::command]
pub fn bootstrap_snapshot() -> BootstrapSnapshot {
    BootstrapSnapshot {
        app_name: "Multi-cloud Publisher",
        version: env!("CARGO_PKG_VERSION"),
        providers: vec![
            ProviderSummary {
                id: "r2",
                name: "Cloudflare R2",
                category: "object",
                recommended_for: "低成本公网图片、博客",
                setup_minutes: 5,
                status: "available",
            },
            ProviderSummary {
                id: "s3",
                name: "S3 Compatible",
                category: "object",
                recommended_for: "AWS、MinIO 与兼容服务",
                setup_minutes: 6,
                status: "available",
            },
            ProviderSummary {
                id: "oss",
                name: "阿里云 OSS",
                category: "object",
                recommended_for: "国内网站与静态资源",
                setup_minutes: 6,
                status: "available",
            },
            ProviderSummary {
                id: "cos",
                name: "腾讯云 COS",
                category: "object",
                recommended_for: "国内网站与静态资源",
                setup_minutes: 6,
                status: "available",
            },
            ProviderSummary {
                id: "github",
                name: "GitHub",
                category: "repository",
                recommended_for: "README、项目文档",
                setup_minutes: 3,
                status: "available",
            },
            ProviderSummary {
                id: "gitee",
                name: "Gitee",
                category: "repository",
                recommended_for: "国内仓库资源、镜像备份",
                setup_minutes: 3,
                status: "available",
            },
            ProviderSummary {
                id: "webdav",
                name: "WebDAV",
                category: "protocol",
                recommended_for: "NAS 与自建服务",
                setup_minutes: 5,
                status: "available",
            },
        ],
    }
}

fn normalize_s3(
    input: &CreateS3StorageInput,
) -> CmdResult<(S3StorageConfig, S3Credentials, &'static str)> {
    let provider_key = match input.provider_key.as_str() {
        "r2" => "r2",
        "s3" => "s3",
        _ => return Err("This setup form supports Cloudflare R2 and S3 Compatible".into()),
    };

    if input.name.trim().is_empty() {
        return Err("Storage name cannot be empty".into());
    }
    if input.bucket.trim().is_empty() {
        return Err("Bucket cannot be empty".into());
    }
    if input.access_key_id.trim().is_empty() || input.secret_access_key.trim().is_empty() {
        return Err("Access Key and Secret Key are required".into());
    }

    let public_base_url = match input.access_mode {
        ObjectAccessMode::Public => Some(normalize_public_base_url(input.public_base_url.as_deref())?),
        ObjectAccessMode::PrivateRequested if provider_key == "r2" => {
            if input.public_base_url.as_deref().is_some_and(|url| !url.trim().is_empty()) {
                return Err("私有存储目标不能同时配置公开 URL；请另建公开目标".into());
            }
            None
        }
        ObjectAccessMode::PrivateRequested => {
            return Err("当前仅 Cloudflare R2 支持创建私有访问意图的目标".into());
        }
    };

    let endpoint = if provider_key == "r2" {
        // R2's synthesized URL is https-by-construction below; user endpoints are checked after.
        let account = input
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or("Cloudflare R2 requires Account ID")?;
        format!("https://{account}.r2.cloudflarestorage.com")
    } else {
        input
            .endpoint
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or("S3 Compatible requires endpoint")?
            .to_string()
    };
    plugin_runtime::require_https_or_loopback(&endpoint)?;

    let region = input
        .region
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            if provider_key == "r2" {
                "auto".into()
            } else {
                "us-east-1".into()
            }
        });

    Ok((
        S3StorageConfig {
            endpoint,
            region,
            bucket: input.bucket.trim().into(),
            root: input.root.clone().unwrap_or_default(),
            public_base_url,
            access_mode: input.access_mode,
        },
        S3Credentials {
            access_key_id: input.access_key_id.trim().to_string(),
            secret_access_key: input.secret_access_key.clone(),
        },
        provider_key,
    ))
}

fn normalize_public_base_url(value: Option<&str>) -> CmdResult<String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Public URL is required so uploaded images can be viewed by other people".to_string()
        })?;
    let url = reqwest::Url::parse(value)
        .map_err(|_| "Public URL must be a valid http:// or https:// URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Public URL must be an http:// or https:// base URL without query or fragment".into(),
        );
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn normalize_optional_public_base_url(value: Option<&str>) -> CmdResult<Option<String>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => normalize_public_base_url(Some(value)).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn create_object_storage(
    state: State<'_, AppState>,
    input: CreateObjectStorageInput,
) -> CmdResult<StorageView> {
    if !matches!(input.provider_key.as_str(), "oss" | "cos") {
        return Err("Object storage form supports Aliyun OSS and Tencent COS".into());
    }
    if input.name.trim().is_empty()
        || input.endpoint.trim().is_empty()
        || input.bucket.trim().is_empty()
        || input.access_key_id.trim().is_empty()
        || input.secret_access_key.trim().is_empty()
    {
        return Err("Name, endpoint, bucket and credentials are required".into());
    }
    plugin_runtime::require_https_or_loopback(input.endpoint.trim())?;
    let public_base_url = normalize_public_base_url(input.public_base_url.as_deref())?;
    let root = input
        .root
        .as_deref()
        .unwrap_or_default()
        .trim()
        .trim_matches('/')
        .to_string();

    let (config_json, credential_json, capabilities_json) = match input.provider_key.as_str() {
        "oss" => {
            let config = OssStorageConfig {
                endpoint: input.endpoint.trim().trim_end_matches('/').into(),
                bucket: input.bucket.trim().into(),
                root,
                public_base_url: Some(public_base_url),
            };
            let credentials = OssCredentials {
                access_key_id: input.access_key_id.trim().into(),
                access_key_secret: input.secret_access_key.clone(),
            };
            let provider =
                OpenDalStorage::oss(&config, &credentials).map_err(|error| error.to_string())?;
            provider
                .test_connection()
                .await
                .map_err(|error| error.to_string())?;
            (
                serde_json::to_value(config).map_err(|error| error.to_string())?,
                serde_json::to_value(credentials).map_err(|error| error.to_string())?,
                serde_json::to_value(provider.capabilities()).map_err(|error| error.to_string())?,
            )
        }
        "cos" => {
            let config = CosStorageConfig {
                endpoint: input.endpoint.trim().trim_end_matches('/').into(),
                bucket: input.bucket.trim().into(),
                root,
                public_base_url: Some(public_base_url),
            };
            let credentials = CosCredentials {
                secret_id: input.access_key_id.trim().into(),
                secret_key: input.secret_access_key.clone(),
            };
            let provider =
                OpenDalStorage::cos(&config, &credentials).map_err(|error| error.to_string())?;
            provider
                .test_connection()
                .await
                .map_err(|error| error.to_string())?;
            (
                serde_json::to_value(config).map_err(|error| error.to_string())?,
                serde_json::to_value(credentials).map_err(|error| error.to_string())?,
                serde_json::to_value(provider.capabilities()).map_err(|error| error.to_string())?,
            )
        }
        _ => unreachable!(),
    };

    let id = Uuid::new_v4();
    let credential_ref = format!("storage:{id}");
    state
        .credentials
        .set_json(&credential_ref, &credential_json)
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let record = StorageRecord {
        id,
        name: input.name.trim().into(),
        provider_key: input.provider_key,
        category: "object".into(),
        credential_ref: Some(credential_ref),
        config_json,
        capabilities_json,
        enabled: true,
        created_at: now,
        updated_at: now,
    };
    persist_new_storage(state.inner(), &record).await?;
    Ok(storage_view(&record))
}

#[tauri::command]
pub async fn create_webdav_storage(
    state: State<'_, AppState>,
    input: CreateWebDavStorageInput,
) -> CmdResult<StorageView> {
    if input.name.trim().is_empty() || input.endpoint.trim().is_empty() {
        return Err("Name and WebDAV endpoint are required".into());
    }
    plugin_runtime::require_https_or_loopback(input.endpoint.trim())?;
    let config = WebDavStorageConfig {
        endpoint: input.endpoint.trim().trim_end_matches('/').into(),
        root: input
            .root
            .as_deref()
            .unwrap_or_default()
            .trim()
            .trim_matches('/')
            .into(),
        public_base_url: Some(normalize_public_base_url(input.public_base_url.as_deref())?),
    };
    let credentials = WebDavCredentials {
        username: input.username.trim().into(),
        password: input.password.clone(),
    };
    let provider =
        OpenDalStorage::webdav(&config, &credentials).map_err(|error| error.to_string())?;
    provider
        .test_connection()
        .await
        .map_err(|error| error.to_string())?;

    let id = Uuid::new_v4();
    let credential_ref = format!("storage:{id}");
    state
        .credentials
        .set_json(&credential_ref, &credentials)
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let record = StorageRecord {
        id,
        name: input.name.trim().into(),
        provider_key: "webdav".into(),
        category: "protocol".into(),
        credential_ref: Some(credential_ref),
        config_json: serde_json::to_value(&config).map_err(|error| error.to_string())?,
        capabilities_json: serde_json::to_value(provider.capabilities())
            .map_err(|error| error.to_string())?,
        enabled: true,
        created_at: now,
        updated_at: now,
    };
    persist_new_storage(state.inner(), &record).await?;
    Ok(storage_view(&record))
}

fn normalize_repository_token(value: &str) -> String {
    let value = value.trim();
    let value = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .unwrap_or(value);
    value.trim().to_string()
}

fn validate_repository_input(input: &CreateRepositoryStorageInput) -> CmdResult<()> {
    if !matches!(input.provider_key.as_str(), "github" | "gitee") {
        return Err("Repository storage must be GitHub or Gitee".into());
    }
    for (label, value) in [
        ("Storage name", input.name.as_str()),
        ("Owner", input.owner.as_str()),
        ("Repository", input.repo.as_str()),
        ("Branch", input.branch.as_str()),
        ("Token", input.token.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{label} cannot be empty"));
        }
    }

    let token = normalize_repository_token(&input.token);
    if token.starts_with("ssh-")
        || token.starts_with("SHA256:")
        || token.contains("BEGIN OPENSSH")
        || token.contains("BEGIN RSA PRIVATE KEY")
    {
        return Err(
            "访问令牌填写错误：这里需要 Personal Access Token，不是 SSH 密钥、SSH 指纹或私钥。"
                .into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn create_s3_storage(
    state: State<'_, AppState>,
    input: CreateS3StorageInput,
) -> CmdResult<StorageView> {
    let (config, credentials, provider_key) = normalize_s3(&input)?;
    let provider = OpenDalStorage::s3(provider_key, &config, &credentials)
        .map_err(|error| error.to_string())?;
    provider
        .test_connection()
        .await
        .map_err(|error| error.to_string())?;

    let id = Uuid::new_v4();
    let credential_ref = format!("storage:{id}");
    state
        .credentials
        .set_json(&credential_ref, &credentials)
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let record = StorageRecord {
        id,
        name: input.name.trim().to_string(),
        provider_key: provider_key.into(),
        category: "object".into(),
        credential_ref: Some(credential_ref),
        config_json: serde_json::to_value(&config).map_err(|error| error.to_string())?,
        capabilities_json: serde_json::to_value(provider.capabilities())
            .map_err(|error| error.to_string())?,
        enabled: true,
        created_at: now,
        updated_at: now,
    };
    persist_new_storage(state.inner(), &record).await?;
    Ok(storage_view(&record))
}

#[tauri::command]
pub async fn create_repository_storage(
    state: State<'_, AppState>,
    input: CreateRepositoryStorageInput,
) -> CmdResult<StorageView> {
    validate_repository_input(&input)?;

    let root = input
        .root
        .as_deref()
        .unwrap_or_default()
        .trim()
        .trim_matches('/')
        .to_string();
    let public_base_url = normalize_optional_public_base_url(input.public_base_url.as_deref())?;

    let (config_json, credential_json, capabilities_json) = match input.provider_key.as_str() {
        "github" => {
            let config = GitHubStorageConfig {
                owner: input.owner.trim().into(),
                repo: input.repo.trim().into(),
                branch: input.branch.trim().into(),
                root,
                public_base_url,
            };
            let credentials = GitHubCredentials {
                token: normalize_repository_token(&input.token),
            };
            let provider = GitHubStorage::new(config.clone(), credentials.clone());
            provider
                .test_connection()
                .await
                .map_err(|error| error.to_string())?;
            (
                serde_json::to_value(config).map_err(|error| error.to_string())?,
                serde_json::to_value(credentials).map_err(|error| error.to_string())?,
                serde_json::to_value(provider.capabilities()).map_err(|error| error.to_string())?,
            )
        }
        "gitee" => {
            let config = GiteeStorageConfig {
                owner: input.owner.trim().into(),
                repo: input.repo.trim().into(),
                branch: input.branch.trim().into(),
                root,
                public_base_url,
            };
            let credentials = GiteeCredentials {
                token: normalize_repository_token(&input.token),
            };
            let provider = GiteeStorage::new(config.clone(), credentials.clone());
            provider
                .test_connection()
                .await
                .map_err(|error| error.to_string())?;
            (
                serde_json::to_value(config).map_err(|error| error.to_string())?,
                serde_json::to_value(credentials).map_err(|error| error.to_string())?,
                serde_json::to_value(provider.capabilities()).map_err(|error| error.to_string())?,
            )
        }
        _ => unreachable!(),
    };

    let id = Uuid::new_v4();
    let credential_ref = format!("storage:{id}");
    state
        .credentials
        .set_json(&credential_ref, &credential_json)
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let record = StorageRecord {
        id,
        name: input.name.trim().into(),
        provider_key: input.provider_key.clone(),
        category: "repository".into(),
        credential_ref: Some(credential_ref),
        config_json,
        capabilities_json,
        enabled: true,
        created_at: now,
        updated_at: now,
    };
    persist_new_storage(state.inner(), &record).await?;
    Ok(storage_view(&record))
}

#[tauri::command]
pub async fn list_storages(state: State<'_, AppState>) -> CmdResult<Vec<StorageView>> {
    Ok(state
        .storages
        .list()
        .await
        .map_err(|error| error.to_string())?
        .iter()
        .map(storage_view)
        .collect())
}

#[tauri::command]
pub async fn delete_storage(state: State<'_, AppState>, storage_id: String) -> CmdResult<()> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    if let Some((target, _)) = resolve_default_publish_target(state.inner()).await? {
        if matches!(target, PublishTarget::Storage { storage_id } if storage_id == id) {
            return Err("该存储当前是默认上传目标，请先把其他云端设为默认后再删除。".into());
        }
    }
    let (deployments, groups, _legacy_workflows) = state
        .storages
        .usage_counts(id)
        .await
        .map_err(|error| error.to_string())?;
    if deployments > 0 || groups > 0 {
        return Err(format!(
            "该存储仍被使用：{deployments} 个资源副本、{groups} 个多云组。请先解除这些真实引用。"
        ));
    }

    // Workflows are no longer a user-facing concept. Remove invisible legacy
    // workflows that reference this non-default target instead of leaving
    // dangling JSON references that can fail later through compatibility APIs.
    if resolve_default_publish_target(state.inner())
        .await?
        .is_some()
    {
        sync_system_default_pipeline(state.inner(), None).await?;
    }
    cleanup_legacy_workflows_referencing_target(
        state.inner(),
        &PublishTarget::Storage { storage_id: id },
    )
    .await?;

    state
        .storages
        .delete(id)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(key) = record.credential_ref.as_deref() {
        let _ = state.credentials.delete(key);
    }
    Ok(())
}

#[tauri::command]
pub async fn test_storage(
    state: State<'_, AppState>,
    storage_id: String,
) -> CmdResult<ConnectionView> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;
    let report = provider
        .test_connection()
        .await
        .map_err(|error| error.to_string())?;
    Ok(ConnectionView {
        reachable: report.reachable,
        detail: report.detail,
    })
}

#[tauri::command]
pub async fn create_storage_group(
    state: State<'_, AppState>,
    input: CreateStorageGroupInput,
) -> CmdResult<StorageGroupView> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Storage Group name cannot be empty".into());
    }
    if !matches!(
        input.strategy.as_str(),
        "mirror_all" | "primary_with_backups"
    ) {
        return Err("Unsupported storage group strategy".into());
    }
    if input.members.len() < 2 {
        return Err("A Storage Group requires at least two storages".into());
    }

    let mut unique = std::collections::HashSet::new();
    let mut primary_count = 0usize;
    let mut members = Vec::with_capacity(input.members.len());
    for member in input.members {
        let storage_id = Uuid::parse_str(&member.storage_id).map_err(|error| error.to_string())?;
        if !unique.insert(storage_id) {
            return Err("The same storage cannot appear twice in a Storage Group".into());
        }
        let role = match member.role.as_str() {
            "primary" => {
                primary_count += 1;
                "primary"
            }
            "mirror" => "mirror",
            "backup" => "backup",
            _ => return Err(format!("Unsupported deployment role: {}", member.role)),
        };
        let storage = state
            .storages
            .get(storage_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Storage {storage_id} does not exist"))?;
        if !storage.enabled {
            return Err(format!("Storage {} is disabled", storage.name));
        }
        members.push(NewStorageGroupMember {
            storage_id,
            role: role.into(),
            priority: member.priority.max(0),
        });
    }
    if primary_count != 1 {
        return Err("A Storage Group must contain exactly one primary storage".into());
    }

    let id = Uuid::new_v4();
    state
        .groups
        .insert(id, name, &input.strategy, &members)
        .await
        .map_err(|error| error.to_string())?;
    let group = state
        .groups
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage Group was created but could not be reloaded")?;
    Ok(storage_group_view(group))
}

#[tauri::command]
pub async fn list_storage_groups(state: State<'_, AppState>) -> CmdResult<Vec<StorageGroupView>> {
    Ok(state
        .groups
        .list()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(storage_group_view)
        .collect())
}

#[tauri::command]
pub async fn delete_storage_group(state: State<'_, AppState>, group_id: String) -> CmdResult<()> {
    let id = Uuid::parse_str(&group_id).map_err(|error| error.to_string())?;
    if let Some((target, _)) = resolve_default_publish_target(state.inner()).await? {
        if matches!(target, PublishTarget::StorageGroup { storage_group_id } if storage_group_id == id)
        {
            return Err("该多云组当前是默认上传目标，请先把其他云端设为默认后再删除。".into());
        }
    }
    if resolve_default_publish_target(state.inner())
        .await?
        .is_some()
    {
        sync_system_default_pipeline(state.inner(), None).await?;
    }
    cleanup_legacy_workflows_referencing_target(
        state.inner(),
        &PublishTarget::StorageGroup {
            storage_group_id: id,
        },
    )
    .await?;
    state
        .groups
        .delete(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_recipes() -> Vec<RecipeView> {
    builtin_recipes()
        .into_iter()
        .map(|recipe| RecipeView {
            key: recipe.key.into(),
            name: recipe.name.into(),
            description: recipe.description.into(),
            badge: recipe.badge.into(),
            format: recipe.format.into(),
            quality: recipe.quality,
            max_width: recipe.max_width,
            max_height: recipe.max_height,
            rename_template: recipe.rename_template.into(),
            recommended: recipe.recommended,
        })
        .collect()
}

#[tauri::command]
pub async fn create_workflow_from_recipe(
    state: State<'_, AppState>,
    input: CreateWorkflowFromRecipeInput,
) -> CmdResult<WorkflowView> {
    let recipe = builtin_recipes()
        .into_iter()
        .find(|recipe| recipe.key == input.recipe_key)
        .ok_or_else(|| format!("Unknown recipe: {}", input.recipe_key))?;
    let target = validate_publish_target(&state, &input.target_kind, &input.target_id).await?;
    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(recipe.name)
        .to_string();
    let workflow = workflow_from_fields(
        name,
        recipe.format,
        recipe.quality,
        recipe.max_width,
        recipe.max_height,
        recipe.rename_template,
        target,
    )?;
    state
        .workflows
        .insert(
            &workflow,
            recipe.description,
            Some(recipe.key),
            input.set_default,
        )
        .await
        .map_err(|error| error.to_string())?;
    let record = state
        .workflows
        .get(workflow.id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Workflow was created but could not be reloaded")?;
    workflow_view(&state, record).await
}

#[tauri::command]
pub async fn create_custom_workflow(
    state: State<'_, AppState>,
    input: CreateCustomWorkflowInput,
) -> CmdResult<WorkflowView> {
    if input.name.trim().is_empty() {
        return Err("Workflow name cannot be empty".into());
    }
    if !(1..=100).contains(&input.quality) {
        return Err("Quality must be between 1 and 100".into());
    }
    if !matches!(input.format.as_str(), "original" | "jpeg" | "png" | "webp") {
        return Err("Unsupported image output format".into());
    }
    if input.rename_template.trim().is_empty() {
        return Err("Rename template cannot be empty".into());
    }
    let target = validate_publish_target(&state, &input.target_kind, &input.target_id).await?;
    let workflow = workflow_from_fields(
        input.name.trim().into(),
        &input.format,
        input.quality,
        input.max_width.filter(|value| *value > 0),
        input.max_height.filter(|value| *value > 0),
        input.rename_template.trim(),
        target,
    )?;
    state
        .workflows
        .insert(
            &workflow,
            input.description.as_deref().unwrap_or_default().trim(),
            None,
            input.set_default,
        )
        .await
        .map_err(|error| error.to_string())?;
    let record = state
        .workflows
        .get(workflow.id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Workflow was created but could not be reloaded")?;
    workflow_view(&state, record).await
}

#[tauri::command]
pub async fn list_workflows(state: State<'_, AppState>) -> CmdResult<Vec<WorkflowView>> {
    if resolve_default_publish_target(state.inner())
        .await?
        .is_some()
    {
        sync_system_default_pipeline(state.inner(), None).await?;
    }
    let records = state
        .workflows
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let mut views = Vec::with_capacity(records.len());
    for record in records {
        views.push(workflow_view(&state, record).await?);
    }
    Ok(views)
}

#[tauri::command]
pub async fn set_default_workflow(
    state: State<'_, AppState>,
    workflow_id: String,
) -> CmdResult<()> {
    let id = Uuid::parse_str(&workflow_id).map_err(|error| error.to_string())?;
    if state
        .workflows
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Err("Workflow not found".into());
    }
    state
        .workflows
        .set_default(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_workflow(state: State<'_, AppState>, workflow_id: String) -> CmdResult<()> {
    let id = Uuid::parse_str(&workflow_id).map_err(|error| error.to_string())?;
    state
        .workflows
        .delete(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn publish_files_with_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    paths: Vec<String>,
) -> CmdResult<Vec<String>> {
    let id = Uuid::parse_str(&workflow_id).map_err(|error| error.to_string())?;
    let record = state
        .workflows
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Workflow not found")?;
    preflight_workflow_target(state.inner(), &record.workflow).await?;
    if paths.is_empty() {
        return Err("No files selected".into());
    }

    let mut task_ids = Vec::with_capacity(paths.len());
    for raw in paths {
        let task = state
            .tasks
            .create(
                "workflow_publish",
                json!({
                    "path": raw.clone(),
                    "workflowId": record.workflow.id.to_string(),
                    "workflowName": record.workflow.name.clone()
                }),
            )
            .await
            .map_err(|error| error.to_string())?;
        task_ids.push(task.id.to_string());
        let app = app.clone();
        let app_state = state.inner().clone();
        let workflow = record.workflow.clone();
        tauri::async_runtime::spawn(async move {
            let semaphore = app_state.upload_semaphore.clone();
            let Ok(_permit) = semaphore.acquire_owned().await else {
                let error = "上传并发控制器已关闭".to_string();
                let _ = app_state.tasks.fail(task.id, error.clone()).await;
                emit_task(&app, task.id, "failed", 100, Some(error));
                return;
            };
            run_workflow_publish_task(app, app_state, workflow, PathBuf::from(raw), task.id).await;
        });
    }
    Ok(task_ids)
}

#[tauri::command]
pub async fn publish_urls_with_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
    urls: Vec<String>,
) -> CmdResult<Vec<String>> {
    let id = Uuid::parse_str(&workflow_id).map_err(|error| error.to_string())?;
    let record = state
        .workflows
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Workflow not found")?;
    preflight_workflow_target(state.inner(), &record.workflow).await?;
    let urls = urls
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Err("No image URLs provided".into());
    }
    if urls.len() > 50 {
        return Err("一次最多发布 50 个 URL".into());
    }

    // Validate the complete batch before creating any task. Otherwise a later
    // invalid URL could make the command return Err after earlier uploads have
    // already started, leaving the UI unaware of those background tasks.
    for url in &urls {
        let parsed =
            reqwest::Url::parse(url).map_err(|error| format!("无效 URL {url}: {error}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("URL 仅支持 http:// 或 https://".into());
        }
    }

    let mut task_ids = Vec::with_capacity(urls.len());
    for url in urls {
        let task = state
            .tasks
            .create(
                "workflow_url_publish",
                json!({
                    "url": url.clone(),
                    "workflowId": record.workflow.id.to_string(),
                    "workflowName": record.workflow.name.clone()
                }),
            )
            .await
            .map_err(|error| error.to_string())?;
        task_ids.push(task.id.to_string());
        let app = app.clone();
        let app_state = state.inner().clone();
        let workflow = record.workflow.clone();
        tauri::async_runtime::spawn(async move {
            let semaphore = app_state.upload_semaphore.clone();
            let Ok(_permit) = semaphore.acquire_owned().await else {
                let error = "上传并发控制器已关闭".to_string();
                let _ = app_state.tasks.fail(task.id, error.clone()).await;
                emit_task(&app, task.id, "failed", 100, Some(error));
                return;
            };
            run_url_workflow_publish_task(app, app_state, workflow, url, task.id).await;
        });
    }
    Ok(task_ids)
}

#[tauri::command]
pub async fn publish_clipboard_image_with_workflow(
    app: AppHandle,
    state: State<'_, AppState>,
    workflow_id: String,
) -> CmdResult<String> {
    let id = Uuid::parse_str(&workflow_id).map_err(|error| error.to_string())?;
    let record = state
        .workflows
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Workflow not found")?;
    preflight_workflow_target(state.inner(), &record.workflow).await?;

    // Read clipboard pixels on a blocking worker. The clipboard backend may deadlock
    // on Linux if it is accessed from the UI/main thread. Only the owned RGBA bytes
    // cross back into the async task; no large pixel array crosses Tauri IPC.
    let clipboard_app = app.clone();
    let (rgba, width, height) =
        tokio::task::spawn_blocking(move || -> CmdResult<(Vec<u8>, u32, u32)> {
            let image = clipboard_app
                .clipboard()
                .read_image()
                .map_err(|_| "剪贴板中没有可读取的图片".to_string())?;
            Ok((image.rgba().to_vec(), image.width(), image.height()))
        })
        .await
        .map_err(|error| format!("读取剪贴板任务失败: {error}"))??;

    if width == 0 || height == 0 {
        return Err("剪贴板图片尺寸无效".into());
    }
    let pixel_count = width as u64 * height as u64;
    if pixel_count > 32_000_000 {
        return Err("剪贴板图片超过 3200 万像素限制".into());
    }
    let expected = pixel_count.checked_mul(4).ok_or("剪贴板图片尺寸过大")? as usize;
    if rgba.len() != expected {
        return Err("剪贴板图片数据长度与尺寸不匹配".into());
    }

    let task = state
        .tasks
        .create(
            "workflow_clipboard_publish",
            json!({
                "width": width,
                "height": height,
                "workflowId": record.workflow.id.to_string(),
                "workflowName": record.workflow.name.clone()
            }),
        )
        .await
        .map_err(|error| error.to_string())?;
    let task_id = task.id;
    let app_state = state.inner().clone();
    let workflow = record.workflow.clone();
    tauri::async_runtime::spawn(async move {
        let semaphore = app_state.upload_semaphore.clone();
        let Ok(_permit) = semaphore.acquire_owned().await else {
            let error = "上传并发控制器已关闭".to_string();
            let _ = app_state.tasks.fail(task_id, error.clone()).await;
            emit_task(&app, task_id, "failed", 100, Some(error));
            return;
        };
        run_clipboard_workflow_publish_task(app, app_state, workflow, rgba, width, height, task_id)
            .await;
    });
    Ok(task_id.to_string())
}

async fn run_clipboard_workflow_publish_task(
    app: AppHandle,
    state: AppState,
    workflow: Workflow,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    task_id: Uuid,
) {
    let prepare: CmdResult<PathBuf> = async {
        state
            .tasks
            .mark_preparing(task_id, 4)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "preparing", 4, None);

        let png = tokio::task::spawn_blocking(move || {
            image_processing::encode_rgba_png(&rgba, width, height)
        })
        .await
        .map_err(|error| format!("剪贴板图片编码任务失败: {error}"))?
        .map_err(|error| error.to_string())?;
        let temp_dir = std::env::temp_dir()
            .join("multicloud-publisher")
            .join(Uuid::new_v4().simple().to_string());
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|error| format!("Cannot create temporary directory: {error}"))?;
        let path = temp_dir.join(format!("clipboard-{}x{}.png", width, height));
        tokio::fs::write(&path, png)
            .await
            .map_err(|error| format!("Cannot write clipboard image: {error}"))?;
        Ok(path)
    }
    .await;

    match prepare {
        Ok(path) => {
            let temp_dir = path.parent().map(Path::to_path_buf);
            run_workflow_publish_task(app, state, workflow, path, task_id).await;
            if let Some(dir) = temp_dir {
                let _ = tokio::fs::remove_dir_all(dir).await;
            }
        }
        Err(error) => {
            let _ = state.tasks.fail(task_id, error.clone()).await;
            emit_task(&app, task_id, "failed", 100, Some(error));
        }
    }
}

async fn run_url_workflow_publish_task(
    app: AppHandle,
    state: AppState,
    workflow: Workflow,
    url: String,
    task_id: Uuid,
) {
    let download: CmdResult<PathBuf> = async {
        state
            .tasks
            .mark_preparing(task_id, 3)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "preparing", 3, None);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .user_agent("Multi-cloud-Publisher/1.0")
            .build()
            .map_err(|error| error.to_string())?;
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("下载 URL 失败: {error}"))?
            .error_for_status()
            .map_err(|error| format!("远端服务器拒绝请求: {error}"))?;
        const MAX_REMOTE_BYTES: u64 = 32 * 1024 * 1024;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_REMOTE_BYTES)
        {
            return Err("远端图片超过 32 MB 限制".into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if !content_type.is_empty() && !content_type.starts_with("image/") {
            return Err(format!("URL 返回的不是图片：{content_type}"));
        }
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("读取远端图片失败: {error}"))?;
        if body.len() as u64 > MAX_REMOTE_BYTES {
            return Err("远端图片超过 32 MB 限制".into());
        }

        let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
        let mut file_name = parsed
            .path_segments()
            .and_then(|segments| segments.filter(|value| !value.is_empty()).last())
            .map(sanitize_filename)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "remote-image".into());
        if !file_name.contains('.') {
            let extension = match content_type.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                "image/gif" => "gif",
                "image/bmp" => "bmp",
                _ => "img",
            };
            file_name.push('.');
            file_name.push_str(extension);
        }
        let temp_dir = std::env::temp_dir()
            .join("multicloud-publisher")
            .join(Uuid::new_v4().simple().to_string());
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|error| format!("Cannot create temporary directory: {error}"))?;
        let path = temp_dir.join(file_name);
        tokio::fs::write(&path, &body)
            .await
            .map_err(|error| format!("Cannot write temporary image: {error}"))?;
        Ok(path)
    }
    .await;

    match download {
        Ok(path) => {
            let temp_dir = path.parent().map(Path::to_path_buf);
            run_workflow_publish_task(app, state, workflow, path, task_id).await;
            if let Some(dir) = temp_dir {
                let _ = tokio::fs::remove_dir_all(dir).await;
            }
        }
        Err(error) => {
            let _ = state.tasks.fail(task_id, error.clone()).await;
            emit_task(&app, task_id, "failed", 100, Some(error));
        }
    }
}

fn workflow_from_fields(
    name: String,
    format: &str,
    quality: u8,
    max_width: Option<u32>,
    max_height: Option<u32>,
    rename_template: &str,
    target: PublishTarget,
) -> CmdResult<Workflow> {
    let mut steps = Vec::new();
    if max_width.is_some() || max_height.is_some() {
        steps.push(WorkflowStep::Resize {
            max_width: max_width.unwrap_or(u32::MAX),
            max_height: max_height.unwrap_or(u32::MAX),
        });
    }
    steps.push(WorkflowStep::Convert {
        format: format.into(),
        quality,
    });
    steps.push(WorkflowStep::Rename {
        template: rename_template.into(),
    });
    steps.push(WorkflowStep::Publish { target });
    steps.push(WorkflowStep::Output {
        template: "{url}".into(),
    });
    Ok(Workflow {
        id: Uuid::new_v4(),
        name,
        steps,
    })
}

async fn validate_publish_target(
    state: &AppState,
    target_kind: &str,
    target_id: &str,
) -> CmdResult<PublishTarget> {
    let id = Uuid::parse_str(target_id).map_err(|error| error.to_string())?;
    match target_kind {
        "storage" => {
            let storage = state
                .storages
                .get(id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Storage not found")?;
            if !storage.enabled {
                return Err("Storage is disabled".into());
            }
            Ok(PublishTarget::Storage { storage_id: id })
        }
        "group" => {
            state
                .groups
                .get(id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Storage Group not found")?;
            Ok(PublishTarget::StorageGroup {
                storage_group_id: id,
            })
        }
        _ => Err("Publish target must be storage or group".into()),
    }
}

async fn workflow_view(state: &AppState, record: WorkflowRecord) -> CmdResult<WorkflowView> {
    let mut format = "original".to_string();
    let mut quality = 100u8;
    let mut max_width = None;
    let mut max_height = None;
    let mut rename_template = "uploads/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}".to_string();
    let mut target_kind = String::new();
    let mut target_id = String::new();
    let mut target_name = String::new();

    for step in &record.workflow.steps {
        match step {
            WorkflowStep::Resize {
                max_width: width,
                max_height: height,
            } => {
                max_width = (*width != u32::MAX).then_some(*width);
                max_height = (*height != u32::MAX).then_some(*height);
            }
            WorkflowStep::Convert {
                format: target_format,
                quality: target_quality,
            } => {
                format = target_format.clone();
                quality = *target_quality;
            }
            WorkflowStep::Rename { template } => rename_template = template.clone(),
            WorkflowStep::Publish { target } => match target {
                PublishTarget::Storage { storage_id } => {
                    target_kind = "storage".into();
                    target_id = storage_id.to_string();
                    target_name = state
                        .storages
                        .get(*storage_id)
                        .await
                        .map_err(|error| error.to_string())?
                        .map(|storage| storage.name)
                        .unwrap_or_else(|| "已删除的存储".into());
                }
                PublishTarget::StorageGroup { storage_group_id } => {
                    target_kind = "group".into();
                    target_id = storage_group_id.to_string();
                    target_name = state
                        .groups
                        .get(*storage_group_id)
                        .await
                        .map_err(|error| error.to_string())?
                        .map(|group| group.name)
                        .unwrap_or_else(|| "已删除的多云组".into());
                }
            },
            WorkflowStep::Output { .. } => {}
        }
    }

    Ok(WorkflowView {
        id: record.workflow.id.to_string(),
        name: record.workflow.name,
        description: record.description,
        source_recipe: record.source_recipe,
        is_default: record.is_default,
        format,
        quality,
        max_width,
        max_height,
        rename_template,
        target_kind,
        target_id,
        target_name,
    })
}

async fn load_ai_settings(state: &AppState) -> CmdResult<Value> {
    let mut settings = state
        .settings
        .get(AI_SETTINGS_KEY)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or(json!({"baseUrl":"https://api.openai.com/v1","model":""}));
    let legacy_key = settings
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    if let Some(legacy_key) = legacy_key {
        state
            .credentials
            .set_json(AI_CREDENTIAL_KEY, &legacy_key)
            .map_err(|e| e.to_string())?;
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("apiKey");
        }
        state
            .settings
            .set(AI_SETTINGS_KEY, &settings)
            .await
            .map_err(|e| e.to_string())?;
    }
    let key = state
        .credentials
        .get_json::<String>(AI_CREDENTIAL_KEY)
        .unwrap_or_default();
    if let Some(obj) = settings.as_object_mut() {
        obj.insert("apiKey".into(), Value::String(key));
    }
    Ok(settings)
}

#[derive(Default)]
struct PluginRunSummary {
    outputs: Vec<PluginExecutionView>,
    failures: Vec<String>,
}

fn plugin_hook_key(hook: PluginHook) -> String {
    serde_json::to_value(hook)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{hook:?}").to_lowercase())
}

fn truncate_plugin_log_message(value: &str) -> String {
    value.chars().take(1200).collect()
}

async fn run_enabled_plugins_for_hook(
    state: &AppState,
    hook: PluginHook,
    asset_name: &str,
    public_url: Option<&str>,
    mime_type: &str,
    metadata: Value,
) -> PluginRunSummary {
    let rows = match state.plugins.list().await {
        Ok(rows) => rows,
        Err(error) => {
            return PluginRunSummary {
                outputs: Vec::new(),
                failures: vec![format!("插件列表读取失败: {error}")],
            };
        }
    };
    let ai_settings = load_ai_settings(state).await.ok();
    let mut summary = PluginRunSummary::default();
    for row in rows.into_iter().filter(|row| row.enabled) {
        let manifest = match plugins::effective_manifest(&row) {
            Ok(manifest) => manifest,
            Err(error) => {
                summary
                    .failures
                    .push(format!("{}: Manifest 无效 ({error})", row.name));
                continue;
            }
        };
        let enabled_hooks = plugins::record_hooks(&row);
        if !enabled_hooks.contains(&hook) {
            continue;
        }
        let granted_permissions: Vec<PluginPermission> =
            serde_json::from_value(row.granted_permissions_json.clone()).unwrap_or_default();
        let mut config = row.config_json.clone();
        if matches!(manifest.kind, plugin_runtime::PluginKind::AiPrompt) {
            if let (Some(ai), Some(obj)) = (ai_settings.as_ref(), config.as_object_mut()) {
                for key in ["baseUrl", "model", "apiKey"] {
                    if obj
                        .get(key)
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .is_empty()
                    {
                        if let Some(value) = ai.get(key) {
                            obj.insert(key.into(), value.clone());
                        }
                    }
                }
            }
        }
        let context = PluginContext {
            asset_name: asset_name.to_string(),
            public_url: public_url.unwrap_or_default().to_string(),
            mime_type: mime_type.to_string(),
            metadata: metadata.clone(),
        };
        let started = std::time::Instant::now();
        match plugin_runtime::execute_for_hook(
            &manifest,
            &granted_permissions,
            &config,
            &context,
            hook,
        )
        .await
        {
            Ok(output) => {
                let duration_ms = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
                let _ = state
                    .plugins
                    .record_execution(
                        &manifest.id,
                        &manifest.name,
                        &plugin_hook_key(hook),
                        "success",
                        duration_ms,
                        None,
                    )
                    .await;
                summary.outputs.push(PluginExecutionView {
                    plugin_id: manifest.id.clone(),
                    plugin_name: manifest.name.clone(),
                    plugin_kind: format!("{:?}", manifest.kind).to_lowercase(),
                    text: output.text,
                    data: output.data,
                });
            }
            Err(error) => {
                let message = error.to_string();
                let audit_message = truncate_plugin_log_message(&message);
                let duration_ms = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
                let _ = state
                    .plugins
                    .record_execution(
                        &manifest.id,
                        &manifest.name,
                        &plugin_hook_key(hook),
                        "failed",
                        duration_ms,
                        Some(&audit_message),
                    )
                    .await;
                summary
                    .failures
                    .push(format!("{}: {message}", manifest.name));
            }
        }
    }
    summary
}

async fn run_enabled_plugins_for_asset(
    state: &AppState,
    asset_name: &str,
    public_url: Option<&str>,
    mime_type: &str,
) -> PluginRunSummary {
    let Some(public_url) = public_url.filter(|value| !value.trim().is_empty()) else {
        return PluginRunSummary::default();
    };
    run_enabled_plugins_for_hook(
        state,
        PluginHook::AfterUpload,
        asset_name,
        Some(public_url),
        mime_type,
        json!({"source":"publish"}),
    )
    .await
}

async fn run_gallery_delete_plugins(state: &AppState, storage_id: Uuid, remote_path: &str) {
    let name = remote_path.rsplit('/').next().unwrap_or(remote_path);
    let summary = run_enabled_plugins_for_hook(
        state,
        PluginHook::OnGalleryDelete,
        name,
        None,
        "application/octet-stream",
        json!({"source":"gallery_delete","storageId":storage_id.to_string(),"remotePath":remote_path}),
    )
    .await;
    if !summary.failures.is_empty() {
        tracing::warn!(failures = ?summary.failures, "gallery-delete plugin hook failed");
    }
}

async fn persist_plugin_outputs(
    state: &AppState,
    asset_id: Uuid,
    outputs: &[PluginExecutionView],
) -> CmdResult<()> {
    let records = outputs
        .iter()
        .map(|output| AssetPluginOutputRecord {
            plugin_id: output.plugin_id.clone(),
            plugin_name: output.plugin_name.clone(),
            plugin_kind: output.plugin_kind.clone(),
            text: output.text.clone(),
            data_json: output.data.clone(),
            created_at: Utc::now(),
        })
        .collect::<Vec<_>>();
    state
        .assets
        .replace_plugin_outputs(asset_id, &records)
        .await
        .map_err(|e| e.to_string())
}

async fn run_workflow_publish_task(
    app: AppHandle,
    state: AppState,
    workflow: Workflow,
    path: PathBuf,
    task_id: Uuid,
) {
    let result: CmdResult<()> = async {
        state
            .tasks
            .mark_preparing(task_id, 5)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "preparing", 5, None);

        let raw_bytes = tokio::fs::read(&path)
            .await
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("asset.bin")
            .to_string();
        let mime_type = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        if !mime_type.starts_with("image/") {
            return Err(format!("Only image files are supported: {file_name}"));
        }

        state
            .tasks
            .mark_running(task_id, 18)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "running", 18, None);

        let before_process = run_enabled_plugins_for_hook(
            &state,
            PluginHook::BeforeProcess,
            &file_name,
            None,
            &mime_type,
            json!({"source":"publish","path":path.to_string_lossy(),"taskId":task_id.to_string()}),
        )
        .await;

        let processing_workflow = workflow.clone();
        let processing_file_name = file_name.clone();
        let processing_mime_type = mime_type.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            prepare_asset(
                &processing_workflow,
                &raw_bytes,
                &processing_file_name,
                &processing_mime_type,
            )
        })
        .await
        .map_err(|error| format!("Image worker failed: {error}"))?
        .map_err(|error| error.to_string())?;
        state
            .tasks
            .mark_running(task_id, 38)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "running", 38, None);

        let after_process = run_enabled_plugins_for_hook(
            &state,
            PluginHook::AfterProcess,
            &file_name,
            None,
            &prepared.mime_type,
            json!({
                "source":"publish",
                "taskId":task_id.to_string(),
                "remotePath":prepared.remote_path.clone(),
                "variantLabel":prepared.variant_label.clone(),
                "width":prepared.width,
                "height":prepared.height,
                "sizeBytes":prepared.body.len()
            }),
        )
        .await;

        let outcomes = match prepared.target.clone() {
            PublishTarget::Storage { storage_id } => {
                let storage = state
                    .storages
                    .get(storage_id)
                    .await
                    .map_err(|error| error.to_string())?
                    .ok_or("Workflow storage no longer exists")?;
                let provider = build_provider(&state, &storage)?;
                PublisherCore::publish_group(
                    StorageGroupStrategy::MirrorAll,
                    vec![PublishMember {
                        storage_id: storage.id,
                        storage_name: storage.name,
                        role: DeploymentRole::Primary,
                        priority: 0,
                        provider: Ok(provider),
                    }],
                    prepared.body.clone(),
                    prepared.remote_path.clone(),
                    prepared.mime_type.clone(),
                )
                .await
                .map_err(|error| error.to_string())?
            }
            PublishTarget::StorageGroup { storage_group_id } => {
                let group = state
                    .groups
                    .get(storage_group_id)
                    .await
                    .map_err(|error| error.to_string())?
                    .ok_or("Workflow Storage Group no longer exists")?;
                publish_group_bytes(
                    &state,
                    &group,
                    prepared.body.clone(),
                    prepared.remote_path.clone(),
                    prepared.mime_type.clone(),
                )
                .await?
            }
        };

        state
            .tasks
            .mark_running(task_id, 82)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "running", 82, None);

        let success_count = outcomes
            .iter()
            .filter(|outcome| outcome.error.is_none())
            .count();
        if success_count == 0 {
            let errors = outcomes
                .iter()
                .filter_map(|outcome| {
                    outcome
                        .error
                        .as_ref()
                        .map(|error| format!("{}: {error}", outcome.storage_name))
                })
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(format!("Workflow publish failed on every target: {errors}"));
        }

        let now = Utc::now();
        let asset = Asset {
            id: Uuid::new_v4(),
            name: file_name,
            kind: AssetKind::Image,
            created_at: now,
            updated_at: now,
        };
        let variant = AssetVariant {
            id: Uuid::new_v4(),
            asset_id: asset.id,
            label: prepared.variant_label,
            mime_type: prepared.mime_type,
            size_bytes: prepared.body.len() as u64,
            width: prepared.width,
            height: prepared.height,
            content_hash: prepared.content_hash,
            created_at: now,
        };
        let deployment_records = outcomes
            .iter()
            .map(|outcome| DeploymentWriteRecord {
                deployment: Deployment {
                    id: Uuid::new_v4(),
                    variant_id: variant.id,
                    storage_id: outcome.storage_id,
                    role: outcome.role.clone(),
                    remote_path: outcome.remote_path.clone(),
                    public_url: outcome.public_url.clone(),
                    status: if outcome.error.is_none() {
                        DeploymentStatus::Online
                    } else {
                        DeploymentStatus::Failed
                    },
                    timestamps: domain::DeploymentTimestamps {
                        deployed_at: Some(now),
                        last_attempted_at: Some(now),
                        ..Default::default()
                    },
                },
                last_error: outcome.error.clone(),
                error_kind: outcome.error_kind,
            })
            .collect::<Vec<_>>();
        if let Err(error) = state
            .assets
            .insert_published_many(&asset, &variant, &deployment_records)
            .await
        {
            let (points, skipped) = rollback_plan(variant.id, &outcomes);
            let resolver = rollback_resolver(&state, &points).await;
            let summary = crate::rollback::run_rollback(&state.journal, &points, resolver).await;
            let failures = combine_rollback_failures(summary, skipped);
            let mut message = format!("远端上传已完成，但本地记录保存失败：{error}");
            if failures.is_empty() {
                message.push_str("；已回滚本次成功上传的远端文件");
            } else {
                message.push_str(&format!(
                    "；部分远端回滚失败，可能存在孤儿文件：{}",
                    failures.join(" | ")
                ));
            }
            return Err(message);
        }
        let published_url = PublisherCore::select_public_url(&outcomes);
        let mut plugin_run = run_enabled_plugins_for_asset(
            &state,
            &asset.name,
            published_url.as_deref(),
            &variant.mime_type,
        )
        .await;
        if let Err(error) = persist_plugin_outputs(&state, asset.id, &plugin_run.outputs).await {
            plugin_run
                .failures
                .push(format!("插件结果保存失败：{error}"));
        }
        persistence_sqlite::journal::record_publish_events(
            &state.journal,
            asset.id,
            variant.id,
            &deployment_records,
            published_url.as_deref(),
        )
        .await;
        persistence_sqlite::journal::record_upload_attempts(
            &state.journal,
            variant.id,
            &deployment_records,
        )
        .await;
        // Matched by storage id, which is unique within a group (0001_init.sql declares
        // PRIMARY KEY(group_id, storage_id) on storage_group_members), so this lookup cannot be
        // ambiguous. A positional zip would have worked today too, but would silently mis-pair a
        // verdict with the wrong row if the two collections ever diverge - and a mis-paired
        // verification is worse than a missing one because it looks authoritative.
        let verified: Vec<persistence_sqlite::journal::VerifiedDeployment> = deployment_records
            .iter()
            .filter_map(|record| {
                let proof = outcomes
                    .iter()
                    .find(|outcome| outcome.storage_id == record.deployment.storage_id)
                    .and_then(|outcome| outcome.verification.as_ref())?;
                Some(persistence_sqlite::journal::VerifiedDeployment {
                    deployment_id: record.deployment.id,
                    method: proof.method.clone(),
                    passed: proof.passed,
                    expected: proof.expected.clone(),
                    observed: proof.observed.clone(),
                })
            })
            .collect();
        persistence_sqlite::journal::record_verification_events(&state.journal, &verified).await;
        for proof in &verified {
            if let Err(error) = state
                .assets
                .record_deployment_verification(proof.deployment_id, proof.passed)
                .await
            {
                tracing::warn!(%error, "could not record a verification timestamp");
            }
        }
        emit_asset_published(
            &app,
            &asset.name,
            published_url.as_deref(),
            &plugin_run.outputs,
        );
        let mut plugin_failures = plugin_run.failures;
        plugin_failures.extend(before_process.failures);
        plugin_failures.extend(after_process.failures);

        let failures = outcomes
            .iter()
            .filter_map(|outcome| {
                outcome
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {error}", outcome.storage_name))
            })
            .collect::<Vec<_>>();
        if failures.is_empty() && plugin_failures.is_empty() {
            state
                .tasks
                .complete(task_id)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            let mut notes = Vec::new();
            if !failures.is_empty() {
                notes.push(format!("部分云端失败：{}", failures.join(" | ")));
            }
            if !plugin_failures.is_empty() {
                notes.push(format!("插件执行失败：{}", plugin_failures.join(" | ")));
            }
            state
                .tasks
                .complete_with_note(task_id, notes.join("；"))
                .await
                .map_err(|error| error.to_string())?;
        }
        emit_task(&app, task_id, "completed", 100, None);
        Ok(())
    }
    .await;

    if let Err(error) = result {
        let failure_plugins = run_enabled_plugins_for_hook(
            &state,
            PluginHook::OnPublishFailure,
            path.file_name().and_then(|value| value.to_str()).unwrap_or("asset"),
            None,
            mime_guess::from_path(&path).first_or_octet_stream().essence_str(),
            json!({"source":"publish","taskId":task_id.to_string(),"path":path.to_string_lossy(),"error":error.clone()}),
        ).await;
        if !failure_plugins.failures.is_empty() {
            tracing::warn!(failures = ?failure_plugins.failures, "publish-failure plugin hook failed");
        }
        let _ = state.tasks.fail(task_id, error.clone()).await;
        emit_task(&app, task_id, "failed", 100, Some(error));
    }
}

type GroupUploadOutcome = application::PublishOutcome;

/// Build the deletable set for a partial publish, reporting what was refused.
///
/// The unsafe paths are not dropped silently: each one becomes a message the caller surfaces, so
/// "we chose not to delete this" never reads as "there was nothing to clean up".
fn rollback_plan(
    variant_id: Uuid,
    outcomes: &[GroupUploadOutcome],
) -> (Vec<storage_core::rollback::RollbackPoint>, Vec<String>) {
    let candidates: Vec<storage_core::rollback::RollbackPoint> = outcomes
        .iter()
        .filter(|outcome| outcome.error.is_none())
        .map(|outcome| storage_core::rollback::RollbackPoint {
            variant_id,
            storage_id: outcome.storage_id,
            remote_path: outcome.remote_path.clone(),
            label: Some(outcome.storage_name.clone()),
        })
        .collect();
    // One filter owns the deletable set; this function does not re-implement the predicate, which
    // is how the two entry points drifted apart before.
    let skipped: Vec<String> = candidates
        .iter()
        .filter(|point| !storage_core::is_safe_compensation_path(&point.remote_path))
        .map(storage_core::rollback::skipped_legacy_path_message)
        .collect();
    (
        storage_core::rollback::safe_rollback_points(candidates),
        skipped,
    )
}

/// Reload every storage named by the plan, then hand out providers from that snapshot.
///
/// ## Why reload at all
///
/// A storage edited mid-publish must not be deleted through credentials the user already replaced,
/// so the in-memory map is not trusted here.
///
/// ## Why one await instead of one per point
///
/// `execute_rollback` takes a synchronous resolver because storage-core cannot reach the database.
/// Making each lookup async inside that loop would require persistence in storage-core, which is
/// the dependency edge this layer exists to avoid. So the awaits happen once, up front, and any
/// storage missing from the snapshot resolves to an error - counted as a failed point rather than
/// silently skipped.
async fn rollback_resolver(
    state: &AppState,
    points: &[storage_core::rollback::RollbackPoint],
) -> impl FnMut(Uuid) -> Result<Arc<dyn StorageProvider>, storage_core::StorageError> {
    let mut providers: Vec<(Uuid, Arc<dyn StorageProvider>)> = Vec::new();
    for storage_id in points
        .iter()
        .map(|point| point.storage_id)
        .collect::<Vec<_>>()
    {
        // A storage that cannot be reloaded is left out of the snapshot on purpose: the resolver
        // below then reports it as an error, so the point counts as failed instead of vanishing.
        if let Ok(Some(record)) = state.storages.get(storage_id).await {
            if let Ok(provider) = build_provider(state, &record) {
                providers.push((storage_id, provider));
            }
        }
    }
    move |storage_id| {
        providers
            .iter()
            .find(|(id, _)| *id == storage_id)
            .map(|(_, provider)| Arc::clone(provider))
            .ok_or_else(|| {
                storage_core::StorageError::Provider("storage no longer exists".to_string())
            })
    }
}

/// Merge counted delete failures with paths the plan refused to touch.
///
/// Both belong in the user's orphan warning: one is "tried and failed", the other "declined by
/// design", and dropping either would understate how many objects remain remote.
fn combine_rollback_failures(
    summary: storage_core::rollback::RollbackSummary,
    mut skipped: Vec<String>,
) -> Vec<String> {
    if summary.failed_count > 0 {
        skipped.insert(0, format!("{} 个远端对象删除失败", summary.failed_count));
    }
    skipped
}

async fn publish_group_bytes(
    state: &AppState,
    group: &StorageGroupRecord,
    bytes: Bytes,
    remote_path: String,
    mime_type: String,
) -> CmdResult<Vec<GroupUploadOutcome>> {
    let strategy = match group.strategy.as_str() {
        "mirror_all" => StorageGroupStrategy::MirrorAll,
        "primary_with_backups" => StorageGroupStrategy::PrimaryWithBackups,
        other => return Err(format!("Unsupported Storage Group strategy: {other}")),
    };

    let mut members = Vec::with_capacity(group.members.len());
    let mut storage_records = Vec::with_capacity(group.members.len());
    for member in &group.members {
        let role = deployment_role_from_str(&member.role)?;
        let provider = match state
            .storages
            .get(member.storage_id)
            .await
            .map_err(|error| error.to_string())?
        {
            Some(storage) => {
                let provider = build_provider(state, &storage)
                    .map_err(|error| format!("Cannot initialize {}: {error}", member.storage_name));
                storage_records.push(storage);
                provider
            }
            None => Err("Storage no longer exists".to_string()),
        };
        members.push(PublishMember {
            storage_id: member.storage_id,
            storage_name: member.storage_name.clone(),
            role,
            priority: member.priority,
            provider,
        });
    }

    // This second guard also covers direct group calls that did not run UI preflight.
    validate_group_access_intents(&storage_records, group.members.len())?;
    PublisherCore::publish_group(strategy, members, bytes, remote_path, mime_type)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn repair_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> CmdResult<String> {
    let asset_uuid = Uuid::parse_str(&asset_id).map_err(|error| error.to_string())?;
    let context = state
        .assets
        .repair_context(asset_uuid)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Asset not found")?;
    let task = state
        .tasks
        .create(
            "repair_asset",
            json!({"assetId": asset_id, "assetName": context.name}),
        )
        .await
        .map_err(|error| error.to_string())?;
    let app_state = state.inner().clone();
    let task_id = task.id;
    tauri::async_runtime::spawn(async move {
        run_repair_task(app, app_state, asset_uuid, task_id).await;
    });
    Ok(task_id.to_string())
}

async fn run_repair_task(app: AppHandle, state: AppState, asset_id: Uuid, task_id: Uuid) {
    let result: CmdResult<()> = async {
        state
            .tasks
            .mark_preparing(task_id, 5)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "preparing", 5, None);

        let context = state
            .assets
            .repair_context(asset_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or("Asset not found")?;
        let failed = context
            .deployments
            .iter()
            .filter(|deployment| matches!(deployment.status.as_str(), "failed" | "degraded"))
            .cloned()
            .collect::<Vec<_>>();
        if failed.is_empty() {
            state
                .tasks
                .complete(task_id)
                .await
                .map_err(|error| error.to_string())?;
            emit_task(&app, task_id, "completed", 100, None);
            return Ok(());
        }

        let mut source_bytes = None;
        for source in context
            .deployments
            .iter()
            .filter(|deployment| deployment.status == "online")
        {
            let Some(storage) = state
                .storages
                .get(source.storage_id)
                .await
                .map_err(|error| error.to_string())?
            else {
                continue;
            };
            let Ok(provider) = build_provider(&state, &storage) else {
                continue;
            };
            if !provider.capabilities().download {
                continue;
            }
            if let Ok(bytes) = provider.download(&source.remote_path).await {
                let actual_hash = hex::encode(Sha256::digest(bytes.as_ref()));
                if actual_hash == context.content_hash {
                    source_bytes = Some(bytes);
                    break;
                }
                let message = format!(
                    "远端内容哈希不匹配：期望 {}，实际 {}。该副本不会用于修复。",
                    context.content_hash, actual_hash
                );
                let _ = state
                    .assets
                    .update_deployment_result(
                        source.deployment_id,
                        DeploymentStatus::Degraded,
                        None,
                        Some(message),
                        // The bytes came back different. That is neither a transport failure nor a
                        // refusal by the provider, so it lands on Rejected rather than borrowing a
                        // kind that would imply retrying or reconfiguring.
                        Some(domain::StorageErrorKind::Rejected),
                    )
                    .await;
            }
        }
        let bytes = source_bytes.ok_or(
            "没有可下载且哈希校验通过的健康副本，已停止修复，避免把错误内容扩散到其他云端",
        )?;

        state
            .tasks
            .mark_running(task_id, 35)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "running", 35, None);

        let total = failed.len();
        let mut remaining_failures = Vec::new();
        for (index, deployment) in failed.into_iter().enumerate() {
            let storage = match state
                .storages
                .get(deployment.storage_id)
                .await
                .map_err(|error| error.to_string())?
            {
                Some(storage) => storage,
                None => {
                    let error = "Storage no longer exists".to_string();
                    state
                        .assets
                        .update_deployment_result(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                            None,
                            Some(error.clone()),
                            // No StorageError was produced here - the local storage record is
                            // gone - but NotFound is still honest: nothing works until the
                            // target is configured again.
                            Some(domain::StorageErrorKind::NotFound),
                        )
                        .await
                        .map_err(|db_error| db_error.to_string())?;
                    remaining_failures.push(error);
                    continue;
                }
            };
            let provider = match build_provider(&state, &storage) {
                Ok(provider) => provider,
                Err(error) => {
                    state
                        .assets
                        .update_deployment_result(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                            None,
                            Some(error.clone()),
                            // build_provider only fails for a missing or unusable credential
                            // reference, which the user can act on. Asserted by a gate below.
                            Some(domain::StorageErrorKind::Authentication),
                        )
                        .await
                        .map_err(|db_error| db_error.to_string())?;
                    remaining_failures.push(format!("{}: {error}", storage.name));
                    continue;
                }
            };
            match provider
                .upload(UploadRequest {
                    path: deployment.remote_path.clone(),
                    content_type: Some(context.mime_type.clone()),
                    body: bytes.clone(),
                })
                .await
            {
                Ok(upload) => {
                    state
                        .assets
                        .update_deployment_result(
                            deployment.deployment_id,
                            DeploymentStatus::Online,
                            upload.public_url,
                            None,
                            None,
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                }
                Err(error) => {
                    let message = error.to_string();
                    state
                        .assets
                        .update_deployment_result(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                            None,
                            Some(message.clone()),
                            Some(error.kind()),
                        )
                        .await
                        .map_err(|db_error| db_error.to_string())?;
                    remaining_failures.push(format!("{}: {message}", storage.name));
                }
            }

            let progress = 35 + (((index + 1) * 55) / total) as u8;
            state
                .tasks
                .mark_running(task_id, progress)
                .await
                .map_err(|error| error.to_string())?;
            emit_task(&app, task_id, "running", progress, None);
        }

        if remaining_failures.is_empty() {
            state
                .tasks
                .complete(task_id)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            state
                .tasks
                .complete_with_note(
                    task_id,
                    format!("仍有云端副本修复失败：{}", remaining_failures.join(" | ")),
                )
                .await
                .map_err(|error| error.to_string())?;
        }
        emit_task(&app, task_id, "completed", 100, None);
        Ok(())
    }
    .await;

    if let Err(error) = result {
        let _ = state.tasks.fail(task_id, error.clone()).await;
        emit_task(&app, task_id, "failed", 100, Some(error));
    }
}

#[tauri::command]
pub async fn delete_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> CmdResult<String> {
    let asset_uuid = Uuid::parse_str(&asset_id).map_err(|error| error.to_string())?;
    let asset_name = state
        .assets
        .name(asset_uuid)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Asset not found")?;
    let payload = json!({"assetId": asset_id, "assetName": asset_name});
    let task = state
        .tasks
        .create("delete_asset", payload)
        .await
        .map_err(|error| error.to_string())?;

    let app_state = state.inner().clone();
    let task_id = task.id;
    tauri::async_runtime::spawn(async move {
        run_delete_task(app, app_state, asset_uuid, task_id).await;
    });
    Ok(task_id.to_string())
}

async fn run_delete_task(app: AppHandle, state: AppState, asset_id: Uuid, task_id: Uuid) {
    let result: CmdResult<()> = async {
        state
            .tasks
            .mark_preparing(task_id, 5)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "preparing", 5, None);

        let deployments = state
            .assets
            .deployment_locations(asset_id)
            .await
            .map_err(|error| error.to_string())?;
        if deployments.is_empty() {
            state
                .assets
                .delete_asset(asset_id)
                .await
                .map_err(|error| error.to_string())?;
            state
                .tasks
                .complete(task_id)
                .await
                .map_err(|error| error.to_string())?;
            emit_task(&app, task_id, "completed", 100, None);
            return Ok(());
        }

        state
            .tasks
            .mark_running(task_id, 10)
            .await
            .map_err(|error| error.to_string())?;
        emit_task(&app, task_id, "running", 10, None);
        let total = deployments.len();
        let mut failures = Vec::new();

        for (index, deployment) in deployments.into_iter().enumerate() {
            if deployment.status == "deleted" {
                continue;
            }

            // Older workflows could generate deterministic remote paths. If
            // another Asset still references the same storage/path, deleting
            // this Asset must not remove the shared remote object.
            let reference_count = state
                .assets
                .active_deployment_reference_count(deployment.storage_id, &deployment.remote_path)
                .await
                .map_err(|error| error.to_string())?;
            if reference_count > 1 {
                state
                    .assets
                    .update_deployment_status(deployment.deployment_id, DeploymentStatus::Deleted)
                    .await
                    .map_err(|error| error.to_string())?;
                let progress = 10 + (((index + 1) * 80) / total) as u8;
                state
                    .tasks
                    .mark_running(task_id, progress)
                    .await
                    .map_err(|error| error.to_string())?;
                emit_task(&app, task_id, "running", progress, None);
                continue;
            }

            let storage = match state
                .storages
                .get(deployment.storage_id)
                .await
                .map_err(|error| error.to_string())?
            {
                Some(storage) => storage,
                None => {
                    failures.push(format!(
                        "Storage {} no longer exists",
                        deployment.storage_id
                    ));
                    state
                        .assets
                        .update_deployment_status(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                    continue;
                }
            };

            let provider = match build_provider(&state, &storage) {
                Ok(provider) => provider,
                Err(error) => {
                    failures.push(format!("{}: {error}", storage.name));
                    state
                        .assets
                        .update_deployment_status(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                        )
                        .await
                        .map_err(|db_error| db_error.to_string())?;
                    continue;
                }
            };

            match provider.delete(&deployment.remote_path).await {
                Ok(()) => {
                    state
                        .assets
                        .update_deployment_status(
                            deployment.deployment_id,
                            DeploymentStatus::Deleted,
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                }
                Err(error) => {
                    failures.push(format!("{}: {error}", storage.name));
                    state
                        .assets
                        .update_deployment_status(
                            deployment.deployment_id,
                            DeploymentStatus::Failed,
                        )
                        .await
                        .map_err(|db_error| db_error.to_string())?;
                }
            }

            let progress = 10 + (((index + 1) * 80) / total) as u8;
            state
                .tasks
                .mark_running(task_id, progress)
                .await
                .map_err(|error| error.to_string())?;
            emit_task(&app, task_id, "running", progress, None);
        }

        if failures.is_empty() {
            state
                .assets
                .delete_asset(asset_id)
                .await
                .map_err(|error| error.to_string())?;
            state
                .tasks
                .complete(task_id)
                .await
                .map_err(|error| error.to_string())?;
            emit_task(&app, task_id, "completed", 100, None);
            Ok(())
        } else {
            Err(format!(
                "Some remote copies could not be deleted: {}",
                failures.join(" | ")
            ))
        }
    }
    .await;

    if let Err(error) = result {
        let _ = state.tasks.fail(task_id, error.clone()).await;
        emit_task(&app, task_id, "failed", 100, Some(error));
    }
}

#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CmdResult<Vec<TaskView>> {
    let limit = limit.unwrap_or(100).clamp(20, 10_000);
    Ok(state
        .tasks
        .list(limit)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(task_view)
        .collect())
}

#[tauri::command]
pub async fn list_assets(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CmdResult<Vec<AssetView>> {
    let limit = limit.unwrap_or(200).clamp(20, 10_000);
    Ok(state
        .assets
        .list(limit)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(asset_view)
        .collect())
}

async fn preflight_workflow_target(state: &AppState, workflow: &Workflow) -> CmdResult<()> {
    let target = workflow
        .steps
        .iter()
        .find_map(|step| match step {
            WorkflowStep::Publish { target } => Some(target.clone()),
            _ => None,
        })
        .ok_or("Workflow has no publish target")?;
    match target {
        PublishTarget::Storage { storage_id } => {
            let storage = state
                .storages
                .get(storage_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Workflow storage no longer exists")?;
            // Only validate local configuration here. The upload itself is the
            // authoritative network check; an eager network test creates a TOCTOU
            // race and, for groups, can block failover before Backup gets a chance.
            let _ = build_provider(state, &storage)?;
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            let group = state
                .groups
                .get(storage_group_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Workflow Storage Group no longer exists")?;
            let mut viable = 0usize;
            let mut storage_records = Vec::with_capacity(group.members.len());
            for member in &group.members {
                let Some(storage) = state
                    .storages
                    .get(member.storage_id)
                    .await
                    .map_err(|e| e.to_string())?
                else {
                    continue;
                };
                if build_provider(state, &storage).is_ok() {
                    viable += 1;
                }
                storage_records.push(storage);
            }
            validate_group_access_intents(&storage_records, group.members.len())?;
            if viable == 0 {
                return Err("Storage Group has no locally configured publish target".into());
            }
        }
    }
    Ok(())
}

fn build_provider(state: &AppState, record: &StorageRecord) -> CmdResult<Arc<dyn StorageProvider>> {
    let credential_ref = record
        .credential_ref
        .as_deref()
        .ok_or("Storage credential reference missing")?;
    match record.provider_key.as_str() {
        "r2" | "s3" => {
            let config: S3StorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: S3Credentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            let provider_key = if record.provider_key == "r2" {
                "r2"
            } else {
                "s3"
            };
            Ok(Arc::new(
                OpenDalStorage::s3(provider_key, &config, &credentials)
                    .map_err(|error| error.to_string())?,
            ))
        }
        "oss" => {
            let config: OssStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: OssCredentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::oss(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "cos" => {
            let config: CosStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: CosCredentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::cos(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "webdav" => {
            let config: WebDavStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: WebDavCredentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::webdav(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "github" => {
            let config: GitHubStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GitHubCredentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(GitHubStorage::new(config, credentials)))
        }
        "gitee" => {
            let config: GiteeStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GiteeCredentials = state
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(GiteeStorage::new(config, credentials)))
        }
        _ => Err(format!(
            "Provider {} is not wired in this build",
            record.provider_key
        )),
    }
}

fn deployment_role_from_str(value: &str) -> CmdResult<DeploymentRole> {
    match value {
        "primary" => Ok(DeploymentRole::Primary),
        "mirror" => Ok(DeploymentRole::Mirror),
        "backup" => Ok(DeploymentRole::Backup),
        _ => Err(format!("Unsupported deployment role: {value}")),
    }
}

fn storage_group_view(record: StorageGroupRecord) -> StorageGroupView {
    StorageGroupView {
        id: record.id.to_string(),
        name: record.name,
        strategy: record.strategy,
        members: record
            .members
            .into_iter()
            .map(|member| StorageGroupMemberView {
                storage_id: member.storage_id.to_string(),
                storage_name: member.storage_name,
                provider_key: member.provider_key,
                role: member.role,
                priority: member.priority,
            })
            .collect(),
    }
}

fn storage_requests_private(record: &StorageRecord) -> bool {
    record.provider_key == "r2"
        && record.config_json.get("access_mode").and_then(Value::as_str)
            == Some("private_requested")
}

// Applies to both setup and later group publishing: a storage intent must never silently
// cross from a private-requested R2 target into a public replica.
fn validate_group_access_intents(storages: &[StorageRecord], expected_count: usize) -> CmdResult<()> {
    if storages.iter().any(storage_requests_private)
        && (storages.len() != expected_count || storages.iter().any(|s| !storage_requests_private(s)))
    {
        return Err("私有 R2 不能与公开、未知或已删除的目标组成同一发布组，请拆分工作流".into());
    }
    Ok(())
}

fn storage_view(record: &StorageRecord) -> StorageView {
    let public_base_url = record
        .config_json
        .get("public_base_url")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let (detail, public_hint) = if record.category == "repository" {
        let owner = record
            .config_json
            .get("owner")
            .and_then(Value::as_str)
            .unwrap_or("");
        let repo = record
            .config_json
            .get("repo")
            .and_then(Value::as_str)
            .unwrap_or("");
        let branch = record
            .config_json
            .get("branch")
            .and_then(Value::as_str)
            .unwrap_or("main");
        (
            format!("{owner}/{repo} · {branch}"),
            if public_base_url.is_some() {
                "Custom public URL".into()
            } else {
                "Repository raw URL".into()
            },
        )
    } else if record.provider_key == "webdav" {
        let endpoint = record
            .config_json
            .get("endpoint")
            .and_then(Value::as_str)
            .unwrap_or("");
        (endpoint.into(), "Public base URL".into())
    } else {
        let bucket = record
            .config_json
            .get("bucket")
            .and_then(Value::as_str)
            .unwrap_or("");
        (bucket.into(), "Public base URL".into())
    };

    StorageView {
        id: record.id.to_string(),
        name: record.name.clone(),
        provider_key: record.provider_key.clone(),
        category: record.category.clone(),
        enabled: record.enabled,
        detail,
        public_base_url,
        public_hint: if storage_requests_private(record) {
            "已请求私有 · Bucket 公开策略未验证".into()
        } else {
            public_hint
        },
        access_mode: if storage_requests_private(record) {
            "private_requested".into()
        } else if record.provider_key == "r2" || record.provider_key == "s3" {
            "public".into()
        } else {
            "unknown".into()
        },
    }
}

fn storage_entry_view(entry: StorageEntry) -> StorageEntryView {
    StorageEntryView {
        name: entry.name,
        path: entry.path,
        is_dir: entry.is_dir,
        size_bytes: entry.size_bytes,
        public_url: entry.public_url,
    }
}

fn emit_asset_published(
    app: &AppHandle,
    name: &str,
    public_url: Option<&str>,
    plugin_outputs: &[PluginExecutionView],
) {
    let Some(public_url) = public_url.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    let _ = app.emit(
        "asset://published",
        json!({
            "name": name,
            "publicUrl": public_url,
            "pluginOutputs": plugin_outputs
        }),
    );
}

fn emit_task(app: &AppHandle, id: Uuid, status: &str, progress: u8, error: Option<String>) {
    let _ = app.emit(
        "task://updated",
        json!({
            "id": id.to_string(),
            "status": status,
            "progress": progress,
            "error": error
        }),
    );
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn task_view(record: TaskRecord) -> TaskView {
    let (title, detail) = match record.kind.as_str() {
        "delete_asset" => {
            let name = record
                .payload_json
                .get("assetName")
                .and_then(Value::as_str)
                .unwrap_or("资源");
            (format!("删除 {name}"), "删除所有远端副本".into())
        }
        "repair_asset" => {
            let name = record
                .payload_json
                .get("assetName")
                .and_then(Value::as_str)
                .unwrap_or("资源");
            (format!("修复 {name}"), "从健康云端副本重建失败副本".into())
        }
        "workflow_url_publish" => {
            let url = record
                .payload_json
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("远端图片");
            let workflow = record
                .payload_json
                .get("workflowName")
                .and_then(Value::as_str)
                .unwrap_or("方案");
            (format!("URL 发布 {}", url), workflow.into())
        }
        "workflow_clipboard_publish" => {
            let workflow = record
                .payload_json
                .get("workflowName")
                .and_then(Value::as_str)
                .unwrap_or("方案");
            let width = record
                .payload_json
                .get("width")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let height = record
                .payload_json
                .get("height")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            (format!("剪贴板发布 {width}×{height}"), workflow.into())
        }
        "workflow_publish" => {
            let path = record
                .payload_json
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("");
            let workflow = record
                .payload_json
                .get("workflowName")
                .and_then(Value::as_str)
                .unwrap_or("方案");
            let name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("资源");
            (format!("方案发布 {name}"), workflow.into())
        }
        "cloud_batch_delete" => {
            let count = record
                .payload_json
                .get("count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            (
                format!("批量删除 {count} 个云端文件"),
                "Cloud Manager 后台任务".into(),
            )
        }
        "cloud_batch_move" => {
            let count = record
                .payload_json
                .get("count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let destination = record
                .payload_json
                .get("destinationDir")
                .and_then(Value::as_str)
                .unwrap_or("");
            (
                format!("批量移动 {count} 个云端文件"),
                if destination.is_empty() {
                    "移动到根目录".into()
                } else {
                    format!("目标目录：{destination}")
                },
            )
        }
        "cloud_batch_rename" => {
            let count = record
                .payload_json
                .get("count")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let template = record
                .payload_json
                .get("template")
                .and_then(Value::as_str)
                .unwrap_or("");
            (
                format!("批量重命名 {count} 个云端文件"),
                format!("模板：{template}"),
            )
        }
        "typora_publish" => {
            let path = record
                .payload_json
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("");
            let workflow = record
                .payload_json
                .get("workflowName")
                .and_then(Value::as_str)
                .unwrap_or("默认方案");
            let name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("图片");
            (format!("Typora 发布 {name}"), workflow.into())
        }
        "publish_group" => {
            let path = record
                .payload_json
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("");
            let group = record
                .payload_json
                .get("groupName")
                .and_then(Value::as_str)
                .unwrap_or("Storage Group");
            let name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("资源");
            (format!("多云发布 {name}"), group.into())
        }
        _ => {
            let path = record
                .payload_json
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("");
            let storage = record
                .payload_json
                .get("storageName")
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("资源");
            (format!("发布 {name}"), storage.into())
        }
    };
    let supports_control = record.kind.starts_with("cloud_batch_");
    let can_cancel = supports_control
        && matches!(
            record.status.as_str(),
            "queued" | "preparing" | "running" | "paused"
        );
    let can_retry = supports_control
        && matches!(record.status.as_str(), "failed" | "cancelled")
        && record.attempt < record.max_attempts;
    TaskView {
        id: record.id.to_string(),
        kind: record.kind,
        title,
        detail,
        status: record.status,
        progress: record.progress,
        attempt: record.attempt,
        max_attempts: record.max_attempts,
        can_cancel,
        can_retry,
        created_at: record.created_at.to_rfc3339(),
        error: record.error,
    }
}

fn asset_view(record: PublishedAssetRecord) -> AssetView {
    let public_url = record
        .deployments
        .iter()
        .find(|deployment| deployment.role == "primary" && deployment.status == "online")
        .and_then(|deployment| deployment.public_url.clone())
        .or_else(|| {
            record
                .deployments
                .iter()
                .find(|deployment| deployment.status == "online")
                .and_then(|deployment| deployment.public_url.clone())
        })
        .unwrap_or_default();
    let status = if record
        .deployments
        .iter()
        .all(|deployment| deployment.status == "online")
    {
        "online"
    } else if record
        .deployments
        .iter()
        .any(|deployment| deployment.status == "online")
    {
        "partial"
    } else {
        "failed"
    };
    AssetView {
        id: record.id.to_string(),
        name: record.name,
        size_bytes: record.size_bytes,
        mime_type: record.mime_type,
        width: record.width,
        height: record.height,
        public_url,
        status: status.into(),
        created_at: record.created_at.to_rfc3339(),
        deployments: record
            .deployments
            .into_iter()
            .map(|deployment| {
                let level =
                    domain::confirmation_tier::derive_confirmation(&deployment.timestamps).level();
                AssetDeploymentView {
                    storage: deployment.storage_name,
                    storage_id: deployment.storage_id.to_string(),
                    remote_path: deployment.remote_path,
                    provider_key: deployment.provider_key,
                    access_mode: deployment.access_mode,
                    role: deployment.role,
                    ok: deployment.status == "online",
                    error: deployment.last_error,
                    confirmation_level: level,
                    error_kind: deployment.error_kind,
                }
            })
            .collect(),
        plugin_outputs: record
            .plugin_outputs
            .into_iter()
            .map(|output| PluginExecutionView {
                plugin_id: output.plugin_id,
                plugin_name: output.plugin_name,
                plugin_kind: output.plugin_kind,
                text: output.text,
                data: output.data_json,
            })
            .collect(),
    }
}

#[cfg(test)]
mod r2_private_access_tests {
    use super::*;

    fn input(access_mode: ObjectAccessMode, public_base_url: Option<&str>) -> CreateS3StorageInput {
        CreateS3StorageInput {
            provider_key: "r2".into(),
            name: "test-r2".into(),
            account_id: Some("testaccount".into()),
            endpoint: None,
            region: Some("auto".into()),
            bucket: "test-bucket".into(),
            root: Some("assets".into()),
            public_base_url: public_base_url.map(str::to_string),
            access_mode,
            access_key_id: "test-key".into(),
            secret_access_key: "not-a-real-secret".into(),
        }
    }

    fn storage(access_mode: &str, provider_key: &str) -> StorageRecord {
        let now = Utc::now();
        StorageRecord {
            id: Uuid::new_v4(),
            name: "test".into(),
            provider_key: provider_key.into(),
            category: "object".into(),
            credential_ref: None,
            config_json: json!({"access_mode":access_mode}),
            capabilities_json: json!({}),
            enabled: true,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn private_r2_can_be_configured_without_any_public_url() {
        let (config, _, key) = normalize_s3(&input(ObjectAccessMode::PrivateRequested, None))
            .expect("private-requested R2 config should be valid");
        assert_eq!(key, "r2");
        assert_eq!(config.access_mode, ObjectAccessMode::PrivateRequested);
        assert!(config.public_base_url.is_none());
    }

    #[test]
    fn private_r2_refuses_public_base_and_other_s3_providers() {
        assert!(
            normalize_s3(&input(
                ObjectAccessMode::PrivateRequested,
                Some("https://public.example")
            ))
            .is_err()
        );
        let mut generic_s3 = input(ObjectAccessMode::PrivateRequested, None);
        generic_s3.provider_key = "s3".into();
        assert!(normalize_s3(&generic_s3).is_err());
    }

    #[test]
    fn legacy_r2_payload_stays_public_after_deserialization() {
        let old: CreateS3StorageInput = serde_json::from_value(json!({
            "providerKey":"r2", "name":"legacy", "accountId":"testaccount",
            "bucket":"test-bucket", "accessKeyId":"test-key",
            "secretAccessKey":"not-a-real-secret", "publicBaseUrl":"https://public.example"
        }))
        .expect("old payload");
        assert_eq!(old.access_mode, ObjectAccessMode::Public);
        let (config, _, _) = normalize_s3(&old).expect("old public R2 config");
        assert_eq!(config.public_base_url.as_deref(), Some("https://public.example"));
    }

    #[test]
    fn private_groups_reject_public_and_missing_targets() {
        let private = storage("private_requested", "r2");
        let public = storage("public", "r2");
        assert!(validate_group_access_intents(&[private.clone()], 1).is_ok());
        assert!(validate_group_access_intents(&[private.clone(), private.clone()], 2).is_ok());
        assert!(validate_group_access_intents(&[private.clone(), public.clone()], 2).is_err());
        assert!(validate_group_access_intents(&[private], 2).is_err());
        assert!(validate_group_access_intents(&[public], 1).is_ok());
    }

    #[test]
    fn private_uploaded_deployment_is_online_without_public_url() {
        let now = Utc::now();
        let deployment = persistence_sqlite::DeploymentSummaryRecord {
            deployment_id: Uuid::new_v4(),
            storage_id: Uuid::new_v4(),
            storage_name: "private R2".into(),
            provider_key: "r2".into(),
            access_mode: "private_requested".into(),
            role: "primary".into(),
            status: "online".into(),
            remote_path: "test/image.png".into(),
            public_url: None,
            last_error: None,
            error_kind: None,
            timestamps: domain::DeploymentTimestamps::default(),
        };
        let record = PublishedAssetRecord {
            id: Uuid::new_v4(),
            name: "image.png".into(),
            variant_id: Uuid::new_v4(),
            mime_type: "image/png".into(),
            size_bytes: 4,
            width: None,
            height: None,
            content_hash: "test".into(),
            created_at: now,
            deployments: vec![deployment],
            plugin_outputs: vec![],
        };
        let rendered = asset_view(record);
        assert_eq!(rendered.status, "online");
        assert!(rendered.public_url.is_empty());
        assert_eq!(rendered.deployments[0].access_mode, "private_requested");
        assert!(rendered.deployments[0].ok);
    }
}
