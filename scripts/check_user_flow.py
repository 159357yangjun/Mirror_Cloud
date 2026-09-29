from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
checks = []

def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')

def require(ok: bool, label: str):
    checks.append((ok, label))

def slice_between(source: str, start_marker: str, end_marker: str, label: str) -> str:
    """A missing marker has to fail loudly. str.find() returns -1, which otherwise turns the
    slice into "everything up to the last character" and makes checks built on it pass while
    examining nothing."""
    start = source.find(start_marker)
    end = source.find(end_marker, start + 1) if start != -1 else -1
    if start == -1 or end == -1:
        raise SystemExit(
            f'User-flow check boundary is broken for {label}: '
            f'{start_marker!r} .. {end_marker!r} not found in order'
        )
    return source[start:end]

commands_main = text('apps/desktop/src-tauri/src/commands.rs')
storage_entries_commands = text('apps/desktop/src-tauri/src/commands/storage_entries.rs')
plugin_commands = text('apps/desktop/src-tauri/src/commands/plugins.rs')
commands = commands_main + '\n' + storage_entries_commands + '\n' + plugin_commands
cli = text('apps/desktop/src-tauri/src/cli.rs')
upload = text('apps/desktop/src/components/UploadDialog.tsx')
app_shell = text('apps/desktop/src/components/AppShell.tsx')
types = text('apps/desktop/src/types.ts')
assets = text('apps/desktop/src/pages/AssetsPage.tsx')
plugins = text('apps/desktop/src/pages/PluginsPage.tsx')
lib = text('apps/desktop/src-tauri/src/lib.rs')
persistence = text('crates/persistence-sqlite/src/lib.rs')
migration8 = text('crates/persistence-sqlite/migrations/0008_asset_plugin_outputs.sql')
application = text('crates/application/src/lib.rs')
publish_page = text('apps/desktop/src/pages/PublishPage.tsx')
desktop = text('apps/desktop/src/lib/desktop.ts')
gallery = text('apps/desktop/src/pages/GalleryPage.tsx')

# UX no longer exposes Workflow/方案 as a top-level page.
require("key: 'workflows'" not in app_shell, 'no Workflow navigation item')
require("'workflows'" not in types.split('export type PageKey', 1)[1].split('\n', 1)[0], 'PageKey hides workflows')

# A connected storage creates or repairs the hidden automatic pipeline.
require(commands.count('persist_new_storage(state.inner(), &record).await?;') >= 4, 'all storage creation paths persist and auto-ensure pipeline')
require('sync_system_default_pipeline' in commands and 'SYSTEM_PIPELINE_SOURCE' in commands, 'hidden system pipeline exists')
require('set_default_publish_target' in commands and 'get_default_publish_target' in commands, 'default cloud target commands exist')
require('commands::set_default_publish_target' in lib and 'commands::get_default_publish_target' in lib, 'default cloud target commands registered')

# Every desktop input mode uses the same hidden workflow.
require('publishFilesWithWorkflow(defaultWorkflow.id, paths)' in upload, 'local files use automatic pipeline')
require('publishUrlsWithWorkflow(defaultWorkflow.id, urls)' in upload, 'URL upload uses automatic pipeline')
require('publishClipboardImageWithWorkflow(defaultWorkflow.id)' in upload, 'clipboard upload uses automatic pipeline')

# Typora self-heals the same pipeline.
require('ensure_default_workflow(&context).await?' in cli, 'Typora auto-ensures default pipeline')
require('upsert_system_default' in cli, 'Typora persists automatic pipeline')

# Plugin outputs survive execution and are exposed.
require('replace_plugin_outputs' in persistence, 'asset plugin outputs persistence API exists')
require('CREATE TABLE IF NOT EXISTS asset_plugin_outputs' in migration8, 'asset plugin outputs migration exists')
require('persist_plugin_outputs(&state, asset.id, &plugin_run.outputs).await' in commands, 'desktop persists plugin outputs')
require('replace_plugin_outputs(asset.id, &outputs)' in cli, 'Typora persists plugin outputs')
require('asset.pluginOutputs' in assets, 'resource UI renders plugin outputs')

# Publish event happens after plugin execution and carries outputs.
require('pluginOutputs' in commands[commands.find('fn emit_asset_published'):], 'final publish event carries plugin outputs')

