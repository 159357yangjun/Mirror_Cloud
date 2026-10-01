from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
checks = []

def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')

def require(ok: bool, label: str):
    checks.append((ok, label))

def top_level_imports(source: str) -> list[str]:
    """Only real import statements.

    A bare `from '...'` search also matches text inside string literals. That is how a mutation
    table describing a third-party import made the file *holding the table* look like it imported
    that package - the scan was poisoned by its own test data.
    """
    return re.findall(r"^import\b.*?\bfrom '([^']+)'", source, re.MULTILINE)

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
print(f'user-flow section [base] | checks so far: {len(checks)}')

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
docs_workflow = text('.github/workflows/docs.yml')
require('cargo generate-lockfile' not in release and 'cargo generate-lockfile' not in ci and 'npm install' not in release and 'npm install' not in ci and 'npm install' not in docs_workflow and '--locked' in release, 'every build workflow installs from committed locks only (npm ci + cargo --locked), never npm install or generate-lockfile')

require('granted_permissions: &[PluginPermission]' in plugin_runtime and 'granted_permissions.contains(&permission)' in plugin_runtime, 'plugin runtime requires explicit user grants')
require('granted_permissions_json' in persistence and 'set_granted_permissions' in persistence, 'plugin grants persist separately from manifest declarations')
require('granted_permissions_json' in migration10 and 'read_asset' in migration10 and 'SET enabled = 0' in migration10, 'existing sensitive plugins are disabled until explicit re-authorization')
require('set_plugin_permissions' in commands and 'commands::set_plugin_permissions' in lib, 'plugin permission grant command is registered')
require('grantedPermissions' in plugins and 'setPluginPermissions' in plugins and 'confirmAction' in plugins and 'if (!accepted) return' in plugins, 'plugin UI requests user approval before sensitive permission use and honours a decline')
require('permissions: plugin.permissions.filter' in plugins and 'revokeSensitivePermissions' in plugins, 'plugin UI can revoke sensitive grants')
require(re.search(r'execute_for_hook\(\s*&manifest,\s*&granted_permissions', cli) is not None, 'Typora plugin runtime uses persisted user grants')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-18:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'user-flow section [reliability hardening] | checks so far: {len(checks)}')

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
print(f'user-flow section [integrity hardening] | checks so far: {len(checks)}')

# v1.3.0 core/UI/cloud-manager architecture.
require("pub struct PublisherCore" in application and "StorageGroupStrategy::MirrorAll" in application and "StorageGroupStrategy::PrimaryWithBackups" in application, 'PublisherCore owns multi-cloud strategy semantics')
require("PublisherCore::publish_group" in commands, 'Tauri publish path delegates multi-cloud strategy to PublisherCore')
require("page: 'publish'" in text('apps/desktop/src/store/useAppStore.ts') and "key: 'publish'" in app_shell, 'Publish Center is the default product entry point')
require("getCurrentWebviewWindow().onDragDropEvent" in publish_page and "openUpload('clipboard')" in publish_page and "openUpload('urls')" in publish_page, 'Publish Center exposes drag/drop clipboard and URL entry points')
require("setDefaultPublishTarget" in publish_page and "saveOutputPreferences" in publish_page, 'Publish Center controls target and output format without duplicating publish logic')
require("delete_storage_entry" in commands and "download_storage_entry" in commands and "commands::delete_storage_entry" in lib and "commands::download_storage_entry" in lib, 'cloud file delete/download commands are implemented and registered')
require("deployment_ids_for_remote" in persistence and "DeploymentStatus::Deleted" in commands[commands.find('pub async fn delete_storage_entry'):commands.find('pub async fn download_storage_entry')], 'direct cloud delete reconciles local Deployment state')
require("deleteStorageEntry" in desktop and "downloadStorageEntry" in desktop and "chooseDownloadPath" in desktop, 'frontend exposes safe cloud file management APIs')
require("deleteStorageEntry" in gallery and "downloadStorageEntry" in gallery and "confirmAction" in gallery, 'Gallery exposes confirmed delete and download actions')

