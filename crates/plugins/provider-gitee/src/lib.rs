//! `provider-gitee` 内置插件：Gitee 仓库存储后端的构造与自述清单。
//!
//! 迁移自 `apps/desktop/src-tauri/src/services/provider_factory.rs` 的 `"gitee"`
//! 分支。迁移期 `provider_factory` 保留为查表薄壳（见 `crates/provider-registry`），
//! 构造代码的**单一实现**落在本 crate，行为与原分支逐字一致。

use std::sync::Arc;

use kernel_api::{
    BuiltinPlugin, Capability, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure,
    PluginId, PluginKind, PluginManifestV2,
};
use provider_registry::{ProviderBuildContext, ProviderConstructor};
use serde_json::Value;
use storage_core::StorageProvider;
use storage_gitee::{GiteeCredentials, GiteeStorage, GiteeStorageConfig};

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "provider-gitee";

pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("provider-gitee is a valid plugin id"),
        name: "Gitee 托管".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "把图片托管到 Gitee 仓库。".to_string(),
        kind: PluginKind::Native,
        permissions: vec![
            Capability::Network,
            Capability::Secret,
            Capability::ProviderConfig,
        ],
        default_enabled: true,
        contributes: vec![Contribution {
            point: ContributionPoint::Provider,
            id: "provider.gitee".to_string(),
            label: Some("Gitee".to_string()),
            description: None,
        }],
        settings_schema: None,
    }
}

/// Gitee 后端构造器：声明键 `gitee`，用 `GiteeStorageConfig` + `GiteeCredentials` 构造。
pub struct GiteeProviderConstructor;

impl ProviderConstructor for GiteeProviderConstructor {
    fn provider_keys(&self) -> &'static [&'static str] {
        &["gitee"]
    }

    fn build(
        &self,
        context: &ProviderBuildContext<'_>,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        let config: GiteeStorageConfig = serde_json::from_value(context.record.config_json.clone())
            .map_err(|error| error.to_string())?;
        let credentials: GiteeCredentials = serde_json::from_value(
            context.credentials.read_json(
                context
                    .record
                    .credential_ref
                    .as_deref()
                    .ok_or("Storage credential reference missing")?,
            )?,
        )
        .map_err(|error| error.to_string())?;
        Ok(Arc::new(GiteeStorage::new(config, credentials)))
    }
}

/// 插件实例：既暴露构造器（注册进 `ProviderRegistry`），也作为 `BuiltinPlugin`
/// 注册进 kernel（复用装配表已声明的 `provider.gitee` 贡献）。
///
/// 当前无自有 IPC 方法：调用任何方法返回 `unknown_method`，构造行为由
/// `ProviderRegistry` 承担。
pub struct ProviderGiteePlugin;

#[async_trait::async_trait]
impl BuiltinPlugin for ProviderGiteePlugin {
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
        assert_eq!(manifest.contributes.len(), 1);
        let contribution = &manifest.contributes[0];
        assert_eq!(contribution.point, ContributionPoint::Provider);
        assert_eq!(contribution.id, "provider.gitee");
    }

    #[test]
    fn constructor_declares_gitee_key() {
        assert_eq!(GiteeProviderConstructor.provider_keys(), &["gitee"]);
    }

    #[tokio::test]
    async fn plugin_reports_unknown_method() {
        let plugin = ProviderGiteePlugin;
        let failure = plugin.invoke("nope", &Value::Null).await;
        assert!(failure.is_err());
        assert_eq!(plugin.manifest().id.as_str(), PLUGIN_ID);
    }
}
