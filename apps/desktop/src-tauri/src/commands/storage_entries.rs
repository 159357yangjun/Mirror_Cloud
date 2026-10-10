use super::*;

#[tauri::command]
pub async fn browse_storage(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<Vec<StorageEntryView>> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;
    provider
        .list(path.trim_matches('/'))
        .await
        .map_err(|error| error.to_string())
        .map(|items| items.into_iter().map(storage_entry_view).collect())
}

// OpenDAL / SDK diagnostics can contain URLs, query signatures or access identifiers.
// Never forward their raw Display text into the UI.
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

/// Share an existing object without making its bucket public. This URL is a bearer secret:
/// it is returned only to the caller (clipboard), never written to settings or the asset index.
fn validated_share_expiry(path: &str, expires_in_seconds: u64) -> CmdResult<std::time::Duration> {
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

#[tauri::command]
pub async fn create_temporary_share_link(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
    expires_in_seconds: u64,
) -> CmdResult<String> {
    let expiry = validated_share_expiry(&path, expires_in_seconds)?;
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let storage = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    if !storage.enabled || !matches!(storage.provider_key.as_str(), "r2" | "s3") {
        return Err("该存储暂不支持临时分享（当前只开放 R2/S3）".into());
    }
    let provider = build_provider(&state, &storage)
        .map_err(|_| "无法初始化存储连接，请检查存储配置".to_string())?;
    if !provider
        .exists(&path)
        .await
        .map_err(|error| safe_share_error(&error).to_string())?
    {
        return Err("该云端对象已不存在，未生成分享链接".into());
    }
    provider
        .temporary_read_url(&path, expiry)
        .await
        .map_err(|error| safe_share_error(&error).to_string())
}

const PRIVATE_PREVIEW_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateImagePreview {
    pub mime_type: &'static str,
    pub bytes: Vec<u8>,
}

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

/// Load a small private R2 image into memory only when the user requests a
/// preview. No signed URL is exposed to the renderer, stored in SQLite or logged.
#[tauri::command]
pub async fn preview_private_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<PrivateImagePreview> {
    validated_share_expiry(&path, 600)?;
    let id = Uuid::parse_str(&storage_id).map_err(|_| "存储 ID 无效".to_string())?;
    let storage = state
        .storages
        .get(id)
        .await
        .map_err(|_| "无法读取存储信息".to_string())?
        .ok_or("该云端存储已不存在")?;
    if !storage.enabled || !storage_requests_private(&storage) {
        return Err("此入口仅可预览已经配置为私有意图的 R2 文件".into());
    }
    let provider = build_provider(&state, &storage)
        .map_err(|_| "无法初始化私有存储连接".to_string())?;
    let bytes = provider
        .download_preview(&path, PRIVATE_PREVIEW_MAX_BYTES)
        .await
        .map_err(|error| safe_share_error(&error).to_string())?
        .ok_or("原图超过 5 MB，请使用“保存原图”下载后查看")?;
    let mime_type = private_preview_mime(&bytes)
        .ok_or("只支持 PNG、JPEG、GIF、WebP 或 AVIF 图片预览")?;
    Ok(PrivateImagePreview {
        mime_type,
        bytes: bytes.to_vec(),
    })
}

#[cfg(test)]
mod temporary_share_tests {
    use super::{StorageError, safe_share_error, validated_share_expiry};

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
}

#[tauri::command]
pub async fn delete_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<usize> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let remote_path = path.trim().trim_matches('/');
    if remote_path.is_empty() {
        return Err("不能删除云端根目录".into());
    }
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;

    provider
        .delete(remote_path)
        .await
        .map_err(|error| error.to_string())?;

    let deployment_ids = state
        .assets
        .deployment_ids_for_remote(id, remote_path)
        .await
        .map_err(|error| {
            format!(
                "远端文件已删除，但本地 Deployment 状态同步失败：{error}。刷新资源后可再次执行修复/删除。"
            )
        })?;
    for deployment_id in &deployment_ids {
        state
            .assets
            .update_deployment_status(*deployment_id, DeploymentStatus::Deleted)
            .await
            .map_err(|error| {
                format!("远端文件已删除，但本地 Deployment {deployment_id} 状态同步失败：{error}")
            })?;
    }
    run_gallery_delete_plugins(state.inner(), id, remote_path).await;
    Ok(deployment_ids.len())
}

#[tauri::command]
pub async fn download_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
    destination_path: String,
) -> CmdResult<u64> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let remote_path = path.trim().trim_matches('/');
    if remote_path.is_empty() {
        return Err("请选择一个远端文件".into());
    }
    let destination = destination_path.trim();
    if destination.is_empty() {
        return Err("下载目标路径不能为空".into());
    }
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;
    let bytes = provider
        .download(remote_path)
        .await
        .map_err(|error| error.to_string())?;

    tokio::fs::write(destination, &bytes)
        .await
        .map_err(|error| format!("写入下载文件失败：{error}"))?;
    Ok(bytes.len() as u64)
}