failed = [label for ok, label in checks if not ok]
for ok, label in checks[-9:]:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} check(s)')
print(f'user-flow section [v1.3 architecture] | checks so far: {len(checks)}')

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
print(f'user-flow section [v1.3.1 integrations] | checks so far: {len(checks)}')

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
print(f'user-flow section [v1.3.2 zero-context/cloud-manager] | checks so far: {len(checks)}')


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
print(f'user-flow section [v1.3.3 lifecycle/batch architecture] | checks so far: {len(checks)}')


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
print(f'user-flow section [v1.3.4 lifecycle/application/task hardening] | checks so far: {len(checks)}')

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

# window.alert is a second, blocking channel for failures the global MutationCache already toasts.
# Both native dialogs are now banned: alert double-reports, and confirm gates destructive actions
# from browser chrome instead of the app's own ConfirmDialog (see the confirm gate below).
alerting = sorted(
    str(path.relative_to(ROOT / 'apps' / 'desktop')).replace('\\', '/')
    for path in (ROOT / 'apps' / 'desktop' / 'src').rglob('*.ts*')
    if 'window.alert(' in path.read_text(encoding='utf-8')
)
require(not alerting, f'errors reach the user through toasts only, never a blocking native dialog ({alerting})')

# An alpha-modified foreground (`text-amber-800/70`) has no fixed colour at all: what the reader
# sees depends on whatever is behind it, and half of this app's surfaces are translucent panels over
# a user-supplied wallpaper. Measured, the 13 such sites sat at 1.48-4.11:1 - the same sentence
# changed value with the theme. De-emphasis is a colour choice (pick a lighter solid rung), not an
# opacity choice, so the pattern is banned outright rather than re-tuned.
ALPHA_TEXT = re.compile(r'text-(?:slate|gray|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]+/[0-9]+')
alpha_hits = {}
for path in (ROOT / 'apps' / 'desktop' / 'src').rglob('*.tsx'):
    n = sum(1 for line in path.read_text(encoding='utf-8').splitlines() if ALPHA_TEXT.search(line))
    if n:
        alpha_hits[str(path.relative_to(ROOT / 'apps' / 'desktop')).replace('\\', '/')] = n
alpha_text = sorted(f'{f}({n})' for f, n in alpha_hits.items())
require(not alpha_text, f'readable text never thins itself with an alpha modifier - it picks a solid rung instead ({alpha_text})')

# The same argument in CSS: color-scheme is the only switch that reaches native form controls, and
# a theme that forgets it paints checkboxes from the opposite palette. Checked at runtime too, by
# contrast-tier comparing the resolved value to the theme's polarity; this half catches the case
# where the property is deleted before the browser gate ever runs.
styles_css = text('apps/desktop/src/styles.css')
require('color-scheme: light' in styles_css, ':root declares a light color-scheme so native controls follow the light themes')
require(re.search(r':root\[data-theme="midnight"\]\s*\{\s*color-scheme:\s*dark', styles_css) is not None, 'midnight sets color-scheme: dark as its first declaration')

# Which providers can produce a public URL without the user typing a domain is a backend fact;
# the form labels have to agree with it or people discover it as a failed publish plus rollback.
opendal_storage = text('crates/storage-opendal/src/lib.rs')
github_storage = text('crates/storage-github/src/lib.rs')
setup_dialog = text('apps/desktop/src/components/StorageSetupDialog.tsx')
require(opendal_storage.count('standard_capabilities(config.public_base_url.is_some())') == 4, 'S3/R2, OSS, COS and WebDAV can only build a public URL from the configured domain')
require('raw.githubusercontent.com' in github_storage, 'GitHub storage derives a Raw URL when no custom domain is set')
require(setup_dialog.count('公开访问域名（发布到该云端时必填') == 3, 'every provider without a derived public URL states when the domain is required')
require(setup_dialog.count('自定义公开域名（可选') == 1, 'repository providers keep the custom domain optional')

