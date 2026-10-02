use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use credential_store::CredentialStore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    App, AppHandle, Emitter, Manager, State,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::RwLock,
};
use uuid::Uuid;

use super::{
    CmdResult, OUTPUT_PREFERENCES_KEY, OutputPreferences, TyporaIntegrationInfo,
    preflight_workflow_target, resolve_default_publish_target, sync_system_default_pipeline,
};
use crate::{AppState, cli};

pub const LOCAL_API_PORT: u16 = 36677;
pub const GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+U";
const GLOBAL_SHORTCUT_ENABLED_KEY: &str = "integration.global_shortcut_enabled";
const WINDOWS_CONTEXT_MENU_KEY: &str =
    r"HKCU\Software\Classes\SystemFileAssociations\image\shell\MultiCloudPublisher";
const LOCAL_API_CREDENTIAL_KEY: &str = "integration:local-api-token";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiInfo {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub token: String,
    pub upload_endpoint: String,
    pub path_upload_endpoint: String,
    pub security_note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutInfo {
    pub shortcut: String,
    pub enabled: bool,
    pub registered: bool,
    pub action: String,
    pub note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnosticsView {
    pub status: String,
    pub app_version: String,
    pub data_dir: String,
    pub database_ready: bool,
    pub local_api_running: bool,
    pub storage_count: usize,
    pub enabled_storage_count: usize,
    pub plugin_count: usize,
    pub enabled_plugin_count: usize,
    pub task_count: usize,
    pub active_task_count: usize,
    pub failed_task_count: usize,
    pub default_workflow: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsContextMenuInfo {
    pub supported: bool,
    pub installed: bool,
    pub label: String,
    pub command_preview: String,
    pub note: String,
}

#[derive(Debug, Deserialize)]
struct LocalPathUploadRequest {
    paths: Vec<String>,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

pub fn load_or_create_local_api_token(credentials: &CredentialStore) -> Result<String, String> {
    if let Ok(token) = credentials.get_json::<String>(LOCAL_API_CREDENTIAL_KEY) {
        if token.len() >= 32 {
            return Ok(token);
        }
    }
    let token = format!("pub_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    credentials
        .set_json(LOCAL_API_CREDENTIAL_KEY, &token)
        .map_err(|error| format!("Cannot store local API token: {error}"))?;
    Ok(token)
}

pub fn start_local_http_api(
    data_dir: PathBuf,
    token: Arc<RwLock<String>>,
    running: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        let address = format!("127.0.0.1:{LOCAL_API_PORT}");
        let listener = match TcpListener::bind(&address).await {
            Ok(listener) => listener,
            Err(error) => {
                tracing::error!(%error, %address, "local Publisher API failed to bind");
                running.store(false, Ordering::Release);
                return;
            }
        };
        running.store(true, Ordering::Release);
        tracing::info!(%address, "local Publisher API listening");

        loop {
            let (stream, peer) = match listener.accept().await {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(%error, "local Publisher API accept failed");
                    continue;
                }
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let data_dir = data_dir.clone();
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = handle_http_connection(stream, data_dir, token).await {
                    tracing::warn!(%error, "local Publisher API request failed");
                }
            });
        }
    });
}

async fn handle_http_connection(
    mut stream: TcpStream,
    data_dir: PathBuf,
    token: Arc<RwLock<String>>,
) -> Result<(), String> {
    let request = read_http_request(&mut stream).await?;

    if request.method == "GET" && request.path == "/health" {
        return write_json_response(
            &mut stream,
            200,
            json!({"ok": true, "service": "Multi-cloud Publisher", "api": "v1"}),
        )
        .await;
    }

    if request.method != "POST" {
        return write_json_response(&mut stream, 405, json!({"error": "method_not_allowed"})).await;
    }

    let expected = token.read().await.clone();
    let authorized = request
        .headers
        .get("authorization")
        .is_some_and(|value| value == &format!("Bearer {expected}"));
    if !authorized {
        return write_json_response(&mut stream, 401, json!({"error": "unauthorized"})).await;
    }

    match request.path.as_str() {
        "/v1/upload-paths" => {
            let payload: LocalPathUploadRequest = serde_json::from_slice(&request.body)
                .map_err(|error| format!("Invalid upload-paths JSON: {error}"))?;
            if payload.paths.is_empty() || payload.paths.len() > 100 {
                return write_json_response(
                    &mut stream,
                    400,
                    json!({"error": "paths must contain 1..100 local image paths"}),
                )
                .await;
            }
            let paths = payload
                .paths
                .into_iter()
                .map(PathBuf::from)
                .collect::<Vec<_>>();
            match cli::upload_with_default_workflow(&data_dir, &paths).await {
                Ok(urls) => {
                    write_json_response(&mut stream, 200, json!({"ok": true, "urls": urls})).await
                }
                Err(error) => {
                    write_json_response(&mut stream, 422, json!({"ok": false, "error": error}))
                        .await
                }
            }
        }
        "/v1/upload" => {
            let file_name = request
                .headers
                .get("x-publisher-filename")
                .cloned()
                .unwrap_or_else(|| "upload.png".to_string());
            let safe_name = sanitize_api_filename(&file_name)?;
            let temp_dir = data_dir.join("http-api-staging");
            tokio::fs::create_dir_all(&temp_dir)
                .await
                .map_err(|error| format!("Cannot create local API staging directory: {error}"))?;
            let temp_path = temp_dir.join(format!("u{}-{safe_name}", Uuid::new_v4().simple()));
            tokio::fs::write(&temp_path, &request.body)
                .await
                .map_err(|error| format!("Cannot stage local API upload: {error}"))?;
            let publish_result =
                cli::upload_with_default_workflow(&data_dir, std::slice::from_ref(&temp_path))
                    .await;
            let _ = tokio::fs::remove_file(&temp_path).await;
            match publish_result {
                Ok(urls) => {
                    write_json_response(&mut stream, 200, json!({"ok": true, "urls": urls})).await
                }
                Err(error) => {
                    write_json_response(&mut stream, 422, json!({"ok": false, "error": error}))
                        .await
                }
            }
        }
        _ => write_json_response(&mut stream, 404, json!({"error": "not_found"})).await,
    }
}

fn sanitize_api_filename(value: &str) -> Result<String, String> {
    let file_name = Path::new(value)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "X-Publisher-Filename is invalid".to_string())?;
    let sanitized = file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err("X-Publisher-Filename is invalid".into());
    }
    Ok(sanitized)
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::<u8>::with_capacity(8192);
    let header_end = loop {
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("HTTP header is too large".into());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        let mut chunk = [0u8; 8192];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("HTTP client closed before headers completed".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| "HTTP headers must be UTF-8/ASCII".to_string())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing HTTP request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let raw_path = request_parts.next().unwrap_or_default();
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_string();
    let mut headers = HashMap::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }

    let content_length = headers
        .get("content-length")
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| "Invalid Content-Length".to_string())
        })
        .transpose()?
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("HTTP request body exceeds 32 MB".into());
    }

    let body_start = header_end + 4;
    let mut body = if buffer.len() > body_start {
        buffer[body_start..].to_vec()
    } else {
        Vec::new()
    };
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = vec![0u8; remaining.min(8192)];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("HTTP client closed before body completed".into());
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    value: serde_json::Value,
) -> Result<(), String> {
    let body = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        422 => "Unprocessable Entity",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&body)
        .await
        .map_err(|error| error.to_string())?;
    stream.shutdown().await.map_err(|error| error.to_string())
}