fn normalize_remote_path(value: &str) -> CmdResult<String> {
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

fn normalize_remote_dir(value: &str) -> CmdResult<String> {
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

fn render_batch_name(template: &str, source: &str, index: usize) -> CmdResult<String> {
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

async fn move_storage_entry_with_provider(
    state: &AppState,
    storage_id: Uuid,
    provider: &dyn StorageProvider,
    source: &str,
    destination: &str,
) -> CmdResult<usize> {
    if source == destination {
        return Ok(0);
    }
    let result = CloudMutationCore::move_object(provider, source, destination)
        .await
        .map_err(|error| error.to_string())?;
    state
        .assets
        .update_deployments_remote_location(storage_id, source, destination, result.public_url)
        .await
        .map_err(|error| {
            format!("远端文件已经移动到 {destination}，但本地 Deployment 路径同步失败：{error}")
        })
        .map(|count| count as usize)
}

#[tauri::command]
pub async fn move_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    source_path: String,
    destination_path: String,
) -> CmdResult<usize> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let source = normalize_remote_path(&source_path)?;
    let destination = normalize_remote_path(&destination_path)?;
    if source == destination {
        return Err("新路径与原路径相同".into());
    }
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;
    move_storage_entry_with_provider(state.inner(), id, provider.as_ref(), &source, &destination)
        .await
}

#[tauri::command]
pub async fn create_storage_directory(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<()> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    let remote_path = normalize_remote_path(&path)?;
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(&state, &record)?;
    provider.create_dir(&remote_path).await.map_err(|error| match error {
        StorageError::Unsupported | StorageError::NotImplemented => {
            "当前 Provider 不支持空目录。GitHub/Gitee 等仓库存储只有在目录中存在文件时才会显示目录。".into()
        }
        other => other.to_string(),
    })
}

#[derive(Clone)]
struct BatchTaskProgress {
    app: AppHandle,
    task_id: Uuid,
}

async fn report_batch_task_progress(
    state: &AppState,
    task: Option<&BatchTaskProgress>,
    completed: usize,
    total: usize,
) -> CmdResult<bool> {
    let Some(task) = task else {
        return Ok(false);
    };
    if state
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
    let active = state
        .tasks
        .mark_running_if_active(task.task_id, progress)
        .await
        .map_err(|error| error.to_string())?;
    if !active {
        return Ok(true);
    }
    emit_task(&task.app, task.task_id, "running", progress, None);
    Ok(false)
}

async fn batch_delete_storage_entries_impl(
    state: &AppState,
    id: Uuid,
    paths: Vec<String>,
    task: Option<&BatchTaskProgress>,
) -> CmdResult<BatchStorageOperationView> {
    if paths.is_empty() {
        return Err("没有选择要删除的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量删除 100 个远端文件".into());
    }
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(state, &record)?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(state, task, index, total).await? {
            break;
        }
        let remote_path = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(state, task, index + 1, total).await?;
                continue;
            }
        };
        match provider.delete(&remote_path).await {
            Ok(()) => {
                succeeded += 1;
                match state
                    .assets
                    .deployment_ids_for_remote(id, &remote_path)
                    .await
                {
                    Ok(ids) => {
                        for deployment_id in ids {
                            match state
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
                run_gallery_delete_plugins(state, id, &remote_path).await;
            }
            Err(error) => failures.push(BatchStorageFailureView {
                path: remote_path,
                error: error.to_string(),
            }),
        }
        if report_batch_task_progress(state, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

async fn batch_move_storage_entries_impl(
    state: &AppState,
    id: Uuid,
    paths: Vec<String>,
    destination_dir: String,
    task: Option<&BatchTaskProgress>,
) -> CmdResult<BatchStorageOperationView> {
    if paths.is_empty() {
        return Err("没有选择要移动的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量移动 100 个远端文件".into());
    }
    let destination_dir = normalize_remote_dir(&destination_dir)?;
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(state, &record)?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(state, task, index, total).await? {
            break;
        }
        let source = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(state, task, index + 1, total).await?;
                continue;
            }
        };
        let name = remote_file_name(&source);
        let destination = if destination_dir.is_empty() {
            name.to_string()
        } else {
            format!("{destination_dir}/{name}")
        };
        match move_storage_entry_with_provider(state, id, provider.as_ref(), &source, &destination)
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
        if report_batch_task_progress(state, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

async fn batch_rename_storage_entries_impl(
    state: &AppState,
    id: Uuid,
    paths: Vec<String>,
    template: String,
    task: Option<&BatchTaskProgress>,
) -> CmdResult<BatchStorageOperationView> {
    if paths.is_empty() {
        return Err("没有选择要重命名的远端文件".into());
    }
    if paths.len() > 100 {
        return Err("一次最多批量重命名 100 个远端文件".into());
    }
    if template.trim().is_empty() {
        return Err("重命名模板不能为空".into());
    }
    let record = state
        .storages
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Storage not found")?;
    let provider = build_provider(state, &record)?;
    let mut succeeded = 0usize;
    let mut deployments_updated = 0usize;
    let mut failures = Vec::new();
    let total = paths.len();
    for (index, raw) in paths.into_iter().enumerate() {
        if report_batch_task_progress(state, task, index, total).await? {
            break;
        }
        let source = match normalize_remote_path(&raw) {
            Ok(path) => path,
            Err(error) => {
                failures.push(BatchStorageFailureView { path: raw, error });
                let _ = report_batch_task_progress(state, task, index + 1, total).await?;
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
                let _ = report_batch_task_progress(state, task, index + 1, total).await?;
                continue;
            }
        };
        let parent = parent_remote_path(&source);
        let destination = if parent.is_empty() {
            new_name
        } else {
            format!("{parent}/{new_name}")
        };
        match move_storage_entry_with_provider(state, id, provider.as_ref(), &source, &destination)
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
        if report_batch_task_progress(state, task, index + 1, total).await? {
            break;
        }
    }
    Ok(BatchStorageOperationView {
        succeeded,
        deployments_updated,
        failures,
    })
}

#[tauri::command]
pub async fn batch_delete_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
) -> CmdResult<BatchStorageOperationView> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    batch_delete_storage_entries_impl(state.inner(), id, paths, None).await
}

#[tauri::command]
pub async fn batch_move_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    destination_dir: String,
) -> CmdResult<BatchStorageOperationView> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    batch_move_storage_entries_impl(state.inner(), id, paths, destination_dir, None).await
}