# Destructive gates must use the in-app dialog: window.confirm suspends painting in WebView2 and
# looks like browser chrome, while confirmAction fails closed - with no dialog mounted the promise
# never resolves, so a destructive action cannot slip through unnoticed.
confirming = sorted(
    str(path.relative_to(ROOT / 'apps' / 'desktop').as_posix())
    for path in (ROOT / 'apps' / 'desktop' / 'src').rglob('*.ts*')
    if 'window.confirm(' in path.read_text(encoding='utf-8')
)
require(not confirming, f'destructive gates use the in-app dialog, never window.confirm ({confirming})')
app_entry = text('apps/desktop/src/App.tsx')
require('ConfirmDialog' in app_entry and '<ConfirmDialog />' in app_entry, 'the confirm dialog is mounted at the app root')
confirm_store = text('apps/desktop/src/store/useConfirmStore.ts')
require('settle(false)' in confirm_store, 'the confirm store can resolve a request as cancelled')
require('danger: spec.danger ?? true' in confirm_store, 'confirm requests default to the destructive style')

# Measured in a browser against the running app: an unbreakable token (a hashed filename or a raw
# URL) in the dialog text overflowed its 302px paragraph by 248px and painted over the dimmed
# backdrop, because the card width is pinned at max-w-[440px] and does not grow.
confirm_dialog = text('apps/desktop/src/components/ConfirmDialog.tsx')
require(re.search(r'<h2[^>]*\bbreak-words\b[^>]*>', confirm_dialog) is not None, 'the confirm dialog title wraps unbreakable filenames')
require(re.search(r'<p[^>]*\bbreak-words\b[^>]*>', confirm_dialog) is not None, 'the confirm dialog detail wraps unbreakable filenames')
require("event.key === 'Escape'" in confirm_dialog and 'settle(false)' in confirm_dialog, 'Escape cancels the confirm request')
require('cancelRef.current?.focus()' in confirm_dialog, 'the dialog focuses Cancel, so Enter cannot fire the destructive action')

# docs/VISUAL_BASELINE.md measured six defects in the onboarding dialog. These are the four that
# hold without a browser; the runtime half (contrast below 4.5:1, size utilities discarded on
# <button>) is asserted by `verify_dialog_interactions.mjs visual`, which fails rather than only
# printing when the dialog regresses.
help_dialog = text('apps/desktop/src/components/HelpCenterDialog.tsx')
steps = re.findall(r'step="(\d)"', help_dialog)
require(steps == [str(i) for i in range(1, 7)], f'the onboarding dialog keeps exactly one 6-step sequence ({steps})')
require('推荐的第一次使用顺序' not in help_dialog, 'the duplicated five-chip ordering block stays deleted')
require('--text-muted' not in help_dialog, 'the dialog avoids the muted grey measured at 2.45:1 / 2.56:1')
require(re.search(r'Microsoft YaHei|PingFang|Noto Sans CJK', help_dialog) is not None, 'the dialog names a CJK face rather than relying on the system fallback')
require('tabular-nums' in help_dialog, 'the STEP ordinals are tabular')
# `button, input, select, textarea { font: inherit }` in styles.css is written outside Tailwind's
# @layer utilities, and unlayered declarations outrank layered ones - so a plain text-xs on a
# <button> silently computes to the inherited 16px/400. 23 buttons across 10 surfaces were measured
# losing their declared size this way; the dialog's buttons must stay marked important.
checked_buttons = 0
for button_tag in re.finditer(r'<button[^>]*?className="([^"]*)"', help_dialog, re.S):
    checked_buttons += 1
    discarded = re.findall(r'(?<![\w-])(?:text-\[\d+(?:\.\d+)?px\]|font-(?:medium|semibold|normal))(?!!)', button_tag.group(1))
    require(not discarded, f'a non-important size/weight utility on a button is discarded by styles.css ({discarded})')
require(checked_buttons >= 2, f'the button-utility rule actually inspected the dialog ({checked_buttons} buttons found)')

