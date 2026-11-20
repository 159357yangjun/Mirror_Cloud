//! `cloud-browser` 内置插件：浏览、移动、删除云端文件并同步专辑索引。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands/storage_entries.rs` 的 13 条命令
//! （`browse_storage` / `create_temporary_share_link` / `preview_private_storage_entry` /
//! `delete_storage_entry` / `download_storage_entry` / `move_storage_entry` /
//! `create_storage_directory` / `batch_delete_storage_entries` / `batch_move_storage_entries` /
//! `batch_rename_storage_entries` / `queue_batch_delete_storage_entries` /
//! `queue_batch_move_storage_entries` / `queue_batch_rename_storage_entries`）。
//! `cancel_task` 与 `retry_task` 属内核（任务中心），不迁。
//!
//! ## 本插件拥有什么
//!
//! - 云端文件浏览、移动、删除、下载、目录创建的实现；
//! - 批量删除/移动/重命名的执行与进度上报；
//! - 后台批量任务的队列与执行（`tokio::spawn`，不依赖 Tauri 运行时）。
//!
//! ## 宿主保留什么
//!
//! 命令注册、`AppState` 生命周期、`AppHandle` 事件出口与图库删除钩子。
//! 插件通过两个注入 trait 拿到它们，不直接依赖 `tauri`：
//! [`TaskEventSink`]（替代 `emit_task`）与 [`GalleryDeleteRunner`]（替代
//! `run_gallery_delete_plugins`）。

use std::sync::Arc;

use application::CloudMutationCore;
use async_trait::async_trait;
use credential_store::CredentialStore;
use domain::DeploymentStatus;
use kernel_api::{
    BuiltinPlugin, Capability, Contribution, ContributionPoint, PluginFailure, PluginId,
    PluginKind, PluginManifestV2,
};
use persistence_sqlite::{AssetRepository, StorageRepository};
use provider_registry::ProviderRegistry;
use serde::Serialize;
use serde_json::{Value, json};
use storage_core::{StorageEntry, StorageError, StorageProvider};
use task_engine::TaskEngine;
use uuid::Uuid;

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "cloud-browser";

/// 插件清单：与 `crates/kernel/src/builtin.rs:185-195` 的装配条目一致。
pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new("cloud-browser").expect("static plugin id is valid"),
        name: "云端文件浏览".into(),
        version: "2.0.0-dev.1".into(),
        description: "浏览、移动、删除云端文件并同步专辑索引。".into(),
        kind: PluginKind::Native,
        permissions: vec![Capability::Network],
        default_enabled: true,
        contributes: vec![Contribution {
            point: ContributionPoint::Page,
            id: "page.gallery".into(),
            label: Some("云端文件".into()),
            description: None,
        }],
        settings_schema: None,
    }
}

/// 宿主注入的后台任务事件出口：替代 `commands.rs` 的 `emit_task`。
///
/// 插件不在内部持有 `AppHandle`，因此批量任务的进度与终态都经此 trait 推给宿主。
#[async_trait]
pub trait TaskEventSink: Send + Sync {
    async fn emit_task(&self, task_id: Uuid, status: &str, progress: u8, error: Option<String>);
}

/// 宿主注入的图库删除钩子出口：替代 `commands.rs` 的 `run_gallery_delete_plugins`。
///
/// 删除云端文件后调用；钩子失败由宿主决定是否仅告警，插件不吞错。
#[async_trait]
pub trait GalleryDeleteRunner: Send + Sync {
    async fn run_gallery_delete(&self, storage_id: Uuid, remote_path: &str);
}

/// 云端文件条目视图（camelCase，字段与 `commands.rs` 的 `StorageEntryView` 一致）。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntryView {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
    pub public_url: Option<String>,
}

/// 单条批量失败明细（camelCase，字段与 `commands.rs` 的 `BatchStorageFailureView` 一致）。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStorageFailureView {
    pub path: String,
    pub error: String,
}

/// 批量操作结果（camelCase，字段与 `commands.rs` 的 `BatchStorageOperationView` 一致）。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStorageOperationView {
    pub succeeded: usize,
    pub deployments_updated: usize,
    pub failures: Vec<BatchStorageFailureView>,
}

/// 私有预览结果（camelCase，字段与 `commands.rs` 的 `PrivateImagePreview` 一致）。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateImagePreview {
    pub mime_type: &'static str,
    pub bytes: Vec<u8>,
}

/// 云端文件浏览插件：仓储、任务引擎、凭据与 provider 注册表在启动时注入。
pub struct CloudBrowserPlugin {
    storages: StorageRepository,
    assets: AssetRepository,
    tasks: TaskEngine,
    credentials: CredentialStore,
    registry: Arc<ProviderRegistry>,
    events: Arc<dyn TaskEventSink>,
    gallery_delete: Arc<dyn GalleryDeleteRunner>,
    manifest: PluginManifestV2,
}

impl CloudBrowserPlugin {
    /// 构造插件。所有依赖由宿主在 `setup` 中构造后注入，插件不访问 `AppState`。
    pub fn new(
        storages: StorageRepository,
        assets: AssetRepository,
        tasks: TaskEngine,
        credentials: CredentialStore,
        registry: Arc<ProviderRegistry>,
        events: Arc<dyn TaskEventSink>,
        gallery_delete: Arc<dyn GalleryDeleteRunner>,
    ) -> Self {
        Self {
            storages,
            assets,
            tasks,
            credentials,
            registry,
            events,
            gallery_delete,
            manifest: manifest(),
        }
    }

