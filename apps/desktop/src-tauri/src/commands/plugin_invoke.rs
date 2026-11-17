use kernel_api::{InvokeErrorCode, PluginInvokeError};
use serde_json::Value;
use tauri::State;

use crate::AppState;

/// 插件命令统一入口（ADR 0003 / 0005）。
///
/// 前端只发 `pluginId + method + payload`；内核命令仍走原名。错误码固定
/// `disabled | unknown_plugin | unknown_method | permission_denied | invalid_payload | timeout | internal`，
/// 由宿主补齐插件 id 与方法名，便于前端直接分支。
///
/// 插件方法可 await 数据库/网络，因此本命令是 async 的：拿 tokio 读锁后直接
/// await 宿主分发，不阻塞命令线程，也不会出现 std 读锁守卫跨 await 的 Send 问题。
#[tauri::command]
pub async fn plugin_invoke(
    state: State<'_, AppState>,
    plugin_id: String,
    method: String,
    payload: Option<Value>,
) -> Result<Value, PluginInvokeError> {
    let kernel = state.kernel.read().await;
    kernel
        .invoke(&plugin_id, &method, &payload.unwrap_or(Value::Null))
        .await
}