# Appearance settings are the one place this app takes a value from outside the render and writes
# it onto documentElement, where it selects which CSS applies. Two boundaries guard it and each
# needs its own assertion, because removing one is now invisible through the app: load rejects a
# bad stored value, and apply - the only writer - rejects a bad argument. Deleting the load guard
# alone changes nothing a browser can observe, which is exactly how a redundant-looking layer hides
# that it is the last line of defence for a direct caller.
def function_body(source, name):
    marker = f'export function {name}('
    start = source.find(marker)
    if start == -1:
        return ''
    rest = source[start + len(marker):]
    nxt = rest.find('export function ')
    return rest if nxt == -1 else rest[:nxt]

theme_lib = text('apps/desktop/src/lib/theme.ts')
load_body = function_body(theme_lib, 'loadThemePreferences')
apply_body = function_body(theme_lib, 'applyThemePreferences')
require(load_body != '', 'loadThemePreferences still exists')
require(apply_body != '', 'applyThemePreferences still exists')
require('isThemeKey(parsed.theme)' in load_body, 'the load boundary rejects an unknown stored theme key')
require('isThemeKey(preferences.theme)' in apply_body, 'the apply boundary, the only writer of data-theme, validates the key itself rather than trusting its caller')
require('if (!isThemeKey(preferences.theme)) return' not in apply_body, 'the apply guard is per-field: an unknown theme must not abort the accent/blur/glass/wallpaper writes')

# Every docs / external link used to be `void openExternalUrl(...)`. Measured with an unreachable
# and then a malformed baked base: the click opened a tab to an error page, or nothing at all, and
# the app showed no toast, no inline error and no console entry the user could act on.
silent_openers = sorted(
    str(path.relative_to(ROOT / 'apps' / 'desktop').as_posix())
    for path in (ROOT / 'apps' / 'desktop' / 'src').rglob('*.ts*')
    if 'void openExternalUrl(' in path.read_text(encoding='utf-8')
)
require(not silent_openers, f'no external-link open is fire-and-forget ({silent_openers})')
desktop_lib = text('apps/desktop/src/lib/desktop.ts')
require('openExternalUrl(url).catch((error) => notifyError' in desktop_lib, 'a failed external-link open is reported through the toast channel')
require("if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')" in desktop_lib, 'external links are still restricted to http/https')

# The browser harness that produced the two measurements above lives in the repo, so the gate that
# voids hidden-window geometry is itself under test: without it a future edit can quietly drop the
# precondition and every width/rect/hit-test number recorded in CHANGELOG becomes unauditable.
harness_path = ROOT / 'scripts' / 'verify_dialog_interactions.mjs'
require(harness_path.exists(), 'the dialog interaction harness is version controlled')
harness = harness_path.read_text(encoding='utf-8') if harness_path.exists() else ''
require('function assertRealViewport' in harness, 'the harness defines the viewport gate')
require(harness.count('assertRealViewport(') >= 8, 'the viewport gate guards every geometry sample, not just startup')
def allowed_imports(source, label):
    """Every top-level import must be a Node built-in or a tracked file inside scripts/.

    Splitting the harness into a probe module means relative imports exist now. Saying "starts
    with node:" would either fail the split or be relaxed to "anything", so the rule is narrowed
    instead: a relative specifier is only allowed if the file it points at is itself version
    controlled under scripts/, which keeps it inside the fingerprint set rather than smuggling a
    dependency in through a path.
    """
    bad = []
    for imp in top_level_imports(source):
        if imp.startswith('node:'):
            continue
        if imp.startswith('./') or imp.startswith('../'):
            target = (ROOT / 'scripts' / imp).resolve()
            try:
                rel = target.relative_to(ROOT).as_posix()
            except ValueError:
                bad.append(f'{imp} escapes scripts/')
                continue
            if rel in tracked_files():
                continue
            bad.append(f'{imp} is not a tracked file under scripts/')
            continue
        bad.append(imp)
    require(not bad, f'{label} adds no third-party dependency ({bad})')


def tracked_files():
    import subprocess
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True)
    return set(out.stdout.decode('utf-8').split('\0')) if out.returncode == 0 else set()


