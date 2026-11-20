//! 存储配置的便携导出/恢复命令：薄包装，实现位于 `crates/plugins/portable-migration`。

use super::*;

#[allow(unused_imports)]
pub use plugin_portable_migration::backup::{
    PortableStorageIdMapping, PortableStorageManifest, PortableStorageProfile,
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
pub async fn export_portable_storage_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.export_storage_manifest",
        json!({ "destinationPath": destination_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_portable_reconnect_map(
    state: State<'_, AppState>,
    destination_path: String,
    source_manifest_exported_at: String,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<usize> {
    let value = invoke_plugin(
        &state,
        "portable.export_reconnect_map",
        json!({
            "destinationPath": destination_path,
            "sourceManifestExportedAt": source_manifest_exported_at,
            "mappings": mappings,
        }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_portable_reconnect_map(
    state: State<'_, AppState>,
    source_path: String,
    manifest: PortableStorageManifest,
) -> CmdResult<Vec<PortableStorageIdMapping>> {
    let value = invoke_plugin(
        &state,
        "portable.inspect_reconnect_map",
        json!({ "sourcePath": source_path, "manifest": manifest }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn inspect_portable_storage_manifest(
    state: State<'_, AppState>,
    source_path: String,
) -> CmdResult<PortableStorageManifest> {
    let value = invoke_plugin(
        &state,
        "portable.inspect_storage_manifest",
        json!({ "sourcePath": source_path }),
    )
    .await?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