pub fn setup_global_shortcut(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                if let Err(error) =
                    publish_clipboard_from_shortcut(&app, state.inner().clone()).await
                {
                    tracing::warn!(%error, "global shortcut upload failed");
                    let _ = app.emit("integration://shortcut-error", error.clone());
                    show_main_window(&app);
                }
            });
        })
        .build();
    app.handle().plugin(plugin)?;
    let enabled = tauri::async_runtime::block_on(async {
        app.state::<AppState>()
            .settings
            .get(GLOBAL_SHORTCUT_ENABLED_KEY)
            .await
            .ok()
            .flatten()
            .and_then(|value| value.as_bool())
            .unwrap_or(true)
    });
    if enabled && !app.global_shortcut().is_registered(GLOBAL_SHORTCUT) {
        app.global_shortcut().register(GLOBAL_SHORTCUT)?;
    }
    Ok(())
}

async fn publish_clipboard_from_shortcut(
    app: &AppHandle,
    state: AppState,
) -> Result<Vec<String>, String> {
    let permit = state
        .upload_semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "上传并发控制器已关闭".to_string())?;
    let _permit = permit;

    let clipboard_app = app.clone();
    let (rgba, width, height) =
        tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, u32, u32), String> {
            let image = clipboard_app
                .clipboard()
                .read_image()
                .map_err(|_| "剪贴板中没有可读取的图片".to_string())?;
            Ok((image.rgba().to_vec(), image.width(), image.height()))
        })
        .await
        .map_err(|error| format!("读取剪贴板任务失败: {error}"))??;

    let png = tokio::task::spawn_blocking(move || {
        image_processing::encode_rgba_png(&rgba, width, height).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("编码剪贴板图片任务失败: {error}"))??;

    let staging = state.data_dir.join("shortcut-staging");
    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|error| format!("无法创建快捷上传临时目录: {error}"))?;
    let temp_path = staging.join(format!("shortcut-{}.png", Uuid::new_v4().simple()));
    tokio::fs::write(&temp_path, png)
        .await
        .map_err(|error| format!("无法写入快捷上传临时图片: {error}"))?;
    let result =
        cli::upload_with_default_workflow(&state.data_dir, std::slice::from_ref(&temp_path)).await;
    let _ = tokio::fs::remove_file(&temp_path).await;
    let urls = result?;
    if urls.is_empty() {
        return Err("快捷上传完成但没有返回公网 URL".into());
    }
    let text = urls.join("\n");
    app.clipboard()
        .write_text(text.clone())
        .map_err(|error| format!("图片已上传，但复制链接失败: {error}"))?;
    let _ = app.emit(
        "integration://shortcut-uploaded",
        json!({"urls": urls, "clipboard": text}),
    );
    Ok(urls)
}