#[tauri::command]
pub async fn batch_rename_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    template: String,
) -> CmdResult<BatchStorageOperationView> {
    let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    batch_rename_storage_entries_impl(state.inner(), id, paths, template, None).await
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
    app: &AppHandle,
    state: &AppState,
    task_id: Uuid,
    action: &str,
    result: CmdResult<BatchStorageOperationView>,
) {
    if state.tasks.is_cancelled(task_id).await.unwrap_or(false) {
        emit_task(app, task_id, "cancelled", 100, Some("用户取消任务".into()));
        return;
    }
    match result {
        Ok(report) if report.succeeded == 0 && !report.failures.is_empty() => {
            let error = batch_note(action, &report);
            let _ = state.tasks.fail(task_id, error.clone()).await;
            emit_task(app, task_id, "failed", 100, Some(error));
        }
        Ok(report) => {
            let note = batch_note(action, &report);
            let completed = if report.failures.is_empty() {
                state.tasks.complete(task_id).await
            } else {
                state.tasks.complete_with_note(task_id, note.clone()).await
            };
            if let Err(error) = completed {
                let text = error.to_string();
                let _ = state.tasks.fail(task_id, text.clone()).await;
                emit_task(app, task_id, "failed", 100, Some(text));
                return;
            }
            emit_task(
                app,
                task_id,
                "completed",
                100,
                if report.failures.is_empty() {
                    None
                } else {
                    Some(note)
                },
            );
        }
        Err(error) => {
            let _ = state.tasks.fail(task_id, error.clone()).await;
            emit_task(app, task_id, "failed", 100, Some(error));
        }
    }
}

