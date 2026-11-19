use std::sync::{Arc, OnceLock};

use persistence_sqlite::StorageRecord;
use provider_registry::{ProviderBuildContext, ProviderConstructor, ProviderRegistry};
use storage_core::StorageProvider;
use storage_opendal::{OpenDalStorage, S3Credentials, S3StorageConfig};

pub(crate) use provider_registry::CredentialReader;

/// 宿主侧兜底：`r2`/`s3` 的 S3 兼容后端（按设计留在宿主，不迁入插件）。
pub(crate) struct BuiltinS3Constructor;

impl ProviderConstructor for BuiltinS3Constructor {
    fn provider_keys(&self) -> &'static [&'static str] {
        &["r2", "s3"]
    }

    fn build(
        &self,
        context: &ProviderBuildContext<'_>,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        let config: S3StorageConfig = serde_json::from_value(context.record.config_json.clone())
            .map_err(|error| error.to_string())?;
        let credentials: S3Credentials = serde_json::from_value(
            context.credentials.read_json(
                context
                    .record
                    .credential_ref
                    .as_deref()
                    .ok_or("Storage credential reference missing")?,
            )?,
        )
        .map_err(|error| error.to_string())?;
        let provider_key = if context.record.provider_key == "r2" {
            "r2"
        } else {
            "s3"
        };
        Ok(Arc::new(
            OpenDalStorage::s3(provider_key, &config, &credentials)
                .map_err(|error| error.to_string())?,
        ))
    }
}

/// 全局注册表：宿主兜底 + 三个 provider 插件构造器。启动期构建一次，之后按 `Arc` 共享。
///
/// 返回 `Arc` 而不是 `&'static`，因为宿主既要用它构造 provider，也要把它注入 `reconcile`
/// 插件（插件实例持有 `Arc<ProviderRegistry>`）。
pub(crate) fn provider_registry() -> Arc<ProviderRegistry> {
    static REGISTRY: OnceLock<Arc<ProviderRegistry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| {
            let mut registry = ProviderRegistry::new();
            registry.register(Arc::new(BuiltinS3Constructor));
            registry.register(Arc::new(plugin_provider_github::GitHubProviderConstructor));
            registry.register(Arc::new(plugin_provider_gitee::GiteeProviderConstructor));
            registry.register(Arc::new(
                plugin_provider_opendal_extra::OpenDalExtraConstructor,
            ));
            Arc::new(registry)
        })
        .clone()
}

/// 构造存储后端；未注册的键由 `unsupported` 给出用户可见文案。
pub(crate) fn build_provider(
    credentials: &impl CredentialReader,
    record: &StorageRecord,
    unsupported: impl FnOnce(&str) -> String,
) -> Result<Arc<dyn StorageProvider>, String> {
    provider_registry().build(record, credentials, unsupported)
}

#[cfg(test)]
mod tests;
