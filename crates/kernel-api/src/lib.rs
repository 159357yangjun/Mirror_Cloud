//! 内核契约层（Kernel Contract，ADR 0001–0004）。
//!
//! 只放纯数据类型：插件清单 v2、贡献点、能力、调用结果。
//! 绝不依赖任何具体插件、存储实现或 Tauri，避免宿主与提供者互相耦合。

use std::collections::BTreeSet;
use std::fmt;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 清单 v2 的 `api_version` 与 `schema_version`（两者当前同值、各自演进）。
pub const MANIFEST_API_VERSION: u32 = 2;
pub const MANIFEST_SCHEMA_VERSION: u32 = 2;

/// 单个清单允许的最大贡献项、设置 schema 的最大序列化字节数。
pub const MAX_CONTRIBUTIONS: usize = 64;
pub const MAX_SETTINGS_SCHEMA_BYTES: usize = 64 * 1024;

/// 插件 id：`^[a-z][a-z0-9.-]{2,63}$`，例如 `provider-github`。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PluginId(String);

impl PluginId {
    pub fn new(value: impl Into<String>) -> Result<Self, ManifestError> {
        let value = value.into();
        let mut chars = value.chars();
        let starts_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase());
        let rest_ok =
            chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.');
        if !starts_ok || !rest_ok || !(3..=64).contains(&value.len()) {
            return Err(ManifestError::InvalidId(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PluginId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl AsRef<str> for PluginId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Serialize for PluginId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for PluginId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::new(raw).map_err(serde::de::Error::custom)
    }
}

/// 插件形态。v1 只加载内置插件，`wasm` 仅为未来预留，宿主会拒绝。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    #[default]
    Declarative,
    Native,
    Wasm,
}

impl PluginKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Declarative => "declarative",
            Self::Native => "native",
            Self::Wasm => "wasm",
        }
    }
}

/// 宿主可授予的能力。插件只能使用清单里声明、且被用户授予的能力。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    ReadAsset,
    ReadSettings,
    WriteSettings,
    Network,
    Secret,
    FsPaths,
    ProviderConfig,
    ExternalWrite,
}

impl Capability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadAsset => "read_asset",
            Self::ReadSettings => "read_settings",
            Self::WriteSettings => "write_settings",
            Self::Network => "network",
            Self::Secret => "secret",
            Self::FsPaths => "fs_paths",
            Self::ProviderConfig => "provider_config",
            Self::ExternalWrite => "external_write",
        }
    }
}

/// 贡献点白名单（ADR 0002 的 9 键）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContributionPoint {
    Provider,
    ImageOp,
    WorkflowStep,
    Hook,
    Settings,
    Page,
    Command,
    PublishStrategy,
    TrayItem,
}

impl ContributionPoint {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Provider => "provider",
            Self::ImageOp => "image_op",
            Self::WorkflowStep => "workflow_step",
            Self::Hook => "hook",
            Self::Settings => "settings",
            Self::Page => "page",
            Self::Command => "command",
            Self::PublishStrategy => "publish_strategy",
            Self::TrayItem => "tray_item",
        }
    }

    /// 贡献点的 id 命名空间前缀（`provider.r2`、`page.uploads` …）。
    pub fn id_prefix(self) -> &'static str {
        match self {
            Self::Provider => "provider",
            Self::ImageOp => "image",
            Self::WorkflowStep => "workflow",
            Self::Hook => "hook",
            Self::Settings => "settings",
            Self::Page => "page",
            Self::Command => "command",
            Self::PublishStrategy => "strategy",
            Self::TrayItem => "tray",
        }
    }
}

/// 一条贡献。`id` 在贡献点内唯一，形如 `page.gallery`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    pub point: ContributionPoint,
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// 插件清单 v2。`contributes` 只允许白名单贡献点；字段与 ADR 0002 一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifestV2 {
    pub api_version: u32,
    pub schema_version: u32,
    pub id: PluginId,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub kind: PluginKind,
    #[serde(default)]
    pub permissions: Vec<Capability>,
    /// 首次安装后的默认开关；禁用只注销贡献，不删除数据。
    #[serde(default)]
    pub default_enabled: bool,
    #[serde(default)]
    pub contributes: Vec<Contribution>,
    #[serde(default)]
    pub settings_schema: Option<Value>,
}