    /// 按存储记录构造后端；错误文案与迁移前一致。
    fn build_provider(
        &self,
        record: &persistence_sqlite::StorageRecord,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        self.registry.build(record, &self.credentials, |key| {
            format!("Provider {key} is not wired in this build")
        })
    }

    /// 读取存储记录并构造后端；存储不存在或初始化失败时给出与迁移前一致的错误。
    async fn provider_for(
        &self,
        storage_id: Uuid,
    ) -> Result<(persistence_sqlite::StorageRecord, Arc<dyn StorageProvider>), String> {
        let record = self
            .storages
            .get(storage_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Storage not found".to_string())?;
        let provider = self.build_provider(&record)?;
        Ok((record, provider))
    }

    // ---------------------------------------------------------------------
    // 浏览 / 分享 / 预览
    // ---------------------------------------------------------------------

    /// 列出云端目录下的条目。
    pub async fn browse_storage(
        &self,
        storage_id: Uuid,
        path: &str,
    ) -> Result<Vec<StorageEntryView>, String> {
        let (_, provider) = self.provider_for(storage_id).await?;
        let items = provider
            .list(path.trim_matches('/'))
            .await
            .map_err(|error| error.to_string())?;
        Ok(items.into_iter().map(storage_entry_view).collect())
    }

    /// 为已有对象生成临时只读签名链接（仅 R2/S3）。
    pub async fn create_temporary_share_link(
        &self,
        storage_id: Uuid,
        path: &str,
        expires_in_seconds: u64,
    ) -> Result<String, String> {
        let expiry = validated_share_expiry(path, expires_in_seconds)?;
        let record = self
            .storages
            .get(storage_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Storage not found".to_string())?;
        if !record.enabled || !matches!(record.provider_key.as_str(), "r2" | "s3") {
            return Err("该存储暂不支持临时分享（当前只开放 R2/S3）".into());
        }
        let provider = self
            .build_provider(&record)
            .map_err(|_| "无法初始化存储连接，请检查存储配置".to_string())?;
        if !provider
            .exists(path)
            .await
            .map_err(|error| safe_share_error(&error).to_string())?
        {
            return Err("该云端对象已不存在，未生成分享链接".into());
        }
        provider
            .temporary_read_url(path, expiry)
            .await
            .map_err(|error| safe_share_error(&error).to_string())
    }

    /// 预览已配置为私有意图的 R2/S3 图片（只读入内存，不暴露签名 URL）。
    pub async fn preview_private_storage_entry(
        &self,
        storage_id: Uuid,
        path: &str,
    ) -> Result<PrivateImagePreview, String> {
        validated_share_expiry(path, 600)?;
        let record = self
            .storages
            .get(storage_id)
            .await
            .map_err(|_| "无法读取存储信息".to_string())?
            .ok_or_else(|| "该云端存储已不存在".to_string())?;
        if !record.enabled || !storage_requests_private(&record) {
            return Err("此入口仅可预览已经配置为私有意图的 R2/S3 文件".into());
        }
        let provider = self
            .build_provider(&record)
            .map_err(|_| "无法初始化私有存储连接".to_string())?;
        let bytes = provider
            .download_preview(path, PRIVATE_PREVIEW_MAX_BYTES)
            .await
            .map_err(|error| safe_share_error(&error).to_string())?
            .ok_or_else(|| "原图超过 5 MB，请使用“保存原图”下载后查看".to_string())?;
        let mime_type =
            private_preview_mime(&bytes).ok_or("只支持 PNG、JPEG、GIF、WebP 或 AVIF 图片预览")?;
        Ok(PrivateImagePreview {
            mime_type,
            bytes: bytes.to_vec(),
        })
    }

    // ---------------------------------------------------------------------
    // 单文件操作
    // ---------------------------------------------------------------------

    /// 删除云端文件，并同步本地 Deployment 状态。返回同步的 Deployment 条数。
    pub async fn delete_storage_entry(
        &self,
        storage_id: Uuid,
        path: &str,
    ) -> Result<usize, String> {
        let remote_path = path.trim().trim_matches('/');
        if remote_path.is_empty() {
            return Err("不能删除云端根目录".into());
        }
        let (_, provider) = self.provider_for(storage_id).await?;
        provider
            .delete(remote_path)
            .await
            .map_err(|error| error.to_string())?;

        let deployment_ids = self
            .assets
            .deployment_ids_for_remote(storage_id, remote_path)
            .await
            .map_err(|error| {
                format!(
                    "远端文件已删除，但本地 Deployment 状态同步失败：{error}。刷新资源后可再次执行修复/删除。"
                )
            })?;
        for deployment_id in &deployment_ids {
            self.assets
                .update_deployment_status(*deployment_id, DeploymentStatus::Deleted)
                .await
                .map_err(|error| {
                    format!(
                        "远端文件已删除，但本地 Deployment {deployment_id} 状态同步失败：{error}"
                    )
                })?;
        }
        self.gallery_delete
            .run_gallery_delete(storage_id, remote_path)
            .await;
        Ok(deployment_ids.len())
    }

    /// 下载云端文件到本地路径，返回写入字节数。
    pub async fn download_storage_entry(
        &self,
        storage_id: Uuid,
        path: &str,
        destination_path: &str,
    ) -> Result<u64, String> {
        let remote_path = path.trim().trim_matches('/');
        if remote_path.is_empty() {
            return Err("请选择一个远端文件".into());
        }
        let destination = destination_path.trim();
        if destination.is_empty() {
            return Err("下载目标路径不能为空".into());
        }
        let (_, provider) = self.provider_for(storage_id).await?;
        let bytes = provider
            .download(remote_path)
            .await
            .map_err(|error| error.to_string())?;
        tokio::fs::write(destination, &bytes)
            .await
            .map_err(|error| format!("写入下载文件失败：{error}"))?;
        Ok(bytes.len() as u64)
    }

    /// 移动云端文件，并同步本地 Deployment 路径。返回同步的 Deployment 条数。
    pub async fn move_storage_entry(
        &self,
        storage_id: Uuid,
        source_path: &str,
        destination_path: &str,
    ) -> Result<usize, String> {
        let source = normalize_remote_path(source_path)?;
        let destination = normalize_remote_path(destination_path)?;
        if source == destination {
            return Err("新路径与原路径相同".into());
        }
        let (_, provider) = self.provider_for(storage_id).await?;
        move_storage_entry_with_provider(
            &self.assets,
            storage_id,
            provider.as_ref(),
            &source,
            &destination,
        )
        .await
    }

    /// 创建云端目录。
    pub async fn create_storage_directory(
        &self,
        storage_id: Uuid,
        path: &str,
    ) -> Result<(), String> {
        let remote_path = normalize_remote_path(path)?;
        let (_, provider) = self.provider_for(storage_id).await?;
        provider
            .create_dir(&remote_path)
            .await
            .map_err(|error| match error {
                StorageError::Unsupported | StorageError::NotImplemented => {
                    "当前 Provider 不支持空目录。GitHub/Gitee 等仓库存储只有在目录中存在文件时才会显示目录。"
                        .into()
                }
                other => other.to_string(),
            })
    }

    // ---------------------------------------------------------------------
    // 批量操作
    // ---------------------------------------------------------------------

    /// 批量删除（同步执行，可带任务进度）。
    pub(crate) async fn batch_delete_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
        task: Option<&BatchTaskProgress>,
    ) -> Result<BatchStorageOperationView, String> {
        batch_delete_storage_entries_impl(self, storage_id, paths, task).await
    }

    /// 批量移动（同步执行，可带任务进度）。
    pub(crate) async fn batch_move_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
        destination_dir: &str,
        task: Option<&BatchTaskProgress>,
    ) -> Result<BatchStorageOperationView, String> {
        batch_move_storage_entries_impl(self, storage_id, paths, destination_dir, task).await
    }

