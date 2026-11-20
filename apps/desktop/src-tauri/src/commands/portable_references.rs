//! 关系快照（多云组/工作流）的便携导出与恢复命令：薄包装，实现位于
//! `crates/plugins/portable-migration`。

use super::*;

#[allow(unused_imports)]
pub use plugin_portable_migration::references::{
    PortableGroupIdMapping, PortableGroupMappingReceipt, PortableGroupPreview,
    PortableReferenceGroup, PortableReferenceManifest, PortableReferenceMember,
    PortableReferencePreview, PortableReferenceWorkflow, PortableWorkflowPreview,
    PortableWorkflowSpec,
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
pub async fn export_portable_reference_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.export_reference_manifest",
        json!({ "destinationPath": destination_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_portable_reference_manifest(
    state: State<'_, AppState>,
    source_path: String,
) -> CmdResult<PortableReferenceManifest> {
    let value = invoke_plugin(
        &state,
        "portable.inspect_reference_manifest",
        json!({ "sourcePath": source_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_portable_reference_restore(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
) -> CmdResult<PortableReferencePreview> {
    let value = invoke_plugin(
        &state,
        "portable.preview_reference_restore",
        json!({
            "manifest": manifest,
            "mappings": mappings,
            "groupMappings": group_mappings,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_portable_storage_group(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    source_group_id: String,
) -> CmdResult<String> {
    let value = invoke_plugin(
        &state,
        "portable.restore_storage_group",
        json!({
            "manifest": manifest,
            "mappings": mappings,
            "sourceGroupId": source_group_id,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_portable_group_mapping(
    state: State<'_, AppState>,
    destination_path: String,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.export_group_mapping",
        json!({
            "destinationPath": destination_path,
            "manifest": manifest,
            "mappings": mappings,
            "groupMappings": group_mappings,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_portable_group_mapping(
    state: State<'_, AppState>,
    source_path: String,
    expected_manifest_exported_at: String,
) -> CmdResult<Vec<PortableGroupIdMapping>> {
    let value = invoke_plugin(
        &state,
        "portable.inspect_group_mapping",
        json!({
            "sourcePath": source_path,
            "expectedManifestExportedAt": expected_manifest_exported_at,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_portable_workflow(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
    source_workflow_id: String,
) -> CmdResult<String> {
    let value = invoke_plugin(
        &state,
        "portable.restore_workflow",
        json!({
            "manifest": manifest,
            "mappings": mappings,
            "groupMappings": group_mappings,
            "sourceWorkflowId": source_workflow_id,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
