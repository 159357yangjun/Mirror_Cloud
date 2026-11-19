//! Reconciliation sweep commands: thin IPC wrappers over the `reconcile` plugin.
//!
//! ## Where the logic went
//!
//! The scan core, the cadence decision and the background loop all live in the built-in
//! `reconcile` plugin (`crates/plugins/reconcile`). This module keeps only the four commands:
//! it resolves nothing of its own, forwards the caller's request to the plugin and converts the
//! plugin's JSON answer back into the type the caller expects.
//!
//! ## What this never does
//!
//! The plugin writes events and returns counts; neither layer deletes, re-uploads, or flips a
//! deployment status. `DriftKind::MissingRemote` is a *report*; acting on it stays a human
//! decision, which is why the probe path separates Unknown from Absent.

use super::*;
use plugin_reconcile::cadence::ReconcileConfig;
use serde_json::{Value, json};
use tauri::State;

/// Run an explicit reconciliation sweep now.
///
/// An explicit call always examines, regardless of the background preference: whoever asked
/// wants an answer now. Only the scheduled path consults the policy gate.
#[tauri::command]
pub async fn run_reconciliation_sweep(state: State<'_, AppState>) -> CmdResult<Value> {
    // P2：扫描核心在 `plugin-reconcile`，命令只做边界转换。
    let kernel = state.kernel.read().await;
    kernel
        .invoke("reconcile", "reconcile.run_sweep", &Value::Null)
        .await
        .map_err(|error| error.to_string())
}

/// Read the stored background-reconciliation preference.
#[tauri::command]
pub async fn get_reconciliation_settings(state: State<'_, AppState>) -> CmdResult<ReconcileConfig> {
    // P2：设置读取在 `plugin-reconcile`，命令只做边界转换。
    let kernel = state.kernel.read().await;
    let value = kernel
        .invoke("reconcile", "reconcile.get_settings", &Value::Null)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

/// Persist the preference, returning the normalised value actually stored rather than the one
/// asked for, so a clamped interval is visible to the caller.
#[tauri::command]
pub async fn set_reconciliation_settings(
    state: State<'_, AppState>,
    enabled: bool,
    interval_minutes: u32,
    scan_interval_minutes: Option<u32>,
) -> CmdResult<ReconcileConfig> {
    // `scan_interval_minutes` stays optional so an older caller (or a browser build that never
    // sends the field) keeps working and takes the documented default. The plugin applies the same
    // fallback, so the wrapper only decides whether to forward the field.
    let payload = match scan_interval_minutes {
        Some(scan_interval_minutes) => json!({
            "enabled": enabled,
            "interval_minutes": interval_minutes,
            "scan_interval_minutes": scan_interval_minutes,
        }),
        None => json!({
            "enabled": enabled,
            "interval_minutes": interval_minutes,
        }),
    };
    // P2：设置写入在 `plugin-reconcile`，命令只做边界转换。
    let kernel = state.kernel.read().await;
    let value = kernel
        .invoke("reconcile", "reconcile.set_settings", &payload)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

/// Read back the stored sweep history.
#[tauri::command]
pub async fn get_reconciliation_history(state: State<'_, AppState>) -> CmdResult<Value> {
    // P2：历史读取在 `plugin-reconcile`，命令只做边界转换。
    let kernel = state.kernel.read().await;
    kernel
        .invoke("reconcile", "reconcile.get_history", &Value::Null)
        .await
        .map_err(|error| error.to_string())
}
