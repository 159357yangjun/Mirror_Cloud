//! Provider 工厂注册表：把存储后端构造能力从宿主硬编码改为可注册的构造器。
//!
//! 背景（`docs/adr/0003-command-dispatch.md` 与 `docs/PLUGIN_FIRST_ARCHITECTURE.md` P2）：
//! `apps/desktop/src-tauri/src/services/provider_factory.rs` 曾用 `match provider_key`
//! 硬编码全部后端。抽取后：
//! - 宿主保留 `r2`/`s3` 兜底构造器（`provider_factory::BuiltinS3Constructor`）；
//! - `github`/`gitee`/`oss`/`cos`/`webdav` 的构造代码搬入各自的插件 crate
//!   （`crates/plugins/provider-*`），以 `ProviderConstructor` 实现注册；
//! - `ProviderRegistry` 只负责按 `provider_key` 查表与转发，错误文案仍由调用方给出，
//!   保持 `commands.rs`（"is not wired in this build"）与 `cli.rs`
//!   （"is not supported by the Typora bridge"）的用户可见文案不变。

use std::collections::BTreeMap;
use std::sync::Arc;

use credential_store::CredentialStore;
use persistence_sqlite::StorageRecord;
use storage_core::StorageProvider;

/// 按引用读取凭据（离线测试可绕开操作系统凭据库）。
///
/// 返回原始 JSON 值：泛型方法会让 `CredentialReader` 失去 dyn 兼容性，
/// 而构造器注册表需要持有 `&dyn CredentialReader`，故由调用方自行反序列化。
pub trait CredentialReader {
    fn read_json(&self, reference: &str) -> Result<serde_json::Value, String>;
}

impl CredentialReader for CredentialStore {
    fn read_json(&self, reference: &str) -> Result<serde_json::Value, String> {
        self.get_json(reference).map_err(|error| error.to_string())
    }
}

/// 一次构造所需的上下文：存储记录 + 凭据读取器。
pub struct ProviderBuildContext<'a> {
    pub record: &'a StorageRecord,
    pub credentials: &'a dyn CredentialReader,
}

/// 一个构造器可声明并构造多个后端键。
pub trait ProviderConstructor: Send + Sync {
    fn provider_keys(&self) -> &'static [&'static str];

    fn build(&self, context: &ProviderBuildContext<'_>)
    -> Result<Arc<dyn StorageProvider>, String>;
}

/// 按 `provider_key` 查表的构造器集合。
pub struct ProviderRegistry {
    constructors: BTreeMap<&'static str, Arc<dyn ProviderConstructor>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            constructors: BTreeMap::new(),
        }
    }

    /// 注册一个构造器；它声明的每个键都映射到同一实例。
    pub fn register(&mut self, constructor: Arc<dyn ProviderConstructor>) {
        for key in constructor.provider_keys() {
            self.constructors.insert(key, Arc::clone(&constructor));
        }
    }

    /// 已注册的后端键（有序）。
    pub fn provider_keys(&self) -> Vec<&'static str> {
        self.constructors.keys().copied().collect()
    }

    /// 按记录构造后端；未注册的键交回调生成错误文案。
    ///
    /// 凭据引用先于查表校验，与迁移前 `provider_factory::build_provider` 的行为一致：
    /// 引用缺失时返回 `Storage credential reference missing`，而不是未注册键的错误文案。
    pub fn build(
        &self,
        record: &StorageRecord,
        credentials: &dyn CredentialReader,
        unsupported: impl FnOnce(&str) -> String,
    ) -> Result<Arc<dyn StorageProvider>, String> {
        if record.credential_ref.as_deref().is_none() {
            return Err("Storage credential reference missing".to_string());
        }
        let context = ProviderBuildContext {
            record,
            credentials,
        };
        match self.constructors.get(record.provider_key.as_str()) {
            Some(constructor) => constructor.build(&context),
            None => Err(unsupported(&record.provider_key)),
        }
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_sqlite::StorageRecord;
    use serde_json::json;
    use storage_core::StorageProvider;

    struct StubCredentials;

    impl CredentialReader for StubCredentials {
        fn read_json(&self, _reference: &str) -> Result<serde_json::Value, String> {
            Err("stub".to_string())
        }
    }

    struct FixedConstructor;

    impl ProviderConstructor for FixedConstructor {
        fn provider_keys(&self) -> &'static [&'static str] {
            &["fixed-a", "fixed-b"]
        }

        fn build(
            &self,
            _context: &ProviderBuildContext<'_>,
        ) -> Result<Arc<dyn StorageProvider>, String> {
            Ok(Arc::new(StubProvider))
        }
    }

    struct StubProvider;

    #[async_trait::async_trait]
    impl StorageProvider for StubProvider {
        fn provider_key(&self) -> &'static str {
            "stub"
        }

        fn capabilities(&self) -> domain::StorageCapabilities {
            domain::StorageCapabilities::default()
        }

        async fn test_connection(
            &self,
        ) -> Result<storage_core::ConnectionReport, storage_core::StorageError> {
            Ok(storage_core::ConnectionReport {
                reachable: true,
                detail: "stub".to_string(),
            })
        }

        async fn upload(
            &self,
            _request: storage_core::UploadRequest,
        ) -> Result<storage_core::UploadResult, storage_core::StorageError> {
            Err(storage_core::StorageError::Unsupported)
        }

        async fn delete(&self, _path: &str) -> Result<(), storage_core::StorageError> {
            Err(storage_core::StorageError::Unsupported)
        }
    }

    fn record(key: &str) -> StorageRecord {
        StorageRecord {
            id: uuid::Uuid::nil(),
            name: "stub".to_string(),
            provider_key: key.to_string(),
            category: "test".to_string(),
            credential_ref: Some("ref".to_string()),
            config_json: json!({}),
            capabilities_json: json!({}),
            enabled: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn one_constructor_registers_all_its_keys() {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(FixedConstructor));
        assert_eq!(registry.provider_keys(), vec!["fixed-a", "fixed-b"]);
        for key in ["fixed-a", "fixed-b"] {
            let provider = registry
                .build(&record(key), &StubCredentials, |key| format!("no {key}"))
                .unwrap();
            assert!(Arc::strong_count(&provider) >= 1);
        }
    }

    #[test]
    fn unknown_key_uses_caller_message() {
        let registry = ProviderRegistry::new();
        let error = registry
            .build(&record("nope"), &StubCredentials, |key| {
                format!("Provider {key} is not wired")
            })
            .err()
            .unwrap();
        assert_eq!(error, "Provider nope is not wired");
    }

    #[test]
    fn missing_credential_ref_fails_before_lookup() {
        let mut record = record("fixed-a");
        record.credential_ref = None;
        let registry = ProviderRegistry::new();
        let error = registry
            .build(&record, &StubCredentials, |_| "x".to_string())
            .err()
            .unwrap();
        assert_eq!(error, "Storage credential reference missing");
    }
}