# Plugin onboarding defaults safely off and validates before enable.
require(re.search(r'enabled\s*:\s*false', commands) is not None, 'marketplace plugins install disabled')
require('validate_plugin_ready' in commands, 'plugin enable readiness validation exists')
require('setPluginEnabled' in plugins, 'plugin UI controls real backend switch')

# AI credentials are not persisted in normal SQLite settings.
require('AI_CREDENTIAL_KEY' in commands and re.search(r'credentials\s*\.\s*set_json\(\s*AI_CREDENTIAL_KEY', commands) is not None, 'AI API key uses credential store')
require('obj.remove("apiKey")' in commands, 'AI API key removed before settings persistence')

failed = [label for ok, label in checks if not ok]
for ok, label in checks:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow contract: OK | checks: {len(checks)}')

# v1.2.3 reliability hardening.
github = text('crates/storage-github/src/lib.rs')
plugin_runtime = text('crates/plugin-runtime/src/lib.rs')
ci = text('.github/workflows/ci.yml')
release = text('.github/workflows/release.yml')
group_dialog = text('apps/desktop/src/components/StorageGroupDialog.tsx')
migration9 = text('crates/persistence-sqlite/migrations/0009_upgrade_official_ai_caption.sql')
migration10 = text('crates/persistence-sqlite/migrations/0010_plugin_permission_grants.sql')

require('permissions/push' in github and 'Contents: Read and write' in github, 'GitHub connection test checks repository write access')
require('PublisherCore::publish_group' in commands and 'backups.sort_by_key(|member| member.priority)' in application and 'if !primary_succeeded {' in application, 'desktop group publish delegates ordered first-success backup failover to PublisherCore')
require('PublisherCore::publish_group' in cli and 'UploadRequest' not in cli and 'if !primary_succeeded {' not in cli and 'backups.sort_by_key(' not in cli, 'Typora/CLI publish delegates multi-cloud strategy to PublisherCore instead of keeping a second implementation')
require('Backup 仅在 Primary 失败时接管' in group_dialog, 'Storage Group UI explains failover semantics')
require('PermissionDenied' in plugin_runtime and 'require_permission' in plugin_runtime, 'plugin runtime enforces manifest permissions')
require('PluginPermission::ExternalWrite' in plugin_runtime, 'webhook requires external_write permission at runtime')
require('PluginPermission::Secret' in plugin_runtime, 'AI API key access requires secret permission at runtime')
require('"type": "image_url"' in plugin_runtime and '"detail": "auto"' in plugin_runtime, 'AI caption sends actual image as multimodal input')
require('official.ai-caption' in migration9 and '"secret"' in migration9, 'existing AI Caption installs migrate to secret permission')
require('cargo generate-lockfile' not in ci and 'npm ci' in ci and '--locked' in ci and all((ROOT / rel).exists() for rel in ('Cargo.lock', 'apps/desktop/package-lock.json', 'website/package-lock.json')), 'CI consumes committed dependency locks without regenerating them')
require('cargo generate-lockfile' not in release and release.count('npm ci') >= 2 and '--locked' in release, 'release build consumes committed dependency locks without regenerating them')

require('granted_permissions: &[PluginPermission]' in plugin_runtime and 'granted_permissions.contains(&permission)' in plugin_runtime, 'plugin runtime requires explicit user grants')
require('granted_permissions_json' in persistence and 'set_granted_permissions' in persistence, 'plugin grants persist separately from manifest declarations')
require('granted_permissions_json' in migration10 and 'read_asset' in migration10 and 'SET enabled = 0' in migration10, 'existing sensitive plugins are disabled until explicit re-authorization')
require('set_plugin_permissions' in commands and 'commands::set_plugin_permissions' in lib, 'plugin permission grant command is registered')
require('grantedPermissions' in plugins and 'setPluginPermissions' in plugins and 'window.confirm' in plugins, 'plugin UI requests user approval before sensitive permission use')
require('permissions: plugin.permissions.filter' in plugins and 'revokeSensitivePermissions' in plugins, 'plugin UI can revoke sensitive grants')
require(re.search(r'execute_for_hook\(\s*&manifest,\s*&granted_permissions', cli) is not None, 'Typora plugin runtime uses persisted user grants')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-18:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow reliability hardening: OK | total checks: {len(checks)}')

