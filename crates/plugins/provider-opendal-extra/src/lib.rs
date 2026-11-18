//! `provider-opendal-extra` 内置插件：OSS、COS 与 WebDAV 三类存储后端的构造与自述清单。
//!
//! 迁移自 `apps/desktop/src-tauri/src/services/provider_factory.rs` 的
//! `"oss"` / `"cos"` / `"webdav"` 三个分支。迁移期 `provider_factory` 保留为查表
//! 薄壳（见 `crates/provider-registry`），构造代码的**单一实现**落在本 crate，
//! 行为与原分支逐字一致。`r2`/`s3` 的 S3 兼容兜底按设计留在宿主侧。

use std::sync::Arc;

use kernel_api::{
    BuiltinPlugin, Capability, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure,
    PluginId, PluginKind, PluginManifestV2,
};
use provider_registry::{ProviderBuildContext, ProviderConstructor};
use serde_json::Value;
use storage_core::StorageProvider;
use storage_opendal::{
    CosCredentials, CosStorageConfig, OpenDalStorage, OssCredentials, OssStorageConfig,
    WebDavCredentials, WebDavStorageConfig,
};

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "provider-opendal-extra";

pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("provider-opendal-extra is a valid plugin id"),
        name: "OpenDAL 额外后端".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "OSS、COS 与 WebDAV 三类存储后端。".to_string(),
        kind: PluginKind::Native,
        permissions: vec![
            Capability::Network,
            Capability::Secret,
            Capability::ProviderConfig,
        ],
        default_enabled: true,
        contributes: vec![
            Contribution {
                point: ContributionPoint::Provider,
                id: "provider.oss".to_string(),
                label: Some("阿里云 OSS".to_string()),
                description: None,
            },
            Contribution {
                point: ContributionPoint::Provider,
                id: "provider.cos".to_string(),
                label: Some("腾讯云 COS".to_string()),
                description: None,
            },
            Contribution {
                point: ContributionPoint::Provider,
                id: "provider.webdav".to_string(),
                label: Some("WebDAV".to_string()),
                description: None,
            },
        ],
        settings_schema: None,
    }
}

/// OSS / COS / WebDAV 后端构造器：声明三个键，按 `provider_key` 分发。
pub struct OpenDalExtraConstructor;

impl ProviderConstructor for OpenDalExtraConstructor {
    fn provider_keys(&self) -> &'static [&'static str] {
        &["oss", "cos", "webdav"]
    }

    fn build(
        &self,
        context: &ProviderBuildContext<'_>,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        let credential_ref = context
            .record
            .credential_ref
            .as_deref()
            .ok_or("Storage credential reference missing")?;
        match context.record.provider_key.as_str() {
            "oss" => {
                let config: OssStorageConfig =
                    serde_json::from_value(context.record.config_json.clone())
                        .map_err(|error| error.to_string())?;
                let credentials: OssCredentials =
                    serde_json::from_value(context.credentials.read_json(credential_ref)?)
                        .map_err(|error| error.to_string())?;
                Ok(Arc::new(
                    OpenDalStorage::oss(&config, &credentials)
                        .map_err(|error| error.to_string())?,
                ))
            }
            "cos" => {
                let config: CosStorageConfig =
                    serde_json::from_value(context.record.config_json.clone())
                        .map_err(|error| error.to_string())?;
                let credentials: CosCredentials =
                    serde_json::from_value(context.credentials.read_json(credential_ref)?)
                        .map_err(|error| error.to_string())?;
                Ok(Arc::new(
                    OpenDalStorage::cos(&config, &credentials)
                        .map_err(|error| error.to_string())?,
                ))
            }
            "webdav" => {
                let config: WebDavStorageConfig =
                    serde_json::from_value(context.record.config_json.clone())
                        .map_err(|error| error.to_string())?;
                let credentials: WebDavCredentials =
                    serde_json::from_value(context.credentials.read_json(credential_ref)?)
                        .map_err(|error| error.to_string())?;
                Ok(Arc::new(
                    OpenDalStorage::webdav(&config, &credentials)
                        .map_err(|error| error.to_string())?,
                ))
            }
            other => Err(format!(
                "provider-opendal-extra cannot construct provider {other}"
            )),
        }
    }
}

/// 插件实例：既暴露构造器（注册进 `ProviderRegistry`），也作为 `BuiltinPlugin`
/// 注册进 kernel（复用装配表已声明的 `provider.oss`/`provider.cos`/`provider.webdav` 贡献）。
///
/// 当前无自有 IPC 方法：调用任何方法返回 `unknown_method`，构造行为由
/// `ProviderRegistry` 承担。
pub struct ProviderOpenDalExtraPlugin;

#[async_trait::async_trait]
impl BuiltinPlugin for ProviderOpenDalExtraPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        manifest()
    }

    async fn invoke(&self, method: &str, _payload: &Value) -> Result<Value, PluginFailure> {
        Err(PluginFailure::new(
            InvokeErrorCode::UnknownMethod,
            format!("method {method} lands with the P2 migration of {PLUGIN_ID}"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_matches_kernel_assembly() {
        let manifest = manifest();
        assert_eq!(manifest.id.as_str(), PLUGIN_ID);
        assert_eq!(manifest.kind, PluginKind::Native);
        assert!(manifest.default_enabled);
        assert_eq!(manifest.contributes.len(), 3);
        let ids: Vec<&str> = manifest.contributes.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["provider.oss", "provider.cos", "provider.webdav"]);
    }

    #[test]
    fn constructor_declares_three_keys() {
        assert_eq!(
            OpenDalExtraConstructor.provider_keys(),
            &["oss", "cos", "webdav"]
        );
    }

    #[tokio::test]
    async fn plugin_reports_unknown_method() {
        let plugin = ProviderOpenDalExtraPlugin;
        let failure = plugin.invoke("nope", &Value::Null).await;
        assert!(failure.is_err());
        assert_eq!(plugin.manifest().id.as_str(), PLUGIN_ID);
    }
}
