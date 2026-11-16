//! 插件宿主（Plugin Host，ADR 0001–0004）。
//!
//! 持有内置插件实例与其清单，提供：注册、启用/禁用、贡献点查询、`plugin_invoke` 分发。
//! 本 crate 不接触 Tauri / SQLite；持久化开关在 P2 由调用方补齐，P1 以清单默认值为准。

use std::collections::BTreeMap;
use std::sync::Arc;

use kernel_api::{
    BuiltinPlugin, Contribution, ContributionPoint, InvokeErrorCode, ManifestError, PluginDescriptor,
    PluginId, PluginInvokeError, PluginKind, PluginManifestV2,
};
#[cfg(test)]
use kernel_api::PluginFailure;
use serde_json::Value;

/// 宿主装配错误。
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    #[error("plugin {0} is already registered")]
    DuplicatePlugin(String),
    #[error("builtin plugin {0} must declare kind=native")]
    NotNative(String),
    #[error("unknown plugin: {0}")]
    UnknownPlugin(String),
}

struct LoadedPlugin {
    manifest: PluginManifestV2,
    instance: Arc<dyn BuiltinPlugin>,
    enabled: bool,
}

/// 内置插件宿主。所有插件在构造时注册，运行时只做启用/禁用与分发。
#[derive(Default)]
pub struct PluginHost {
    plugins: BTreeMap<PluginId, LoadedPlugin>,
}

impl PluginHost {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册一个内置插件：校验清单 → 拒绝 `declarative` 实例 → 以 `default_enabled` 初始化开关。
    /// 重复 id 直接报错，不静默覆盖。
    pub fn register_builtin(&mut self, instance: Arc<dyn BuiltinPlugin>) -> Result<(), HostError> {
        let manifest = instance.manifest();
        manifest.validate()?;
        if manifest.kind != PluginKind::Native {
            return Err(HostError::NotNative(manifest.id.to_string()));
        }
        if self.plugins.contains_key(&manifest.id) {
            return Err(HostError::DuplicatePlugin(manifest.id.to_string()));
        }
        let enabled = manifest.default_enabled;
        let id = manifest.id.clone();
        self.plugins.insert(
            id,
            LoadedPlugin {
                manifest,
                instance,
                enabled,
            },
        );
        Ok(())
    }

    /// 一次性注册全部内置插件；任一失败则整体失败（P1 种子幂等、无部分状态）。
    pub fn register_all(&mut self, instances: Vec<Arc<dyn BuiltinPlugin>>) -> Result<(), HostError> {
        for instance in instances {
            self.register_builtin(instance)?;
        }
        Ok(())
    }

    pub fn is_enabled(&self, plugin_id: &str) -> bool {
        let Ok(id) = PluginId::new(plugin_id) else {
            return false;
        };
        self.plugins.get(&id).is_some_and(|plugin| plugin.enabled)
    }

    /// 切换开关；禁用只影响贡献点与调用，不删除插件数据。
    pub fn set_enabled(&mut self, plugin_id: &str, enabled: bool) -> Result<(), HostError> {
        let id = PluginId::new(plugin_id).map_err(HostError::Manifest)?;
        match self.plugins.get_mut(&id) {
            Some(plugin) => {
                plugin.enabled = enabled;
                Ok(())
            }
            None => Err(HostError::UnknownPlugin(plugin_id.to_string())),
        }
    }

    /// 已注册插件的只读列表（按 id 排序，含禁用项）。
    pub fn descriptors(&self) -> Vec<PluginDescriptor> {
        self.plugins
            .values()
            .map(|plugin| PluginDescriptor {
                id: plugin.manifest.id.to_string(),
                name: plugin.manifest.name.clone(),
                version: plugin.manifest.version.clone(),
                description: plugin.manifest.description.clone(),
                kind: plugin.manifest.kind,
                permissions: plugin.manifest.permissions.clone(),
                default_enabled: plugin.manifest.default_enabled,
                enabled: plugin.enabled,
                builtin: true,
                contributes: plugin.manifest.contributes.clone(),
            })
            .collect()
    }

    /// 某个贡献点的全部有效贡献（只包含已启用插件），保持注册顺序之外按插件 id 排序。
    pub fn contributions(&self, point: ContributionPoint) -> Vec<(PluginId, Contribution)> {
        let mut items = Vec::new();
        for (id, plugin) in &self.plugins {
            if !plugin.enabled {
                continue;
            }
            for contribution in &plugin.manifest.contributes {
                if contribution.point == point {
                    items.push((id.clone(), contribution.clone()));
                }
            }
        }
        items
    }