# v1.2.5 consistency and integrity hardening.
gitee = text('crates/storage-gitee/src/lib.rs')
opendal = text('crates/storage-opendal/src/lib.rs')
workflow_engine = text('crates/workflow-engine/src/lib.rs')

preflight_desktop = commands[commands.find('async fn preflight_workflow_target'):commands.find('fn build_provider', commands.find('async fn preflight_workflow_target'))]
preflight_cli = cli[cli.find('async fn preflight_target'):cli.find('fn build_provider', cli.find('async fn preflight_target'))]
url_publish = commands[commands.find('pub async fn publish_urls_with_workflow'):commands.find('pub async fn publish_clipboard_image_with_workflow')]

require('.test_connection().await' not in preflight_desktop and 'build_provider' in preflight_desktop, 'desktop preflight does not block runtime failover on primary network health')
require('.test_connection().await' not in preflight_cli and 'build_provider' in preflight_cli, 'Typora preflight does not block runtime failover on primary network health')
require(url_publish.find('for url in &urls') < url_publish.find('let mut task_ids'), 'URL batch validates every URL before creating tasks')
require('for path in paths {' in cli[:cli.find('std::fs::create_dir_all')] and 'path.is_file()' in cli[:cli.find('std::fs::create_dir_all')], 'Typora validates full local batch before first task/upload')
require('{uuid}' in commands and '{uuid}' in cli and '{uuid}' in workflow_engine, 'new automatic remote paths include UUID uniqueness')
require('active_deployment_reference_count' in persistence and 'reference_count > 1' in commands, 'asset deletion protects shared legacy remote paths')
require('actual_hash == context.content_hash' in commands and 'DeploymentStatus::Degraded' in commands, 'repair source is hash-verified before propagation')
require('complete_with_note(task.id' in cli and 'Publisher warning:' in cli, 'Typora persists partial publish/plugin warnings')
require('warningTasks' in upload and 'TriangleAlert' in upload, 'upload dialog surfaces completed-with-warning state')
require('API Key 不能写入插件 JSON' in commands and re.search(r'config\s*\.\s*get\(\s*"apiKey"\s*\)', commands) is not None, 'generic plugin JSON cannot persist AI API keys')
require('let verified_sha = self.existing_sha(&repository_path).await?' in gitee and 'remote SHA verification failed' in gitee, 'Gitee upload verifies remote object after write')
require('self.operator.stat(&remote_path)' in opendal and 'content_length() != expected_len' in opendal, 'OpenDAL upload verifies remote size after write')
require('reqwest::Url::parse(value)' in commands and 'url.host_str().is_none()' in commands, 'public base URLs are structurally validated')
require('rollback_successful_uploads' in commands and '可能存在孤儿文件' in commands, 'desktop compensates remote uploads when local persistence fails')
require('rollback_successful_uploads' in cli and 'orphan files may remain' in cli, 'Typora compensates remote uploads when local persistence/public URL fails')
require('is_safe_compensation_path' in commands and 'u{uuid}' in commands, 'compensation delete is limited to explicitly unique new paths')
require('workflows.find((workflow) => workflow.isDefault)' in upload and '?? workflows[0]' not in upload, 'upload UI never falls back to an arbitrary legacy workflow')
require('async fn persist_new_storage' in commands and commands.count('persist_new_storage(state.inner(), &record).await?;') >= 4, 'storage setup only succeeds after automatic pipeline persistence')
require('sync_system_default_pipeline(state.inner(), None).await?;' in commands, 'automatic pipeline sync errors are surfaced instead of silently ignored')
require('connection-test-u' in opendal and '.write(&probe_path' in opendal and '.stat(&probe_path)' in opendal and '.delete(&probe_path)' in opendal, 'OpenDAL connection test verifies write/stat/delete permissions')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-20:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow integrity hardening: OK | total checks: {len(checks)}')