harness_imports = top_level_imports(harness)
allowed_imports(harness, 'the harness')

# Page-side code is transported to the browser as a template literal, so a backtick anywhere inside
# one - including in a // comment, where it is inert JavaScript - closes the literal and breaks the
# file with a SyntaxError that only appears when the string is parsed by the page. This has now
# happened four times in this repo. node --check catches it, but only for whoever remembers to run
# it after editing the comment, which is the same "written down as a rule, enforced by nobody" shape
# this file exists to remove.
def template_comment_backticks(source):
    # Lines that are comments AND sit inside a template literal, tracked by backtick parity from the
    # top of the file. The first version flagged any comment containing a backtick, which fired six
    # times on ordinary Node-side comments that are harmless - a guard with six false alarms gets
    # silenced by the next person, so it has to be able to tell the two apart.
    hits, inside, line_no = [], False, 0
    for line in source.replace('\r\n', '\n').split('\n'):
        line_no += 1
        stripped = line.lstrip()
        if stripped.startswith('//') and '`' in line and inside:
            hits.append(line_no)
        for ch in line:
            if ch == '`':
                inside = not inside
    return hits

require(template_comment_backticks('const t = `(function(){\n// a note with `code` in it\n})()`\n') == [2],
        'the backtick-in-comment guard can see a planted violation inside a transported template')
require(template_comment_backticks('// a harmless Node-side note with `code` in it\nconst t = `x`\n') == [],
        'the guard does not fire on a comment outside a template (six false alarms would get it deleted)')
require(template_comment_backticks('const t = `a`\nconst u = `b`\n// clean\n') == [],
        'the guard returns to outside-template state after a closed literal')
for guarded in ['scripts/verify_probes.mjs', 'scripts/verify_dialog_interactions.mjs']:
    path = ROOT / guarded
    if path.exists():
        hits = template_comment_backticks(path.read_text(encoding='utf-8'))
        require(not hits, f'{guarded} has no backtick inside a comment that sits in a transported template (found on lines {hits[:6]})')

# The probe module was cut out of the harness so the harness reads as control flow. That only
# holds if the extracted file stays inert: three string exports and nothing that can run. If it
# ever grows logic, the split has moved behaviour rather than text, and the harness's own
# assertions no longer describe what the browser executes.
probes_path = ROOT / 'scripts' / 'verify_probes.mjs'
require(probes_path.exists(), 'the page-side probes live in a module the harness imports')
if probes_path.exists():
    probes_text = probes_path.read_text(encoding='utf-8')
    require(top_level_imports(probes_text) == [], f'the probe module imports nothing at all ({top_level_imports(probes_text)})')
    for probe_name in ('HELPERS', 'VISUAL_PROBE', 'LAYOUT_PROBE'):
        require(f'export const {probe_name} = `' in probes_text, f'{probe_name} is still a template literal export')
    require('export function' not in probes_text and '=>' not in probes_text.split('export const HELPERS')[0], 'the probe module exports no logic of its own above the payloads')
    for bad_token in ('fetch(', 'require(', 'eval(', 'Function('):
        require(bad_token not in probes_text, f'the probe module does not call {bad_token} from Node')
    # The harness must still be the only thing that decides what happens with these strings.
    require('await evaluate(HELPERS)' in harness, 'the harness installs the interaction helpers')
    require('await evaluate(VISUAL_PROBE)' in harness, 'the harness injects the visual probe')
    require('await evaluate(LAYOUT_PROBE)' in harness, 'the harness injects the geometry probe')
