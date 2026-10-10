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
use persistence_sqlite::asset_staging::{StagedAssetBatch, StagedAssetInput, StagedAssetRow};

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
    build_asset_preview(state.inner(), &manifest, &mappings).await
}

async fn build_asset_preview(
    state: &AppState,
    manifest: &PortableAssetManifest,
    mappings: &[PortableStorageIdMapping],
) -> CmdResult<PortableAssetPreview> {
    validate_manifest(manifest)?;
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
    for mapping in mappings {
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
        } else if missing_count > 0 || item.deployments.is_empty() {
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

/// Confirm an import into an isolated, non-active review queue.
/// Never insert into assets, asset_variants or deployments.
#[tauri::command]
pub async fn stage_portable_asset_manifest(
    state: State<'_, AppState>,
    manifest: PortableAssetManifest,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<String> {
    let preview = build_asset_preview(state.inner(), &manifest, &mappings).await?;
    if manifest.entries.is_empty() {
        return Err("空资源清单无需暂存".into());
    }
    let items = manifest
        .entries
        .iter()
        .zip(preview.rows.iter())
        .map(|(entry, row)| {
            let review_status = match row.status.as_str() {
                "duplicate" => "blocked_duplicate",
                "path_conflict" => "blocked_path",
                "needs_rebind" => "needs_rebind",
                _ => "awaiting_verification",
            };
            Ok(StagedAssetInput {
                source_asset_id: entry.source_asset_id.clone(),
                source_variant_id: entry.source_variant_id.clone(),
                name: entry.name.clone(),
                review_status: review_status.into(),
                entry_json: serde_json::to_string(entry).map_err(|_| "无法序列化安全资源记录")?,
                resolved_copies: row.resolved_copies as i64,
                missing_copies: row.missing_copies as i64,
            })
        })
        .collect::<CmdResult<Vec<_>>>()?;
    let mapping_json = serde_json::to_string(&mappings).map_err(|_| "无法记录源存储映射")?;
    let id = Uuid::new_v4();
    let inserted = state
        .asset_staging
        .stage(id, &manifest.exported_at, &mapping_json, &items)
        .await
        .map_err(|_| "无法写入隔离暂存区；数据库事务已回滚")?;
    if !inserted {
        return Err("当前来源清单已存在暂存记录；请在暂存列表中查看或先删除旧批次".into());
    }
    Ok(id.to_string())
}

#[tauri::command]
pub async fn list_portable_asset_staging(
    state: State<'_, AppState>,
) -> CmdResult<Vec<StagedAssetBatch>> {
    state
        .asset_staging
        .list_batches()
        .await
        .map_err(|_| "无法读取暂存批次".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedSourceStorage {
    pub source_storage_id: String,
    pub provider_key: String,
    pub has_safe_path: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAssetReviewView {
    #[serde(flatten)]
    pub row: StagedAssetRow,
    pub sources: Vec<StagedSourceStorage>,
    pub bindings: Vec<PortableStorageIdMapping>,
}

#[tauri::command]
pub async fn list_portable_staged_items(
    state: State<'_, AppState>,
    batch_id: String,
) -> CmdResult<Vec<StagedAssetReviewView>> {
    let batch_id = Uuid::parse_str(&batch_id).map_err(|_| "批次 UUID 无效")?;
    state
        .asset_staging
        .list_items(batch_id)
        .await
        .map_err(|_| "无法读取暂存记录")?
        .into_iter()
        .map(|row| {
            let entry: PortableAssetEntry =
                serde_json::from_str(&row.entry_json).map_err(|_| "暂存记录内容损坏")?;
            let bindings: Vec<PortableStorageIdMapping> =
                serde_json::from_str(&row.binding_overrides_json)
                    .map_err(|_| "暂存存储映射内容损坏")?;
            let sources = entry
                .deployments
                .iter()
                .map(|d| StagedSourceStorage {
                    source_storage_id: d.source_storage_id.clone(),
                    provider_key: d.provider_key.clone(),
                    has_safe_path: d.remote_path.is_some(),
                })
                .collect();
            Ok(StagedAssetReviewView {
                row,
                sources,
                bindings,
            })
        })
        .collect()
}

/// Persist a deliberate local repair decision. A new destination must be enabled
/// and match the original provider; the source reference must occur in this row.
/// No remote access, active assets or public URLs are ever written.
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
    if !matches!(decision.as_str(), "review" | "defer" | "exclude") || expected_revision < 0 {
        return Err("无效的处理决定或修订版本".into());
    }
    let batch = Uuid::parse_str(&batch_id).map_err(|_| "批次 UUID 无效")?;
    let item = Uuid::parse_str(&item_id).map_err(|_| "暂存记录 UUID 无效")?;
    let context = state
        .asset_staging
        .get_review_context(batch, item)
        .await
        .map_err(|_| "无法核实暂存记录")?
        .ok_or("暂存记录不存在")?;
    if context.revision != expected_revision {
        return Err("记录已被其他操作修改，请刷新后重试".into());
    }
    let entry: PortableAssetEntry =
        serde_json::from_str(&context.entry_json).map_err(|_| "暂存元数据损坏")?;
    let source_manifest = PortableAssetManifest {
        schema_version: SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        entries: vec![entry.clone()],
    };
    validate_manifest(&source_manifest)?;

    let saved: Vec<PortableStorageIdMapping> =
        serde_json::from_str(&context.storage_mappings_json).map_err(|_| "来源映射格式损坏")?;
    let mut overrides: Vec<PortableStorageIdMapping> =
        serde_json::from_str(&context.binding_overrides_json).map_err(|_| "人工映射格式损坏")?;

    match (source_storage_id.as_deref(), new_storage_id.as_deref()) {
        (None, None) => {}
        (Some(old_id), Some(new_id)) => {
            let old = Uuid::parse_str(old_id).map_err(|_| "旧 Storage UUID 无效")?;
            let dest = Uuid::parse_str(new_id).map_err(|_| "目标 Storage UUID 无效")?;
            if old == dest {
                return Err("不可复用旧 Storage UUID".into());
            }
            let source = entry
                .deployments
                .iter()
                .find(|d| Uuid::parse_str(&d.source_storage_id).ok() == Some(old))
                .ok_or("当前资源不包含该来源存储")?;
            let local = state
                .storages
                .get(dest)
                .await
                .map_err(|_| "无法查找目标存储")?
                .ok_or("目标存储不存在")?;
            if !local.enabled || local.provider_key != source.provider_key {
                return Err("目标存储已禁用或 Provider 不匹配".into());
            }
            overrides.retain(|m| m.old_storage_id != old_id);
            overrides.push(PortableStorageIdMapping {
                old_storage_id: old_id.to_string(),
                new_storage_id: new_id.to_string(),
                provider_key: source.provider_key.clone(),
            });
        }
        (Some(old_id), None) => {
            let old = Uuid::parse_str(old_id).map_err(|_| "旧 Storage UUID 无效")?;
            if !entry
                .deployments
                .iter()
                .any(|d| Uuid::parse_str(&d.source_storage_id).ok() == Some(old))
            {
                return Err("当前资源不包含该来源存储".into());
            }
            overrides.retain(|m| m.old_storage_id != old_id);
        }
        (None, Some(_)) => return Err("必须指定要修复的来源存储".into()),
    }

    let local = state
        .storages
        .list()
        .await
        .map_err(|_| "无法读取本机存储")?;
    let mut effective = Vec::new();
    let mut targets = HashSet::new();
    for deployment in &entry.deployments {
        let candidate = overrides
            .iter()
            .find(|m| m.old_storage_id == deployment.source_storage_id)
            .or_else(|| {
                saved
                    .iter()
                    .find(|m| m.old_storage_id == deployment.source_storage_id)
            });
        if let Some(mapping) = candidate {
            if mapping.provider_key != deployment.provider_key {
                continue;
            }
            let new_id =
                Uuid::parse_str(&mapping.new_storage_id).map_err(|_| "目标存储 UUID 损坏")?;
            if !local
                .iter()
                .any(|s| s.id == new_id && s.enabled && s.provider_key == mapping.provider_key)
            {
                continue;
            }
            if !targets.insert(new_id) {
                return Err("多个来源副本绑定了同一目标存储，请分别修复".into());
            }
            effective.push(mapping.clone());
        }
    }
    let preview = build_asset_preview(state.inner(), &source_manifest, &effective).await?;
    let row = preview.rows.first().ok_or("无法重新检查资源")?;
    let status = match row.status.as_str() {
        "duplicate" => "blocked_duplicate",
        "path_conflict" => "blocked_path",
        "needs_rebind" => "needs_rebind",
        _ => "awaiting_verification",
    };
    let serialized = serde_json::to_string(&overrides).map_err(|_| "无法保存人工存储映射")?;
    let updated = state
        .asset_staging
        .update_review(
            batch,
            item,
            expected_revision,
            status,
            &decision,
            &serialized,
            row.resolved_copies as i64,
            row.missing_copies as i64,
        )
        .await
        .map_err(|_| "暂存修复保存失败")?;
    if !updated {
        return Err("记录被其他操作修改，请刷新后重试".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn discard_portable_asset_staging(
    state: State<'_, AppState>,
    batch_id: String,
) -> CmdResult<bool> {
    let batch_id = Uuid::parse_str(&batch_id).map_err(|_| "批次 UUID 无效")?;
    state
        .asset_staging
        .discard(batch_id)
        .await
        .map_err(|_| "无法清理暂存批次".into())
}

/// Read-only, fail-closed activation preflight. The current release has no
/// trusted cloud evidence collector, so this command NEVER authorizes promotion.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableActivationCopyGate {
    pub source_storage_id: String,
    pub destination_storage_id: Option<String>,
    pub provider_key: String,
    pub local_binding_valid: bool,
    pub has_safe_object_key: bool,
    pub required_evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableActivationGate {
    pub item_id: String,
    pub revision: i64,
    pub local_status: String,
    pub decision: String,
    pub gate_status: String,
    pub local_blockers: Vec<String>,
    pub copies: Vec<PortableActivationCopyGate>,
    pub activation_allowed: bool,
}

fn activation_gate_status(
    decision: &str,
    local_blockers: &[String],
) -> &'static str {
    match decision {
        "exclude" => "excluded",
        "defer" => "deferred",
        "review" if local_blockers.is_empty() => "awaiting_remote_evidence",
        _ => "blocked_local",
    }
}

fn required_copy_evidence(private_intent: bool) -> Vec<String> {
    let mut requirements = vec![
        "remote_object_exists".into(),
        "authenticated_readback_matches_source_digest".into(),
        "provider_access_policy_verified".into(),
    ];
    if private_intent {
        requirements.push("anonymous_access_denied".into());
        requirements.push("time_limited_share_expiration_verified".into());
    }
    requirements
}

#[tauri::command]
pub async fn assess_portable_asset_activation(
    state: State<'_, AppState>,
    batch_id: String,
    item_id: String,
) -> CmdResult<PortableActivationGate> {
    let batch = Uuid::parse_str(&batch_id).map_err(|_| "无效的批次 UUID")?;
    let item = Uuid::parse_str(&item_id).map_err(|_| "无效的资源 UUID")?;
    let ctx = state.asset_staging.get_review_context(batch, item).await
        .map_err(|_| "无法读取暂存检查信息")?
        .ok_or("暂存记录不存在或已被清理")?;
    if !matches!(ctx.operator_decision.as_str(), "review" | "defer" | "exclude") {
        return Err("暂存审核决定无效".into());
    }
    let entry: PortableAssetEntry = serde_json::from_str(&ctx.entry_json)
        .map_err(|_| "暂存资源数据损坏")?;
    let sample = PortableAssetManifest {
        schema_version: SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        entries: vec![entry.clone()],
    };
    validate_manifest(&sample)?;
    let saved: Vec<PortableStorageIdMapping> =
        serde_json::from_str(&ctx.storage_mappings_json)
            .map_err(|_| "来源存储映射损坏")?;
    let overrides: Vec<PortableStorageIdMapping> =
        serde_json::from_str(&ctx.binding_overrides_json)
            .map_err(|_| "本地人工映射损坏")?;
    let storages = state.storages.list().await.map_err(|_| "无法读取存储列表")?;
    let mut effective = Vec::new();
    let mut destinations = HashSet::new();
    let mut blockers = Vec::new();
    let mut copies = Vec::new();

    if entry.deployments.is_empty() {
        blockers.push("no_deployment_references".into());
    }
    for deployment in &entry.deployments {
        let mapping = overrides.iter()
            .find(|m| m.old_storage_id == deployment.source_storage_id)
            .or_else(|| saved.iter().find(|m| m.old_storage_id == deployment.source_storage_id));
        let mut accepted = None;
        let mut private_requested = false;
        if let Some(mapping) = mapping {
            let source = Uuid::parse_str(&mapping.old_storage_id).ok();
            let dest = Uuid::parse_str(&mapping.new_storage_id).ok();
            if let (Some(source), Some(dest)) = (source, dest) {
                if source != dest && mapping.provider_key == deployment.provider_key
                    && mapping.old_storage_id == deployment.source_storage_id
                {
                    if let Some(storage) = storages.iter().find(|storage|
                        storage.id == dest && storage.enabled && storage.provider_key == mapping.provider_key)
                    {
                        if destinations.insert(dest) {
                            private_requested = matches!(storage.provider_key.as_str(), "r2" | "s3")
                                && storage.config_json.get("access_mode")
                                    .and_then(serde_json::Value::as_str) == Some("private_requested");
                            effective.push(mapping.clone());
                            accepted = Some(dest.to_string());
                        } else {
                            blockers.push("multiple_copies_share_destination".into());
                        }
                    }
                }
            }
        }
        if accepted.is_none() {
            blockers.push("missing_or_invalid_storage_binding".into());
        }
        if deployment.remote_path.is_none() {
            blockers.push("unsafe_or_missing_object_key".into());
        }
        copies.push(PortableActivationCopyGate {
            source_storage_id: deployment.source_storage_id.clone(),
            destination_storage_id: accepted.clone(),
            provider_key: deployment.provider_key.clone(),
            local_binding_valid: accepted.is_some(),
            has_safe_object_key: deployment.remote_path.is_some(),
            required_evidence: required_copy_evidence(private_requested),
        });
    }

    // Re-query current local variant index and active deployment locations. Never
    // trust the review_status stored when this batch was originally staged.
    let preview = build_asset_preview(state.inner(), &sample, &effective).await?;
    let row = preview.rows.first().ok_or("无法计算当前本地冲突")?;
    match row.status.as_str() {
        "duplicate" => blockers.push("duplicate_content_identity".into()),
        "path_conflict" => blockers.push("active_remote_key_conflict".into()),
        "needs_rebind" => blockers.push("unresolved_local_references".into()),
        "unverified" => {}
        _ => blockers.push("unknown_local_preflight_status".into()),
    }
    let gate_status = activation_gate_status(&ctx.operator_decision, &blockers);
    Ok(PortableActivationGate {
        item_id, revision: ctx.revision,
        local_status: row.status.clone(),
        decision: ctx.operator_decision,
        gate_status: gate_status.into(),
        local_blockers: blockers,
        copies,
        // Intentionally hard-coded: remote evidence has not been collected or
        // cryptographically/operationally bound to this exact source and target.
        activation_allowed: false,
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
    fn activation_gate_never_approves_only_local_preflight() {
        let empty: Vec<String> = vec![];
        assert_eq!(activation_gate_status("review", &empty), "awaiting_remote_evidence");
        assert_eq!(activation_gate_status("defer", &empty), "deferred");
        assert_eq!(activation_gate_status("exclude", &empty), "excluded");
        assert_eq!(activation_gate_status("review", &["duplicate".into()]), "blocked_local");
        assert_eq!(activation_gate_status("unexpected", &empty), "blocked_local");
    }

    #[test]
    fn private_intent_requires_additional_proof() {
        let normal = required_copy_evidence(false);
        let private = required_copy_evidence(true);
        assert!(normal.contains(&"authenticated_readback_matches_source_digest".to_string()));
        assert!(!normal.contains(&"anonymous_access_denied".to_string()));
        assert!(private.contains(&"anonymous_access_denied".to_string()));
        assert!(private.contains(&"time_limited_share_expiration_verified".to_string()));
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