fn cloud_batch_payload_paths(payload: &Value) -> CmdResult<Vec<String>> {
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

fn spawn_cloud_batch_task(
    app: AppHandle,
    state: AppState,
    task_id: Uuid,
    kind: String,
    payload: Value,
) {
    tauri::async_runtime::spawn(async move {
        let active = match state.tasks.mark_running_if_active(task_id, 10).await {
            Ok(active) => active,
            Err(error) => {
                let text = format!("无法启动后台任务：{error}");
                let _ = state.tasks.fail(task_id, text.clone()).await;
                emit_task(&app, task_id, "failed", 100, Some(text));
                return;
            }
        };
        if !active {
            if state.tasks.is_cancelled(task_id).await.unwrap_or(false) {
                emit_task(&app, task_id, "cancelled", 100, Some("用户取消任务".into()));
            }
            return;
        }
        emit_task(&app, task_id, "running", 10, None);
        let progress = BatchTaskProgress {
            app: app.clone(),
            task_id,
        };
        let result = async {
            let storage_id = payload
                .get("storageId")
                .and_then(Value::as_str)
                .ok_or("后台任务缺少 storageId")?;
            let storage_id = Uuid::parse_str(storage_id).map_err(|error| error.to_string())?;
            let paths = cloud_batch_payload_paths(&payload)?;
            match kind.as_str() {
                "cloud_batch_delete" => {
                    batch_delete_storage_entries_impl(&state, storage_id, paths, Some(&progress))
                        .await
                }
                "cloud_batch_move" => {
                    let destination = payload
                        .get("destinationDir")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    batch_move_storage_entries_impl(
                        &state,
                        storage_id,
                        paths,
                        destination,
                        Some(&progress),
                    )
                    .await
                }
                "cloud_batch_rename" => {
                    let template = payload
                        .get("template")
                        .and_then(Value::as_str)
                        .ok_or("后台任务缺少 template")?
                        .to_string();
                    batch_rename_storage_entries_impl(
                        &state,
                        storage_id,
                        paths,
                        template,
                        Some(&progress),
                    )
                    .await
                }
                _ => Err(format!("不支持重跑的任务类型：{kind}")),
            }
        }
        .await;
        let action = match kind.as_str() {
            "cloud_batch_delete" => "批量删除",
            "cloud_batch_move" => "批量移动",
            "cloud_batch_rename" => "批量重命名",
            _ => "批量操作",
        };
        finish_cloud_batch_task(&app, &state, task_id, action, result).await;
    });
}

async fn queue_cloud_batch_task(
    app: AppHandle,
    state: &AppState,
    kind: &str,
    payload: Value,
) -> CmdResult<String> {
    let task = state
        .tasks
        .create(kind, payload.clone())
        .await
        .map_err(|error| error.to_string())?;
    let task_id = task.id;
    spawn_cloud_batch_task(app, state.clone(), task_id, kind.to_string(), payload);
    Ok(task_id.to_string())
}

#[tauri::command]
pub async fn queue_batch_delete_storage_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
) -> CmdResult<String> {
    Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    if paths.is_empty() || paths.len() > 100 {
        return Err("批量删除需要选择 1-100 个远端文件".into());
    }
    let count = paths.len();
    queue_cloud_batch_task(
        app,
        state.inner(),
        "cloud_batch_delete",
        json!({"storageId":storage_id,"count":count,"paths":paths}),
    )
    .await
}

#[tauri::command]
pub async fn queue_batch_move_storage_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    destination_dir: String,
) -> CmdResult<String> {
    Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    if paths.is_empty() || paths.len() > 100 {
        return Err("批量移动需要选择 1-100 个远端文件".into());
    }
    let count = paths.len();
    queue_cloud_batch_task(app, state.inner(), "cloud_batch_move", json!({"storageId":storage_id,"count":count,"paths":paths,"destinationDir":destination_dir})).await
}

#[tauri::command]
pub async fn queue_batch_rename_storage_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    template: String,
) -> CmdResult<String> {
    Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
    if paths.is_empty() || paths.len() > 100 {
        return Err("批量重命名需要选择 1-100 个远端文件".into());
    }
    if template.trim().is_empty() {
        return Err("重命名模板不能为空".into());
    }
    let count = paths.len();
    queue_cloud_batch_task(
        app,
        state.inner(),
        "cloud_batch_rename",
        json!({"storageId":storage_id,"count":count,"paths":paths,"template":template}),
    )
    .await
}

#[tauri::command]
pub async fn cancel_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> CmdResult<()> {
    let id = Uuid::parse_str(&task_id).map_err(|error| error.to_string())?;
    let record = state
        .tasks
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Task not found")?;
    if !record.kind.starts_with("cloud_batch_") {
        return Err("当前版本只允许取消 Cloud Manager 批量任务，避免对尚未支持 cooperative cancellation 的上传任务造成状态不一致。".into());
    }
    if !state
        .tasks
        .cancel(id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("任务已结束，无法取消".into());
    }
    emit_task(&app, id, "cancelled", 100, Some("用户取消任务".into()));
    Ok(())
}

#[tauri::command]
pub async fn retry_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> CmdResult<String> {
    let id = Uuid::parse_str(&task_id).map_err(|error| error.to_string())?;
    let record = state
        .tasks
        .get(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Task not found")?;
    if !record.kind.starts_with("cloud_batch_") {
        return Err("当前版本只支持重试 Cloud Manager 批量任务".into());
    }
    if !matches!(record.status.as_str(), "failed" | "cancelled") {
        return Err("只有失败或已取消的任务可以重试".into());
    }
    if record.attempt >= record.max_attempts {
        return Err(format!("已达到最大重试次数 {}", record.max_attempts));
    }
    if !state
        .tasks
        .requeue_for_retry(id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err("任务状态已变化，无法重试".into());
    }
    spawn_cloud_batch_task(
        app,
        state.inner().clone(),
        id,
        record.kind,
        record.payload_json,
    );
    Ok(id.to_string())
}