# v1.3.0 core/UI/cloud-manager architecture.
require("pub struct PublisherCore" in application and "StorageGroupStrategy::MirrorAll" in application and "StorageGroupStrategy::PrimaryWithBackups" in application, 'PublisherCore owns multi-cloud strategy semantics')
require("PublisherCore::publish_group" in commands, 'Tauri publish path delegates multi-cloud strategy to PublisherCore')
require("page: 'publish'" in text('apps/desktop/src/store/useAppStore.ts') and "key: 'publish'" in app_shell, 'Publish Center is the default product entry point')
require("getCurrentWebviewWindow().onDragDropEvent" in publish_page and "openUpload('clipboard')" in publish_page and "openUpload('urls')" in publish_page, 'Publish Center exposes drag/drop clipboard and URL entry points')
require("setDefaultPublishTarget" in publish_page and "saveOutputPreferences" in publish_page, 'Publish Center controls target and output format without duplicating publish logic')
require("delete_storage_entry" in commands and "download_storage_entry" in commands and "commands::delete_storage_entry" in lib and "commands::download_storage_entry" in lib, 'cloud file delete/download commands are implemented and registered')
require("deployment_ids_for_remote" in persistence and "DeploymentStatus::Deleted" in commands[commands.find('pub async fn delete_storage_entry'):commands.find('pub async fn download_storage_entry')], 'direct cloud delete reconciles local Deployment state')
require("deleteStorageEntry" in desktop and "downloadStorageEntry" in desktop and "chooseDownloadPath" in desktop, 'frontend exposes safe cloud file management APIs')
require("deleteStorageEntry" in gallery and "downloadStorageEntry" in gallery and "window.confirm" in gallery, 'Gallery exposes confirmed delete and download actions')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-9:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3 architecture: OK | total checks: {len(checks)}')

# v1.3.1 integration/performance architecture.
integrations = text('apps/desktop/src-tauri/src/commands/integrations.rs')
settings_page = text('apps/desktop/src/pages/SettingsPage.tsx')
cargo_desktop = text('apps/desktop/src-tauri/Cargo.toml')
cargo_root = text('Cargo.toml')

require('pub(crate) mod integrations;' in commands_main and 'get_typora_integration_info' not in commands_main, 'integration commands moved out of the monolithic command module')
require('TcpListener::bind(&address)' in integrations and '127.0.0.1' in integrations, 'Local HTTP API binds loopback only')
require('LOCAL_API_CREDENTIAL_KEY' in integrations and 'CredentialStore' in integrations and 'Bearer {expected}' in integrations, 'Local HTTP API token is credential-backed and enforced')
require('MAX_BODY_BYTES' in integrations and '32 * 1024 * 1024' in integrations, 'Local HTTP API enforces request body limit')
require(integrations.count('cli::upload_with_default_workflow') >= 2, 'Local API raw/path uploads reuse the default workflow bridge')
require('get_local_api_info' in integrations and 'regenerate_local_api_token' in integrations and 'commands::integrations::get_local_api_info' in lib, 'Local API status/token commands are registered')
require('TrayIconBuilder' in integrations and 'setup_tray(app)?' in lib and 'CloseRequested' in lib and 'api.prevent_close()' in lib, 'tray background mode keeps integrations available when the main window closes')
require('features = ["tray-icon"]' in cargo_desktop and '"net", "io-util"' in cargo_root, 'Tauri tray and Tokio local networking features are enabled')
require('Local HTTP API' in settings_page and 'copyApiToken' in settings_page and 'regenerateApiToken' in settings_page, 'Settings exposes real Local API status and token controls')
require('tokio::task::spawn_blocking' in slice_between(commands_main, 'async fn run_workflow_publish_task', 'fn is_safe_compensation_path', 'workflow publish worker') and 'tokio::task::spawn_blocking' in cli[cli.find('async fn publish_one'):], 'CPU-heavy workflow image processing leaves async IO workers')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-10:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3.1 integrations: OK | total checks: {len(checks)}')

# v1.3.2 zero-context integrations and cloud-manager mutation layer.
main_rs = text('apps/desktop/src-tauri/src/main.rs')
storage_core = text('crates/storage-core/src/lib.rs')
storage_opendal = text('crates/storage-opendal/src/lib.rs')