#[tauri::command]
pub async fn get_global_shortcut_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<GlobalShortcutInfo> {
    let enabled = state
        .settings
        .get(GLOBAL_SHORTCUT_ENABLED_KEY)
        .await
        .map_err(|error| error.to_string())?
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    Ok(GlobalShortcutInfo {
        shortcut: GLOBAL_SHORTCUT.into(),
        enabled,
        registered: app.global_shortcut().is_registered(GLOBAL_SHORTCUT),
        action: "上传当前剪贴板图片，并把最终 URL 写回剪贴板".into(),
        note: "快捷键使用同一默认 Workflow、多云策略与插件链；关闭时会真正释放系统快捷键。".into(),
    })
}

#[tauri::command]
pub async fn set_global_shortcut_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> CmdResult<GlobalShortcutInfo> {
    if enabled {
        if !app.global_shortcut().is_registered(GLOBAL_SHORTCUT) {
            app.global_shortcut()
                .register(GLOBAL_SHORTCUT)
                .map_err(|error| format!("快捷键注册失败，可能已被其他应用占用：{error}"))?;
        }
    } else if app.global_shortcut().is_registered(GLOBAL_SHORTCUT) {
        app.global_shortcut()
            .unregister(GLOBAL_SHORTCUT)
            .map_err(|error| format!("快捷键注销失败：{error}"))?;
    }
    state
        .settings
        .set(GLOBAL_SHORTCUT_ENABLED_KEY, &json!(enabled))
        .await
        .map_err(|error| error.to_string())?;
    get_global_shortcut_info(app, state).await
}

fn windows_context_menu_command(executable: &Path, data_dir: &Path) -> String {
    format!(
        "\"{}\" --shell-upload --data-dir \"{}\" -- \"%1\"",
        executable.display(),
        data_dir.display()
    )
}

#[cfg(target_os = "windows")]
fn reg_command() -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("reg.exe");
    // CREATE_NO_WINDOW: registry install/remove should not flash a console window.
    command.creation_flags(0x08000000);
    command
}

#[cfg(target_os = "windows")]
fn context_menu_installed() -> bool {
    reg_command()
        .args(["query", WINDOWS_CONTEXT_MENU_KEY])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn context_menu_installed() -> bool {
    false
}

#[tauri::command]
pub fn get_windows_context_menu_info(app: AppHandle) -> CmdResult<WindowsContextMenuInfo> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(WindowsContextMenuInfo {
        supported: cfg!(target_os = "windows"),
        installed: context_menu_installed(),
        label: "使用 Multi-cloud Publisher 上传".into(),
        command_preview: windows_context_menu_command(&executable, &data_dir),
        note: if cfg!(target_os = "windows") {
            "写入当前用户 HKCU，不需要管理员权限。右击图片后会后台调用同一默认 Workflow，成功后把最终 URL 放入剪贴板。".into()
        } else {
            "Windows 资源管理器右键菜单仅在 Windows 桌面版可用。".into()
        },
    })
}