/// 清单校验错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    #[error("plugin id is invalid: {0}")]
    InvalidId(String),
    #[error("manifest field is invalid: {0}")]
    InvalidField(&'static str),
    #[error("unsupported api_version/schema_version: {0}/{1}")]
    UnsupportedVersion(u32, u32),
    #[error("too many contributions (limit {MAX_CONTRIBUTIONS})")]
    TooManyContributions,
    #[error("duplicate contribution id: {0}")]
    DuplicateContribution(String),
    #[error("contribution id is invalid: {0}")]
    InvalidContributionId(String),
    #[error("duplicate capability: {0}")]
    DuplicateCapability(String),
    #[error("settings_schema is too large")]
    SettingsSchemaTooLarge,
}

fn valid_contribution_id(value: &str) -> bool {
    let mut chars = value.chars();
    let starts_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_ok = chars
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.' || c == '-');
    starts_ok && rest_ok && (2..=96).contains(&value.len())
}

impl PluginManifestV2 {
    /// 结构性校验：版本、命名、贡献点唯一性、能力去重、设置 schema 体积。
    /// 形态约束（`native` 必须随构建编入）由宿主在注册时另行判定。
    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.api_version != MANIFEST_API_VERSION
            || self.schema_version != MANIFEST_SCHEMA_VERSION
        {
            return Err(ManifestError::UnsupportedVersion(
                self.api_version,
                self.schema_version,
            ));
        }
        if self.name.trim().is_empty() || self.name.len() > 120 {
            return Err(ManifestError::InvalidField("name"));
        }
        if self.version.trim().is_empty() || self.version.len() > 64 {
            return Err(ManifestError::InvalidField("version"));
        }
        if self.contributions_len() > MAX_CONTRIBUTIONS {
            return Err(ManifestError::TooManyContributions);
        }
        if self.kind == PluginKind::Wasm {
            // v1 不装载磁盘代码；WASM 留给 v2，清单阶段先拒绝，避免误判为已支持。
            return Err(ManifestError::InvalidField(
                "kind=wasm is not supported in v1",
            ));
        }

        let mut contribution_ids = BTreeSet::new();
        for contribution in &self.contributes {
            if !valid_contribution_id(&contribution.id) {
                return Err(ManifestError::InvalidContributionId(
                    contribution.id.clone(),
                ));
            }
            let unique = format!("{}.{}", contribution.point.id_prefix(), contribution.id);
            if !contribution_ids.insert(unique.clone()) {
                return Err(ManifestError::DuplicateContribution(unique));
            }
        }

        let mut capabilities = BTreeSet::new();
        for capability in &self.permissions {
            if !capabilities.insert(capability.as_str()) {
                return Err(ManifestError::DuplicateCapability(
                    capability.as_str().into(),
                ));
            }
        }

        if let Some(schema) = &self.settings_schema {
            let bytes =
                serde_json::to_vec(schema).map_err(|_| ManifestError::SettingsSchemaTooLarge)?;
            if bytes.len() > MAX_SETTINGS_SCHEMA_BYTES {
                return Err(ManifestError::SettingsSchemaTooLarge);
            }
        }
        Ok(())
    }

    fn contributions_len(&self) -> usize {
        self.contributes.len()
    }
}

/// 调用失败码（ADR 0003 的 6 个固定值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvokeErrorCode {
    Disabled,
    UnknownPlugin,
    UnknownMethod,
    PermissionDenied,
    InvalidPayload,
    Timeout,
    Internal,
}

impl InvokeErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::UnknownPlugin => "unknown_plugin",
            Self::UnknownMethod => "unknown_method",
            Self::PermissionDenied => "permission_denied",
            Self::InvalidPayload => "invalid_payload",
            Self::Timeout => "timeout",
            Self::Internal => "internal",
        }
    }
}

