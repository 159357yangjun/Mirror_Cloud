//! `reconcile` 内置插件：云端文件与本地索引的对账扫描。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands/reconcile.rs` 的四个命令
//! （`run_reconciliation_sweep` / `get_reconciliation_settings` / `set_reconciliation_settings` /
//! `get_reconciliation_history`）与 `apps/desktop/src-tauri/src/reconcile_cadence.rs` 的调度决策。
//!
//! ## 本插件拥有什么
//!
//! - 扫描核心（[`sweep`]）：显式扫描、设置读写、历史记录；
//! - 调度决策（[`cadence`]）：间隔、预算、游标推进——纯函数，只有它知道"现在该不该跑"；
//! - 后台循环（[`ReconcilePlugin::start_background`]）：宿主启动一次，之后自持。
//!
//! ## 宿主保留什么
//!
//! 命令注册与 `AppState` 的生命周期。扫描所需的仓储与凭据在启动时注入插件实例，插件不再经
//! `AppState` 间接访问，因此单测可以只构造插件本身。

use std::sync::Arc;

use credential_store::CredentialStore;
use kernel_api::{
    BuiltinPlugin, Capability, PluginFailure, PluginId, PluginKind, PluginManifestV2,
};
use persistence_sqlite::{
    AssetRepository, SettingsRepository, StorageRepository, journal::SqliteEventJournal,
};
use provider_registry::ProviderRegistry;
use serde_json::Value;

use crate::cadence::{DEFAULT_SCAN_INTERVAL_MINUTES, ReconcileConfig};
use crate::sweep::{
    SweepDeps, read_config, read_history, run_manual_sweep, run_sweep_inner, write_config,
};

pub mod cadence;
pub mod sweep;

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "reconcile";

/// 插件清单：与 `crates/kernel/src/builtin.rs` 中的装配条目一致。
pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new("reconcile").expect("static plugin id is valid"),
        name: "索引对账".into(),
        version: "2.0.0-dev.1".into(),
        description: "云端文件与本地索引的对账扫描。".into(),
        kind: PluginKind::Native,
        permissions: vec![Capability::Network],
        default_enabled: true,
        contributes: Vec::new(),
        settings_schema: None,
    }
}

/// 对账插件：扫描所需的仓储、凭据与 provider 注册表，启动时注入。
pub struct ReconcilePlugin {
    assets: AssetRepository,
    storages: StorageRepository,
    journal: SqliteEventJournal,
    settings: SettingsRepository,
    credentials: CredentialStore,
    registry: Arc<ProviderRegistry>,
    manifest: PluginManifestV2,
}

impl ReconcilePlugin {
    pub fn new(
        assets: AssetRepository,
        storages: StorageRepository,
        journal: SqliteEventJournal,
        settings: SettingsRepository,
        credentials: CredentialStore,
        registry: Arc<ProviderRegistry>,
    ) -> Self {
        Self {
            assets,
            storages,
            journal,
            settings,
            credentials,
            registry,
            manifest: manifest(),
        }
    }

    /// 本次扫描所需的依赖切片。
    fn sweep_deps(&self) -> SweepDeps<'_> {
        SweepDeps {
            assets: &self.assets,
            storages: &self.storages,
            journal: &self.journal,
            settings: &self.settings,
            credentials: &self.credentials,
            registry: &self.registry,
        }
    }

    /// 启动后台对账循环并立即返回。
    ///
    /// ## 为什么循环每拍重读配置
    ///
    /// 关闭之后下一个唤醒就应该停止探测、开启之后不必重启；每拍读一次本地设置行就能同时满足
    /// 这两者，代价是一次本地 SQLite 读取。
    ///
    /// ## 为什么配置不可读时不跑
    ///
    /// `should_run_on_tick` 对缺失或不可读的偏好返回 false。默认安装因此会启动这个任务，但
    /// 在有人显式启用之前不会发出任何远端请求。
    pub fn start_background(self: Arc<Self>) {
        tokio::spawn(async move { self.run_loop().await });
    }

    async fn run_loop(self: Arc<Self>) {
        let mut cursor: Option<String> = None;
        loop {
            let config = read_config(&self.sweep_deps()).await;
            tokio::time::sleep(std::time::Duration::from_secs(
                u64::from(config.interval_minutes) * 60,
            ))
            .await;
            if !crate::cadence::should_run_on_tick(&config) {
                continue;
            }
            let providers = match crate::sweep::build_sweep_providers(&self.sweep_deps()).await {
                Ok(providers) => providers,
                Err(error) => {
                    tracing::warn!(%error, "reconciliation could not resolve providers");
                    continue;
                }
            };
            crate::sweep::refresh_stale_indexes(&self.sweep_deps(), &providers, &config).await;
            let report =
                run_sweep_inner(&self.sweep_deps(), &providers, cursor.clone(), true).await;
            cursor = report.next_cursor.clone();
            tracing::info!(
                examined = report.examined,
                missing_remote = report.missing_remote,
                unrecorded_remote = report.unrecorded_remote,
                inconclusive = report.inconclusive,
                wrapped = report.next_cursor.is_none(),
                "background reconciliation sweep finished"
            );
        }
    }

    async fn get_settings(&self) -> Value {
        serde_json::to_value(read_config(&self.sweep_deps()).await)
            .unwrap_or_else(|_| serde_json::json!({}))
    }

    async fn set_settings(&self, payload: &Value) -> Result<Value, PluginFailure> {
        let wanted = parse_set_settings(payload)?;
        let stored = write_config(&self.sweep_deps(), wanted)
            .await
            .map_err(|error| internal(error))?;
        serde_json::to_value(stored).map_err(|error| internal(error.to_string()))
    }

    async fn get_history(&self) -> Value {
        read_history(&self.sweep_deps()).await
    }
}

