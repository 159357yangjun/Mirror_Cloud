//! 14 个内置插件的清单与实例（v1 唯一插件来源）。
//!
//! P1 只注册“结构”：贡献点与默认开关已生效，除 `diagnostics` 外的业务方法在 P2
//! 随代码迁移逐个落地；未实现的方法统一返回 `unknown_method`，不会伪造成功。

use std::sync::Arc;

use kernel_api::{
    BuiltinPlugin, Capability, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure,
    PluginId, PluginKind, PluginManifestV2,
};
use serde_json::Value;

fn contribution(point: ContributionPoint, id: &str, label: &str) -> Contribution {
    Contribution {
        point,
        id: id.to_string(),
        label: Some(label.to_string()),
        description: None,
    }
}

fn native(
    id: &str,
    name: &str,
    description: &str,
    permissions: Vec<Capability>,
    contributes: Vec<Contribution>,
) -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(id).expect("builtin plugin ids are constants"),
        name: name.to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: description.to_string(),
        kind: PluginKind::Native,
        permissions,
        default_enabled: true,
        contributes,
        settings_schema: None,
    }
}

/// 仅承载清单的内置插件：方法在 P2 落地前一律返回 `unknown_method`。
struct PendingPlugin {
    manifest: PluginManifestV2,
}

#[async_trait::async_trait]
impl BuiltinPlugin for PendingPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, _payload: &Value) -> Result<Value, PluginFailure> {
        Err(PluginFailure::new(
            InvokeErrorCode::UnknownMethod,
            format!(
                "method {method} lands with the P2 migration of {}",
                self.manifest.id
            ),
        ))
    }
}

/// `diagnostics` 是 P1 唯一的可调用种子插件：只为验证 `plugin_invoke` 全链路，
/// 返回静态状态，不读取用户数据。
struct DiagnosticsPlugin {
    manifest: PluginManifestV2,
}

#[async_trait::async_trait]
impl BuiltinPlugin for DiagnosticsPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, _payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "diagnostics.get" => Ok(serde_json::json!({
                "status": "ok",
                "kernel": "2.0.0-dev.1",
                "source": "builtin-diagnostics",
            })),
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown diagnostics method {method}"),
            )),
        }
    }
}

/// 全部内置插件的清单（按显示顺序；注册时仍按 id 排序）。
pub fn manifests() -> Vec<PluginManifestV2> {
    vec![
        native(
            "provider-github",
            "GitHub 托管",
            "把图片托管到 GitHub 仓库（jsDelivr 风格外链可选）。",
            vec![
                Capability::Network,
                Capability::Secret,
                Capability::ProviderConfig,
            ],
            vec![contribution(
                ContributionPoint::Provider,
                "provider.github",
                "GitHub",
            )],
        ),
        native(
            "provider-gitee",
            "Gitee 托管",
            "把图片托管到 Gitee 仓库。",
            vec![
                Capability::Network,
                Capability::Secret,
                Capability::ProviderConfig,
            ],
            vec![contribution(
                ContributionPoint::Provider,
                "provider.gitee",
                "Gitee",
            )],
        ),
        native(
            "provider-opendal-extra",
            "OpenDAL 额外后端",
            "OSS、COS 与 WebDAV 三类存储后端。",
            vec![
                Capability::Network,
                Capability::Secret,
                Capability::ProviderConfig,
            ],
            vec![
                contribution(ContributionPoint::Provider, "provider.oss", "阿里云 OSS"),
                contribution(ContributionPoint::Provider, "provider.cos", "腾讯云 COS"),
                contribution(ContributionPoint::Provider, "provider.webdav", "WebDAV"),
            ],
        ),
        native(
            "image-transform",
            "图片处理",
            "缩放、格式转换、质量与重命名模板。",
            vec![Capability::ReadAsset],
            vec![contribution(
                ContributionPoint::ImageOp,
                "image.resize",
                "缩放",
            )],
        ),
        native(
            "workflow",
            "工作流",
            "线性 Step 的润色、压缩、水印与路径模板。",
            vec![Capability::ReadAsset],
            vec![contribution(
                ContributionPoint::Page,
                "page.workflows",
                "工作流",
            )],
        ),
        native(
            "publish-strategy",
            "发布策略",
            "单目标发布、主备镜像、镜像全部与云端修复。",
            vec![Capability::ReadAsset, Capability::ProviderConfig],
            vec![
                contribution(ContributionPoint::Page, "page.publish", "发布"),
                contribution(
                    ContributionPoint::PublishStrategy,
                    "strategy.primary",
                    "主备镜像",
                ),
            ],
        ),
        native(
            "reconcile",
            "索引对账",
            "云端文件与本地索引的对账扫描。",
            vec![Capability::Network],
            vec![],
        ),
        native(
            "cloud-browser",
            "云端文件浏览",
            "浏览、移动、删除云端文件并同步专辑索引。",
            vec![Capability::Network],
            vec![contribution(
                ContributionPoint::Page,
                "page.gallery",
                "云端文件",
            )],
        ),
        native(
            "portable-migration",
            "迁移与备份",
            "导出/恢复便携资产、引用、分组映射。",
            vec![Capability::FsPaths, Capability::ReadAsset],
            vec![],
        ),
        native(
            "task-console",
            "任务中心",
            "任务列表、取消、重试与批量队列。",
            vec![],
            vec![contribution(ContributionPoint::Page, "page.tasks", "任务")],
        ),
        native(
            "integrations-os",
            "系统集成",
            "Typora、全局快捷键、右键菜单与 Local HTTP API。",
            vec![Capability::FsPaths],
            vec![contribution(
                ContributionPoint::TrayItem,
                "tray.integrations",
                "系统集成",
            )],
        ),
        native(
            "ai-assistant",
            "AI 助手",
            "设置 AI 提供方并规划上传工作流。",
            vec![Capability::Network, Capability::Secret],
            vec![contribution(
                ContributionPoint::Settings,
                "settings.ai",
                "AI 助手",
            )],
        ),
        native(
            "themes",
            "主题与皮肤",
            "内置主题与配色变量。",
            vec![],
            vec![contribution(
                ContributionPoint::Settings,
                "settings.theme",
                "外观",
            )],
        ),
        native(
            "diagnostics",
            "诊断",
            "系统诊断与环境信息。",
            vec![],
            vec![],
        ),
    ]
}

/// 生产入口：按 [`manifests`] 的顺序返回可注册实例。
pub fn instances() -> Vec<Arc<dyn BuiltinPlugin>> {
    manifests()
        .into_iter()
        .map(|manifest| {
            let id = manifest.id.to_string();
            let instance: Arc<dyn BuiltinPlugin> = if id == "diagnostics" {
                Arc::new(DiagnosticsPlugin { manifest })
            } else {
                Arc::new(PendingPlugin { manifest })
            };
            instance
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_api::PluginKind;

    #[test]
    fn manifests_are_valid_and_complete() {
        let items = manifests();
        assert_eq!(items.len(), 14);
        for manifest in &items {
            manifest.validate().expect("builtin manifest must validate");
            assert_eq!(manifest.kind, PluginKind::Native);
            assert!(manifest.default_enabled);
        }
    }

    #[test]
    fn instances_cover_every_manifest() {
        assert_eq!(instances().len(), manifests().len());
    }
}
