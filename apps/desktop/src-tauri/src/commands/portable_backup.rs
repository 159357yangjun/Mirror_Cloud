//! Portable, non-secret storage reconnection inventory.
//!
//! This is deliberately NOT a database/credential backup. Import is read-only
//! until a separate rebind workflow is reviewed and implemented.
use chrono::Utc;
use persistence_sqlite::StorageRecord;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, io::Write, path::Path};
use tauri::State;

use super::CmdResult;
use crate::AppState;

const VERSION: u32 = 2;
const LEGACY_VERSION: u32 = 1;
const MAX_IMPORT_BYTES: u64 = 1024 * 1024;
const MAX_PROFILES: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableStorageProfile {
    pub name: String,
    pub provider_key: String,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub root: Option<String>,
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub access_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_storage_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableStorageManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub credential_rebind_required: bool,
    pub profiles: Vec<PortableStorageProfile>,
}

/// A non-secret, manually exported receipt. It is not proof of remote ownership.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableStorageIdMapping {
    pub old_storage_id: String,
    pub new_storage_id: String,
    pub provider_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableReconnectMapReceipt {
    schema_version: u32,
    source_manifest_exported_at: String,
    generated_at: String,
    mappings: Vec<PortableStorageIdMapping>,
}

fn optional_field(record: &StorageRecord, key: &str) -> Option<String> {
    record
        .config_json
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn make_profile(record: &StorageRecord) -> PortableStorageProfile {
    let provider_key = record.provider_key.clone();
    let supports_intent = matches!(record.provider_key.as_str(), "r2" | "s3");
    PortableStorageProfile {
        name: record.name.clone(),
        provider_key,
        bucket: optional_field(record, "bucket"),
        region: optional_field(record, "region"),
        root: optional_field(record, "root"),
        owner: optional_field(record, "owner"),
        repo: optional_field(record, "repo"),
        branch: optional_field(record, "branch"),
        source_storage_id: Some(record.id.to_string()),
        access_mode: if supports_intent
            && record
                .config_json
                .get("access_mode")
                .and_then(serde_json::Value::as_str)
                == Some("private_requested")
        {
            "private_requested".to_string()
        } else {
            "unknown".to_string()
        },
    }
}

fn validate_manifest(manifest: &PortableStorageManifest) -> CmdResult<()> {
    if !matches!(manifest.schema_version, LEGACY_VERSION | VERSION)
        || !manifest.credential_rebind_required
    {
        return Err("不支持的清单格式；必须使用无凭据重绑定版本".into());
    }
    if manifest.profiles.len() > MAX_PROFILES {
        return Err("配置条目超过安全上限".into());
    }
    let mut old_ids = HashSet::new();
    for profile in &manifest.profiles {
        if profile.name.trim().is_empty() || profile.name.len() > 256 {
            return Err("清单包含无效的存储名称".into());
        }
        if !matches!(
            profile.provider_key.as_str(),
            "r2" | "s3" | "oss" | "cos" | "github" | "gitee" | "webdav"
        ) {
            return Err("清单包含不支持的存储类型".into());
        }
        if !matches!(
            profile.access_mode.as_str(),
            "unknown" | "private_requested"
        ) {
            return Err("清单包含无效的访问意图".into());
        }
        if profile.access_mode == "private_requested"
            && !matches!(profile.provider_key.as_str(), "r2" | "s3")
        {
            return Err("非 S3 存储不能恢复私有访问意图".into());
        }
        match (manifest.schema_version, &profile.source_storage_id) {
            (LEGACY_VERSION, None) => {}
            (VERSION, Some(old_id)) => {
                let id = uuid::Uuid::parse_str(old_id).map_err(|_| "清单包含无效旧 Storage ID")?;
                if !old_ids.insert(id) {
                    return Err("清单中的旧 Storage ID 重复".into());
                }
            }
            _ => return Err("清单版本与旧 Storage ID 不匹配".into()),
        }
    }
    Ok(())
}

fn ensure_json_path(path: &str) -> CmdResult<&Path> {
    let file = Path::new(path.trim());
    if !file.is_absolute() || file.extension().and_then(|x| x.to_str()) != Some("json") {
        return Err("请选择一个绝对路径且扩展名为 .json 的文件".into());
    }
    Ok(file)
}

/// Export only an allowlist of non-credential storage fields.
/// Deliberately excludes endpoint/public URL (potentially signed), credential
/// references, tokens, keys, local API credentials, asset data and DB internals.
#[tauri::command]
pub async fn export_portable_storage_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    let records = state
        .storages
        .list()
        .await
        .map_err(|_| "无法读取存储配置".to_string())?;
    if records.len() > MAX_PROFILES {
        return Err("存储配置超过导出条目上限".into());
    }
    let manifest = PortableStorageManifest {
        schema_version: VERSION,
        exported_at: Utc::now().to_rfc3339(),
        credential_rebind_required: true,
        profiles: records.iter().map(make_profile).collect(),
    };
    validate_manifest(&manifest)?;
    let bytes =
        serde_json::to_vec_pretty(&manifest).map_err(|_| "无法序列化存储配置清单".to_string())?;
    let destination = ensure_json_path(&destination_path)?;
    // Refuse overwrite: an export can never clobber an existing backup/file.
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "无法创建清单文件；如同名文件已存在，请另选文件名".to_string())?;
    file.write_all(&bytes)
        .map_err(|_| "写入存储配置清单失败".to_string())?;
    Ok(manifest.profiles.len())
}

