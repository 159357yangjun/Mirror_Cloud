pub mod cli;
mod commands;
mod rollback;
mod services;
mod update_security;
mod window_layout;

use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use credential_store::CredentialStore;
use persistence_sqlite::asset_staging::AssetStagingRepository;
use persistence_sqlite::{
    AssetRepository, PluginRepository, SettingsRepository, StorageGroupRepository,
    StorageRepository, TaskRepository, WorkflowRepository, journal::SqliteEventJournal,
};
use task_engine::TaskEngine;
use tauri::Manager;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub storages: StorageRepository,
    pub assets: AssetRepository,
    pub asset_staging: AssetStagingRepository,
    pub settings: SettingsRepository,
    pub groups: StorageGroupRepository,
    pub workflows: WorkflowRepository,
    pub plugins: PluginRepository,
    /// Durable domain event journal. Separate from `tasks`: the task table answers "what is running
    /// now", the journal answers "what happened, in order".
    pub journal: SqliteEventJournal,
    pub tasks: TaskEngine,
    pub credentials: CredentialStore,
    pub upload_semaphore: Arc<tokio::sync::Semaphore>,
    pub data_dir: PathBuf,
    pub local_api_token: Arc<RwLock<String>>,
    pub local_api_running: Arc<AtomicBool>,
    /// 插件内核（ADR 0001/0005）：内置插件注册表与 `plugin_invoke` 分发。
    /// 插件方法可 await，故用 tokio RwLock，命令侧 `read().await` 后调用。
    pub kernel: Arc<tokio::sync::RwLock<kernel::Kernel>>,
}

/// Bring the main window back into view: unminimise, show, focus - in that order, because a
/// minimised window that is merely shown stays invisible on Windows.
fn restore_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        restore_main_window_inner(window);
    }
}

