use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExecutionLogView {
    pub id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub hook: String,
    pub status: String,
    pub duration_ms: i64,
    pub message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub kind: String,
    pub permissions: Vec<String>,
    pub granted_permissions: Vec<String>,
    pub supported_hooks: Vec<String>,
    pub enabled_hooks: Vec<String>,
    pub enabled: bool,
    pub installed: bool,
    pub source: String,
    pub config: Value,
}

fn marketplace_manifests() -> Vec<PluginManifest> {
    vec![
        PluginManifest {
            id: "official.markdown-card".into(),
            name: "Markdown Asset Card".into(),
            version: "1.1.0".into(),
            description: "把上传结果格式化为可复用 Markdown 卡片。".into(),
            kind: plugin_runtime::PluginKind::Template,
            permissions: vec![PluginPermission::ReadAsset],
            hooks: vec![PluginHook::AfterUpload, PluginHook::ManualTrigger],
            config_schema: json!({"template":{"type":"string","default":"![{name}]({url})"}}),
        },
        PluginManifest {
            id: "official.webhook".into(),
            name: "Webhook Publisher".into(),
            version: "1.2.0".into(),
            description:
                "在处理前后、上传成功、发布失败或云端删除后向你自己的 Webhook 发送资源事件。".into(),
            kind: plugin_runtime::PluginKind::Webhook,
            permissions: vec![
                PluginPermission::ReadAsset,
                PluginPermission::Network,
                PluginPermission::ExternalWrite,
            ],
            hooks: vec![
                PluginHook::BeforeProcess,
                PluginHook::AfterProcess,
                PluginHook::AfterUpload,
                PluginHook::OnPublishFailure,
                PluginHook::OnGalleryDelete,
                PluginHook::ManualTrigger,
            ],
            config_schema: json!({"endpoint":{"type":"url"}}),
        },
        PluginManifest {
            id: "official.ai-caption".into(),
            name: "AI Image Caption".into(),
            version: "1.2.0".into(),
            description:
                "使用支持视觉输入的 OpenAI-compatible 接口真正读取图片并生成说明或 Alt Text。"
                    .into(),
            kind: plugin_runtime::PluginKind::AiPrompt,
            permissions: vec![
                PluginPermission::ReadAsset,
                PluginPermission::Network,
                PluginPermission::Secret,
            ],
            hooks: vec![PluginHook::AfterUpload, PluginHook::ManualTrigger],
            config_schema: json!({"prompt":{"type":"string"}}),
        },
    ]
}

fn permission_name(permission: &PluginPermission) -> String {
    serde_json::to_value(permission)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{permission:?}").to_lowercase())
}

fn parse_permission_name(value: &str) -> Option<PluginPermission> {
    serde_json::from_value(Value::String(value.to_string())).ok()
}

fn hook_name(hook: &PluginHook) -> String {
    serde_json::to_value(hook)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{hook:?}").to_lowercase())
}

fn parse_hook_name(value: &str) -> Option<PluginHook> {
    serde_json::from_value(Value::String(value.to_string())).ok()
}

pub(super) fn record_hooks(record: &PluginRecord) -> Vec<PluginHook> {
    serde_json::from_value(record.enabled_hooks_json.clone())
        .unwrap_or_else(|_| vec![PluginHook::AfterUpload])
}

pub(super) fn effective_manifest(record: &PluginRecord) -> CmdResult<PluginManifest> {
    if let Some(current) = marketplace_manifests()
        .into_iter()
        .find(|manifest| manifest.id == record.id)
    {
        return Ok(current);
    }
    serde_json::from_value(record.manifest_json.clone()).map_err(|error| error.to_string())
}

fn record_grants(record: &PluginRecord) -> Vec<PluginPermission> {
    serde_json::from_value(record.granted_permissions_json.clone()).unwrap_or_default()
}

fn missing_permissions(
    manifest: &PluginManifest,
    granted: &[PluginPermission],
) -> Vec<PluginPermission> {
    manifest
        .permissions
        .iter()
        .copied()
        .filter(|permission| !granted.contains(permission))
        .collect()
}

