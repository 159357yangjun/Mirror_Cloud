//! Portable, non-secret storage reconnection inventory.
//!
//! This is deliberately NOT a database/credential backup. Import is read-only
//! until a separate rebind workflow is reviewed and implemented.
use chrono::Utc;
use persistence_sqlite::StorageRecord;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};
use tauri::State;

use super::CmdResult;
use crate::AppState;

const VERSION: u32 = 1;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableStorageManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub credential_rebind_required: bool,
    pub profiles: Vec<PortableStorageProfile>,
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
    if manifest.schema_version != VERSION || !manifest.credential_rebind_required {
        return Err("不支持的清单格式；必须使用无凭据重绑定版本".into());
    }
    if manifest.profiles.len() > MAX_PROFILES {
        return Err("配置条目超过安全上限".into());
    }
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
}