#[tauri::command]
pub fn install_windows_context_menu(app: AppHandle) -> CmdResult<WindowsContextMenuInfo> {
    #[cfg(target_os = "windows")]
    {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let command = windows_context_menu_command(&executable, &data_dir);
        let command_key = format!(r"{}\command", WINDOWS_CONTEXT_MENU_KEY);
        let status = reg_command()
            .args([
                "add",
                WINDOWS_CONTEXT_MENU_KEY,
                "/ve",
                "/d",
                "使用 Multi-cloud Publisher 上传",
                "/f",
            ])
            .status()
            .map_err(|error| format!("无法写入 Windows 右键菜单: {error}"))?;
        if !status.success() {
            return Err("Windows 拒绝写入当前用户右键菜单".into());
        }
        let _ = reg_command()
            .args([
                "add",
                WINDOWS_CONTEXT_MENU_KEY,
                "/v",
                "Icon",
                "/d",
                executable.to_string_lossy().as_ref(),
                "/f",
            ])
            .status();
        let status = reg_command()
            .args(["add", &command_key, "/ve", "/d", &command, "/f"])
            .status()
            .map_err(|error| format!("无法写入右键菜单命令: {error}"))?;
        if !status.success() {
            return Err("Windows 拒绝写入右键菜单执行命令".into());
        }
        return get_windows_context_menu_info(app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Windows 右键菜单仅在 Windows 桌面版可用".into())
    }
}

#[tauri::command]
pub fn uninstall_windows_context_menu(app: AppHandle) -> CmdResult<WindowsContextMenuInfo> {
    #[cfg(target_os = "windows")]
    {
        let status = reg_command()
            .args(["delete", WINDOWS_CONTEXT_MENU_KEY, "/f"])
            .status()
            .map_err(|error| format!("无法移除 Windows 右键菜单: {error}"))?;
        if !status.success() && context_menu_installed() {
            return Err("Windows 拒绝移除当前用户右键菜单".into());
        }
        return get_windows_context_menu_info(app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Windows 右键菜单仅在 Windows 桌面版可用".into())
    }
}

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "tray-open", "打开 Publisher", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
    let mut builder = TrayIconBuilder::with_id("publisher-tray")
        .tooltip("Multi-cloud Publisher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == "tray-open" {
                show_main_window(app);
            } else if event.id() == "tray-quit" {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub async fn get_system_diagnostics(
    state: State<'_, AppState>,
) -> CmdResult<SystemDiagnosticsView> {
    let storages = state
        .storages
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let plugins = state
        .plugins
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let tasks = state
        .tasks
        .list(10_000)
        .await
        .map_err(|error| error.to_string())?;
    let workflows = state
        .workflows
        .list()
        .await
        .map_err(|error| error.to_string())?;
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
    let local_api_running = state.local_api_running.load(Ordering::Acquire);
    let mut warnings = Vec::new();
    if enabled_storage_count == 0 {
        warnings.push("没有已启用的 Storage，发布入口将不可用".into());
    }
    if default_workflow.is_none() {
        warnings.push("没有默认 Workflow，Typora / 快捷键 / Local API 无法自动发布".into());
    }
    if !local_api_running {
        warnings.push("Local HTTP API 未运行，ShareX/脚本集成将不可用".into());
    }
    if failed_task_count > 0 {
        warnings.push(format!(
            "任务中心存在 {failed_task_count} 个失败任务，请检查最近错误"
        ));
    }
    Ok(SystemDiagnosticsView {
        status: if warnings.is_empty() {
            "healthy".into()
        } else {
            "attention".into()
        },
        app_version: env!("CARGO_PKG_VERSION").into(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        database_ready: true,
        local_api_running,
        storage_count: storages.len(),
        enabled_storage_count,
        plugin_count: plugins.len(),
        enabled_plugin_count,
        task_count: tasks.len(),
        active_task_count,
        failed_task_count,
        default_workflow,
        warnings,
    })
}

#[tauri::command]
pub async fn get_local_api_info(state: State<'_, AppState>) -> CmdResult<LocalApiInfo> {
    let token = state.local_api_token.read().await.clone();
    let base_url = format!("http://127.0.0.1:{LOCAL_API_PORT}");
    Ok(LocalApiInfo {
        running: state.local_api_running.load(Ordering::Acquire),
        host: "127.0.0.1".into(),
        port: LOCAL_API_PORT,
        upload_endpoint: format!("{base_url}/v1/upload"),
        path_upload_endpoint: format!("{base_url}/v1/upload-paths"),
        base_url,
        token,
        security_note: "只监听本机 127.0.0.1；上传接口必须携带 Bearer Token。Token 保存在系统 Credential Store。".into(),
    })
}

#[tauri::command]
pub async fn regenerate_local_api_token(state: State<'_, AppState>) -> CmdResult<LocalApiInfo> {
    let token = format!("pub_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    state
        .credentials
        .set_json(LOCAL_API_CREDENTIAL_KEY, &token)
        .map_err(|error| error.to_string())?;
    *state.local_api_token.write().await = token;
    get_local_api_info(state).await
}

#[tauri::command]
pub async fn get_typora_integration_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<TyporaIntegrationInfo> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    if resolve_default_publish_target(state.inner())
        .await?
        .is_some()
    {
        sync_system_default_pipeline(state.inner(), None).await?;
    }
    let workflows = state
        .workflows
        .list()
        .await
        .map_err(|error| error.to_string())?;
    let default = workflows.iter().find(|workflow| workflow.is_default);
    let command = format!(
        "\"{}\" --typora-upload --data-dir \"{}\" --",
        executable.display(),
        data_dir.display()
    );
    let (ready, message) = if let Some(workflow) = default {
        match preflight_workflow_target(state.inner(), &workflow.workflow).await {
            Ok(()) => (
                true,
                format!(
                    "默认上传链“{}”已就绪，Typora 可直接调用。",
                    workflow.workflow.name
                ),
            ),
            Err(error) => (false, format!("默认上传链尚未就绪：{error}")),
        }
    } else {
        (
            false,
            "还没有可用的默认上传链。请先连接一个云端存储。".into(),
        )
    };
    Ok(TyporaIntegrationInfo {
        command,
        executable: executable.to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        default_workflow: default.map(|workflow| workflow.workflow.name.clone()),
        ready,
        message,
    })
}

#[tauri::command]
pub fn open_typora() -> CmdResult<String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::<PathBuf>::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Typora/Typora.exe"));
        }
        if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
            candidates.push(PathBuf::from(program_files).join("Typora/Typora.exe"));
        }
        if let Some(program_files_x86) = std::env::var_os("PROGRAMFILES(X86)") {
            candidates.push(PathBuf::from(program_files_x86).join("Typora/Typora.exe"));
        }
        if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
            Command::new(&path)
                .spawn()
                .map_err(|error| error.to_string())?;
            return Ok(path.to_string_lossy().into_owned());
        }
        Command::new("cmd")
            .args(["/C", "start", "", "typora"])
            .spawn()
            .map_err(|error| {
                format!("未找到 Typora。请先安装 Typora，或把 Typora.exe 加入 PATH：{error}")
            })?;
        Ok("typora".into())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Typora"])
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok("Typora".into())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("typora")
            .spawn()
            .map_err(|error| format!("未找到 Typora：{error}"))?;
        Ok("typora".into())
    }
}