/// 插件侧返回的失败（不含插件名，由宿主补齐）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFailure {
    pub code: InvokeErrorCode,
    pub message: String,
}

impl PluginFailure {
    pub fn new(code: InvokeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// 宿主返回给前端的统一错误。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInvokeError {
    pub plugin_id: String,
    pub method: String,
    pub code: InvokeErrorCode,
    pub message: String,
}

impl PluginInvokeError {
    pub fn new(
        plugin_id: impl Into<String>,
        method: impl Into<String>,
        code: InvokeErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            plugin_id: plugin_id.into(),
            method: method.into(),
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for PluginInvokeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "plugin {} method {} failed: {} ({})",
            self.plugin_id,
            self.method,
            self.message,
            self.code.as_str()
        )
    }
}

impl std::error::Error for PluginInvokeError {}

/// 已注册插件对 UI 的只读描述。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub kind: PluginKind,
    pub permissions: Vec<Capability>,
    pub default_enabled: bool,
    pub enabled: bool,
    pub builtin: bool,
    pub contributes: Vec<Contribution>,
}

/// 内置插件必须实现的宿主契约：声明清单 + 处理 `plugin_invoke` 的方法调用。
///
/// 插件实例在构造期注入仓储/凭据等服务句柄，方法本身是异步的（数据库与网络都在
/// 异步侧）；宿主 `plugin_invoke` 直接 await，不阻塞 Tauri 命令线程。
#[async_trait]
pub trait BuiltinPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifestV2;

    /// 方法名约定 `<domain>.<verb>`，例如 `diagnostics.get`；未知方法返回 `unknown_method`。
    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest() -> PluginManifestV2 {
        PluginManifestV2 {
            api_version: 2,
            schema_version: 2,
            id: PluginId::new("provider-github").unwrap(),
            name: "GitHub 托管".into(),
            version: "1.0.0".into(),
            description: String::new(),
            kind: PluginKind::Native,
            permissions: vec![
                Capability::Network,
                Capability::Secret,
                Capability::ProviderConfig,
            ],
            default_enabled: true,
            contributes: vec![Contribution {
                point: ContributionPoint::Provider,
                id: "provider.github".into(),
                label: Some("GitHub".into()),
                description: None,
            }],
            settings_schema: Some(json!({"type": "object"})),
        }
    }

    #[test]
    fn accepts_valid_manifest() {
        manifest().validate().unwrap();
    }

    #[test]
    fn rejects_wrong_versions() {
        let mut item = manifest();
        item.api_version = 1;
        assert!(matches!(
            item.validate(),
            Err(ManifestError::UnsupportedVersion(1, 2))
        ));
    }

    #[test]
    fn rejects_wasm_kind_in_v1() {
        let mut item = manifest();
        item.kind = PluginKind::Wasm;
        assert!(item.validate().is_err());
    }

    #[test]
    fn rejects_duplicate_contributions() {
        let mut item = manifest();
        let duplicate = item.contributes[0].clone();
        item.contributes.push(duplicate);
        assert!(matches!(
            item.validate(),
            Err(ManifestError::DuplicateContribution(_))
        ));
    }

    #[test]
    fn rejects_duplicate_capabilities() {
        let mut item = manifest();
        item.permissions.push(Capability::Network);
        assert!(matches!(
            item.validate(),
            Err(ManifestError::DuplicateCapability(_))
        ));
    }

    #[test]
    fn plugin_id_validation() {
        assert!(PluginId::new("provider-github").is_ok());
        assert!(PluginId::new("Provider").is_err());
        assert!(PluginId::new("ab").is_err());
        assert!(PluginId::new("bad id").is_err());
    }

    #[test]
    fn manifest_roundtrips_through_json() {
        let item = manifest();
        let encoded = serde_json::to_string(&item).unwrap();
        let decoded: PluginManifestV2 = serde_json::from_str(&encoded).unwrap();
        decoded.validate().unwrap();
        assert_eq!(decoded.id.as_str(), "provider-github");
    }
}