# Reachability: a tool nobody can discover is a tool that rots. It must stay wired to a real entry.
desktop_pkg = json.loads(text('apps/desktop/package.json'))
require('verify_dialog_interactions.mjs' in json.dumps(desktop_pkg.get('scripts', {})), 'the harness is reachable from an npm script entry')
# One command must reproduce the whole chain, and it must not be able to report green while the
# browser-backed stages never ran.
all_scripts = json.dumps(desktop_pkg.get('scripts', {}))
require('verify_all.mjs' in all_scripts, 'one npm entry reproduces the whole measurement chain')
all_path = ROOT / 'scripts' / 'verify_all.mjs'
all_text = all_path.read_text(encoding='utf-8') if all_path.exists() else ''
require('SKIPPED' in all_text and 'skipped.length ? 3 : 0' in all_text, 'the aggregate reports skipped stages instead of passing them')
require("line.startsWith('FAIL')" in all_text, 'the aggregate prints each failing stage its own failures')
require(all(i.startswith('node:') for i in top_level_imports(all_text)), f'the aggregate adds no third-party dependency ({top_level_imports(all_text)})')
# Pointing a probe at a port is not pointing it at this project. The identity gate has to stay, and
# it has to refuse by throwing - a finish(2) that falls through keeps sampling and prints success
# fields next to its own failure message.
require('async function assertProjectIdentity' in harness, 'the harness verifies it is measuring this project')
require('error.identityFault = true' in harness and 'e.identityFault ? 2 : 1' in harness, 'an identity mismatch exits as a harness fault, not a pass or a regression')
require('exportNames' in harness and "function|const|class|enum" in harness, 'the export comparison ignores type exports that the TS transform erases')
# A red demonstration that lives only in a chat log is not evidence. The impostor fixture and the
# mutation runner have to stay in the repo and stay reachable from the same entry point.
require("MODE === 'red-demo'" in harness and '__fixtures__/impostor_dev_server.mjs' in harness, 'the identity gate keeps a re-runnable red demonstration')
mutations_path = ROOT / 'scripts' / 'verify_guard_mutations.mjs'
require(mutations_path.exists(), 'the guard mutations are version controlled')
mutations_text = mutations_path.read_text(encoding='utf-8') if mutations_path.exists() else ''
require('refusing to run' in mutations_text and 'writeFileSync(path, original)' in mutations_text,
        'the mutation runner refuses dirty targets and restores every byte it touched')
require('oracleRan' in mutations_text, 'the mutation runner distinguishes a silent oracle from an alarm')
mutation_imports = top_level_imports(mutations_text)
require(all(i.startswith('node:') for i in mutation_imports), f'the mutation runner adds no third-party dependency ({mutation_imports})')
# The invariant that makes the mutations meaningful: a guard that asserts on substrings of a file
# must not have its own test plan inside that file, because the table's literals then satisfy the
# very assertions they are supposed to break. So: no mutation table in the harness, and the runner
# never mutates itself.
require("id: 'M" not in harness, 'the harness contains no mutation table (it would satisfy its own assertions)')
require(not re.search(r"file:\s*'scripts/verify_guard_mutations\.mjs'", mutations_text), 'the mutation runner never mutates itself')
fixture_path = ROOT / 'scripts' / '__fixtures__' / 'impostor_dev_server.mjs'
require(fixture_path.exists(), 'the impostor dev server fixture is version controlled')
fixture_imports = top_level_imports(fixture_path.read_text(encoding='utf-8')) if fixture_path.exists() else []
require(all(i.startswith('node:') for i in fixture_imports), f'the fixture adds no third-party dependency ({fixture_imports})')

# The fingerprint table in CHANGELOG.md is machine-checked now. It records filename + line count +
# sha256 for the measurement chain, and the hand-maintained version drifted one commit after the
# rule "come back and update this when you touch these files" was written down - a hand-written
# table cannot bind the person who writes it.
def blob_of(rev_spec):
    proc = subprocess.run(['git', 'show', rev_spec], cwd=ROOT, capture_output=True)
    return None if proc.returncode != 0 else proc.stdout