/// Export a local-only audit receipt for reconnections that already succeeded.
/// This never restores workflow/groups/assets or alters any storage row.
#[tauri::command]
pub async fn export_portable_reconnect_map(
    state: State<'_, AppState>,
    destination_path: String,
    source_manifest_exported_at: String,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<usize> {
    chrono::DateTime::parse_from_rfc3339(&source_manifest_exported_at)
        .map_err(|_| "源清单时间无效")?;
    if mappings.is_empty() || mappings.len() > MAX_PROFILES {
        return Err("没有可导出的有效映射记录".into());
    }
    let storages = state
        .storages
        .list()
        .await
        .map_err(|_| "无法核实当前存储")?;
    let mut old_ids = HashSet::new();
    let mut new_ids = HashSet::new();
    for mapping in &mappings {
        let old =
            uuid::Uuid::parse_str(&mapping.old_storage_id).map_err(|_| "无效的旧 Storage ID")?;
        let new =
            uuid::Uuid::parse_str(&mapping.new_storage_id).map_err(|_| "无效的新 Storage ID")?;
        if old == new || !old_ids.insert(old) || !new_ids.insert(new) {
            return Err("映射存在重复或新旧 ID 相同".into());
        }
        if !storages
            .iter()
            .any(|storage| storage.id == new && storage.provider_key == mapping.provider_key)
        {
            return Err("映射目标已不存在或 Provider 不匹配".into());
        }
    }
    let receipt = PortableReconnectMapReceipt {
        schema_version: 1,
        source_manifest_exported_at,
        generated_at: Utc::now().to_rfc3339(),
        mappings,
    };
    let bytes = serde_json::to_vec_pretty(&receipt).map_err(|_| "无法序列化映射结果")?;
    let destination = ensure_json_path(&destination_path)?;
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "无法创建映射文件；同名文件不会覆盖")?;
    output.write_all(&bytes).map_err(|_| "写入映射文件失败")?;
    Ok(receipt.mappings.len())
}

/// Read a previously exported v2 Storage ID receipt, validating old IDs against
/// the selected source manifest and new IDs against current local storages.
#[tauri::command]
pub async fn inspect_portable_reconnect_map(
    state: State<'_, AppState>,
    source_path: String,
    manifest: PortableStorageManifest,
) -> CmdResult<Vec<PortableStorageIdMapping>> {
    validate_manifest(&manifest)?;
    if manifest.schema_version != VERSION {
        return Err("v1 清单没有原存储 UUID，无法使用 ID 映射".into());
    }
    let source = ensure_json_path(&source_path)?;
    let meta = std::fs::metadata(source).map_err(|_| "无法读取存储 ID 映射")?;
    if !meta.is_file() || meta.len() > MAX_IMPORT_BYTES {
        return Err("ID 映射文件无效或超过 1 MB".into());
    }
    let bytes = std::fs::read(source).map_err(|_| "无法读取存储 ID 映射")?;
    let receipt: PortableReconnectMapReceipt = serde_json::from_slice(&bytes)
        .map_err(|_| "ID 映射文件包含多余字段或格式错误")?;
    if receipt.schema_version != 1 || receipt.source_manifest_exported_at != manifest.exported_at
        || receipt.mappings.is_empty() || receipt.mappings.len() > MAX_PROFILES {
        return Err("ID 映射文件与当前存储清单不匹配".into());
    }
    let local = state.storages.list().await.map_err(|_| "无法核实本机存储")?;
    let mut old_ids = HashSet::new();
    let mut new_ids = HashSet::new();
    for item in &receipt.mappings {
        let old = uuid::Uuid::parse_str(&item.old_storage_id)
            .map_err(|_| "旧 Storage ID 无效")?;
        let new = uuid::Uuid::parse_str(&item.new_storage_id)
            .map_err(|_| "新 Storage ID 无效")?;
        if old == new || !old_ids.insert(old) || !new_ids.insert(new) {
            return Err("ID 映射包含重复或相同的旧新 UUID".into());
        }
        if !manifest.profiles.iter().any(|profile|
            profile.source_storage_id.as_deref().and_then(|id| uuid::Uuid::parse_str(id).ok()) == Some(old)
                && profile.provider_key == item.provider_key
        ) {
            return Err("旧 Storage ID 不属于当前清单或 Provider 不匹配".into());
        }
        if !local.iter().any(|record|
            record.id == new && record.provider_key == item.provider_key && record.enabled
        ) {
            return Err("新存储不存在、已禁用或 Provider 不匹配".into());
        }
    }
    Ok(receipt.mappings)
}