require('tauri-plugin-global-shortcut' in cargo_desktop and 'setup_global_shortcut(app)?' in lib, 'global shortcut plugin is wired into desktop startup')
require('CommandOrControl+Shift+U' in integrations and 'publish_clipboard_from_shortcut' in integrations and 'cli::upload_with_default_workflow' in integrations, 'global shortcut performs zero-context clipboard publishing through the default workflow')
require('.unregister(GLOBAL_SHORTCUT)' in integrations and 'GLOBAL_SHORTCUT_ENABLED_KEY' in integrations, 'disabling global shortcut releases the OS registration and persists preference')
require('write_text(text.clone())' in integrations and 'integration://shortcut-uploaded' in integrations, 'global shortcut writes the final URL back to clipboard')
require('--shell-upload' in main_rs and 'write_windows_clipboard' in main_rs, 'Windows shell upload mode publishes and copies the final URL')
require('SystemFileAssociations' in integrations and 'image' in integrations and 'HKCU' in integrations and 'install_windows_context_menu' in integrations, 'Windows image context menu uses current-user registry scope')
require(r'\"{}\" --shell-upload --data-dir \"{}\" -- \"%1\"' in integrations, 'Windows context-menu command forwards the selected path with explicit quoting')
require('GlobalShortcutInfo' in types and 'WindowsContextMenuInfo' in types and '全局快捷上传' in settings_page and 'Windows 右键上传' in settings_page, 'Settings exposes real global shortcut and Explorer integration controls')
require('async fn move_object' in storage_core and 'async fn create_dir' in storage_core, 'StorageProvider port exposes cloud move and directory creation capabilities')
require('self.operator.rename(from, to)' in storage_opendal and '.create_dir(&format!' in storage_opendal, 'OpenDAL adapter implements native move and create-directory operations')
require('move_storage_entry' in commands and 'CloudMutationCore::move_object' in commands and 'CloudMutationCore' in application, 'cloud move delegates overwrite/fallback semantics to application core')
require('update_deployments_remote_location' in persistence and 'update_deployments_remote_location' in commands, 'cloud move reconciles local Deployment paths and public URLs')
require('batch_delete_storage_entries_impl' in storage_entries_commands and '一次最多批量删除 100' in storage_entries_commands and 'DeploymentStatus::Deleted' in storage_entries_commands, 'batch cloud delete is bounded and reconciles Deployment status')
require('queueBatchDeleteStorageEntries' in gallery and 'moveStorageEntry' in gallery and 'createStorageDirectory' in gallery and 'selectedPaths' in gallery and '新建云端目录' in gallery, 'Cloud Manager exposes create, rename/move, selection and queued batch delete UI')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-14:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3.2 zero-context/cloud-manager: OK | total checks: {len(checks)}')


# v1.3.3 lifecycle, batch-management and command-boundary hardening.
migration11 = text('crates/persistence-sqlite/migrations/0011_plugin_hooks.sql')
require('enabled_hooks_json' in migration11 and 'after_upload' in migration11, 'plugin hook selections persist with backward-compatible after_upload default')
require('pub enum PluginHook' in plugin_runtime and 'AfterUpload' in plugin_runtime and 'OnGalleryDelete' in plugin_runtime and 'ManualTrigger' in plugin_runtime, 'plugin runtime defines explicit lifecycle hooks')
require('execute_for_hook' in plugin_runtime and 'does not support hook' in plugin_runtime, 'plugin runtime gates execution by manifest-supported lifecycle hooks')
require('supported_hooks' in plugin_commands and 'enabled_hooks' in plugin_commands and 'set_plugin_hooks' in plugin_commands, 'plugin backend exposes supported and user-enabled hook state')
require('setPluginHooks' in plugins and '触发器' in plugins and 'on_gallery_delete' in plugins, 'plugin UI lets users control lifecycle triggers explicitly')
require('manual_trigger 触发点' in plugin_commands and 'PluginHook::ManualTrigger' in plugin_commands, 'manual plugin execution respects the user-enabled manual trigger')
require('run_gallery_delete_plugins' in commands_main and 'PluginHook::OnGalleryDelete' in commands_main and 'run_gallery_delete_plugins' in storage_entries_commands, 'cloud deletion fires enabled gallery-delete lifecycle hooks')
require('batch_move_storage_entries' in storage_entries_commands and '一次最多批量移动 100' in storage_entries_commands, 'batch cloud move is bounded')
require('batch_rename_storage_entries' in storage_entries_commands and 'render_batch_name' in storage_entries_commands and '{index}' in storage_entries_commands, 'batch rename uses bounded safe filename templates')
require('queueBatchMoveStorageEntries' in gallery and 'queueBatchRenameStorageEntries' in gallery and '批量改名' in gallery and '批量移动' in gallery, 'Cloud Manager queues batch move and rename from UI')
require('pub(crate) mod storage_entries;' in commands_main and 'pub(crate) mod plugins;' in commands_main and len(commands_main) < 140000, 'large Tauri command module is split into dedicated storage/plugin modules')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-11:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3.3 lifecycle/batch architecture: OK | total checks: {len(checks)}')