def fingerprint(data):
    return {'lines': data.count(b'\n'), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def working_fingerprint(rel):
    # core.autocrlf=true checks files out with CRLF while the blob stores LF, so normalise before
    # hashing; a clean file then fingerprints identically to its blob (verified by measurement).
    data = (ROOT / rel).read_bytes().replace(b'\r\n', b'\n')
    return fingerprint(data)

table_rows = {}
for line in (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8').splitlines():
    row = re.match(r'\|\s*`(scripts/[^`]+)`[^|]*\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*`([0-9a-f]{64})`\s*\|', line)
    if row:
        table_rows[row.group(1)] = {'lines': int(row.group(2)), 'bytes': int(row.group(3).replace(',', '')), 'sha256': row.group(4)}

aggregate = (ROOT / 'scripts' / 'verify_all.mjs').read_text(encoding='utf-8').replace('\r\n', '\n')
# Membership follows "is a stage", not "starts with verify_": a gate named anything else escaped the
# table entirely (theme_face_inventory.mjs was wired into the aggregate and fingerprinted by nobody).
# The same derivation lives in scripts/fingerprint_rows.mjs, which writes these rows.
staged = sorted(set(re.findall(r"'scripts/([A-Za-z0-9_-]+\.mjs)'", aggregate)))
measured_files = sorted(set(
    [str(path.relative_to(ROOT)).replace('\\', '/') for pattern in ('scripts/verify_*.mjs', 'scripts/__fixtures__/*.mjs') for path in ROOT.glob(pattern)]
    + ['scripts/' + name for name in staged]
    + ['scripts/check_user_flow.py']
))
require(sorted(table_rows) == measured_files, f'the fingerprint table lists exactly the measured files (table={sorted(table_rows)}; on disk={measured_files})')
for rel in measured_files:
    want = table_rows.get(rel)
    if want is None:
        continue
    blob = blob_of(f'HEAD:{rel}')
    committed = fingerprint(blob) if blob is not None else {'lines': -1, 'bytes': -1, 'sha256': 'no committed blob'}
    # Always exactly two checks per file. The first version short-circuited with an extra require()
    # when a blob was missing, so the total check count changed with tree state and the baseline
    # number recorded in the table could not be relied on.
    require(blob is not None and committed == want,
            f'fingerprint row for {rel} matches its HEAD blob '
            f'(table {want["lines"]}L/{want["bytes"]}B/{want["sha256"]}; blob {committed["lines"]}L/{committed["bytes"]}B/{committed["sha256"]})')
    on_disk = working_fingerprint(rel)
    # Full hashes on both sides: a truncated pair prints identically when the difference is in the
    # tail, which is exactly what a one-character typo in the table looks like.
    require(on_disk == want, f'fingerprint row for {rel} matches the working copy '
                             f'(table {want["lines"]}L/{want["bytes"]}B/{want["sha256"]}; on disk {on_disk["lines"]}L/{on_disk["bytes"]}B/{on_disk["sha256"]})')

# Encoding integrity for the change record. A latin1 read + utf8 write turns every CJK character
# into a two-byte mojibake sequence; the result still decodes as UTF-8, so "it parsed" proves
# nothing. Real Chinese code points sit far above U+00FF, so their absence is the signature.
change_log_text = (ROOT / 'CHANGELOG.md').read_bytes().decode('utf-8')
require(any(ord(c) > 0x255 for c in change_log_text), 'CHANGELOG.md still holds real CJK code points (not double-encoded)')

failed = [label for ok, label in checks if not ok]
# Print every failure, then a short tail of passing checks for context. Printing only the last 20
# checks meant a failing assertion outside that window exited 1 without ever naming itself, which the
# mutation runner reported as "the oracle stayed silent" for guards that had caught the mutation.
for label in failed:
    print('FAIL ' + label)
for ok, label in checks[-8:]:
    if ok:
        print('OK   ' + label)
print(f'user-flow section [v1.3.5 task/observability/diagnostics hardening] | checks so far: {len(checks)}')
# Machine line, printed on every exit path: an aggregator that decides "did the oracle even run" by
# looking for human prose breaks silently the moment that prose is reworded, which happened twice here.
print(f'USERFLOW_CHECKS total={len(checks)} failed={len(failed)}')
if failed:
    raise SystemExit(f'user-flow checker FAILED: {len(failed)} of {len(checks)} check(s)')
print(f'user-flow checker: OK | total checks: {len(checks)}')
