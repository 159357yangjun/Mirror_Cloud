//! P2 resource migration: export an allowlisted catalogue and preview local conflicts.
//! NO imported status, public/signed URL, evidence clocks or remote operations.
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::Path,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use super::{CmdResult, PortableStorageIdMapping};
use crate::AppState;

const SCHEMA_VERSION: u32 = 1;
const MAX_RECORDS: usize = 1000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableAssetDeployment {
    pub source_storage_id: String,
    pub provider_key: String,
    pub role: String,
    /// Object key only. Never a public URL, signer query string or credentials.
    pub remote_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableAssetEntry {
    pub source_asset_id: String,
    pub source_variant_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub content_hash: String,
    pub deployments: Vec<PortableAssetDeployment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableAssetManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub entries: Vec<PortableAssetEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableAssetPreviewRow {
    pub source_asset_id: String,
    pub source_variant_id: String,
    pub name: String,
    pub status: String,
    pub detail: String,
    pub resolved_copies: usize,
    pub missing_copies: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableAssetPreview {
    pub rows: Vec<PortableAssetPreviewRow>,
    pub duplicate_variants: usize,
    pub missing_mappings: usize,
    pub remote_path_conflicts: usize,
    /// This stage performs no writes. All statuses are informational.
    pub applied: bool,
}

fn safe_object_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 1024
        && !key.starts_with('/')
        && !key.starts_with('\\')
        && !key.contains("://")
        && !key.contains('?')
        && !key.contains('#')
        && !key.contains('\\')
        && !key.contains('%')
        && !key.chars().any(char::is_control)
        && key
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn path_for_export(key: &str) -> Option<String> {
    safe_object_key(key).then(|| key.to_owned())
}

fn validate_manifest(manifest: &PortableAssetManifest) -> CmdResult<()> {
    if manifest.schema_version != SCHEMA_VERSION
        || chrono::DateTime::parse_from_rfc3339(&manifest.exported_at).is_err()
        || manifest.entries.len() > MAX_RECORDS
    {
        return Err("资源清单版本、时间或记录数量无效".into());
    }
    let mut variants = HashSet::new();
    for item in &manifest.entries {
        let id = Uuid::parse_str(&item.source_asset_id).map_err(|_| "资源 UUID 无效")?;
        let variant = Uuid::parse_str(&item.source_variant_id).map_err(|_| "资源变体 UUID 无效")?;
        if !variants.insert((id, variant))
            || item.name.is_empty()
            || item.name.len() > 512
            || item.name.chars().any(char::is_control)
            || item.mime_type.len() > 128
            || !item.mime_type.starts_with("image/")
            || !item
                .mime_type
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/.+-".contains(&b))
            || item.content_hash.len() < 32
            || item.content_hash.len() > 128
            || !item.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
            || item.size_bytes > 1_000_000_000_000
            || item.width.is_some_and(|x| x == 0 || x > 1_000_000)
            || item.height.is_some_and(|x| x == 0 || x > 1_000_000)
            || item.deployments.len() > 100
        {
            return Err("资源记录格式、名称或内容哈希不安全".into());
        }
        let mut storage_ids = HashSet::new();
        for deployment in &item.deployments {
            let storage =
                Uuid::parse_str(&deployment.source_storage_id).map_err(|_| "副本存储 UUID 无效")?;
            if !storage_ids.insert(storage)
                || deployment.provider_key.is_empty()
                || deployment.provider_key.len() > 48
                || !deployment
                    .provider_key
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                || !matches!(deployment.role.as_str(), "primary" | "mirror" | "backup")
                || deployment
                    .remote_path
                    .as_deref()
                    .is_some_and(|p| !safe_object_key(p))
            {
                return Err("副本引用或路径包含不安全字段".into());
            }
        }
    }
    Ok(())
}

fn json_path(path: &str) -> CmdResult<&Path> {
    let path = Path::new(path.trim());
    if !path.is_absolute() || path.extension().and_then(|s| s.to_str()) != Some("json") {
        return Err("资源清单必须保存为绝对路径的 JSON 文件".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn export_portable_asset_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    // Fetch one over the cap: never silently produce a partial backup.
    let assets = state
        .assets
        .list(MAX_RECORDS as i64 + 1)
        .await
        .map_err(|_| "无法读取资源索引")?;
    if assets.len() > MAX_RECORDS {
        return Err("资源记录超过 1000 条，已拒绝不完整导出".into());
    }
    let entries = assets
        .into_iter()
        .map(|asset| PortableAssetEntry {
            source_asset_id: asset.id.to_string(),
            source_variant_id: asset.variant_id.to_string(),
            name: asset.name,
            mime_type: asset.mime_type,
            size_bytes: asset.size_bytes,
            width: asset.width,
            height: asset.height,
            content_hash: asset.content_hash,
            deployments: asset
                .deployments
                .into_iter()
                .map(|deployment| PortableAssetDeployment {
                    source_storage_id: deployment.storage_id.to_string(),
                    provider_key: deployment.provider_key,
                    role: deployment.role,
                    remote_path: path_for_export(&deployment.remote_path),
                })
                .collect(),
        })
        .collect();
    let manifest = PortableAssetManifest {
        schema_version: SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        entries,
    };
    validate_manifest(&manifest)?;
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|_| "无法序列化资源清单")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("资源清单超过 4 MB".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(json_path(&destination_path)?)
        .map_err(|_| "无法创建资源清单；不会覆盖同名文件")?;
    file.write_all(&bytes).map_err(|_| "资源清单写入失败")?;
    Ok(manifest.entries.len())
}

#[tauri::command]
pub fn inspect_portable_asset_manifest(source_path: String) -> CmdResult<PortableAssetManifest> {
    let file = json_path(&source_path)?;
    let metadata = std::fs::metadata(file).map_err(|_| "无法读取资源清单")?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("资源清单无效或超过 4 MB".into());
    }
    let bytes = std::fs::read(file).map_err(|_| "无法读取资源清单")?;
    let manifest: PortableAssetManifest =
        serde_json::from_slice(&bytes).map_err(|_| "资源清单包含未知字段或 JSON 格式错误")?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[tauri::command]
pub async fn preview_portable_asset_restore(
    state: State<'_, AppState>,
    manifest: PortableAssetManifest,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<PortableAssetPreview> {
    validate_manifest(&manifest)?;
    if mappings.len() > MAX_RECORDS {
        return Err("存储映射数量超出上限".into());
    }
    let local_storages = state
        .storages
        .list()
        .await
        .map_err(|_| "无法读取本机存储")?;
    let mut resolved = HashMap::new();
    let mut destinations = HashSet::new();
    for mapping in &mappings {
        let old = Uuid::parse_str(&mapping.old_storage_id).map_err(|_| "旧存储 ID 无效")?;
        let new = Uuid::parse_str(&mapping.new_storage_id).map_err(|_| "新存储 ID 无效")?;
        if old == new || resolved.contains_key(&old) || !destinations.insert(new) {
            return Err("存储映射包含重复 ID 或源目标 UUID 相同".into());
        }
        let found = local_storages
            .iter()
            .find(|s| s.id == new && s.enabled && s.provider_key == mapping.provider_key)
            .ok_or("存储映射的目标未启用或 Provider 不符")?;
        resolved.insert(old, found);
    }
    let mut rows = Vec::with_capacity(manifest.entries.len());
    let mut duplicate_variants = 0;
    let mut missing_mappings = 0;
    let mut remote_path_conflicts = 0;
    for item in &manifest.entries {
        let duplicate = state
            .assets
            .has_variant_identity(&item.content_hash, &item.mime_type, item.size_bytes)
            .await
            .map_err(|_| "无法检查本地重复图片")?;
        let mut mapped_count = 0;
        let mut missing_count = 0;
        let mut conflict = false;
        for deployment in &item.deployments {
            let old = Uuid::parse_str(&deployment.source_storage_id)
                .map_err(|_| "无效的副本存储 UUID")?;
            if let Some(storage) = resolved.get(&old) {
                if storage.provider_key != deployment.provider_key {
                    missing_count += 1;
                } else if let Some(key) = &deployment.remote_path {
                    mapped_count += 1;
                    if !state
                        .assets
                        .deployment_ids_for_remote(storage.id, key)
                        .await
                        .map_err(|_| "无法检查现有远端路径引用")?
                        .is_empty()
                    {
                        conflict = true;
                    }
                } else {
                    missing_count += 1;
                }
            } else {
                missing_count += 1;
            }
        }
        let (status, detail) = if duplicate {
            duplicate_variants += 1;
            ("duplicate", "本地已有相同内容哈希、类型和大小；暂不导入")
        } else if conflict {
            remote_path_conflicts += 1;
            (
                "path_conflict",
                "远端对象路径已被本地资源引用；禁止自动关联",
            )
        } else if missing_count > 0 {
            missing_mappings += 1;
            (
                "needs_rebind",
                "缺少存储映射或存在被安全省略的路径，需人工修复",
            )
        } else {
            (
                "unverified",
                "路径和存储映射可用，但未验证云端存在；本阶段只预览",
            )
        };
        rows.push(PortableAssetPreviewRow {
            source_asset_id: item.source_asset_id.clone(),
            source_variant_id: item.source_variant_id.clone(),
            name: item.name.clone(),
            status: status.into(),
            detail: detail.into(),
            resolved_copies: mapped_count,
            missing_copies: missing_count,
        });
    }
    Ok(PortableAssetPreview {
        rows,
        duplicate_variants,
        missing_mappings,
        remote_path_conflicts,
        applied: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_potentially_signed_and_unsafe_paths_from_export() {
        assert_eq!(
            path_for_export("images/photo.webp"),
            Some("images/photo.webp".into())
        );
        for path in [
            "https://domain/test?X-Amz-Signature=secret",
            "image?token=abc",
            "../photo.png",
            "/absolute.png",
            "dir//file.png",
            "images%3Ftoken%3Dsecret",
            "dir\\file.png",
        ] {
            assert_eq!(path_for_export(path), None);
        }
    }
    #[test]
    fn manifest_refuses_status_and_public_url_fields() {
        let base = PortableAssetManifest {
            schema_version: 1,
            exported_at: "2026-10-10T00:00:00Z".into(),
            entries: vec![PortableAssetEntry {
                source_asset_id: Uuid::new_v4().to_string(),
                source_variant_id: Uuid::new_v4().to_string(),
                name: "photo".into(),
                mime_type: "image/webp".into(),
                size_bytes: 1234,
                width: Some(100),
                height: Some(50),
                content_hash: "a".repeat(64),
                deployments: vec![],
            }],
        };
        assert!(validate_manifest(&base).is_ok());
        let mut json = serde_json::to_value(base).unwrap();
        json["entries"][0]["status"] = serde_json::json!("online");
        assert!(serde_json::from_value::<PortableAssetManifest>(json.clone()).is_err());
        json["entries"][0].as_object_mut().unwrap().remove("status");
        json["entries"][0]["publicUrl"] = serde_json::json!("https://signed.invalid/?key=x");
        assert!(serde_json::from_value::<PortableAssetManifest>(json).is_err());
    }
}
