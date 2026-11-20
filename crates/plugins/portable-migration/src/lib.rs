//! `portable-migration` 内置插件：导出/恢复便携资产、存储配置与关系快照。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands/portable_assets.rs`（10 条）、
//! `portable_backup.rs`（4 条）与 `portable_references.rs`（7 条），共 21 条命令。
//!
//! ## 本插件拥有什么
//!
//! - 便携资产：清单导出/检查、恢复预览、隔离暂存与激活预检（[`assets`]）；
//! - 存储配置：非凭据清单与 ID 映射的导出/检查（[`backup`]）；
//! - 关系快照：多云组与工作流的导出/检查/恢复（[`references`]）。
//!
//! ## 宿主保留什么
//!
//! 命令注册与 `AppState` 的生命周期。所需仓储在启动时注入插件实例，插件不再经
//! `AppState` 间接访问，因此单测可以只构造插件本身。
//!
//! 全部操作为本地文件读写与 SQLite 事务：不触网、不读写凭据、不写正式资源表。

use async_trait::async_trait;
use kernel_api::{
    BuiltinPlugin, Capability, InvokeErrorCode, PluginFailure, PluginId, PluginKind,
    PluginManifestV2,
};
use persistence_sqlite::{
    AssetRepository, StorageGroupRepository, StorageRepository, WorkflowRepository,
    asset_staging::AssetStagingRepository,
};
use serde::Serialize;
use serde_json::Value;

pub mod assets;
pub mod backup;
pub mod references;

pub use backup::PortableStorageIdMapping;

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "portable-migration";

/// 插件清单：与 `crates/kernel/src/builtin.rs` 中的装配条目一致。
pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("static plugin id is valid"),
        name: "迁移与备份".into(),
        version: "2.0.0-dev.1".into(),
        description: "导出/恢复便携资产、引用、分组映射。".into(),
        kind: PluginKind::Native,
        permissions: vec![Capability::FsPaths, Capability::ReadAsset],
        default_enabled: true,
        contributes: Vec::new(),
        settings_schema: None,
    }
}

/// 迁移与备份插件：所需的仓储在启动时注入。
pub struct PortableMigrationPlugin {
    storages: StorageRepository,
    assets: AssetRepository,
    asset_staging: AssetStagingRepository,
    groups: StorageGroupRepository,
    workflows: WorkflowRepository,
    manifest: PluginManifestV2,
}

impl PortableMigrationPlugin {
    pub fn new(
        storages: StorageRepository,
        assets: AssetRepository,
        asset_staging: AssetStagingRepository,
        groups: StorageGroupRepository,
        workflows: WorkflowRepository,
    ) -> Self {
        Self {
            storages,
            assets,
            asset_staging,
            groups,
            workflows,
            manifest: manifest(),
        }
    }
}

/// 载荷字段缺失或类型不符。
pub(crate) fn bad_payload(message: impl Into<String>) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::InvalidPayload, message)
}

/// 插件内部失败（持久化、文件 IO、格式校验等）。
pub(crate) fn internal(message: impl Into<String>) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::Internal, message)
}

pub(crate) fn required_str(payload: &Value, key: &str) -> Result<String, PluginFailure> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| bad_payload(format!("缺少必填字段 {key}")))
}

pub(crate) fn optional_str(payload: &Value, key: &str) -> Result<Option<String>, PluginFailure> {
    match payload.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(bad_payload(format!("字段 {key} 必须为字符串或空"))),
    }
}

pub(crate) fn required<T: serde::de::DeserializeOwned>(
    payload: &Value,
    key: &str,
) -> Result<T, PluginFailure> {
    payload
        .get(key)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .ok_or_else(|| bad_payload(format!("字段 {key} 缺失或格式无效")))
}

pub(crate) fn to_value<T: Serialize>(value: &T) -> Result<Value, PluginFailure> {
    serde_json::to_value(value).map_err(|error| internal(format!("序列化失败：{error}")))
}

