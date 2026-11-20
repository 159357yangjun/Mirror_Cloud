//! 云端文件浏览命令的薄包装层。
//!
//! 13 条 cloud-browser 命令的业务逻辑已迁入内置插件
//! `crates/plugins/cloud-browser`，这里只做参数装配、通过
//! `plugin_invoke` 分发、并把插件返回的 JSON 还原为内核视图类型。
//! `cancel_task` / `retry_task` 属任务中心，保留在内核；`retry_task`
//! 的重跑执行体已移入插件，这里改为委托 `cloud.respawn_batch_task`。

use super::*;

#[tauri::command]
pub async fn browse_storage(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<Vec<StorageEntryView>> {
    let payload = json!({"storageId": storage_id, "path": path});
    let value = state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.browse_storage", &payload)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_temporary_share_link(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
    expires_in_seconds: u64,
) -> CmdResult<String> {
    let payload = json!({
        "storageId": storage_id,
        "path": path,
        "expiresInSeconds": expires_in_seconds,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.create_temporary_share_link",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "云端分享链接返回格式异常".to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateImagePreview {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn preview_private_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<PrivateImagePreview> {
    let payload = json!({"storageId": storage_id, "path": path});
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.preview_private_storage_entry",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<usize> {
    let payload = json!({"storageId": storage_id, "path": path});
    let value = state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.delete_storage_entry", &payload)
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_u64()
        .map(|count| count as usize)
        .ok_or_else(|| "云端删除返回格式异常".to_string())
}

#[tauri::command]
pub async fn download_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
    destination_path: String,
) -> CmdResult<u64> {
    let payload = json!({
        "storageId": storage_id,
        "path": path,
        "destinationPath": destination_path,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.download_storage_entry", &payload)
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_u64()
        .ok_or_else(|| "云端下载返回格式异常".to_string())
}

#[tauri::command]
pub async fn move_storage_entry(
    state: State<'_, AppState>,
    storage_id: String,
    source_path: String,
    destination_path: String,
) -> CmdResult<usize> {
    let payload = json!({
        "storageId": storage_id,
        "sourcePath": source_path,
        "destinationPath": destination_path,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.move_storage_entry", &payload)
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_u64()
        .map(|count| count as usize)
        .ok_or_else(|| "云端移动返回格式异常".to_string())
}

#[tauri::command]
pub async fn create_storage_directory(
    state: State<'_, AppState>,
    storage_id: String,
    path: String,
) -> CmdResult<()> {
    let payload = json!({"storageId": storage_id, "path": path});
    state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.create_storage_directory", &payload)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn batch_delete_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
) -> CmdResult<BatchStorageOperationView> {
    let payload = json!({"storageId": storage_id, "paths": paths});
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.batch_delete_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn batch_move_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    destination_dir: String,
) -> CmdResult<BatchStorageOperationView> {
    let payload = json!({
        "storageId": storage_id,
        "paths": paths,
        "destinationDir": destination_dir,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.batch_move_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn batch_rename_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    template: String,
) -> CmdResult<BatchStorageOperationView> {
    let payload = json!({
        "storageId": storage_id,
        "paths": paths,
        "template": template,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.batch_rename_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn queue_batch_delete_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
) -> CmdResult<String> {
    let payload = json!({"storageId": storage_id, "paths": paths});
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.queue_batch_delete_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "后台任务排队返回格式异常".to_string())
}

#[tauri::command]
pub async fn queue_batch_move_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    destination_dir: String,
) -> CmdResult<String> {
    let payload = json!({
        "storageId": storage_id,
        "paths": paths,
        "destinationDir": destination_dir,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.queue_batch_move_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "后台任务排队返回格式异常".to_string())
}

#[tauri::command]
pub async fn queue_batch_rename_storage_entries(
    state: State<'_, AppState>,
    storage_id: String,
    paths: Vec<String>,
    template: String,
) -> CmdResult<String> {
    let payload = json!({
        "storageId": storage_id,
        "paths": paths,
        "template": template,
    });
    let value = state
        .kernel
        .read()
        .await
        .invoke(
            "cloud-browser",
            "cloud.queue_batch_rename_storage_entries",
            &payload,
        )
        .await
        .map_err(|error| error.to_string())?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "后台任务排队返回格式异常".to_string())
}

/// 取消 Cloud Manager 批量任务（任务中心，保留内核）。
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

/// 重试 Cloud Manager 批量任务：校验与重排队保留内核，执行体重跑委托插件。
#[tauri::command]
pub async fn retry_task(state: State<'_, AppState>, task_id: String) -> CmdResult<String> {
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
    let payload = json!({
        "taskId": id.to_string(),
        "kind": record.kind,
        "payload": record.payload_json,
    });
    state
        .kernel
        .read()
        .await
        .invoke("cloud-browser", "cloud.respawn_batch_task", &payload)
        .await
        .map_err(|error| error.to_string())?;
    Ok(id.to_string())
}
