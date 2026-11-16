//! 内核装配根（ADR 0001）。
//!
//! P1 职责：把 14 个内置插件按清单注册进宿主，并提供内核自有的贡献查询
//! （存储 provider 归属）。存储构造、发布闭环等真实内核代码仍在既有 crate 中，
//! P2 起逐步迁入。本 crate 刻意不依赖 Tauri / SQLite。

pub mod builtin;

use kernel_api::{ContributionPoint, PluginDescriptor, PluginId, PluginInvokeError};
use plugin_host::{HostError, PluginHost};
use serde_json::Value;

/// 内核的运行时入口：持有插件宿主，并回答“某个 provider_key 归谁管”。
pub struct Kernel {
    host: PluginHost,
}

impl Kernel {
    /// 用显式实例构造（测试与未来动态插件用）。
    pub fn new(instances: Vec<std::sync::Arc<dyn kernel_api::BuiltinPlugin>>) -> Result<Self, HostError> {
        let mut host = PluginHost::new();
        host.register_all(instances)?;
        Ok(Self { host })
    }

    /// 生产入口：注册全部内置插件（v1 唯一的插件来源）。
    pub fn with_builtin_plugins() -> Result<Self, HostError> {
        Self::new(builtin::instances())
    }

    pub fn host(&self) -> &PluginHost {
        &self.host
    }

    pub fn invoke(
        &self,
        plugin_id: &str,
        method: &str,
        payload: &Value,
    ) -> Result<Value, PluginInvokeError> {
        self.host.invoke(plugin_id, method, payload)
    }

    pub fn descriptors(&self) -> Vec<PluginDescriptor> {
        self.host.descriptors()
    }

    /// provider_key（`r2`/`s3`/`github`…）→ 归属插件 id；`None` 表示内核自有实现。
    /// 依据贡献 id 约定 `provider.<key>`，不做字符串前缀推断之外的假设。
    pub fn provider_owner(&self, provider_key: &str) -> Option<PluginId> {
        let expected = format!("provider.{provider_key}");
        self.host
            .contributions(ContributionPoint::Provider)
            .into_iter()
            .find(|(_, contribution)| contribution.id == expected)
            .map(|(plugin_id, _)| plugin_id)
    }

    /// 某个贡献点的有效贡献（已启用插件）。
    pub fn contributions(&self, point: ContributionPoint) -> Vec<(PluginId, kernel_api::Contribution)> {
        self.host.contributions(point)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_api::ContributionPoint;

    #[test]
    fn builtin_set_is_complete_and_unique() {
        let kernel = Kernel::with_builtin_plugins().unwrap();
        assert_eq!(kernel.host().len(), 14);
        let ids = kernel.host().ids();
        let unique: std::collections::BTreeSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), unique.len());
        assert!(ids.contains(&"diagnostics".to_string()));
        assert!(ids.contains(&"provider-github".to_string()));
    }

    #[test]
    fn provider_ownership_maps_to_plugins() {
        let kernel = Kernel::with_builtin_plugins().unwrap();
        assert_eq!(kernel.provider_owner("r2"), None); // 内核自有 S3 兼容实现
        assert_eq!(kernel.provider_owner("s3"), None);
        assert_eq!(
            kernel.provider_owner("github").map(|id| id.to_string()),
            Some("provider-github".to_string())
        );
        assert_eq!(
            kernel.provider_owner("webdav").map(|id| id.to_string()),
            Some("provider-opendal-extra".to_string())
        );
    }

    #[test]
    fn page_contributions_are_registered() {
        let kernel = Kernel::with_builtin_plugins().unwrap();
        let pages = kernel.contributions(ContributionPoint::Page);
        let ids: Vec<_> = pages.iter().map(|(_, item)| item.id.as_str()).collect();
        assert!(ids.contains(&"page.gallery"));
        assert!(ids.contains(&"page.tasks"));
        assert!(ids.contains(&"page.workflows"));
        assert!(ids.contains(&"page.publish"));
    }

    #[test]
    fn diagnostics_plugin_answers_its_own_method() {
        let kernel = Kernel::with_builtin_plugins().unwrap();
        let value = kernel
            .invoke("diagnostics", "diagnostics.get", &serde_json::json!({}))
            .unwrap();
        assert_eq!(value["status"], "ok");
    }
}
