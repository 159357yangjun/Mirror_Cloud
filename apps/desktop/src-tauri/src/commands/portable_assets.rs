//! 便携资产的导出/恢复命令：薄包装，实现位于 `crates/plugins/portable-migration`。

use super::*;

#[allow(unused_imports)]
pub use persistence_sqlite::asset_staging::StagedAssetBatch;
#[allow(unused_imports)]
pub use plugin_portable_migration::assets::{
    PortableActivationCopyGate, PortableActivationGate, PortableAssetDeployment,
    PortableAssetEntry, PortableAssetManifest, PortableAssetPreview, PortableAssetPreviewRow,
    PortableBatchDecisionItem, StagedAssetReviewView, StagedSourceStorage,
};

async fn invoke_plugin(
    state: &State<'_, AppState>,
    method: &str,
    payload: Value,
) -> CmdResult<Value> {
    state
        .kernel
        .read()
        .await
        .invoke("portable-migration", method, &payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_portable_asset_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.export_asset_manifest",
        json!({ "destinationPath": destination_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_portable_asset_manifest(
    state: State<'_, AppState>,
    source_path: String,
) -> CmdResult<PortableAssetManifest> {
    let value = invoke_plugin(
        &state,
        "portable.inspect_asset_manifest",
        json!({ "sourcePath": source_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_portable_asset_restore(
    state: State<'_, AppState>,
    manifest: PortableAssetManifest,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<PortableAssetPreview> {
    let value = invoke_plugin(
        &state,
        "portable.preview_asset_restore",
        json!({ "manifest": manifest, "mappings": mappings }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn stage_portable_asset_manifest(
    state: State<'_, AppState>,
    manifest: PortableAssetManifest,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<String> {
    let value = invoke_plugin(
        &state,
        "portable.stage_asset_manifest",
        json!({ "manifest": manifest, "mappings": mappings }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_portable_asset_staging(
    state: State<'_, AppState>,
) -> CmdResult<Vec<StagedAssetBatch>> {
    let value = invoke_plugin(&state, "portable.list_asset_staging", json!({})).await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_portable_staged_items(
    state: State<'_, AppState>,
    batch_id: String,
) -> CmdResult<Vec<StagedAssetReviewView>> {
    let value = invoke_plugin(
        &state,
        "portable.list_staged_items",
        json!({ "batchId": batch_id }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_portable_staged_item_review(
    state: State<'_, AppState>,
    batch_id: String,
    item_id: String,
    expected_revision: i64,
    decision: String,
    source_storage_id: Option<String>,
    new_storage_id: Option<String>,
) -> CmdResult<()> {
    let value = invoke_plugin(
        &state,
        "portable.update_staged_item_review",
        json!({
            "batchId": batch_id,
            "itemId": item_id,
            "expectedRevision": expected_revision,
            "decision": decision,
            "sourceStorageId": source_storage_id,
            "newStorageId": new_storage_id,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn discard_portable_asset_staging(
    state: State<'_, AppState>,
    batch_id: String,
) -> CmdResult<bool> {
    let value = invoke_plugin(
        &state,
        "portable.discard_asset_staging",
        json!({ "batchId": batch_id }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_portable_staged_batch_decision(
    state: State<'_, AppState>,
    batch_id: String,
    items: Vec<PortableBatchDecisionItem>,
    decision: String,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.apply_staged_batch_decision",
        json!({ "batchId": batch_id, "items": items, "decision": decision }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn assess_portable_asset_activation(
    state: State<'_, AppState>,
    batch_id: String,
    item_id: String,
) -> CmdResult<PortableActivationGate> {
    let value = invoke_plugin(
        &state,
        "portable.assess_asset_activation",
        json!({ "batchId": batch_id, "itemId": item_id }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