    /// 批量重命名（同步执行，可带任务进度）。
    pub(crate) async fn batch_rename_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
        template: &str,
        task: Option<&BatchTaskProgress>,
    ) -> Result<BatchStorageOperationView, String> {
        batch_rename_storage_entries_impl(self, storage_id, paths, template, task).await
    }

    /// 排队一个后台批量删除任务，返回任务 id 字符串。
    pub async fn queue_batch_delete_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
    ) -> Result<String, String> {
        if paths.is_empty() || paths.len() > 100 {
            return Err("批量删除需要选择 1-100 个远端文件".into());
        }
        let count = paths.len();
        self.queue_cloud_batch_task(
            storage_id,
            "cloud_batch_delete",
            json!({"storageId":storage_id.to_string(),"count":count,"paths":paths}),
        )
        .await
    }

    /// 排队一个后台批量移动任务，返回任务 id 字符串。
    pub async fn queue_batch_move_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
        destination_dir: &str,
    ) -> Result<String, String> {
        if paths.is_empty() || paths.len() > 100 {
            return Err("批量移动需要选择 1-100 个远端文件".into());
        }
        let count = paths.len();
        self.queue_cloud_batch_task(
            storage_id,
            "cloud_batch_move",
            json!({
                "storageId": storage_id.to_string(),
                "count": count,
                "paths": paths,
                "destinationDir": destination_dir,
            }),
        )
        .await
    }

    /// 排队一个后台批量重命名任务，返回任务 id 字符串。
    pub async fn queue_batch_rename_storage_entries(
        &self,
        storage_id: Uuid,
        paths: Vec<String>,
        template: &str,
    ) -> Result<String, String> {
        if paths.is_empty() || paths.len() > 100 {
            return Err("批量重命名需要选择 1-100 个远端文件".into());
        }
        if template.trim().is_empty() {
            return Err("重命名模板不能为空".into());
        }
        let count = paths.len();
        self.queue_cloud_batch_task(
            storage_id,
            "cloud_batch_rename",
            json!({
                "storageId": storage_id.to_string(),
                "count": count,
                "paths": paths,
                "template": template,
            }),
        )
        .await
    }

    /// 创建任务记录并把执行体交给后台循环。
    async fn queue_cloud_batch_task(
        &self,
        _storage_id: Uuid,
        kind: &str,
        payload: Value,
    ) -> Result<String, String> {
        let task = self
            .tasks
            .create(kind, payload.clone())
            .await
            .map_err(|error| error.to_string())?;
        let task_id = task.id;
        let kind = kind.to_string();
        let progress = BatchTaskProgress { task_id };
        let deps = self.deps_snapshot();
        tokio::spawn(async move {
            let active = match deps.tasks.mark_running_if_active(task_id, 10).await {
                Ok(active) => active,
                Err(error) => {
                    let text = format!("无法启动后台任务：{error}");
                    let _ = deps.tasks.fail(task_id, text.clone()).await;
                    deps.events
                        .emit_task(task_id, "failed", 100, Some(text))
                        .await;
                    return;
                }
            };
            if !active {
                if deps.tasks.is_cancelled(task_id).await.unwrap_or(false) {
                    deps.events
                        .emit_task(task_id, "cancelled", 100, Some("用户取消任务".into()))
                        .await;
                }
                return;
            }
            deps.events.emit_task(task_id, "running", 10, None).await;
            let result = deps.run_batch(&kind, payload, Some(&progress)).await;
            let action = match kind.as_str() {
                "cloud_batch_delete" => "批量删除",
                "cloud_batch_move" => "批量移动",
                "cloud_batch_rename" => "批量重命名",
                _ => "批量操作",
            };
            finish_cloud_batch_task(&deps, task_id, action, result).await;
        });
        Ok(task_id.to_string())
    }

    /// 重跑一个已落库的后台批量任务：复用现有任务记录（不新建），仅重新派发执行体。
    pub async fn respawn_cloud_batch_task(&self, task_id: Uuid, kind: &str, payload: Value) {
        let kind = kind.to_string();
        let progress = BatchTaskProgress { task_id };
        let deps = self.deps_snapshot();
        tokio::spawn(async move {
            let active = match deps.tasks.mark_running_if_active(task_id, 10).await {
                Ok(active) => active,
                Err(error) => {
                    let text = format!("无法启动后台任务：{error}");
                    let _ = deps.tasks.fail(task_id, text.clone()).await;
                    deps.events
                        .emit_task(task_id, "failed", 100, Some(text))
                        .await;
                    return;
                }
            };
            if !active {
                if deps.tasks.is_cancelled(task_id).await.unwrap_or(false) {
                    deps.events
                        .emit_task(task_id, "cancelled", 100, Some("用户取消任务".into()))
                        .await;
                }
                return;
            }
            deps.events.emit_task(task_id, "running", 10, None).await;
            let result = deps.run_batch(&kind, payload, Some(&progress)).await;
            let action = match kind.as_str() {
                "cloud_batch_delete" => "批量删除",
                "cloud_batch_move" => "批量移动",
                "cloud_batch_rename" => "批量重命名",
                _ => "批量操作",
            };
            finish_cloud_batch_task(&deps, task_id, action, result).await;
        });
    }

    /// 后台执行体需要的依赖切片（可脱离插件实例独立搬运）。
    fn deps_snapshot(&self) -> BatchDeps {
        BatchDeps {
            storages: self.storages.clone(),
            assets: self.assets.clone(),
            tasks: self.tasks.clone(),
            credentials: self.credentials.clone(),
            registry: Arc::clone(&self.registry),
            events: Arc::clone(&self.events),
            gallery_delete: Arc::clone(&self.gallery_delete),
        }
    }
}