#[tauri::command]
pub fn open_app_data_dir(app: AppHandle) -> CmdResult<String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&data_dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&data_dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    Command::new("xdg-open")
        .arg(&data_dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_output_preferences(state: State<'_, AppState>) -> CmdResult<OutputPreferences> {
    let value = state
        .settings
        .get(OUTPUT_PREFERENCES_KEY)
        .await
        .map_err(|error| error.to_string())?;
    match value {
        Some(value) => serde_json::from_value(value).map_err(|error| error.to_string()),
        None => Ok(OutputPreferences::default()),
    }
}

#[tauri::command]
pub async fn save_output_preferences(
    state: State<'_, AppState>,
    preferences: OutputPreferences,
) -> CmdResult<OutputPreferences> {
    if !matches!(
        preferences.default_format.as_str(),
        "url" | "markdown" | "html" | "bbcode" | "custom"
    ) {
        return Err("Unsupported output format".into());
    }
    if preferences.default_format == "custom" && !preferences.custom_template.contains("{url}") {
        return Err("Custom output template must contain {url}".into());
    }
    if !matches!(
        preferences.image_format.as_str(),
        "original" | "jpeg" | "png" | "webp"
    ) {
        return Err("Unsupported image format".into());
    }
    let value = serde_json::to_value(&preferences).map_err(|error| error.to_string())?;
    state
        .settings
        .set(OUTPUT_PREFERENCES_KEY, &value)
        .await
        .map_err(|error| error.to_string())?;
    Ok(preferences)
}

pub async fn default_chain_image_format(settings: &persistence_sqlite::SettingsRepository) -> String {
    // Single mapping from the stored preference to the Convert step. Anything unrecognized
    // (including a hand-edited row or a read failure) falls back to webp - the pre-existing
    // shipped behavior - never to an empty pipeline.
    let format = settings
        .get(OUTPUT_PREFERENCES_KEY)
        .await
        .ok()
        .flatten()
        .and_then(|value| {
            value
                .get("imageFormat")
                .and_then(serde_json::Value::as_str)
                .map(|format| format.to_string())
        });
    match format.as_deref() {
        Some(f @ ("original" | "jpeg" | "png" | "webp")) => f.to_string(),
        _ => "webp".to_string(),
    }
}