fn manifest_to_view(
    m: &PluginManifest,
    installed: bool,
    enabled: bool,
    source: &str,
    config: Value,
    granted: &[PluginPermission],
    enabled_hooks: &[PluginHook],
) -> PluginView {
    PluginView {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        description: m.description.clone(),
        kind: format!("{:?}", m.kind).to_lowercase(),
        permissions: m.permissions.iter().map(permission_name).collect(),
        granted_permissions: granted.iter().map(permission_name).collect(),
        supported_hooks: m.hooks.iter().map(hook_name).collect(),
        enabled_hooks: enabled_hooks.iter().map(hook_name).collect(),
        enabled,
        installed,
        source: source.into(),
        config,
    }
}

#[tauri::command]
pub async fn list_marketplace_plugins(state: State<'_, AppState>) -> CmdResult<Vec<PluginView>> {
    let installed = state.plugins.list().await.map_err(|e| e.to_string())?;
    Ok(marketplace_manifests()
        .iter()
        .map(|manifest| {
            if let Some(record) = installed.iter().find(|record| record.id == manifest.id) {
                let granted = record_grants(record);
                let hooks = record_hooks(record);
                manifest_to_view(
                    manifest,
                    true,
                    record.enabled,
                    &record.source,
                    record.config_json.clone(),
                    &granted,
                    &hooks,
                )
            } else {
                manifest_to_view(
                    manifest,
                    false,
                    false,
                    "marketplace",
                    json!({}),
                    &[],
                    &[PluginHook::AfterUpload],
                )
            }
        })
        .collect())
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> CmdResult<Vec<PluginView>> {
    let rows = state.plugins.list().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for record in rows {
        let manifest = effective_manifest(&record)?;
        let granted = record_grants(&record);
        let hooks = record_hooks(&record);
        out.push(manifest_to_view(
            &manifest,
            true,
            record.enabled,
            &record.source,
            record.config_json,
            &granted,
            &hooks,
        ));
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_plugin_execution_logs(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> CmdResult<Vec<PluginExecutionLogView>> {
    let rows = state
        .plugins
        .list_execution_logs(limit.unwrap_or(40).clamp(1, 200))
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| PluginExecutionLogView {
            id: row.id.to_string(),
            plugin_id: row.plugin_id,
            plugin_name: row.plugin_name,
            hook: row.hook,
            status: row.status,
            duration_ms: row.duration_ms,
            message: row.message,
            created_at: row.created_at.to_rfc3339(),
        })
        .collect())
}

#[tauri::command]
pub async fn install_marketplace_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
) -> CmdResult<PluginView> {
    let manifest = marketplace_manifests()
        .into_iter()
        .find(|manifest| manifest.id == plugin_id)
        .ok_or("Plugin not found")?;
    let now = Utc::now();
    let default_config = match manifest.kind {
        plugin_runtime::PluginKind::Template => json!({"template":"![{name}]({url})"}),
        plugin_runtime::PluginKind::Webhook => json!({"endpoint":""}),
        plugin_runtime::PluginKind::AiPrompt => {
            json!({"prompt":"Write concise, accessible alt text for this image. Use the image content, not just its filename or URL."})
        }
    };
    // ReadAsset is the local baseline capability. Network/Secret/ExternalWrite always require explicit user approval.
    let granted = manifest
        .permissions
        .iter()
        .copied()
        .filter(|permission| matches!(permission, PluginPermission::ReadAsset))
        .collect::<Vec<_>>();
    let record = PluginRecord {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        manifest_json: serde_json::to_value(&manifest).map_err(|e| e.to_string())?,
        config_json: default_config.clone(),
        granted_permissions_json: serde_json::to_value(&granted).map_err(|e| e.to_string())?,
        enabled_hooks_json: serde_json::to_value(vec![PluginHook::AfterUpload])
            .map_err(|e| e.to_string())?,
        enabled: false,
        source: "marketplace".into(),
        created_at: now,
        updated_at: now,
    };
    state
        .plugins
        .upsert(&record)
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifest_to_view(
        &manifest,
        true,
        false,
        "marketplace",
        default_config,
        &granted,
        &[PluginHook::AfterUpload],
    ))
}