    /// `plugin_invoke` 分发：禁用 → `disabled`；未知插件 → `unknown_plugin`；
    /// 其余交给插件实例，失败时补齐插件 id 与方法名。
    pub fn invoke(
        &self,
        plugin_id: &str,
        method: &str,
        payload: &Value,
    ) -> Result<Value, PluginInvokeError> {
        let id = match PluginId::new(plugin_id) {
            Ok(id) => id,
            Err(_) => {
                return Err(PluginInvokeError::new(
                    plugin_id,
                    method,
                    InvokeErrorCode::UnknownPlugin,
                    "invalid plugin id",
                ))
            }
        };
        let Some(plugin) = self.plugins.get(&id) else {
            return Err(PluginInvokeError::new(
                plugin_id,
                method,
                InvokeErrorCode::UnknownPlugin,
                "plugin is not registered",
            ));
        };
        if !plugin.enabled {
            return Err(PluginInvokeError::new(
                plugin_id,
                method,
                InvokeErrorCode::Disabled,
                "plugin is disabled",
            ));
        }
        if method.trim().is_empty() || method.len() > 96 {
            return Err(PluginInvokeError::new(
                plugin_id,
                method,
                InvokeErrorCode::UnknownMethod,
                "invalid method name",
            ));
        }
        plugin
            .instance
            .invoke(method, payload)
            .map_err(|failure| {
                PluginInvokeError::new(plugin_id, method, failure.code, failure.message)
            })
    }

    /// 插件声明并被宿主信任的能力集合（P1 内置插件按清单声明视为已授予）。
    pub fn declared_capabilities(&self, plugin_id: &str) -> Vec<kernel_api::Capability> {
        let Ok(id) = PluginId::new(plugin_id) else {
            return Vec::new();
        };
        self.plugins
            .get(&id)
            .map(|plugin| plugin.manifest.permissions.clone())
            .unwrap_or_default()
    }

    /// 有效插件数（含禁用）。
    pub fn len(&self) -> usize {
        self.plugins.len()
    }

    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }

    /// 当前启用插件的 id 列表。
    pub fn enabled_ids(&self) -> Vec<String> {
        self.plugins
            .iter()
            .filter(|(_, plugin)| plugin.enabled)
            .map(|(id, _)| id.to_string())
            .collect()
    }

    /// 全部插件 id（含禁用）。
    pub fn ids(&self) -> Vec<String> {
        self.plugins.keys().map(ToString::to_string).collect()
    }
}

/// 测试辅助：一个只回显 payload 的内置插件。
#[cfg(test)]
pub(crate) struct EchoPlugin {
    pub id: &'static str,
}

#[cfg(test)]
impl BuiltinPlugin for EchoPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        PluginManifestV2 {
            api_version: 2,
            schema_version: 2,
            id: PluginId::new(self.id).unwrap(),
            name: "Echo".into(),
            version: "3.2.1".into(),
            description: "test plugin".into(),
            kind: PluginKind::Native,
            permissions: vec![kernel_api::Capability::ReadAsset],
            default_enabled: true,
            contributes: vec![Contribution {
                point: ContributionPoint::Page,
                id: "page.echo".into(),
                label: Some("Echo".into()),
                description: None,
            }],
            settings_schema: None,
        }
    }

    fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "echo.get" => Ok(payload.clone()),
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown method {method}"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_api::{ContributionPoint, InvokeErrorCode};
    use serde_json::json;
    use std::sync::Arc;

    fn host() -> PluginHost {
        let mut host = PluginHost::new();
        host.register_all(vec![
            Arc::new(EchoPlugin { id: "test-echo-a" }),
            Arc::new(EchoPlugin { id: "test-echo-b" }),
        ])
        .unwrap();
        host
    }

    #[test]
    fn registers_and_describes_builtin_plugins() {
        let host = host();
        assert_eq!(host.len(), 2);
        let descriptors = host.descriptors();
        assert_eq!(descriptors.len(), 2);
        assert!(descriptors.iter().all(|item| item.enabled && item.builtin));
        assert_eq!(host.contributions(ContributionPoint::Page).len(), 2);
    }

    #[test]
    fn invoke_dispatches_to_plugin() {
        let value = host().invoke("test-echo-a", "echo.get", &json!({"x": 1})).unwrap();
        assert_eq!(value, json!({"x": 1}));
    }

    #[test]
    fn invoke_reports_unknown_plugin_method_and_disabled() {
        let mut host = host();
        let error = host.invoke("missing-plugin", "echo.get", &json!({})).unwrap_err();
        assert_eq!(error.code, InvokeErrorCode::UnknownPlugin);
        let error = host.invoke("test-echo-a", "nope", &json!({})).unwrap_err();
        assert_eq!(error.code, InvokeErrorCode::UnknownMethod);
        host.set_enabled("test-echo-a", false).unwrap();
        let error = host.invoke("test-echo-a", "echo.get", &json!({})).unwrap_err();
        assert_eq!(error.code, InvokeErrorCode::Disabled);
        // 禁用后贡献点也消失。
        assert_eq!(host.contributions(ContributionPoint::Page).len(), 1);
    }

    #[test]
    fn duplicate_registration_is_rejected() {
        let mut host = host();
        let error = host
            .register_builtin(Arc::new(EchoPlugin { id: "test-echo-a" }))
            .unwrap_err();
        assert!(matches!(error, HostError::DuplicatePlugin(_)));
    }
}