#[async_trait]
impl BuiltinPlugin for PortableMigrationPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            // —— 便携资产（原 portable_assets.rs）
            "portable.export_asset_manifest" => {
                let destination_path = required_str(payload, "destinationPath")?;
                self.export_asset_manifest(&destination_path).await
            }
            "portable.inspect_asset_manifest" => {
                let source_path = required_str(payload, "sourcePath")?;
                self.inspect_asset_manifest(&source_path)
            }
            "portable.preview_asset_restore" => {
                let manifest = required::<assets::PortableAssetManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                self.preview_asset_restore(&manifest, &mappings).await
            }
            "portable.stage_asset_manifest" => {
                let manifest = required::<assets::PortableAssetManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                self.stage_asset_manifest(&manifest, &mappings).await
            }
            "portable.list_asset_staging" => self.list_asset_staging().await,
            "portable.list_staged_items" => {
                let batch_id = required_str(payload, "batchId")?;
                self.list_staged_items(&batch_id).await
            }
            "portable.update_staged_item_review" => {
                let batch_id = required_str(payload, "batchId")?;
                let item_id = required_str(payload, "itemId")?;
                let expected_revision = required::<i64>(payload, "expectedRevision")?;
                let decision = required_str(payload, "decision")?;
                let source_storage_id = optional_str(payload, "sourceStorageId")?;
                let new_storage_id = optional_str(payload, "newStorageId")?;
                self.update_staged_item_review(
                    &batch_id,
                    &item_id,
                    expected_revision,
                    &decision,
                    source_storage_id.as_deref(),
                    new_storage_id.as_deref(),
                )
                .await
            }
            "portable.discard_asset_staging" => {
                let batch_id = required_str(payload, "batchId")?;
                self.discard_asset_staging(&batch_id).await
            }
            "portable.apply_staged_batch_decision" => {
                let batch_id = required_str(payload, "batchId")?;
                let items = required::<Vec<assets::PortableBatchDecisionItem>>(payload, "items")?;
                let decision = required_str(payload, "decision")?;
                self.apply_staged_batch_decision(&batch_id, &items, &decision)
                    .await
            }
            "portable.assess_asset_activation" => {
                let batch_id = required_str(payload, "batchId")?;
                let item_id = required_str(payload, "itemId")?;
                self.assess_asset_activation(&batch_id, &item_id).await
            }

            // —— 存储配置（原 portable_backup.rs）
            "portable.export_storage_manifest" => {
                let destination_path = required_str(payload, "destinationPath")?;
                self.export_storage_manifest(&destination_path).await
            }
            "portable.export_reconnect_map" => {
                let destination_path = required_str(payload, "destinationPath")?;
                let source_manifest_exported_at =
                    required_str(payload, "sourceManifestExportedAt")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                self.export_reconnect_map(
                    &destination_path,
                    &source_manifest_exported_at,
                    &mappings,
                )
                .await
            }
            "portable.inspect_reconnect_map" => {
                let source_path = required_str(payload, "sourcePath")?;
                let manifest = required::<backup::PortableStorageManifest>(payload, "manifest")?;
                self.inspect_reconnect_map(&source_path, &manifest).await
            }
            "portable.inspect_storage_manifest" => {
                let source_path = required_str(payload, "sourcePath")?;
                self.inspect_storage_manifest(&source_path)
            }

            // —— 关系快照（原 portable_references.rs）
            "portable.export_reference_manifest" => {
                let destination_path = required_str(payload, "destinationPath")?;
                self.export_reference_manifest(&destination_path).await
            }
            "portable.inspect_reference_manifest" => {
                let source_path = required_str(payload, "sourcePath")?;
                self.inspect_reference_manifest(&source_path)
            }
            "portable.preview_reference_restore" => {
                let manifest =
                    required::<references::PortableReferenceManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                let group_mappings =
                    required::<Vec<references::PortableGroupIdMapping>>(payload, "groupMappings")?;
                self.preview_reference_restore(&manifest, &mappings, &group_mappings)
                    .await
            }
            "portable.restore_storage_group" => {
                let manifest =
                    required::<references::PortableReferenceManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                let source_group_id = required_str(payload, "sourceGroupId")?;
                self.restore_storage_group(&manifest, &mappings, &source_group_id)
                    .await
            }
            "portable.export_group_mapping" => {
                let destination_path = required_str(payload, "destinationPath")?;
                let manifest =
                    required::<references::PortableReferenceManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                let group_mappings =
                    required::<Vec<references::PortableGroupIdMapping>>(payload, "groupMappings")?;
                self.export_group_mapping(&destination_path, &manifest, &mappings, &group_mappings)
                    .await
            }
            "portable.inspect_group_mapping" => {
                let source_path = required_str(payload, "sourcePath")?;
                let expected_manifest_exported_at =
                    required_str(payload, "expectedManifestExportedAt")?;
                self.inspect_group_mapping(&source_path, &expected_manifest_exported_at)
            }
            "portable.restore_workflow" => {
                let manifest =
                    required::<references::PortableReferenceManifest>(payload, "manifest")?;
                let mappings = required::<Vec<PortableStorageIdMapping>>(payload, "mappings")?;
                let group_mappings =
                    required::<Vec<references::PortableGroupIdMapping>>(payload, "groupMappings")?;
                let source_workflow_id = required_str(payload, "sourceWorkflowId")?;
                self.restore_workflow(&manifest, &mappings, &group_mappings, &source_workflow_id)
                    .await
            }

            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("未知方法 {method}"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_matches_kernel_assembly_table() {
        let manifest = manifest();
        assert_eq!(manifest.id.as_str(), "portable-migration");
        assert_eq!(manifest.name, "迁移与备份");
        assert_eq!(manifest.description, "导出/恢复便携资产、引用、分组映射。");
        assert_eq!(manifest.permissions.len(), 2);
        assert!(
            manifest
                .permissions
                .iter()
                .any(|capability| matches!(capability, Capability::FsPaths))
        );
        assert!(
            manifest
                .permissions
                .iter()
                .any(|capability| matches!(capability, Capability::ReadAsset))
        );
        assert!(manifest.contributes.is_empty());
        assert!(matches!(manifest.kind, PluginKind::Native));
        assert!(manifest.default_enabled);
        assert_eq!(manifest.version, "2.0.0-dev.1");
    }
}
