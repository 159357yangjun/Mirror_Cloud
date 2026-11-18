//! `publish-strategy` 内置插件：多云组（Storage Group）的创建、列出与删除。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands.rs` 的 `create_storage_group` /
//! `list_storage_groups` / `delete_storage_group`（P2）。群组 CRUD 与视图映射在此单份实现；
//! 「默认上传目标」与系统默认管线维护仍归内核，命令层在委托本插件前后做这两步。
//!
//! `repair_asset`（副本修复）暂留内核：它依赖 `build_provider` 与 `tauri::AppHandle` 事件，
//! 待 P3 抽出 provider factory 与任务事件再迁入（见 `docs/PLUGIN_COMMAND_MAP.md` 偏差记录）。

use kernel_api::{
    BuiltinPlugin, Capability, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure,
    PluginId, PluginKind, PluginManifestV2,
};
use persistence_sqlite::{
    NewStorageGroupMember, StorageGroupRecord, StorageGroupRepository, StorageRecord,
    StorageRepository,
};
use serde_json::{Value, json};
use uuid::Uuid;

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "publish-strategy";

pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("publish-strategy is a valid plugin id"),
        name: "发布策略".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "单目标发布、主备镜像、镜像全部与云端修复。".to_string(),
        kind: PluginKind::Native,
        permissions: vec![Capability::ReadAsset, Capability::ProviderConfig],
        default_enabled: true,
        contributes: vec![
            Contribution {
                point: ContributionPoint::Page,
                id: "page.publish".to_string(),
                label: Some("发布".to_string()),
                description: None,
            },
            Contribution {
                point: ContributionPoint::PublishStrategy,
                id: "strategy.primary".to_string(),
                label: Some("主备镜像".to_string()),
                description: None,
            },
        ],
        settings_schema: None,
    }
}

/// 发布策略插件：存储与多云组仓储（群组校验需要读取存储记录）。
pub struct PublishStrategyPlugin {
    storages: StorageRepository,
    groups: StorageGroupRepository,
    manifest: PluginManifestV2,
}

impl PublishStrategyPlugin {
    pub fn new(storages: StorageRepository, groups: StorageGroupRepository) -> Self {
        Self {
            storages,
            groups,
            manifest: manifest(),
        }
    }

    fn group_view(record: StorageGroupRecord) -> Value {
        let members = record
            .members
            .into_iter()
            .map(|member| {
                json!({
                    "storageId": member.storage_id.to_string(),
                    "storageName": member.storage_name,
                    "providerKey": member.provider_key,
                    "role": member.role,
                    "priority": member.priority,
                })
            })
            .collect::<Vec<_>>();
        json!({
            "id": record.id.to_string(),
            "name": record.name,
            "strategy": record.strategy,
            "members": members,
        })
    }

