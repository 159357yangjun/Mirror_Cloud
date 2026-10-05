use std::collections::{HashSet, VecDeque};

use super::*;

const MAX_REMOTE_FILES_PER_STORAGE: usize = 2_000;
const MAX_REMOTE_DIRECTORIES_PER_STORAGE: usize = 1_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteIndexSyncView {
    pub storages_scanned: usize,
    pub files_scanned: usize,
    pub imported: usize,
    pub skipped_existing: usize,
    pub skipped_non_images: usize,
    pub errors: Vec<String>,
}

fn remote_image_mime(path: &str) -> Option<&'static str> {
    let extension = path
        .split('?')
        .next()
        .unwrap_or(path)
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())?;
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn normalize_index_path(path: &str) -> String {
    path.trim().replace('\\', "/").trim_matches('/').to_string()
}

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

    let mut summary = RemoteIndexSyncView {
        storages_scanned: 0,
        files_scanned: 0,
        imported: 0,
        skipped_existing: 0,
        skipped_non_images: 0,
        errors: Vec::new(),
    };

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

        let mut pending_dirs = VecDeque::from([String::new()]);
        let mut seen_dirs = HashSet::new();
        let mut seen_files = HashSet::new();
        let mut storage_files_scanned = 0usize;
        let mut hit_file_limit = false;

        while let Some(directory) = pending_dirs.pop_front() {
            if !seen_dirs.insert(directory.clone()) {
                continue;
            }
            if seen_dirs.len() > MAX_REMOTE_DIRECTORIES_PER_STORAGE {
                summary.errors.push(format!(
                    "{}：目录数量超过 {}，本次同步已停止继续深入",
                    storage.name, MAX_REMOTE_DIRECTORIES_PER_STORAGE
                ));
                break;
            }

            let entries = match provider.list(&directory).await {
                Ok(entries) => entries,
                Err(error) => {
                    let display_path = if directory.is_empty() {
                        "/".to_string()
                    } else {
                        format!("/{directory}")
                    };
                    summary.errors.push(format!(
                        "{} {}：读取失败：{error}",
                        storage.name, display_path
                    ));
                    continue;
                }
            };

            for entry in entries {
                let remote_path = normalize_index_path(&entry.path);
                if remote_path.is_empty() {
                    continue;
                }
                if entry.is_dir {
                    if !seen_dirs.contains(&remote_path) {
                        pending_dirs.push_back(remote_path);
                    }
                    continue;
                }
                if !seen_files.insert(remote_path.clone()) {
                    continue;
                }

                storage_files_scanned += 1;
                summary.files_scanned += 1;
                if storage_files_scanned > MAX_REMOTE_FILES_PER_STORAGE {
                    summary.errors.push(format!(
                        "{}：文件数量超过 {}，为避免首次同步过载，本次已停止；可整理目录后再次同步",
                        storage.name, MAX_REMOTE_FILES_PER_STORAGE
                    ));
                    hit_file_limit = true;
                    break;
                }

                let Some(mime_type) = remote_image_mime(&remote_path) else {
                    summary.skipped_non_images += 1;
                    continue;
                };

                let existing = state
                    .assets
                    .deployment_ids_for_remote(storage.id, &remote_path)
                    .await
                    .map_err(|error| error.to_string())?;
                if !existing.is_empty() {
                    summary.skipped_existing += 1;
                    continue;
                }

                let now = Utc::now();
                let asset = Asset {
                    id: Uuid::new_v4(),
                    name: entry.name.clone(),
                    kind: AssetKind::Image,
                    created_at: now,
                    updated_at: now,
                };
                let synthetic_hash = format!(
                    "remote-index:{}",
                    hex::encode(Sha256::digest(
                        format!("{}:{remote_path}", storage.id).as_bytes()
                    ))
                );
                let variant = AssetVariant {
                    id: Uuid::new_v4(),
                    asset_id: asset.id,
                    label: "remote_index".into(),
                    mime_type: mime_type.into(),
                    size_bytes: entry.size_bytes.unwrap_or(0),
                    width: None,
                    height: None,
                    content_hash: synthetic_hash,
                    created_at: now,
                };
                let deployment = Deployment {
                    id: Uuid::new_v4(),
                    variant_id: variant.id,
                    storage_id: storage.id,
                    role: DeploymentRole::Primary,
                    remote_path: remote_path.clone(),
                    public_url: entry.public_url.clone(),
                    status: DeploymentStatus::Online,
                    deployed_at: None,
                    recorded_at: Some(now),
                };

                match state
                    .assets
                    .insert_published(&asset, &variant, &deployment)
                    .await
                {
                    Ok(()) => summary.imported += 1,
                    Err(error) => summary.errors.push(format!(
                        "{} /{}：写入资源索引失败：{error}",
                        storage.name, remote_path
                    )),
                }
            }

            if hit_file_limit {
                break;
            }
        }
    }

    Ok(summary)
}
