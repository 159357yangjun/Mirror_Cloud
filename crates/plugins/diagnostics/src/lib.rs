//! `diagnostics` 内置插件：P2 第一个真实实现（ADR 0005）。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands/integrations.rs` 的
//! `get_system_diagnostics`：读取仓储计数、Local API 状态与数据目录，
//! 组装与 `SystemDiagnosticsView` 同形的 JSON（camelCase）。逻辑单份，命令侧只做反序列化。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use kernel_api::{
    BuiltinPlugin, InvokeErrorCode, PluginFailure, PluginId, PluginKind, PluginManifestV2,
};
use persistence_sqlite::{PluginRepository, StorageRepository, WorkflowRepository};
use serde_json::{Value, json};
use task_engine::TaskEngine;

/// 本插件对外的清单 id（与 `crates/kernel/src/builtin.rs` 的装配表一致）。
pub const PLUGIN_ID: &str = "diagnostics";

/// 插件的清单（清单校验由宿主在注册时执行；替换占位实例时 id 必须一致）。
pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("diagnostics is a valid plugin id"),
        name: "诊断".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "系统诊断与环境信息。".to_string(),
        kind: PluginKind::Native,
        permissions: Vec::new(),
        default_enabled: true,
        contributes: Vec::new(),
        settings_schema: None,
    }
}

/// 诊断插件：构造期注入仓储与运行态句柄，方法直接 `await`，不接收 context 参数。
pub struct DiagnosticsPlugin {
    storages: StorageRepository,
    plugins: PluginRepository,
    workflows: WorkflowRepository,
    tasks: TaskEngine,
    data_dir: PathBuf,
    local_api_running: Arc<AtomicBool>,
    app_version: String,
    manifest: PluginManifestV2,
}

impl DiagnosticsPlugin {
    pub fn new(
        storages: StorageRepository,
        plugins: PluginRepository,
        workflows: WorkflowRepository,
        tasks: TaskEngine,
        data_dir: PathBuf,
        local_api_running: Arc<AtomicBool>,
        app_version: String,
    ) -> Self {
        Self {
            storages,
            plugins,
            workflows,
            tasks,
            data_dir,
            local_api_running,
            app_version,
            manifest: manifest(),
        }
    }

    /// `diagnostics.get`：与 1.4.16 的 `get_system_diagnostics` 逐字段对齐。
    async fn get(&self) -> Result<Value, PluginFailure> {
        let storages = self
            .storages
            .list()
            .await
            .map_err(|error| internal(error.to_string()))?;
        let plugins = self
            .plugins
            .list()
            .await
            .map_err(|error| internal(error.to_string()))?;
        let tasks = self
            .tasks
            .list(10_000)
            .await
            .map_err(|error| internal(error.to_string()))?;
        let workflows = self
            .workflows
            .list()
            .await
            .map_err(|error| internal(error.to_string()))?;

        let default_workflow = workflows
            .iter()
            .find(|workflow| workflow.is_default)
            .map(|workflow| workflow.workflow.name.clone());
        let active_task_count = tasks
            .iter()
            .filter(|task| {
                matches!(
                    task.status.as_str(),
                    "queued" | "preparing" | "running" | "paused"
                )
            })
            .count();
        let failed_task_count = tasks.iter().filter(|task| task.status == "failed").count();
        let enabled_storage_count = storages.iter().filter(|storage| storage.enabled).count();
        let enabled_plugin_count = plugins.iter().filter(|plugin| plugin.enabled).count();
        let local_api_running = self.local_api_running.load(Ordering::Acquire);

        let mut warnings = Vec::new();
        if enabled_storage_count == 0 {
            warnings.push("没有已启用的 Storage，发布入口将不可用".to_string());
        }
        if default_workflow.is_none() {
            warnings
                .push("没有默认 Workflow，Typora / 快捷键 / Local API 无法自动发布".to_string());
        }
        if !local_api_running {
            warnings.push("Local HTTP API 未运行，ShareX/脚本集成将不可用".to_string());
        }
        if failed_task_count > 0 {
            warnings.push(format!(
                "任务中心存在 {failed_task_count} 个失败任务，请检查最近错误"
            ));
        }

        Ok(json!({
            "status": if warnings.is_empty() { "healthy" } else { "attention" },
            "appVersion": self.app_version,
            "dataDir": self.data_dir.to_string_lossy(),
            "databaseReady": true,
            "localApiRunning": local_api_running,
            "storageCount": storages.len(),
            "enabledStorageCount": enabled_storage_count,
            "pluginCount": plugins.len(),
            "enabledPluginCount": enabled_plugin_count,
            "taskCount": tasks.len(),
            "activeTaskCount": active_task_count,
            "failedTaskCount": failed_task_count,
            "defaultWorkflow": default_workflow,
            "warnings": warnings,
        }))
    }
}

fn internal(message: String) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::Internal, message)
}

#[async_trait::async_trait]
impl BuiltinPlugin for DiagnosticsPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, _payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "diagnostics.get" => self.get().await,
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown diagnostics method {method}"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_valid_and_matches_kernel_id() {
        let item = manifest();
        item.validate().expect("diagnostics manifest must validate");
        assert_eq!(item.id.as_str(), PLUGIN_ID);
        assert!(item.default_enabled);
        assert_eq!(item.kind, PluginKind::Native);
    }
}
