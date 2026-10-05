pub mod cli;
mod commands;
pub mod reconcile_cadence;
mod rollback;

use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use credential_store::CredentialStore;
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("publisher.sqlite3");
            let pool = tauri::async_runtime::block_on(persistence_sqlite::connect_path(&db_path))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
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
            let state = AppState {
                storages: StorageRepository::new(pool.clone()),
                assets: AssetRepository::new(pool.clone()),
                settings: SettingsRepository::new(pool.clone()),
                groups: StorageGroupRepository::new(pool.clone()),
                workflows: WorkflowRepository::new(pool.clone()),
                plugins: PluginRepository::new(pool.clone()),
                journal: persistence_sqlite::journal::SqliteEventJournal::new(pool),
                tasks: TaskEngine::new(task_repo),
                credentials,
                upload_semaphore: Arc::new(tokio::sync::Semaphore::new(4)),
                data_dir: data_dir.clone(),
                local_api_token: local_api_token.clone(),
                local_api_running: local_api_running.clone(),
            };
            app.manage(state);
            app.manage(commands::updater::new_pending_store());
            commands::integrations::setup_tray(app)?;
            commands::integrations::setup_global_shortcut(app)?;
            commands::integrations::start_local_http_api(
                data_dir,
                local_api_token,
                local_api_running,
            );
            commands::reconcile::start_background_reconciler(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_snapshot,
            commands::create_s3_storage,
            commands::create_object_storage,
            commands::create_webdav_storage,
            commands::create_repository_storage,
            commands::list_storages,
            commands::get_default_publish_target,
            commands::set_default_publish_target,
            commands::delete_storage,
            commands::test_storage,
            commands::browse_storage,
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
            commands::set_plugin_enabled,
            commands::set_plugin_permissions,
            commands::set_plugin_hooks,
            commands::save_plugin_config,
            commands::delete_plugin,
            commands::run_plugin,
            commands::get_ai_settings,
            commands::save_ai_settings,
            commands::ai_plan_workflow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Multi-cloud Publisher");
}