async fn validate_plugin_ready(state: &AppState, record: &PluginRecord) -> CmdResult<()> {
    let manifest = effective_manifest(record)?;
    match manifest.kind {
        plugin_runtime::PluginKind::Template => Ok(()),
        plugin_runtime::PluginKind::Webhook => {
            let endpoint = record
                .config_json
                .get("endpoint")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if endpoint.starts_with("https://") || endpoint.starts_with("http://") {
                Ok(())
            } else {
                Err("请先配置有效的 Webhook http/https 地址，再开启插件。".into())
            }
        }
        plugin_runtime::PluginKind::AiPrompt => {
            let settings = load_ai_settings(state).await?;
            let base = settings
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let model = settings
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if base.is_empty() || model.is_empty() {
                Err("请先在插件页配置 AI Provider 的 Base URL 和 Model，再开启 AI 插件。".into())
            } else {
                Ok(())
            }
        }
    }
}

#[tauri::command]
pub async fn set_plugin_enabled(
    state: State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> CmdResult<()> {
    if enabled {
        let record = state
            .plugins
            .get(&plugin_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Plugin not installed")?;
        validate_plugin_ready(state.inner(), &record).await?;
        let manifest = effective_manifest(&record)?;
        let granted = record_grants(&record);
        let missing = missing_permissions(&manifest, &granted);
        if !missing.is_empty() {
            let names = missing
                .iter()
                .map(permission_name)
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!("插件需要先获得用户授权：{names}"));
        }
    }
    state
        .plugins
        .set_enabled(&plugin_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_plugin_permissions(
    state: State<'_, AppState>,
    plugin_id: String,
    permissions: Vec<String>,
) -> CmdResult<()> {
    let record = state
        .plugins
        .get(&plugin_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Plugin not installed")?;
    let manifest = effective_manifest(&record)?;
    let mut granted = Vec::new();
    for name in permissions {
        let permission =
            parse_permission_name(&name).ok_or_else(|| format!("未知插件权限：{name}"))?;
        if !manifest.permissions.contains(&permission) {
            return Err(format!("插件 Manifest 未声明权限：{name}"));
        }
        if !granted.contains(&permission) {
            granted.push(permission);
        }
    }
    state
        .plugins
        .set_granted_permissions(
            &plugin_id,
            &serde_json::to_value(&granted).map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())?;
    if record.enabled && !missing_permissions(&manifest, &granted).is_empty() {
        state
            .plugins
            .set_enabled(&plugin_id, false)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn set_plugin_hooks(
    state: State<'_, AppState>,
    plugin_id: String,
    hooks: Vec<String>,
) -> CmdResult<()> {
    let record = state
        .plugins
        .get(&plugin_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Plugin not installed")?;
    let manifest = effective_manifest(&record)?;
    let mut enabled_hooks = Vec::new();
    for name in hooks {
        let hook = parse_hook_name(&name).ok_or_else(|| format!("未知插件触发点：{name}"))?;
        if !manifest.hooks.contains(&hook) {
            return Err(format!("插件不支持触发点：{name}"));
        }
        if !enabled_hooks.contains(&hook) {
            enabled_hooks.push(hook);
        }
    }
    state
        .plugins
        .set_enabled_hooks(
            &plugin_id,
            &serde_json::to_value(&enabled_hooks).map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_plugin_config(
    state: State<'_, AppState>,
    plugin_id: String,
    config: Value,
) -> CmdResult<()> {
    let record = state
        .plugins
        .get(&plugin_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Plugin not installed")?;
    let manifest = effective_manifest(&record)?;
    if matches!(manifest.kind, plugin_runtime::PluginKind::AiPrompt)
        && config
            .get("apiKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(
            "API Key 不能写入插件 JSON；请使用“AI Provider”设置，它会保存到系统凭据库。".into(),
        );
    }
    state
        .plugins
        .set_config(&plugin_id, &config)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_plugin(state: State<'_, AppState>, plugin_id: String) -> CmdResult<()> {
    state
        .plugins
        .delete(&plugin_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
    asset_name: String,
    public_url: String,
    mime_type: String,
) -> CmdResult<Value> {
    let r = state
        .plugins
        .get(&plugin_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Plugin not installed")?;
    if !r.enabled {
        return Err("Plugin is disabled".into());
    }
    let granted_permissions: Vec<PluginPermission> =
        serde_json::from_value(r.granted_permissions_json.clone()).unwrap_or_default();
    let m = effective_manifest(&r)?;
    if !m.hooks.is_empty() && !record_hooks(&r).contains(&PluginHook::ManualTrigger) {
        return Err("插件未启用 manual_trigger 触发点".into());
    }
    let mut config = r.config_json.clone();
    if matches!(m.kind, plugin_runtime::PluginKind::AiPrompt) {
        let ai = load_ai_settings(state.inner()).await?;
        if let Some(obj) = config.as_object_mut() {
            for key in ["baseUrl", "model", "apiKey"] {
                if obj
                    .get(key)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .is_empty()
                {
                    if let Some(v) = ai.get(key) {
                        obj.insert(key.into(), v.clone());
                    }
                }
            }
        }
    }
    let started = std::time::Instant::now();
    let result = plugin_runtime::execute_for_hook(
        &m,
        &granted_permissions,
        &config,
        &PluginContext {
            asset_name,
            public_url,
            mime_type,
            metadata: json!({"source":"manual"}),
        },
        PluginHook::ManualTrigger,
    )
    .await;
    let duration_ms = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
    match result {
        Ok(out) => {
            let _ = state
                .plugins
                .record_execution(
                    &m.id,
                    &m.name,
                    "manual_trigger",
                    "success",
                    duration_ms,
                    None,
                )
                .await;
            Ok(json!({"text":out.text,"data":out.data}))
        }
        Err(error) => {
            let message = error.to_string();
            let audit: String = message.chars().take(1200).collect();
            let _ = state
                .plugins
                .record_execution(
                    &m.id,
                    &m.name,
                    "manual_trigger",
                    "failed",
                    duration_ms,
                    Some(&audit),
                )
                .await;
            Err(message)
        }
    }
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> CmdResult<Value> {
    load_ai_settings(state.inner()).await
}
#[tauri::command]
pub async fn save_ai_settings(state: State<'_, AppState>, mut settings: Value) -> CmdResult<Value> {
    let key = settings
        .get("apiKey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if key.is_empty() {
        let _ = state.credentials.delete(AI_CREDENTIAL_KEY);
    } else {
        state
            .credentials
            .set_json(AI_CREDENTIAL_KEY, &key)
            .map_err(|e| e.to_string())?;
    }
    if let Some(obj) = settings.as_object_mut() {
        obj.remove("apiKey");
    }
    state
        .settings
        .set(AI_SETTINGS_KEY, &settings)
        .await
        .map_err(|e| e.to_string())?;
    load_ai_settings(state.inner()).await
}
#[tauri::command]
pub async fn ai_plan_workflow(state: State<'_, AppState>, request: String) -> CmdResult<Value> {
    let settings = load_ai_settings(state.inner()).await?;
    let base = settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or("baseUrl missing")?;
    let model = settings
        .get("model")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or("model missing")?;
    let plugins = state
        .plugins
        .list()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|p| p.enabled)
        .map(|p| json!({"id":p.id,"name":p.name}))
        .collect::<Vec<_>>();
    let prompt = format!(
        "You are a workflow planner for an image publishing app. User request: {request}. Installed plugins: {}. Return strict JSON with keys name, steps, suggestedPlugins, explanation. Never claim an action was executed.",
        serde_json::to_string(&plugins).unwrap_or_default()
    );
    let mut req=reqwest::Client::new().post(format!("{}/chat/completions",base.trim_end_matches('/'))).json(&json!({"model":model,"response_format":{"type":"json_object"},"messages":[{"role":"user","content":prompt}]}));
    if let Some(key) = settings
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        req = req.bearer_auth(key)
    }
    let v: Value = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let text = v
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or("AI returned no content")?;
    serde_json::from_str(text).map_err(|e| format!("AI returned invalid JSON: {e}"))
}
