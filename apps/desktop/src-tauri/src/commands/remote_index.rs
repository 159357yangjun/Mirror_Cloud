//! Remote index sync command: thin wrapper over the shared `remote-index` crate.
//!
//! ## Where the walk went
//!
//! The directory walk, the import and the per-storage scan record live in `crates/remote-index`
//! so the explicit command and the reconcile plugin's background refresh share one implementation.
//! This module keeps only what is specific to an explicit request: resolving the requested
//! storages, building providers, reporting a capability refusal, and returning errors to the
//! caller.

use super::*;
use ::remote_index::{RemoteIndexSyncView, sync_one_storage};
use tauri::State;

/// Walk one or every enabled storage's remote listing and import what is new locally.
#[tauri::command]
pub async fn sync_storage_asset_index(
    state: State<'_, AppState>,
    storage_id: Option<String>,
) -> CmdResult<RemoteIndexSyncView> {
    let storages = if let Some(storage_id) = storage_id {
        let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
        vec![
            state
                .storages
                .get(id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Storage not found")?,
        ]
    } else {
        state
            .storages
            .list()
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|storage| storage.enabled)
            .collect()
    };

    let mut summary = RemoteIndexSyncView::new();

    for storage in storages {
        summary.storages_scanned += 1;
        let provider = match build_provider(&state, &storage) {
            Ok(provider) => provider,
            Err(error) => {
                summary.errors.push(format!("{}：{error}", storage.name));
                continue;
            }
        };
        if !provider.capabilities().list {
            summary.errors.push(format!(
                "{}：当前 Provider 不支持列出远端文件",
                storage.name
            ));
            continue;
        }
        // P2：遍历与导入在 `remote-index`，命令只负责解析存储与构造 provider。
        sync_one_storage(
            &state.assets,
            &state.journal,
            &storage,
            &provider,
            &mut summary,
        )
        .await;
    }

    Ok(summary)
}