/// 把前端 payload 解析成规范化设置。
///
/// `scan_interval_minutes` 可选：较老的调用方（或不传该字段的浏览器构建）继续可用，并取文档化的
/// 默认值。声明为必填会为了一个不承载正确性的设置做一次破坏性 IPC 改动。
fn parse_set_settings(payload: &Value) -> Result<ReconcileConfig, PluginFailure> {
    let enabled = payload
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("enabled is required"))?;
    let interval_minutes = payload
        .get("interval_minutes")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("interval_minutes is required"))? as u32;
    let scan_interval_minutes = payload
        .get("scan_interval_minutes")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(DEFAULT_SCAN_INTERVAL_MINUTES)) as u32;
    Ok(ReconcileConfig {
        enabled,
        interval_minutes,
        scan_interval_minutes,
    })
}

fn internal(message: impl Into<String>) -> PluginFailure {
    PluginFailure::new(kernel_api::InvokeErrorCode::Internal, message.into())
}

fn invalid(message: &str) -> PluginFailure {
    PluginFailure::new(
        kernel_api::InvokeErrorCode::InvalidPayload,
        message.to_string(),
    )
}

#[async_trait::async_trait]
impl BuiltinPlugin for ReconcilePlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            // An explicit call always examines, regardless of the background preference: whoever
            // asked wants an answer now. Only the scheduled path consults `should_run_on_tick`.
            "reconcile.run_sweep" => Ok(serde_json::to_value(
                run_manual_sweep(&self.sweep_deps()).await,
            )
            .map_err(|error| internal(error.to_string()))?),
            "reconcile.get_settings" => Ok(self.get_settings().await),
            "reconcile.set_settings" => self.set_settings(payload).await,
            "reconcile.get_history" => Ok(self.get_history().await),
            _ => Err(PluginFailure::new(
                kernel_api::InvokeErrorCode::UnknownMethod,
                format!("unknown reconcile method {method}"),
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
        item.validate()
            .expect("manifest must satisfy the kernel contract");
        assert_eq!(item.id.as_str(), PLUGIN_ID);
    }

    #[test]
    fn a_settings_payload_missing_a_required_field_names_the_field() {
        // The thin wrapper forwards whatever the IPC layer gives it; naming the missing field here
        // is the only way an invalid payload explains itself at the source.
        let missing = serde_json::json!({ "interval_minutes": 360 });
        let failure = parse_set_settings(&missing).unwrap_err();
        assert_eq!(failure.code, kernel_api::InvokeErrorCode::InvalidPayload);
        assert!(
            failure.message.contains("enabled"),
            "the message must name the missing field, got: {}",
            failure.message
        );

        let missing_interval = serde_json::json!({ "enabled": true });
        let failure = parse_set_settings(&missing_interval).unwrap_err();
        assert!(
            failure.message.contains("interval_minutes"),
            "got: {}",
            failure.message
        );
    }

    #[test]
    fn a_settings_payload_takes_the_documented_scan_interval_default() {
        let configured = serde_json::json!({
            "enabled": true,
            "interval_minutes": 120,
        });
        let parsed = parse_set_settings(&configured).expect("valid payload");
        assert_eq!(
            parsed.scan_interval_minutes, DEFAULT_SCAN_INTERVAL_MINUTES,
            "an omitted scan interval falls back to the documented default"
        );

        let explicit = serde_json::json!({
            "enabled": false,
            "interval_minutes": 30,
            "scan_interval_minutes": 120,
        });
        let parsed = parse_set_settings(&explicit).expect("valid payload");
        assert_eq!(parsed.scan_interval_minutes, 120);
        assert!(!parsed.enabled);
    }
}