    /// `publishStrategy.create_group`：校验与 1.4.16 `create_storage_group` 一致。
    async fn create_group(&self, payload: &Value) -> Result<Value, PluginFailure> {
        let name = payload
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("name missing"))?
            .trim();
        if name.is_empty() {
            return Err(invalid("Storage Group name cannot be empty"));
        }
        let strategy = payload
            .get("strategy")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("strategy missing"))?;
        if !matches!(strategy, "mirror_all" | "primary_with_backups") {
            return Err(invalid("Unsupported storage group strategy"));
        }
        let members_payload = payload
            .get("members")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("members missing"))?;
        if members_payload.len() < 2 {
            return Err(invalid("A Storage Group requires at least two storages"));
        }

        let mut unique = std::collections::HashSet::new();
        let mut primary_count = 0usize;
        let mut members = Vec::with_capacity(members_payload.len());
        let mut selected_records: Vec<StorageRecord> = Vec::with_capacity(members_payload.len());
        for member in members_payload {
            let raw_id = member
                .get("storageId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("member storageId missing"))?;
            let storage_id = Uuid::parse_str(raw_id)
                .map_err(|error| invalid(&format!("storage id: {error}")))?;
            if !unique.insert(storage_id) {
                return Err(invalid(
                    "The same storage cannot appear twice in a Storage Group",
                ));
            }
            let raw_role = member
                .get("role")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("member role missing"))?;
            let role = match raw_role {
                "primary" => {
                    primary_count += 1;
                    "primary"
                }
                "mirror" => "mirror",
                "backup" => "backup",
                other => return Err(invalid(&format!("Unsupported deployment role: {other}"))),
            };
            let storage = self
                .storages
                .get(storage_id)
                .await
                .map_err(|error| internal(error.to_string()))?
                .ok_or_else(|| invalid(&format!("Storage {storage_id} does not exist")))?;
            if !storage.enabled {
                return Err(invalid(&format!("Storage {} is disabled", storage.name)));
            }
            let priority = member
                .get("priority")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .max(0) as i32;
            members.push(NewStorageGroupMember {
                storage_id,
                role: role.into(),
                priority,
            });
            selected_records.push(storage);
        }
        if primary_count != 1 {
            return Err(invalid(
                "A Storage Group must contain exactly one primary storage",
            ));
        }
        // 私有 R2/S3 不能与公开目标混组：与 1.4.16 的校验口径一致。
        validate_group_access_intents(&selected_records)?;

        let id = Uuid::new_v4();
        self.groups
            .insert(id, name, strategy, &members)
            .await
            .map_err(|error| internal(error.to_string()))?;
        let record = self
            .groups
            .get(id)
            .await
            .map_err(|error| internal(error.to_string()))?
            .ok_or_else(|| internal("Storage Group was created but could not be reloaded"))?;
        Ok(Self::group_view(record))
    }

    async fn list_groups(&self) -> Result<Value, PluginFailure> {
        let records = self
            .groups
            .list()
            .await
            .map_err(|error| internal(error.to_string()))?;
        Ok(Value::Array(
            records.into_iter().map(Self::group_view).collect(),
        ))
    }

    /// `publishStrategy.delete_group`：只删群组本身；默认目标守卫与管线清理由命令层先行完成。
    async fn delete_group(&self, payload: &Value) -> Result<Value, PluginFailure> {
        let raw_id = payload
            .get("groupId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("groupId missing"))?;
        let id = Uuid::parse_str(raw_id).map_err(|error| invalid(&format!("group id: {error}")))?;
        self.groups
            .delete(id)
            .await
            .map_err(|error| internal(error.to_string()))?;
        Ok(json!({ "ok": true }))
    }
}

fn storage_requests_private(record: &StorageRecord) -> bool {
    matches!(record.provider_key.as_str(), "r2" | "s3")
        && record
            .config_json
            .get("access_mode")
            .and_then(Value::as_str)
            == Some("private_requested")
}

fn validate_group_access_intents(storages: &[StorageRecord]) -> Result<(), PluginFailure> {
    let expected_count = storages.len();
    if storages.iter().any(storage_requests_private)
        && (storages.len() != expected_count
            || storages
                .iter()
                .any(|storage| !storage_requests_private(storage)))
    {
        return Err(invalid(
            "私有 R2/S3 不能与公开、未知或已删除的目标组成同一发布组，请拆分工作流",
        ));
    }
    Ok(())
}

fn invalid(message: &str) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::InvalidPayload, message.to_string())
}

fn internal(message: impl Into<String>) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::Internal, message)
}

#[async_trait::async_trait]
impl BuiltinPlugin for PublishStrategyPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "publishStrategy.create_group" => self.create_group(payload).await,
            "publishStrategy.list_groups" => self.list_groups().await,
            "publishStrategy.delete_group" => self.delete_group(payload).await,
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown publish-strategy method {method}"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_valid_and_matches_kernel_entry() {
        let item = manifest();
        item.validate()
            .expect("publish-strategy manifest must validate");
        assert_eq!(item.id.as_str(), PLUGIN_ID);
        assert!(item.default_enabled);
        assert_eq!(item.kind, PluginKind::Native);
        assert_eq!(item.contributes.len(), 2);
        assert_eq!(item.permissions.len(), 2);
    }

    fn storage(provider_key: &str, access_mode: &str) -> StorageRecord {
        StorageRecord {
            id: Uuid::new_v4(),
            name: format!("{provider_key}-{access_mode}"),
            provider_key: provider_key.to_string(),
            category: "object".to_string(),
            credential_ref: None,
            config_json: json!({ "access_mode": access_mode }),
            capabilities_json: json!({}),
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn private_r2_cannot_mix_with_public_targets() {
        let private = storage("r2", "private_requested");
        let public = storage("r2", "public");
        assert!(validate_group_access_intents(std::slice::from_ref(&private)).is_ok());
        assert!(validate_group_access_intents(&[private, public]).is_err());
    }
}