/// Import step one: inspect and validate only. NEVER mutate SQLite or secrets.
#[tauri::command]
pub async fn inspect_portable_storage_manifest(
    source_path: String,
) -> CmdResult<PortableStorageManifest> {
    let source = ensure_json_path(&source_path)?;
    let meta = std::fs::metadata(source).map_err(|_| "无法读取清单文件".to_string())?;
    if !meta.is_file() || meta.len() > MAX_IMPORT_BYTES {
        return Err("请选择不超过 1 MB 的 JSON 配置清单".into());
    }
    let bytes = std::fs::read(source).map_err(|_| "读取清单失败".to_string())?;
    let manifest: PortableStorageManifest = serde_json::from_slice(&bytes)
        .map_err(|_| "清单格式错误或包含不允许的额外字段".to_string())?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn export_allowlist_excludes_keys_tokens_and_signed_urls() {
        let now = Utc::now();
        let record = StorageRecord {
            id: Uuid::new_v4(),
            name: "Private S3".into(),
            provider_key: "s3".into(),
            category: "object".into(),
            credential_ref: Some("storage:super-secret".into()),
            config_json: json!({
                "bucket":"photos","region":"us-east-1","root":"assets",
                "access_mode":"private_requested",
                "endpoint":"https://secret-token@example.com?X-Amz-Signature=secret",
                "public_base_url":"https://cdn.example.com/secret-key",
                "password":"hidden","token":"hidden"
            }),
            capabilities_json: json!({}),
            enabled: true,
            created_at: now,
            updated_at: now,
        };
        let profile = make_profile(&record);
        let json = serde_json::to_string(&profile).unwrap();
        for forbidden in [
            "secret",
            "hidden",
            "credential",
            "endpoint",
            "password",
            "token",
            "publicBaseUrl",
        ] {
            assert!(!json.contains(forbidden), "leaked {forbidden}");
        }
        assert_eq!(profile.access_mode, "private_requested");
        assert_eq!(
            profile.source_storage_id.as_deref(),
            Some(record.id.to_string().as_str())
        );
        assert_eq!(profile.bucket.as_deref(), Some("photos"));
    }

    #[test]
    fn reject_extra_sensitive_fields_and_wrong_provider_intent() {
        let mut manifest = PortableStorageManifest {
            schema_version: VERSION,
            exported_at: "2026-10-10T00:00:00Z".into(),
            credential_rebind_required: true,
            profiles: vec![PortableStorageProfile {
                name: "invalid".into(),
                provider_key: "gitee".into(),
                bucket: None,
                region: None,
                root: None,
                owner: None,
                repo: None,
                branch: None,
                access_mode: "private_requested".into(),
                source_storage_id: Some(Uuid::new_v4().to_string()),
            }],
        };
        assert!(validate_manifest(&manifest).is_err());
        manifest.profiles[0].provider_key = "s3".into();
        assert!(validate_manifest(&manifest).is_ok());
        let mut raw = serde_json::to_value(&manifest).unwrap();
        raw.as_object_mut()
            .unwrap()
            .insert("secretAccessKey".into(), json!("oops"));
        assert!(serde_json::from_value::<PortableStorageManifest>(raw).is_err());
    }

    #[test]
    fn v1_remains_readable_without_ids_but_rejects_hidden_ids() {
        let id = Uuid::new_v4().to_string();
        let mut manifest = PortableStorageManifest {
            schema_version: LEGACY_VERSION,
            exported_at: "2026-10-10T00:00:00Z".into(),
            credential_rebind_required: true,
            profiles: vec![PortableStorageProfile {
                name: "old".into(),
                provider_key: "s3".into(),
                bucket: Some("pics".into()),
                region: None,
                root: None,
                owner: None,
                repo: None,
                branch: None,
                access_mode: "unknown".into(),
                source_storage_id: None,
            }],
        };
        assert!(validate_manifest(&manifest).is_ok());
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(!json.contains("sourceStorageId"));
        manifest.profiles[0].source_storage_id = Some(id);
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn v2_requires_distinct_valid_old_ids() {
        let mut manifest = PortableStorageManifest {
            schema_version: VERSION,
            exported_at: "2026-10-10T00:00:00Z".into(),
            credential_rebind_required: true,
            profiles: vec![PortableStorageProfile {
                name: "first".into(),
                provider_key: "r2".into(),
                bucket: Some("photos".into()),
                region: None,
                root: None,
                owner: None,
                repo: None,
                branch: None,
                access_mode: "unknown".into(),
                source_storage_id: Some(Uuid::new_v4().to_string()),
            }],
        };
        assert!(validate_manifest(&manifest).is_ok());
        manifest.profiles.push(manifest.profiles[0].clone());
        manifest.profiles[1].name = "second".into();
        assert!(validate_manifest(&manifest).is_err());
        manifest.profiles.pop();
        manifest.profiles[0].source_storage_id = Some("not-a-uuid".into());
        assert!(validate_manifest(&manifest).is_err());
        manifest.profiles[0].source_storage_id = None;
        assert!(validate_manifest(&manifest).is_err());
    }
}