/// 后台批量任务执行体持有的依赖（`StorageRepository`/`AssetRepository`/`TaskEngine`/
/// `CredentialStore` 均为 `Clone`，可整体搬入 `tokio::spawn` 的任务）。
#[derive(Clone)]
struct BatchDeps {
    storages: StorageRepository,
    assets: AssetRepository,
    tasks: TaskEngine,
    credentials: CredentialStore,
    registry: Arc<ProviderRegistry>,
    events: Arc<dyn TaskEventSink>,
    gallery_delete: Arc<dyn GalleryDeleteRunner>,
}

impl BatchDeps {
    fn build_provider(
        &self,
        record: &persistence_sqlite::StorageRecord,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        self.registry.build(record, &self.credentials, |key| {
            format!("Provider {key} is not wired in this build")
        })
    }

    async fn provider_for(
        &self,
        storage_id: Uuid,
    ) -> Result<(persistence_sqlite::StorageRecord, Arc<dyn StorageProvider>), String> {
        let record = self
            .storages
            .get(storage_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Storage not found".to_string())?;
        let provider = self.build_provider(&record)?;
        Ok((record, provider))
    }

    /// 按任务类型执行批量操作。
    async fn run_batch(
        &self,
        kind: &str,
        payload: Value,
        task: Option<&BatchTaskProgress>,
    ) -> Result<BatchStorageOperationView, String> {
        let storage_id = payload
            .get("storageId")
            .and_then(Value::as_str)
            .ok_or("后台任务缺少 storageId")?;
        let storage_id = Uuid::parse_str(storage_id).map_err(|error| error.to_string())?;
        let paths = cloud_batch_payload_paths(&payload)?;
        match kind {
            "cloud_batch_delete" => {
                batch_delete_storage_entries_impl_deps(self, storage_id, paths, task).await
            }
            "cloud_batch_move" => {
                let destination = payload
                    .get("destinationDir")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                batch_move_storage_entries_impl_deps(self, storage_id, paths, destination, task)
                    .await
            }
            "cloud_batch_rename" => {
                let template = payload
                    .get("template")
                    .and_then(Value::as_str)
                    .ok_or("后台任务缺少 template")?
                    .to_string();
                batch_rename_storage_entries_impl_deps(self, storage_id, paths, template, task)
                    .await
            }
            _ => Err(format!("不支持重跑的任务类型：{kind}")),
        }
    }
}

/// 后台批量任务的进度记录（`AppHandle` 由 `TaskEventSink` 取代）。
#[derive(Clone)]
struct BatchTaskProgress {
    task_id: Uuid,
}

/// 向宿主上报一次进度；返回是否应提前结束。
async fn report_batch_task_progress(
    deps: &BatchDeps,
    task: Option<&BatchTaskProgress>,
    completed: usize,
    total: usize,
) -> Result<bool, String> {
    let Some(task) = task else {
        return Ok(false);
    };
    if deps
        .tasks
        .is_cancelled(task.task_id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Ok(true);
    }
    let span = if total == 0 {
        0
    } else {
        ((completed.min(total) * 80) / total) as u8
    };
    let progress = 10u8.saturating_add(span).min(90);
    let active = deps
        .tasks
        .mark_running_if_active(task.task_id, progress)
        .await
        .map_err(|error| error.to_string())?;
    if !active {
        return Ok(true);
    }
    deps.events
        .emit_task(task.task_id, "running", progress, None)
        .await;
    Ok(false)
}

async fn batch_delete_storage_entries_impl_deps(
    deps: &BatchDeps,
    id: Uuid,
    paths: Vec<String>,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    if paths.is_empty() {
        return Err("没有选择要删除的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量删除 100 个远端文件".into());
    }
    let (_, provider) = deps.provider_for(id).await?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(deps, task, index, total).await? {
            break;
        }
        let remote_path = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(deps, task, index + 1, total).await?;
                continue;
            }
        };
        match provider.delete(&remote_path).await {
            Ok(()) => {
                succeeded += 1;
                match deps
                    .assets
                    .deployment_ids_for_remote(id, &remote_path)
                    .await
                {
                    Ok(ids) => {
                        for deployment_id in ids {
                            match deps
                                .assets
                                .update_deployment_status(deployment_id, DeploymentStatus::Deleted)
                                .await
                            {
                                Ok(()) => deployments_updated += 1,
                                Err(error) => failures.push(BatchStorageFailureView {
                                    path: remote_path.clone(),
                                    error: format!(
                                        "远端已删除，但本地 Deployment 状态同步失败：{error}"
                                    ),
                                }),
                            }
                        }
                    }
                    Err(error) => failures.push(BatchStorageFailureView {
                        path: remote_path.clone(),
                        error: format!("远端已删除，但无法查询本地 Deployment：{error}"),
                    }),
                }
                deps.gallery_delete
                    .run_gallery_delete(id, &remote_path)
                    .await;
            }
            Err(error) => failures.push(BatchStorageFailureView {
                path: remote_path,
                error: error.to_string(),
            }),
        }
        if report_batch_task_progress(deps, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

async fn batch_move_storage_entries_impl_deps(
    deps: &BatchDeps,
    id: Uuid,
    paths: Vec<String>,
    destination_dir: String,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    if paths.is_empty() {
        return Err("没有选择要移动的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量移动 100 个远端文件".into());
    }
    let destination_dir = normalize_remote_dir(&destination_dir)?;
    let (_, provider) = deps.provider_for(id).await?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(deps, task, index, total).await? {
            break;
        }
        let source = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(deps, task, index + 1, total).await?;
                continue;
            }
        };
        let name = remote_file_name(&source);
        let destination = if destination_dir.is_empty() {
            name.to_string()
        } else {
            format!("{destination_dir}/{name}")
        };
        match move_storage_entry_with_provider(
            &deps.assets,
            id,
            provider.as_ref(),
            &source,
            &destination,
        )
        .await
        {
            Ok(updated) => {
                succeeded += 1;
                deployments_updated += updated;
            }
            Err(error) => failures.push(BatchStorageFailureView {
                path: source,
                error,
            }),
        }
        if report_batch_task_progress(deps, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

async fn batch_rename_storage_entries_impl_deps(
    deps: &BatchDeps,
    id: Uuid,
    paths: Vec<String>,
    template: String,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    if paths.is_empty() {
        return Err("没有选择要重命名的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量重命名 100 个远端文件".into());
    }
    if template.trim().is_empty() {
        return Err("重命名模板不能为空".into());
    }
    let (_, provider) = deps.provider_for(id).await?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(deps, task, index, total).await? {
            break;
        }
        let source = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(deps, task, index + 1, total).await?;
                continue;
            }
        };
        let new_name = match render_batch_name(template.trim(), &source, index) {
            Ok(name) => name,
            Err(error) => {
                failures.push(BatchStorageFailureView {
                    path: source,
                    error,
                });
                let _ = report_batch_task_progress(deps, task, index + 1, total).await?;
                continue;
            }
        };
        let parent = parent_remote_path(&source);
        let destination = if parent.is_empty() {
            new_name
        } else {
            format!("{parent}/{new_name}")
        };
        match move_storage_entry_with_provider(
            &deps.assets,
            id,
            provider.as_ref(),
            &source,
            &destination,
        )
        .await
        {
            Ok(updated) => {
                succeeded += 1;
                deployments_updated += updated;
            }
            Err(error) => failures.push(BatchStorageFailureView {
                path: source,
                error,
            }),
        }
        if report_batch_task_progress(deps, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

// 同步执行路径（无后台任务）：复用同一套实现，只是 task 传 None。
async fn batch_delete_storage_entries_impl(
    plugin: &CloudBrowserPlugin,
    id: Uuid,
    paths: Vec<String>,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    let deps = plugin.deps_snapshot();
    batch_delete_storage_entries_impl_deps(&deps, id, paths, task).await
}

async fn batch_move_storage_entries_impl(
    plugin: &CloudBrowserPlugin,
    id: Uuid,
    paths: Vec<String>,
    destination_dir: &str,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    let deps = plugin.deps_snapshot();
    batch_move_storage_entries_impl_deps(&deps, id, paths, destination_dir.to_string(), task).await
}

async fn batch_rename_storage_entries_impl(
    plugin: &CloudBrowserPlugin,
    id: Uuid,
    paths: Vec<String>,
    template: &str,
    task: Option<&BatchTaskProgress>,
) -> Result<BatchStorageOperationView, String> {
    let deps = plugin.deps_snapshot();
    batch_rename_storage_entries_impl_deps(&deps, id, paths, template.to_string(), task).await
}

fn batch_note(action: &str, report: &BatchStorageOperationView) -> String {
    if report.failures.is_empty() {
        format!(
            "{action}完成：{} 项；同步 Deployment {} 条",
            report.succeeded, report.deployments_updated
        )
    } else {
        let details = report
            .failures
            .iter()
            .take(3)
            .map(|item| format!("{}: {}", item.path, item.error))
            .collect::<Vec<_>>()
            .join(" | ");
        format!(
            "{action}完成：{} 项成功，{} 项失败；同步 Deployment {} 条；{}",
            report.succeeded,
            report.failures.len(),
            report.deployments_updated,
            details
        )
    }
}

async fn finish_cloud_batch_task(
    deps: &BatchDeps,
    task_id: Uuid,
    action: &str,
    result: Result<BatchStorageOperationView, String>,
) {
    if deps.tasks.is_cancelled(task_id).await.unwrap_or(false) {
        deps.events
            .emit_task(task_id, "cancelled", 100, Some("用户取消任务".into()))
            .await;
        return;
    }
    match result {
        Ok(report) if report.succeeded == 0 && !report.failures.is_empty() => {
            let error = batch_note(action, &report);
            let _ = deps.tasks.fail(task_id, error.clone()).await;
            deps.events
                .emit_task(task_id, "failed", 100, Some(error))
                .await;
        }
        Ok(report) => {
            let note = batch_note(action, &report);
            let completed = if report.failures.is_empty() {
                deps.tasks.complete(task_id).await
            } else {
                deps.tasks.complete_with_note(task_id, note.clone()).await
            };
            if let Err(error) = completed {
                let text = error.to_string();
                let _ = deps.tasks.fail(task_id, text.clone()).await;
                deps.events
                    .emit_task(task_id, "failed", 100, Some(text))
                    .await;
                return;
            }
            deps.events
                .emit_task(
                    task_id,
                    "completed",
                    100,
                    if report.failures.is_empty() {
                        None
                    } else {
                        Some(note)
                    },
                )
                .await;
        }
        Err(error) => {
            let _ = deps.tasks.fail(task_id, error.clone()).await;
            deps.events
                .emit_task(task_id, "failed", 100, Some(error))
                .await;
        }
    }
}

fn cloud_batch_payload_paths(payload: &Value) -> Result<Vec<String>, String> {
    let paths = payload
        .get("paths")
        .and_then(Value::as_array)
        .ok_or("后台任务缺少 paths")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "后台任务 paths 包含无效值".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if paths.is_empty() || paths.len() > 100 {
        return Err("后台批量任务需要包含 1-100 个路径".into());
    }
    Ok(paths)
}

async fn move_storage_entry_with_provider(
    assets: &AssetRepository,
    storage_id: Uuid,
    provider: &dyn StorageProvider,
    source: &str,
    destination: &str,
) -> Result<usize, String> {
    if source == destination {
        return Ok(0);
    }
    let result = CloudMutationCore::move_object(provider, source, destination)
        .await
        .map_err(|error| error.to_string())?;
    assets
        .update_deployments_remote_location(storage_id, source, destination, result.public_url)
        .await
        .map_err(|error| {
            format!("远端文件已经移动到 {destination}，但本地 Deployment 路径同步失败：{error}")
        })
        .map(|count| count as usize)
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

// ---------------------------------------------------------------------
// 纯函数辅助（与迁移前 `commands/storage_entries.rs` 逐字一致）
// ---------------------------------------------------------------------

/// OpenDAL / SDK 诊断可能包含 URL、查询签名或访问标识。
/// 绝不把这些原始 `Display` 文本转发到 UI。
fn safe_share_error(error: &StorageError) -> &'static str {
    match error {
        StorageError::Authentication(_) => "存储认证失败，请检查密钥和权限",
        StorageError::Network(_) => "无法连接存储服务，请检查网络和 Endpoint",
        StorageError::Unsupported | StorageError::NotImplemented => {
            "此存储服务暂不支持可直接分享的只读签名链接"
        }
        StorageError::MissingObject(_) => "远端文件不存在，请刷新后重试",
        StorageError::Conflict(_) => "远端文件状态已变化，请刷新后重试",
        StorageError::Provider(_) => "云端请求失败，请检查存储配置和签名功能",
    }
}

/// 校验临时分享路径与有效期。
fn validated_share_expiry(
    path: &str,
    expires_in_seconds: u64,
) -> Result<std::time::Duration, String> {
    if path.is_empty()
        || path.len() > 1024
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("请选择有效的远端文件路径".into());
    }
    if !matches!(expires_in_seconds, 600 | 3600 | 86_400) {
        return Err("临时分享仅支持 10 分钟、1 小时或 24 小时".into());
    }
    Ok(std::time::Duration::from_secs(expires_in_seconds))
}

