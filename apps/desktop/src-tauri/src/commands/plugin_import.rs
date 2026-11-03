use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use super::*;
use plugin_runtime::{PluginHook, PluginManifest, PluginPermission};
use tokio::io::AsyncReadExt;

pub struct PendingPluginImport {
    manifest: PluginManifest,
    created: Instant,
}
pub type PendingPluginImports = Arc<Mutex<HashMap<String, PendingPluginImport>>>;
pub fn new_import_store() -> PendingPluginImports {
    Arc::new(Mutex::new(HashMap::new()))
}

fn take_preview(store: &PendingPluginImports, id: &str, now: Instant) -> CmdResult<PluginManifest> {
    let entry = store
        .lock()
        .map_err(|_| "导入状态不可用")?
        .remove(id)
        .ok_or("导入预览已过期，请重新选择文件")?;
    if now
        .checked_duration_since(entry.created)
        .is_none_or(|age| age >= Duration::from_secs(300))
    {
        return Err("导入预览已过期，请重新选择文件".into());
    }
    Ok(entry.manifest)
}

fn stage_preview(
    store: &PendingPluginImports,
    manifest: PluginManifest,
    now: Instant,
) -> CmdResult<String> {
    let mut entries = store.lock().map_err(|_| "导入状态不可用")?;
    entries.retain(|_, value| {
        now.checked_duration_since(value.created)
            .is_some_and(|age| age < Duration::from_secs(300))
    });
    if entries.len() >= 4 {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, value)| value.created)
            .map(|(id, _)| id.clone())
        {
            entries.remove(&oldest);
        }
    }
    let id = Uuid::new_v4().to_string();
    entries.insert(
        id.clone(),
        PendingPluginImport {
            manifest,
            created: now,
        },
    );
    Ok(id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginImportPreview {
    pub import_id: String,
    pub plugin: plugins::PluginView,
}

#[tauri::command]
pub async fn preview_local_plugin(
    state: State<'_, AppState>,
    pending: State<'_, PendingPluginImports>,
    path: String,
) -> CmdResult<PluginImportPreview> {
    let path = PathBuf::from(path);
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err("请选择本地 JSON Manifest 文件".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("Manifest 导入只允许本地磁盘文件".into());
    }
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|_| "无法读取 Manifest 文件")?;
    if !metadata.is_file() || metadata.len() > plugin_runtime::manifest::MAX_MANIFEST_BYTES as u64 {
        return Err("Manifest 必须是非空且不超过 256 KiB 的文件".into());
    }
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| "无法读取 Manifest 文件")?;
    let mut bytes = Vec::new();
    file.take((plugin_runtime::manifest::MAX_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Manifest 读取失败")?;
    let manifest = plugin_runtime::manifest::parse_local_manifest(&bytes)?;
    if state
        .plugins
        .get(&manifest.id)
        .await
        .map_err(|_| "无法检查已安装插件")?
        .is_some()
    {
        return Err("插件 ID 已存在，不会覆盖已有配置".into());
    }
    let config = plugin_runtime::manifest::default_config(&manifest)?;
    let grants = vec![PluginPermission::ReadAsset];
    let hooks = initial_hooks(&manifest);
    let plugin =
        plugins::manifest_to_view(&manifest, false, false, "local", config, &grants, &hooks);
    let import_id = stage_preview(&pending, manifest, Instant::now())?;
    Ok(PluginImportPreview { import_id, plugin })
}

fn initial_hooks(manifest: &PluginManifest) -> Vec<PluginHook> {
    if manifest.hooks.contains(&PluginHook::AfterUpload) {
        vec![PluginHook::AfterUpload]
    } else {
        vec![]
    }
}

#[tauri::command]
pub async fn install_local_plugin(
    state: State<'_, AppState>,
    pending: State<'_, PendingPluginImports>,
    import_id: String,
) -> CmdResult<plugins::PluginView> {
    // Confirmation consumes exactly the backend-owned preview; never reopens a mutable file.
    let manifest = take_preview(&pending, &import_id, Instant::now())?;
    manifest.validate_contract(true)?;
    let config = plugin_runtime::manifest::default_config(&manifest)?;
    let grants = vec![PluginPermission::ReadAsset];
    let hooks = initial_hooks(&manifest);
    let now = Utc::now();
    let record = PluginRecord {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        manifest_json: serde_json::to_value(&manifest).map_err(|_| "Manifest 保存失败")?,
        config_json: config.clone(),
        granted_permissions_json: serde_json::to_value(&grants).map_err(|_| "权限保存失败")?,
        enabled_hooks_json: serde_json::to_value(&hooks).map_err(|_| "触发器保存失败")?,
        enabled: false,
        source: "local".into(),
        created_at: now,
        updated_at: now,
    };
    if !state
        .plugins
        .insert_if_absent(&record)
        .await
        .map_err(|_| "插件安装失败，原配置未覆盖")?
    {
        return Err("插件 ID 已存在，不会覆盖已有配置".into());
    }
    Ok(plugins::manifest_to_view(
        &manifest, true, false, "local", config, &grants, &hooks,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_are_single_use_and_expired_previews_cannot_install() {
        let manifest = plugin_runtime::manifest::parse_local_manifest(include_bytes!(
            "../../../../../examples/plugins/markdown-card.plugin.json"
        ))
        .unwrap();
        let store = new_import_store();
        let created = Instant::now();
        store.lock().unwrap().insert(
            "fresh".into(),
            PendingPluginImport {
                manifest: manifest.clone(),
                created,
            },
        );
        assert!(take_preview(&store, "fresh", created).is_ok());
        assert!(take_preview(&store, "fresh", created).is_err());
        store
            .lock()
            .unwrap()
            .insert("old".into(), PendingPluginImport { manifest, created });
        assert!(take_preview(&store, "old", created + Duration::from_secs(301)).is_err());
        assert!(store.lock().unwrap().is_empty());
    }

    #[test]
    fn abandoned_previews_are_bounded_and_oldest_is_evicted() {
        let manifest = plugin_runtime::manifest::parse_local_manifest(include_bytes!(
            "../../../../../examples/plugins/markdown-card.plugin.json"
        ))
        .unwrap();
        let store = new_import_store();
        let now = Instant::now();
        let first = stage_preview(&store, manifest.clone(), now).unwrap();
        for seconds in 1..5 {
            stage_preview(&store, manifest.clone(), now + Duration::from_secs(seconds)).unwrap();
        }
        assert_eq!(store.lock().unwrap().len(), 4);
        assert!(take_preview(&store, &first, now + Duration::from_secs(5)).is_err());
    }
}
