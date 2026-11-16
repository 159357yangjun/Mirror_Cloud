use kernel_api::{InvokeErrorCode, PluginInvokeError};
use serde_json::Value;
use tauri::State;

use crate::AppState;

/// 插件命令统一入口（ADR 0003）。
///
/// 前端只发 `pluginId + method + payload`；内核命令仍走原名。错误码固定
/// `disabled | unknown_plugin | unknown_method | permission_denied | invalid_payload | timeout | internal`，
/// 由宿主补齐插件 id 与方法名，便于前端直接分支。
#[tauri::command]
pub fn plugin_invoke(
    state: State<'_, AppState>,
    plugin_id: String,
    method: String,
    payload: Option<Value>,
) -> Result<Value, PluginInvokeError> {
    let kernel = state.kernel.read().map_err(|_| {
        PluginInvokeError::new(
            plugin_id.clone(),
            method.clone(),
            InvokeErrorCode::Internal,
            "kernel lock is poisoned",
        )
    })?;
    kernel.invoke(&plugin_id, &method, &payload.unwrap_or(Value::Null))
}