const PRIVATE_PREVIEW_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn private_preview_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}

fn normalize_remote_path(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    let normalized = normalized.trim_matches('/');
    if normalized.is_empty() {
        return Err("远端路径不能为空".into());
    }
    if normalized.len() > 1024 {
        return Err("远端路径过长".into());
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("远端路径不能包含空目录、. 或 ..".into());
    }
    Ok(normalized.to_string())
}

fn normalize_remote_dir(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    let normalized = normalized.trim_matches('/');
    if normalized.is_empty() {
        return Ok(String::new());
    }
    normalize_remote_path(normalized)
}

fn parent_remote_path(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

fn remote_file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn render_batch_name(template: &str, source: &str, index: usize) -> Result<String, String> {
    let name = remote_file_name(source);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    let rendered = template
        .replace("{name}", name)
        .replace("{stem}", stem)
        .replace("{ext}", &ext)
        .replace("{index}", &(index + 1).to_string());
    let rendered = rendered.trim();
    if rendered.is_empty()
        || rendered == "."
        || rendered == ".."
        || rendered.contains('/')
        || rendered.contains('\\')
    {
        return Err(format!("批量重命名生成了无效文件名：{rendered}"));
    }
    Ok(rendered.to_string())
}

/// R2/S3 且配置为 `private_requested` 时视为私有意图。
fn storage_requests_private(record: &persistence_sqlite::StorageRecord) -> bool {
    matches!(record.provider_key.as_str(), "r2" | "s3")
        && record
            .config_json
            .get("access_mode")
            .and_then(Value::as_str)
            == Some("private_requested")
}

#[async_trait]
impl BuiltinPlugin for CloudBrowserPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        if method == "cloud.respawn_batch_task" {
            let task_id = payload
                .get("taskId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PluginFailure::new(kernel_api::InvokeErrorCode::InvalidPayload, "缺少 taskId")
                })?;
            let task_id = Uuid::parse_str(task_id).map_err(|error| {
                PluginFailure::new(
                    kernel_api::InvokeErrorCode::InvalidPayload,
                    error.to_string(),
                )
            })?;
            let kind = payload
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PluginFailure::new(kernel_api::InvokeErrorCode::InvalidPayload, "缺少 kind")
                })?
                .to_string();
            let body = payload.get("payload").cloned().unwrap_or(Value::Null);
            self.respawn_cloud_batch_task(task_id, &kind, body).await;
            return Ok(Value::Null);
        }

        let storage_id = payload
            .get("storageId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                PluginFailure::new(
                    kernel_api::InvokeErrorCode::InvalidPayload,
                    "缺少 storageId",
                )
            })?;
        let storage_id = Uuid::parse_str(storage_id).map_err(|error| {
            PluginFailure::new(
                kernel_api::InvokeErrorCode::InvalidPayload,
                error.to_string(),
            )
        })?;

        let result = match method {
            "cloud.browse_storage" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.browse_storage(storage_id, &path)
                    .await
                    .map(|items| serde_json::to_value(items).unwrap_or(Value::Null))
            }
            "cloud.create_temporary_share_link" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let expires = payload
                    .get("expiresInSeconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(600);
                self.create_temporary_share_link(storage_id, &path, expires)
                    .await
                    .map(Value::from)
            }
            "cloud.preview_private_storage_entry" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.preview_private_storage_entry(storage_id, &path)
                    .await
                    .map(|preview| serde_json::to_value(preview).unwrap_or(Value::Null))
            }
            "cloud.delete_storage_entry" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.delete_storage_entry(storage_id, &path)
                    .await
                    .map(Value::from)
            }
            "cloud.download_storage_entry" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let destination = payload
                    .get("destinationPath")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.download_storage_entry(storage_id, &path, &destination)
                    .await
                    .map(Value::from)
            }
            "cloud.move_storage_entry" => {
                let source = payload
                    .get("sourcePath")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let destination = payload
                    .get("destinationPath")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.move_storage_entry(storage_id, &source, &destination)
                    .await
                    .map(Value::from)
            }
            "cloud.create_storage_directory" => {
                let path = payload
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.create_storage_directory(storage_id, &path)
                    .await
                    .map(|()| Value::Null)
            }
            "cloud.batch_delete_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                self.batch_delete_storage_entries(storage_id, paths, None)
                    .await
                    .map(|view| serde_json::to_value(view).unwrap_or(Value::Null))
            }
            "cloud.batch_move_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let destination = payload
                    .get("destinationDir")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.batch_move_storage_entries(storage_id, paths, &destination, None)
                    .await
                    .map(|view| serde_json::to_value(view).unwrap_or(Value::Null))
            }
            "cloud.batch_rename_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let template = payload
                    .get("template")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.batch_rename_storage_entries(storage_id, paths, &template, None)
                    .await
                    .map(|view| serde_json::to_value(view).unwrap_or(Value::Null))
            }
            "cloud.queue_batch_delete_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                self.queue_batch_delete_storage_entries(storage_id, paths)
                    .await
                    .map(Value::from)
            }
            "cloud.queue_batch_move_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let destination = payload
                    .get("destinationDir")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.queue_batch_move_storage_entries(storage_id, paths, &destination)
                    .await
                    .map(Value::from)
            }
            "cloud.queue_batch_rename_storage_entries" => {
                let paths = payload
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let template = payload
                    .get("template")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.queue_batch_rename_storage_entries(storage_id, paths, &template)
                    .await
                    .map(Value::from)
            }
            _ => {
                return Err(PluginFailure::new(
                    kernel_api::InvokeErrorCode::UnknownMethod,
                    format!("cloud-browser 不支持方法：{method}"),
                ));
            }
        };

        result.map_err(|error| PluginFailure::new(kernel_api::InvokeErrorCode::Internal, error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_api::PluginManifestV2;

    #[test]
    fn manifest_matches_kernel_assembly_table() {
        let manifest: PluginManifestV2 = manifest();
        manifest.validate().expect("static manifest must validate");
        assert_eq!(manifest.id.as_str(), "cloud-browser");
        assert_eq!(manifest.name, "云端文件浏览");
        assert_eq!(manifest.permissions, vec![Capability::Network]);
        assert_eq!(manifest.contributes.len(), 1);
        assert_eq!(manifest.contributes[0].point, ContributionPoint::Page);
        assert_eq!(manifest.contributes[0].id, "page.gallery");
    }

    #[test]
    fn provider_diagnostics_cannot_leak_presigned_query_or_credentials() {
        let leaked = "https://storage.example/?X-Amz-Signature=private-secret";
        for error in [
            StorageError::Authentication(leaked.into()),
            StorageError::Network(leaked.into()),
            StorageError::Provider(leaked.into()),
            StorageError::MissingObject(leaked.into()),
            StorageError::Conflict(leaked.into()),
        ] {
            let user_message = safe_share_error(&error);
            assert!(!user_message.contains("private-secret"));
            assert!(!user_message.contains("X-Amz-Signature"));
            assert!(!user_message.contains("storage.example"));
        }
    }

    #[test]
    fn only_read_share_presets_are_accepted() {
        for seconds in [600, 3600, 86_400] {
            assert_eq!(
                validated_share_expiry("photos/a.png", seconds)
                    .unwrap()
                    .as_secs(),
                seconds
            );
        }
        for seconds in [0, 1, 599, 604_800, u64::MAX] {
            assert!(validated_share_expiry("photos/a.png", seconds).is_err());
        }
    }

    #[test]
    fn root_traversal_and_control_characters_are_refused() {
        for path in [
            "", "/x", "x/", "x//y", "../x", "x/../y", "x/./y", "x\\y", "x\ny",
        ] {
            assert!(validated_share_expiry(path, 600).is_err(), "{path:?}");
        }
        assert!(validated_share_expiry("中文/图片.png", 600).is_ok());
        assert!(validated_share_expiry(&"x".repeat(1025), 600).is_err());
    }

    #[test]
    fn remote_path_normalization_rejects_traversal() {
        assert_eq!(normalize_remote_path("a\\b/c.png").unwrap(), "a/b/c.png");
        assert!(normalize_remote_path("a/../b").is_err());
        assert!(normalize_remote_path("").is_err());
        assert_eq!(normalize_remote_dir("").unwrap(), "");
        assert_eq!(normalize_remote_dir("  ").unwrap(), "");
        assert_eq!(parent_remote_path("a/b/c.png"), "a/b");
        assert_eq!(parent_remote_path("c.png"), "");
        assert_eq!(remote_file_name("a/b/c.png"), "c.png");
    }

    #[test]
    fn batch_rename_template_renders_and_rejects_invalid_names() {
        assert_eq!(
            render_batch_name("{stem}-{index}{ext}", "photos/a.png", 0).unwrap(),
            "a-1.png"
        );
        assert!(render_batch_name("../x", "a.png", 0).is_err());
        assert!(render_batch_name("a/b", "a.png", 0).is_err());
    }

    #[test]
    fn private_preview_only_accepts_known_image_signatures() {
        assert_eq!(
            private_preview_mime(b"\x89PNG\r\n\x1a\nXX"),
            Some("image/png")
        );
        assert_eq!(
            private_preview_mime(&[0xff, 0xd8, 0xff, 0x00]),
            Some("image/jpeg")
        );
        assert_eq!(private_preview_mime(b"GIF89aXX"), Some("image/gif"));
        assert_eq!(private_preview_mime(b"RIFF1234WEBP"), Some("image/webp"));
        assert_eq!(
            private_preview_mime(b"0000ftypavif0000"),
            Some("image/avif")
        );
        assert_eq!(private_preview_mime(b"not an image"), None);
    }

    #[test]
    fn private_intent_requires_r2_s3_with_private_requested() {
        let record = persistence_sqlite::StorageRecord {
            id: Uuid::nil(),
            name: "s".into(),
            provider_key: "r2".into(),
            category: "object".into(),
            credential_ref: Some("c".into()),
            config_json: json!({"access_mode": "private_requested"}),
            capabilities_json: json!({}),
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert!(storage_requests_private(&record));
        let mut public = record.clone();
        public.config_json = json!({"access_mode": "public"});
        assert!(!storage_requests_private(&public));
        let mut github = record;
        github.provider_key = "github".into();
        assert!(!storage_requests_private(&github));
    }

    #[test]
    fn batch_payload_paths_bounds_and_validates() {
        let ok = json!({"paths": ["a.png", "b.png"]});
        assert_eq!(cloud_batch_payload_paths(&ok).unwrap().len(), 2);
        assert!(cloud_batch_payload_paths(&json!({"paths": []})).is_err());
        assert!(cloud_batch_payload_paths(&json!({"paths": ["ok", 3]})).is_err());
        assert!(cloud_batch_payload_paths(&json!({})).is_err());
    }
}