# v1.3.4 application-boundary, lifecycle and persistent batch-task hardening.
require('BeforeProcess' in plugin_runtime and 'AfterProcess' in plugin_runtime and 'OnPublishFailure' in plugin_runtime, 'plugin runtime exposes pre/post-process and publish-failure hooks')
require('PluginHook::BeforeProcess' in plugin_commands and 'PluginHook::AfterProcess' in plugin_commands and 'PluginHook::OnPublishFailure' in plugin_commands, 'official webhook manifest advertises the expanded lifecycle')
require("before_process: '处理前'" in plugins and "after_process: '处理后'" in plugins and "on_publish_failure: '发布失败'" in plugins, 'plugin UI exposes expanded lifecycle controls')
workflow_publish = slice_between(commands_main, 'async fn run_workflow_publish_task', 'fn is_safe_compensation_path', 'workflow publish body')
require('PluginHook::BeforeProcess' in workflow_publish and 'PluginHook::AfterProcess' in workflow_publish and 'PluginHook::OnPublishFailure' in workflow_publish, 'workflow publish fires expanded lifecycle hooks')
require('pub struct CloudMutationCore' in application and 'destination already exists' in application and 'provider.move_object' in application, 'application core owns overwrite prevention and native cloud move')
require('provider.download(source)' in application and '.upload(UploadRequest' in application and 'provider.delete(destination)' in application, 'application core owns safe download-upload-delete fallback with rollback')
require('queue_batch_delete_storage_entries' in storage_entries_commands and 'cloud_batch_delete' in storage_entries_commands, 'batch cloud delete can run as a persistent task')
require('queue_batch_move_storage_entries' in storage_entries_commands and 'cloud_batch_move' in storage_entries_commands, 'batch cloud move can run as a persistent task')
require('queue_batch_rename_storage_entries' in storage_entries_commands and 'cloud_batch_rename' in storage_entries_commands, 'batch cloud rename can run as a persistent task')
require('commands::queue_batch_delete_storage_entries' in lib and 'commands::queue_batch_move_storage_entries' in lib and 'commands::queue_batch_rename_storage_entries' in lib, 'persistent cloud batch commands are registered')
require('queueBatchDeleteStorageEntries' in gallery and 'queueBatchMoveStorageEntries' in gallery and 'queueBatchRenameStorageEntries' in gallery and "queryKey: ['tasks']" in gallery, 'Cloud Manager submits batch mutations to Task Center')
require('"cloud_batch_delete"' in commands_main and '"cloud_batch_move"' in commands_main and '"cloud_batch_rename"' in commands_main, 'Task Center renders persistent cloud batch task types')


require('PluginHook::BeforeProcess' in cli and 'PluginHook::AfterProcess' in cli and 'PluginHook::OnPublishFailure' in cli and 'run_enabled_plugins_for_hook' in cli, 'Typora/Local API bridge shares expanded plugin lifecycle')
migration12 = text('crates/persistence-sqlite/migrations/0012_official_webhook_lifecycle.sql')
require('official.webhook' in migration12 and 'before_process' in migration12 and 'on_publish_failure' in migration12, 'existing official webhook installs migrate to expanded lifecycle manifest')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-15:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3.4 lifecycle/application/task hardening: OK | total checks: {len(checks)}')

# v1.3.5 task-control, plugin-observability and diagnostics hardening.
migration13 = text('crates/persistence-sqlite/migrations/0013_plugin_execution_logs.sql')
task_engine = text('crates/task-engine/src/lib.rs')
tasks_page = text('apps/desktop/src/pages/TasksPage.tsx')
settings_page = text('apps/desktop/src/pages/SettingsPage.tsx')
integrations = text('apps/desktop/src-tauri/src/commands/integrations.rs')