fn restore_main_window_inner(window: tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // A second launch must wake the window that is already running, not start a rival process.
    // Without this the app has no single-instance guard at all: Windows spawns instance #2, it
    // reaches setup(), finds the SQLite file locked by instance #1, and dies during migration -
    // which is what users see as "clicking the icon makes it flash and vanish". The callback also
    // runs for the FIRST instance; `open_paths` is empty there, so restoring only on a non-empty
    // argument list keeps the initial window untouched.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, open_paths, _| {
        if !open_paths.is_empty() {
            restore_main_window(app.clone());
        }
    }));
    builder
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window_layout::configure_initial_window(&window)?;
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("publisher.sqlite3");
            let pool = tauri::async_runtime::block_on(persistence_sqlite::connect_path(&db_path))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let journal = SqliteEventJournal::new(pool.clone());
            tauri::async_runtime::block_on(persistence_sqlite::migrate(&pool))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let task_repo = TaskRepository::new(pool.clone());
            tauri::async_runtime::block_on(task_repo.recover_interrupted())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let credentials = CredentialStore::new("com.multicloud.publisher");
            let local_api_token =
                commands::integrations::load_or_create_local_api_token(&credentials)
                    .map_err(std::io::Error::other)?;
            let local_api_token = Arc::new(RwLock::new(local_api_token));
            let local_api_running = Arc::new(AtomicBool::new(false));
            // 内置插件全部注册后才进入事件循环；任何清单错误都在启动期暴露。
            let mut kernel = kernel::Kernel::with_builtin_plugins()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let storages = StorageRepository::new(pool.clone());
            let assets = AssetRepository::new(pool.clone());
            let asset_staging = AssetStagingRepository::new(pool.clone());
            let settings = SettingsRepository::new(pool.clone());
            let groups = StorageGroupRepository::new(pool.clone());
            let workflows = WorkflowRepository::new(pool.clone());
            let plugins = PluginRepository::new(pool.clone());
            let tasks = TaskEngine::new(task_repo);
            // P2：diagnostics 换成真实实现（ADR 0005）。清单仍以内核装配表为准。
            kernel
                .register_override(Arc::new(plugin_diagnostics::DiagnosticsPlugin::new(
                    storages.clone(),
                    plugins.clone(),
                    workflows.clone(),
                    tasks.clone(),
                    data_dir.clone(),
                    local_api_running.clone(),
                    env!("CARGO_PKG_VERSION").to_string(),
                )))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            // P2：AI 助手也换成真实实现（设置 + 凭据库）。
            kernel
                .register_override(Arc::new(plugin_ai_assistant::AiAssistantPlugin::new(
                    settings.clone(),
                    plugins.clone(),
                    credentials.clone(),
                )))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            // P2：工作流也换成真实实现（工作流 + 存储 + 多云组仓储）。
            kernel
                .register_override(Arc::new(plugin_workflow::WorkflowPlugin::new(
                    workflows.clone(),
                    storages.clone(),
                    groups.clone(),
                )))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            // P2：发布策略（多云组创建/列出/删除）换成真实实现；默认目标守卫与管线清理仍留内核。
            kernel
                .register_override(Arc::new(
                    plugin_publish_strategy::PublishStrategyPlugin::new(
                        storages.clone(),
                        groups.clone(),
                    ),
                ))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            // P2：三个 provider 插件换成真实构造器实例（复用装配表已声明的 provider.* 贡献）。
            // 宿主侧 `provider_factory` 仍保留 r2/s3 的 S3 兼容兜底。
            kernel
                .register_override(Arc::new(plugin_provider_github::ProviderGitHubPlugin))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            kernel
                .register_override(Arc::new(plugin_provider_gitee::ProviderGiteePlugin))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            kernel
                .register_override(Arc::new(
                    plugin_provider_opendal_extra::ProviderOpenDalExtraPlugin,
                ))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            // P2：索引对账换成真实实现（扫描 + 调度 + 后台循环）；provider 注册表按 Arc 注入，
            // 插件不再经 AppState 间接取依赖。后台循环在 `app.manage` 之后由同一实例启动。
            let reconcile = Arc::new(plugin_reconcile::ReconcilePlugin::new(
                assets.clone(),
                storages.clone(),
                journal.clone(),
                settings.clone(),
                credentials.clone(),
                services::provider_factory::provider_registry(),
            ));
            kernel
                .register_override(reconcile.clone())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let state = AppState {
                storages,
                assets,
                asset_staging,
                settings,
                groups,
                workflows,
                plugins,
                journal,
                tasks,
                credentials,
                upload_semaphore: Arc::new(tokio::sync::Semaphore::new(4)),
                data_dir: data_dir.clone(),
                local_api_token: local_api_token.clone(),
                local_api_running: local_api_running.clone(),
                kernel: Arc::new(RwLock::new(kernel)),
            };
            app.manage(state);
            app.manage(commands::updater::new_pending_store());
            app.manage(commands::plugin_import::new_import_store());
            commands::integrations::setup_tray(app)?;
            commands::integrations::setup_global_shortcut(app)?;
            commands::integrations::start_local_http_api(
                data_dir,
                local_api_token,
                local_api_running,
            );
            // 后台对账循环由插件自持；默认关闭，启用前不产生远端请求（见 cadence 模块）。
            reconcile.start_background();
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_snapshot,
            commands::create_s3_storage,
            commands::create_object_storage,
            commands::create_webdav_storage,
            commands::create_repository_storage,
            commands::list_storages,
            commands::export_portable_storage_manifest,
            commands::inspect_portable_storage_manifest,
            commands::export_portable_reference_manifest,
            commands::inspect_portable_reference_manifest,
            commands::preview_portable_reference_restore,
            commands::restore_portable_storage_group,
            commands::export_portable_group_mapping,
            commands::inspect_portable_group_mapping,
            commands::restore_portable_workflow,
            commands::export_portable_reconnect_map,
            commands::inspect_portable_reconnect_map,
            commands::export_portable_asset_manifest,
            commands::inspect_portable_asset_manifest,
            commands::preview_portable_asset_restore,
            commands::stage_portable_asset_manifest,
            commands::list_portable_asset_staging,
            commands::list_portable_staged_items,
            commands::update_portable_staged_item_review,
            commands::assess_portable_asset_activation,
            commands::apply_portable_staged_batch_decision,
            commands::discard_portable_asset_staging,
            commands::get_default_publish_target,
            commands::set_default_publish_target,
            commands::delete_storage,
            commands::test_storage,
            commands::browse_storage,
            commands::create_temporary_share_link,
            commands::preview_private_storage_entry,
            commands::sync_storage_asset_index,
            commands::delete_storage_entry,
            commands::download_storage_entry,
            commands::move_storage_entry,
            commands::create_storage_directory,
            commands::batch_delete_storage_entries,
            commands::batch_move_storage_entries,
            commands::batch_rename_storage_entries,
            commands::queue_batch_delete_storage_entries,
            commands::queue_batch_move_storage_entries,
            commands::queue_batch_rename_storage_entries,
            commands::cancel_task,
            commands::retry_task,
            commands::reconcile::run_reconciliation_sweep,
            commands::reconcile::get_reconciliation_settings,
            commands::reconcile::set_reconciliation_settings,
            commands::reconcile::get_reconciliation_history,
            commands::create_storage_group,
            commands::list_storage_groups,
            commands::delete_storage_group,
            commands::list_recipes,
            commands::create_workflow_from_recipe,
            commands::create_custom_workflow,
            commands::list_workflows,
            commands::set_default_workflow,
            commands::delete_workflow,
            commands::publish_files_with_workflow,
            commands::publish_urls_with_workflow,
            commands::publish_clipboard_image_with_workflow,
            commands::repair_asset,
            commands::delete_asset,
            commands::integrations::get_typora_integration_info,
            commands::integrations::open_typora,
            commands::integrations::open_app_data_dir,
            commands::integrations::get_output_preferences,
            commands::integrations::save_output_preferences,
            commands::updater::check_for_updates,
            commands::updater::get_update_status,
            commands::updater::download_update,
            commands::updater::install_update,
            commands::integrations::get_system_diagnostics,
            commands::integrations::get_local_api_info,
            commands::integrations::regenerate_local_api_token,
            commands::integrations::get_global_shortcut_info,
            commands::integrations::set_global_shortcut_enabled,
            commands::integrations::get_windows_context_menu_info,
            commands::integrations::install_windows_context_menu,
            commands::integrations::uninstall_windows_context_menu,
            commands::list_tasks,
            commands::list_assets,
            commands::list_marketplace_plugins,
            commands::list_plugins,
            commands::list_plugin_execution_logs,
            commands::install_marketplace_plugin,
            commands::preview_local_plugin,
            commands::install_local_plugin,
            commands::set_plugin_enabled,
            commands::set_plugin_permissions,
            commands::set_plugin_hooks,
            commands::save_plugin_config,
            commands::delete_plugin,
            commands::run_plugin,
            commands::get_ai_settings,
            commands::save_ai_settings,
            commands::ai_plan_workflow,
            commands::plugin_invoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Multi-cloud Publisher");
}