require("status='cancelled'" in persistence and "status IN ('queued','preparing','running','paused')" in persistence, 'task cancellation is persisted only for active states')
require('update_running_progress_if_active' in persistence and "status IN ('queued','preparing','running')" in persistence and "status <> 'cancelled'" in persistence, 'task status and progress updates cannot revive cancelled work')
require('requeue_for_retry' in persistence and 'attempt=attempt+1' in persistence and 'attempt < max_attempts' in persistence, 'task retry is bounded and persisted')
require('report_batch_task_progress' in storage_entries_commands and 'mark_running_if_active' in storage_entries_commands and 'is_cancelled' in storage_entries_commands, 'cloud batch workers cooperatively stop between items and persist item progress')
require('pub async fn cancel_task' in storage_entries_commands and 'pub async fn retry_task' in storage_entries_commands and 'commands::cancel_task' in lib and 'commands::retry_task' in lib, 'Task Center control commands are implemented and registered')
require('cancelTask' in tasks_page and 'retryTask' in tasks_page and 'task.canCancel' in tasks_page and 'task.canRetry' in tasks_page, 'Task Center exposes real cancel and bounded retry controls')
require('CREATE TABLE IF NOT EXISTS plugin_execution_logs' in migration13 and 'duration_ms' in migration13 and 'plugin_id' in migration13, 'plugin execution audit migration exists')
require('record_execution' in persistence and 'list_execution_logs' in persistence, 'plugin execution audit repository persists and reads logs')
require(re.search(r'record_execution\(\s*&manifest\.id', commands_main) is not None and re.search(r'record_execution\(\s*&manifest\.id', cli) is not None, 'desktop and Typora/Local API plugin lifecycle executions are audited')
require(re.search(r'"manual_trigger"\s*,\s*"success"', plugin_commands) is not None and re.search(r'"manual_trigger"\s*,\s*"failed"', plugin_commands) is not None, 'manual plugin runs are audited')
require('list_plugin_execution_logs' in plugin_commands and 'commands::list_plugin_execution_logs' in lib and 'listPluginExecutionLogs' in plugins and '插件执行记录' in plugins, 'plugin UI exposes recent execution success failure and duration')
require('get_system_diagnostics' in integrations and 'enabled_storage_count' in integrations and 'failed_task_count' in integrations and 'commands::integrations::get_system_diagnostics' in lib, 'system diagnostics aggregate core runtime health')
require('getSystemDiagnostics' in settings_page and '系统诊断' in settings_page and 'diagnostics.warnings' in settings_page, 'Settings exposes actionable runtime diagnostics')

# A decorative duplicate <img> that points at the same remote original as the lazy main image
# silently cancels the laziness: eager images start downloading at parse time, so opening the
# gallery fires one full-size request per mounted card. Both attributes are therefore required
# on every list/grid image, not just the primary one.
media_card = text('apps/desktop/src/components/GalleryMediaCard.tsx')
storage_browser = text('apps/desktop/src/components/StorageBrowserDialog.tsx')
grid_sources = (('GalleryMediaCard', media_card), ('StorageBrowserDialog', storage_browser), ('GalleryPage', gallery), ('AssetsPage', assets))
grid_imgs = [
    (label, tag)
    for label, source in grid_sources
    for tag in re.findall(r'<img\b[^>]*>', source, re.DOTALL)
    if 'entry.publicUrl' in tag or 'asset.publicUrl' in tag
]
require(len(grid_imgs) >= 6, f'list/grid remote images are enumerated for lazy-load checks (found {len(grid_imgs)})')
eager = [f'{label}:{tag.split("publicUrl")[0][-24:]}' for label, tag in grid_imgs if 'loading="lazy"' not in tag]
blocking = [label for label, tag in grid_imgs if 'decoding="async"' not in tag]
require(not eager, f'every list/grid remote image defers its network fetch (eager: {eager})')
require(not blocking, f'every list/grid remote image decodes off the main thread (blocking: {blocking})')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-13:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'User-flow v1.3.5 task/observability/diagnostics hardening: OK | total checks: {len(checks)}')
