from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
checks = []

def text(rel: str) -> str:
    # Normalise line endings at the single read point. GitHub's windows runners check out with
    # core.autocrlf=true, so every file arrives there with CRLF while this box holds LF for the files
    # an agent rewrites - which makes any `$`-anchored or line-indexed assertion answer to the
    # checkout instead of the content. That is not hypothetical: the evidence-table regex returned
    # zero rows in CI and eight locally, and the only difference was the line ending. The
    # double-encoding check below still reads raw bytes on purpose, because that defect IS a byte
    # property.
    return (ROOT / rel).read_text(encoding='utf-8').replace('\r\n', '\n')

def require(ok: bool, label: str):
    checks.append((ok, label))


def _slice_between(source: str, start_marker: str, end_marker: str, label: str) -> str:
    """A slice of `source` between two markers, or a loud empty string.

    Returns '' when either marker is missing so the caller's assertion fails by name instead of
    silently examining nothing. The existing `slice_between` raises SystemExit, which would abort
    the run before any label prints - wrong trade-off for a reader whose absence should read as a
    red gate, not as a crashed checker.
    """
    start = source.find(start_marker)
    if start == -1:
        return ''
    rest = source[start:]
    end = rest.find(end_marker, len(start_marker))
    return rest if end == -1 else rest[:end]


def _rust_block(source: str, marker: str) -> str:
    """From `marker` to the brace that closes it.

    Scoped for the same reason every other reader here is: an unscoped substring test passes when
    the token appears anywhere - including in a comment explaining why it must not appear.
    """
    start = source.find(marker)
    if start == -1:
        return ''
    rest = source[start:]
    brace = rest.find('{')
    if brace == -1:
        return ''
    depth = 0
    for index in range(brace, len(rest)):
        if rest[index] == '{':
            depth += 1
        elif rest[index] == '}':
            depth -= 1
            if depth == 0:
                return rest[:index + 1]
    return rest

def top_level_imports(source: str) -> list[str]:
    """Only real import statements.

    A bare `from '...'` search also matches text inside string literals. That is how a mutation
    table describing a third-party import made the file *holding the table* look like it imported
    that package - the scan was poisoned by its own test data.
    """
    return re.findall(r"^import\b.*?\bfrom '([^']+)'", source, re.MULTILINE)

def _cadence_default_is_disabled(source: str) -> bool:
    """Read the literal inside `impl Default for ReconcileConfig`, not just any occurrence.

    A plain substring test for "enabled: false," stays satisfied by the unrelated disabled branch in
    `from_value`, so flipping the actual default to true would pass it. That is a gate that looks like
    a safety check and is not one, which is worse than having no gate at all.
    """
    marker = "impl Default for ReconcileConfig"
    start = source.find(marker)
    if start == -1:
        return False
    body = source[start:start + 700]
    end = body.find("}")
    if end != -1:
        body = body[:end]
    return "enabled: false," in body


def _cadence_wraps_on_short_page(source: str) -> bool:
    """Read the body of `advance_cursor` and require a short page to return None.

    A substring test cannot express this: the wrapping arm's distinguishing feature is what it
    returns for a Some(_) input whose row count is below the page size, and every token in that arm
    also appears elsewhere in the file. So the function body is isolated and its match arms are
    checked structurally.
    """
    marker = "pub fn advance_cursor("
    start = source.find(marker)
    if start == -1:
        return False
    rest = source[start:]
    brace = rest.find("{")
    # Walk to the matching close brace rather than trusting indentation or a fixed window.
    depth = 0
    end = -1
    for index in range(brace, len(rest)):
        char = rest[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end == -1:
        return False
    body = rest[brace:end + 1]
    # The wrap must be the arm that matches any Some(_) without the full-page guard.
    return 'Some(_) => None,' in body


def _desktop_default_is_inert(source: str) -> bool:
    """Require the browser-build reconciliation default to say enabled: false.

    Written as a function because the declaration spans one long line whose exact punctuation keeps
    changing under formatting, and an inline string test then fails for layout reasons rather than
    meaning. This isolates the declaration and reads only its enabled field.
    """
    marker = "const reconciliationDefaults"
    start = source.find(marker)
    if start == -1:
        return False
    window = source[start:start + 240]
    end = window.find("}")
    if end != -1:
        window = window[:end]
    return "enabled: false" in window


def _ui_interval_floor_matches_backend(frontend_source: str, cadence_source: str) -> bool:
    """Both sides must declare the same numeric floor.

    The gate that preceded this one checked that each file mentioned a floor, which stayed green when
    the frontend said 1 minute and the backend said 30 - the exact divergence that makes a UI accept a
    value the backend silently rewrites. Reading the numbers is the only way to catch that.
    """
    def literal(source: str, marker: str) -> int | None:
        start = source.find(marker)
        if start == -1:
            return None
        tail = source[start + len(marker):]
        digits = ""
        for char in tail.lstrip():
            if char.isdigit():
                digits += char
            else:
                break
        # Rust writes the ceiling as an expression; only the plain-literal floor is compared here.
        return int(digits) if digits else None

    frontend_value = literal(frontend_source, "export const MIN_RECONCILE_INTERVAL_MINUTES =")
    backend_value = literal(cadence_source, "pub const MIN_INTERVAL_MINUTES: u32 =")
    return frontend_value is not None and frontend_value == backend_value


def _names_bare_verified_at(source: str) -> bool:
    """Whether the text mentions the old column as itself, not as part of last_verified_at.

    A plain substring test can never pass after section seventeen, because the honest new column name
    ends with the old one. This looks for `verified_at` not preceded by `last_`.
    """
    return re.search(r"(?<!last_)verified_at", source) is not None


def _tier_reports_unknown_without_evidence(source: str) -> bool:
    """The fall-through arm of derive_confirmation must be Unknown.

    Written as a reader because the surrounding code legitimately mentions several tier names; a
    substring test for "Unknown" would pass even if the final arm returned Uploaded, which is the
    exact regression this guards.
    """
    marker = "pub fn derive_confirmation"
    start = source.find(marker)
    if start == -1:
        return False
    body = source[start:]
    brace = body.find("{")
    depth = 0
    end = -1
    for index in range(brace, len(body)):
        if body[index] == "{":
            depth += 1
        elif body[index] == "}":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end == -1:
        return False
    tail = body[:end].rstrip()
    return tail.endswith("ConfirmationTier::Unknown")


def _kind_is_retryable(source: str, variant: str) -> bool:
    """Whether `variant` appears inside the match arm of `is_retryable`.

    Scoped to that function's body on purpose: the same variant name also appears in the
    config-actionable list, so a substring test over the whole file would pass for a kind that is
    deliberately not retryable.
    """
    start = source.find("pub fn is_retryable")
    if start == -1:
        return False
    tail = source[start:]
    brace = tail.find("{")
    depth = 0
    end = -1
    for index in range(brace, len(tail)):
        if tail[index] == "{":
            depth += 1
        elif tail[index] == "}":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end == -1:
        return False
    # `matches!(self, A | B)` contains a bang from the macro name, so splitting on '!' to find a
    # negation would truncate the body here and report every kind as absent. The real signal is the
    # `|`-joined pattern list, which this reads directly.
    body = tail[:end]
    patterns = body[body.find("matches!("):] if "matches!(" in body else ""
    return f"StorageErrorKind::{variant}" in patterns


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
storage_core_rollback = text('crates/storage-core/src/rollback.rs')
domain_events_src = text('crates/domain/src/event_journal.rs')
tauri_rollback = text('apps/desktop/src-tauri/src/rollback.rs')
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
domain = text('crates/domain/src/lib.rs')
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

section_one = list(checks)
failed = [label for ok, label in section_one if not ok]
for ok, label in section_one:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Named, not just counted: this exit used to print the total across the whole file while showing
    # only section one's labels, so a red run could be observed with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(base) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(section_one)} base check(s)')
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
require('PublisherCore::publish_group' in commands and 'backup_members.sort_by_key(|member| member.priority)' in application and 'futures::future::join3' in application, 'desktop group publish delegates priority-ordered backup failover to PublisherCore, concurrent with mirrors (PWB-semantics-fix)')
require('PublisherCore::publish_group' in cli and 'UploadRequest' not in cli and 'futures::future::join3' not in cli and 'backup_members.sort_by_key(' not in cli, 'Typora/CLI publish delegates multi-cloud strategy to PublisherCore instead of keeping a second implementation')
_pwb = application[application.index('StorageGroupStrategy::PrimaryWithBackups'):]
_pwb = _pwb[:_pwb.index('Ok(outcomes)')]
require('_primary_succeeded' not in _pwb and 'if !primary_succeeded {' not in _pwb,
        'no lane gates another: PrimaryWithBackups has no primary-success conditional left (offenders: '
        + ', '.join(l.strip() for l in _pwb.splitlines() if 'primary_succeeded' in l)[:120] + ')')
require('Backup 仅在 Primary 失败时接管' in group_dialog, 'Storage Group UI explains failover semantics')
# audit item A (2026-10-03): the public-URL pick must live in exactly one place and a
# Mirror must never win it; both consumers used to hand-roll `.or_else(first-successful)`.
require('pub fn select_public_url' in application and 'DeploymentRole::Backup' in application[application.index('fn select_public_url'):],
        'PublisherCore owns the public-URL selection with an explicit Backup role filter')
require('.or_else(|| outcomes.iter().find(|outcome| outcome.error.is_none()))' not in cli,
        'CLI delegates the public-URL pick to PublisherCore instead of first-successful')
require('.or_else(|| {' not in commands[commands.index('let published_url'):commands.index('let published_url')+400],
        'desktop publish path delegates the public-URL pick to PublisherCore too')
require('PermissionDenied' in plugin_runtime and 'require_permission' in plugin_runtime, 'plugin runtime enforces manifest permissions')
require('PluginPermission::ExternalWrite' in plugin_runtime, 'webhook requires external_write permission at runtime')
# Audit item E (2026-10-03): one endpoint policy across AI base URL, webhook, WebDAV,
# S3/R2/OSS/COS custom endpoints. The backend is the final gate; the UI mirrors it.
plugin_lib = text('crates/plugin-runtime/src/lib.rs')
commands_src = commands
require('pub fn require_https_or_loopback' in plugin_lib and '.is_ok_and(|address| address.is_loopback())' in plugin_lib,
        'plugin-runtime owns require_https_or_loopback with an IpAddr loopback check (not a prefix string test)')
require(plugin_lib.count('require_https_or_loopback(value)') >= 1 and 'fn http_endpoint' in plugin_lib,
        'http_endpoint (webhook + AI baseUrl) routes through the policy before any request is sent')
require(commands_src.count('plugin_runtime::require_https_or_loopback(') == 3,
        f'all three storage-creation paths call the policy exactly once each (found {commands_src.count("plugin_runtime::require_https_or_loopback(")})')
setup_dialog = text('apps/desktop/src/components/StorageSetupDialog.tsx')
require('const insecureHttp' in setup_dialog and setup_dialog.count('insecureHttp(s3Form.endpoint)') == 1
        and setup_dialog.count('insecureHttp(objectForm.endpoint)') == 1
        and setup_dialog.count('insecureHttp(webdavForm.endpoint)') == 1,
        'the UI mirrors the policy on all three endpoint forms: localhost-only plain HTTP')
require('plain HTTP is only allowed for loopback hosts' in plugin_lib,
        'the refusal message names the loopback carve-out explicitly')
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
section_tail = checks[-18:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 18
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
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
# Gitee puts access_token in the query string on every request, so a raw reqwest error would carry
# the credential into task records, toasts and diagnostics. Two-sided: the redaction helper must
# exist AND no network/provider error path may stringify a reqwest error directly.
require('fn redact(message: &str, token: &str) -> String' in gitee and '[redacted]' in gitee,
        'Gitee shares one redaction helper that replaces the token in message text')
require('without_url()' in gitee, 'Gitee strips the request URL from reqwest errors before surfacing them')
require(gitee.count('StorageError::Network(e.to_string())') == 0
        and len(re.findall(r'\.map_err\(\|e\| StorageError::Provider\(e\.to_string\(\)\)\)', gitee)) == 2,
        'no Gitee reqwest error is stringified raw; the only two remaining Provider(e.to_string()) calls '
        'are Url::parse on the compile-time API_ROOT/WEB_ROOT constants, which carry no credential')
# Per-call-site predicate: every transport boundary must route through a redacting helper. A bare
# count would stay green if someone swapped safe_ctx() for to_string() inside the helpers, so match
# each .send()/.json()/.text() site to its map_err instead of trusting the helper body.
_gitee_send = len(re.findall(r'\.send\(\)', gitee))
_gitee_net = len(re.findall(r'\.map_err\(\|e\| net_err\(e, tok\)\)\?;', gitee))
_gitee_prov = len(re.findall(r'\.map_err\(\|e\| prov_err\(e, tok\)\)\?;', gitee))
require(_gitee_send >= 1 and _gitee_net == _gitee_send,
        f'every one of the {_gitee_send} Gitee .send() sites maps its error through net_err (found {_gitee_net})')
require(_gitee_prov >= 7,
        f'Gitee response-body parses map their errors through prov_err (found {_gitee_prov})')
require(re.search(r'fn net_err\(error: reqwest::Error, token: &str\) -> StorageError \{\s*StorageError::Network\(safe_ctx\(error, token\)\)', gitee) is not None,
        'net_err itself delegates to safe_ctx — it may not stringify the error directly')
require(re.search(r'fn prov_err\(error: reqwest::Error, token: &str\) -> StorageError \{\s*StorageError::Provider\(safe_ctx\(error, token\)\)', gitee) is not None,
        'prov_err itself delegates to safe_ctx — it may not stringify the error directly')
require(re.search(r'fn safe_ctx\(error: reqwest::Error, token: &str\) -> String \{\s*redact\(&error\.without_url\(\)\.to_string\(\), token\)\s*\}', gitee) is not None,
        'safe_ctx is exactly without_url + redact, in that order')
require(gitee.count('net_err(e, tok)') + gitee.count('prov_err(e, tok)') >= 16,
        f'Gitee routes its transport errors through the redacting helpers (found {gitee.count("net_err(e, tok)") + gitee.count("prov_err(e, tok)")})')
require('fn response_error(response: Response, context: &str, token: &str)' in gitee,
        'Gitee scrubs server response bodies with the token too')
# Event journal (piclist #39 piece three): values + trait only, no SQLite yet. The assertions pin
# the two properties that make it a journal rather than a log table: the journal assigns ordering,
# and replay is derived rather than reimplemented per backend.
event_journal = text('crates/domain/src/event_journal.rs')
require('pub trait EventJournal' in event_journal and 'fn append(&mut self, event: DomainEvent)' in event_journal,
        'EventJournal exposes an append that owns the event so sequence assignment cannot be bypassed')
require('sequence: 0,' in event_journal and 'pub fn with_sequence(self, sequence: u64) -> Self' in event_journal,
        'new events arrive unsequenced and only the journal can stamp a position')
require('fn replay(&self, from: u64, to: u64) -> Vec<DomainEvent> {' in event_journal,
        'replay has a default implementation derived from events_since, so a backend cannot get it wrong independently')
require('caller supplied a sequence' in event_journal and 'sequence != 0' in event_journal,
        'the mock rejects an injected sequence (guard + message both present) rather than accepting a caller-chosen position')
require('serde_json.workspace = true' in text('crates/domain/Cargo.toml').split('[dev-dependencies]')[0],
        'domain depends on serde_json as a normal dependency (payload is a Value), not only for tests')
# Reconciliation + durable journal storage (piclist #39 piece four). The two properties worth a
# gate are: down scripts must not leak into the up replay, and an inconclusive probe must never be
# reported as a missing remote (that is how a network blip becomes mass deletion).
journal_src = text('crates/persistence-sqlite/src/journal.rs')
migration15 = text('crates/persistence-sqlite/migrations/0015_domain_events.sql')
down15 = text('crates/persistence-sqlite/migrations/down/0015_domain_events.sql')
require('CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_events_aggregate_sequence' in migration15
        and 'aggregate_kind, aggregate_id, sequence' in migration15,
        'per-aggregate sequence uniqueness is enforced by the schema, not just by convention')
require('CHECK (sequence >= 1)' in migration15,
        'the reserved "not yet persisted" sequence 0 cannot enter the table')
require('DROP TABLE IF EXISTS domain_events' in down15,
        'the new up migration ships with its same-named down counterpart')
require("glob('*.sql')" in text('scripts/validate.py'),
        'validate.py replays only top-level *.sql, which is what keeps migrations/down/ out of the up chain')
require('DriftKind::ProbeInconclusive' in journal_src
        and 'Some(RemoteObservation::Absent) if deployment.status_online' in journal_src,
        'drift detection distinguishes "we could not look" from "it is gone"')
require('caller supplied a sequence' in journal_src and 'event.sequence != 0' in journal_src,
        'the SQLite journal also refuses a caller-chosen history position')
# Journal wiring (step 5 of the plan): both publish entry points must record, and a journal
# failure must never fail a publish. The pair matters: one call site only would leave Typora
# uploads producing gaps that read as real history.
desktop_publish = commands[commands.find('async fn publish_clipboard_image_with_workflow') if 'async fn publish_clipboard_image_with_workflow' in commands else 0:]
require('persistence_sqlite::journal::record_publish_events(' in commands
        and 'persistence_sqlite::journal::record_publish_events(' in cli,
        'both the desktop and Typora publish paths append to the journal')
require('journal: persistence_sqlite::journal::SqliteEventJournal::new(pool' in lib
        and 'journal: persistence_sqlite::journal::SqliteEventJournal::new(pool' in cli,
        'the journal handle is constructed for the desktop AppState and the CLI context alike')
require('SettingsRepository::new(pool.clone())' in cli,
        'the CLI pool is cloned before the journal takes it (a moved pool would not compile)')
require('if let Err(error) = journal.append(&outcome).await' in journal_src
        and 'tracing::warn!' in journal_src,
        'a journal write failure degrades to a warning instead of failing a completed upload')
require('pub async fn record_publish_events' in journal_src
        and 'fn record_publish_events' not in commands
        and 'fn record_publish_events' not in cli,
        'the publish-event helper is defined exactly once, in persistence-sqlite')
# JournalError must be printable: the persistence layer logs append failures through tracing,
# which needs Display. CI #274 failed the build because the type shipped without it.
require('impl std::fmt::Display for JournalError' in event_journal
        and 'impl std::error::Error for JournalError' in event_journal,
        'JournalError implements Display + Error so a journal failure can be logged, not just matched')
# Reconciler probe safety (step 2 pre-condition B): the reconciler must not read a failed lookup
# as absence, and OpenDAL must not fall back to the trait default's directory listing.
opendal_lib = text('crates/storage-opendal/src/lib.rs')
require('async fn exists(&self, path: &str) -> Result<bool, StorageError>' in opendal_lib
        and 'self.operator.stat(path).await' in opendal_lib,
        'OpenDAL overrides exists with an exact-path stat instead of listing the parent directory')
require('opendal::ErrorKind::NotFound => Ok(false)' in opendal_lib
        and 'Err(error) => Err(map_error(error))' in opendal_lib,
        'only NotFound reads as absent; every other backend failure propagates as an error')
require('pub fn observation_from_probe(probe: Result<bool, ()>) -> RemoteObservation' in journal_src
        and 'Err(()) => RemoteObservation::Unknown' in journal_src,
        'a failed probe maps to Unknown, never Absent, before drift detection ever sees it')
require('use storage_core' not in text('crates/persistence-sqlite/src/journal.rs'),
        'the persistence layer does not depend on the storage abstraction for this mapping')
# Reconciliation sweep wiring: a command that is never registered is indistinguishable from dead
# code, and one that repairs silently would be worse than no sweep at all.
reconcile_src = text('apps/desktop/src-tauri/src/commands/reconcile.rs')
cadence_src = text('apps/desktop/src-tauri/src/reconcile_cadence.rs')
timestamps_src = text('crates/domain/src/deployment_timestamps.rs')
tier_src = text('crates/domain/src/confirmation_tier.rs')
error_kind_src = text('crates/domain/src/storage_error_kind.rs')
migration17 = text('crates/persistence-sqlite/migrations/0017_add_deployment_error_kind.sql')
down17 = text('crates/persistence-sqlite/migrations/down/0017_add_deployment_error_kind.sql')
application_src = text('crates/application/src/lib.rs')
github_src = text('crates/storage-github/src/lib.rs')
gitee_src = text('crates/storage-gitee/src/lib.rs')
opendal_src = text('crates/storage-opendal/src/lib.rs')
assets_page = text('apps/desktop/src/pages/AssetsPage.tsx')
assets_types = text('apps/desktop/src/types.ts')
migration16 = text('crates/persistence-sqlite/migrations/0016_split_deployment_timestamps.sql')
down16 = text('crates/persistence-sqlite/migrations/down/0016_split_deployment_timestamps.sql')
require('pub(crate) mod reconcile;' in commands and 'commands::reconcile::run_reconciliation_sweep,' in lib,
        'the sweep module is declared and its command registered (not left as unreachable code)')
require('SWEEP_ROW_BUDGET' in cadence_src and 'rows.len() as i64 >= SWEEP_ROW_BUDGET' in reconcile_src,
        'a sweep is bounded per run instead of walking the whole library in one click')
require('"actionTaken": null' in reconcile_src and 'DriftKind::ProbeInconclusive => continue' in reconcile_src,
        'the sweep records drift without acting on it, and keeps inconclusive probes out of history')
require('use persistence_sqlite::journal::{' in reconcile_src and 'observation_from_probe' in reconcile_src,
        'probe results go through the three-state mapper rather than a raw bool')
# Upload-attempt events (publish dispatch step 1): both entry points must record them, the
# decision must be a named predicate rather than an inline ternary, and it must not claim to be
# verification.
require('pub async fn record_upload_attempts' in journal_src
        and 'persistence_sqlite::journal::record_upload_attempts(' in commands
        and 'persistence_sqlite::journal::record_upload_attempts(' in cli,
        'upload attempts are recorded by the desktop and Typora publish paths alike')
require('pub fn attempt_event_type(failed: bool) -> EventType' in journal_src
        and 'let event_type = attempt_event_type(record.last_error.is_some());' in journal_src,
        'the completed-vs-failed choice is one named predicate used at the write site, not a copy-pasted branch')
require('EventType::UploadAttemptFailed' in journal_src and 'EventType::UploadAttemptCompleted' in journal_src,
        'both attempt event kinds are actually produced somewhere (not declared-only enum arms)')
require('attemptIndex' not in journal_src,
        'no fabricated attempt counter: retry indices belong to the deployment_attempts table')
# Verification evidence reaching the journal (publish dispatch step 2). The load-bearing rules are
# that an unverified path stays silent and that every adapter reports what it really did.
storage_core_src = text('crates/storage-core/src/lib.rs')
application_src = text('crates/application/src/lib.rs')
require('pub verification: Option<VerificationOutcome>' in storage_core_src
        and '#[serde(default)]' in storage_core_src,
        'UploadResult carries an optional verdict that defaults to absent rather than failed')
for _adapter in ('storage-github', 'storage-gitee', 'storage-opendal'):
    require('verification: Some(verification)' in text(f'crates/{_adapter}/src/lib.rs'),
            f'{_adapter} reports the verdict its post-write read-back produced')
require(application_src.count('verification:') >= 4,
        'PublishOutcome threads the verdict through on success and clears it on both failure paths')
require('pub async fn record_verification_events' in journal_src
        and 'record_verification_events(&state.journal' in commands
        and 'record_verification_events(&context.journal' in cli,
        'both publish entry points emit VerificationRecorded for verified members')
require('outcome.verification.as_ref()' in commands and 'outcome.verification.as_ref()' in cli,
        'both entry points skip members whose adapter reported no verdict, instead of writing a row'
        ' that would read as evidence of absence')
require('outcome.storage_id == record.deployment.storage_id' in commands
        and 'outcome.storage_id == record.deployment.storage_id' in cli,
        'verdicts are matched by storage id (unique per group by schema), never by list position')
require('redact_hides_the_token_and_empty_token_passes_text_through' in gitee,
        'the redaction behaviour has a two-sided test (token hidden, empty token passed through verbatim)')
require('self.credentials.token.trim())' not in github or 'bearer_auth' in github,
        'GitHub keeps the token in an Authorization header rather than the query string')
require(github.count('StorageError::Network(e.to_string())') > 0,
        'KNOWN GAP: GitHub still stringifies raw reqwest errors — safe today only because bearer_auth keeps the token out of the URL; re-check before any change moves the token into a query parameter')
require('self.operator.stat(&remote_path)' in opendal and 'content_length() != expected_len' in opendal, 'OpenDAL upload verifies remote size after write')
require('reqwest::Url::parse(value)' in commands and 'url.host_str().is_none()' in commands, 'public base URLs are structurally validated')
require('fn rollback_plan(' in commands and '可能存在孤儿文件' in commands,
        'desktop compensates remote uploads through a plan when local persistence fails')
require('fn rollback_plan(' in cli and 'orphan files may remain' in cli,
        'Typora compensates remote uploads through a plan when local persistence/public URL fails')
# --- publish dispatch step three: plan-driven rollback -------------------------------------
# The compensation pass deletes remote objects, so these assertions exist for one reason: a
# future edit must not be able to widen what gets deleted without turning something red here.
require('pub fn is_safe_compensation_path' in storage_core_src
        and 'segment.len() == 33' in storage_core_src
        and "starts_with('u')" in storage_core_src,
        'the unique-path predicate lives once in storage-core instead of per entry point')
require('pub fn safe_rollback_points' in storage_core_rollback
        and '.filter(|point| is_safe_compensation_path(&point.remote_path))' in storage_core_rollback,
        'unsafe paths are filtered out of the rollback plan before any delete is attempted')
require('!storage_core::is_safe_compensation_path(&point.remote_path)' in commands
        and 'safe_rollback_points(candidates)' in commands
        and '!storage_core::is_safe_compensation_path(&point.remote_path)' in cli
        and 'safe_rollback_points(candidates)' in cli,
        'both entry points build plans through the shared filter and report refused paths')
require('rollback_successful_uploads' not in commands
        and 'rollback_successful_uploads' not in cli,
        'no entry point keeps a private copy of the compensation loop')
require('pub async fn execute_rollback' in storage_core_rollback
        and 'deleted.push(point.clone())' in storage_core_rollback
        and 'failures.push((point.clone(), error.to_string()))' in storage_core_rollback,
        'rollback is best-effort: a failed delete is recorded and the pass continues')
require('Err(error) => Err(error),' in storage_core_rollback
        and 'Ok(provider) => provider.delete(&point.remote_path).await' in storage_core_rollback,
        'an unresolvable backend counts as a failed point rather than being skipped')
require('RollbackCompleted,' in domain_events_src and 'RollbackFailed,' in domain_events_src,
        'the journal distinguishes a completed rollback from a failed one')
require('"rollback_completed" => EventType::RollbackCompleted' in journal_src
        and '"rollback_failed" => EventType::RollbackFailed' in journal_src
        and 'EventType::RollbackCompleted => "rollback_completed"' in journal_src
        and 'EventType::RollbackFailed => "rollback_failed"' in journal_src,
        'both rollback event types round-trip through their persisted strings')
require('EventType::RollbackFailed' in tauri_rollback
        and 'EventType::RollbackCompleted' in tauri_rollback
        and '"error": reason' in tauri_rollback,
        'a rollback failure is journalled with its reason, not just its count')
require('crate::rollback::run_rollback(&state.journal' in commands
        and 'crate::rollback::run_rollback(&context.journal' in cli,
        'both publish entry points journal their compensation pass')
require('pub fn accounting_is_complete' in storage_core_rollback
        and 'deleted_count + self.failed_count == self.points_count' in storage_core_rollback,
        'a rollback summary can prove no point went unaccounted for')
require('async fn an_unresolvable_storage_counts_as_a_failed_point' in storage_core_rollback
        and 'async fn a_failed_delete_does_not_stop_the_remaining_points' in storage_core_rollback
        and 'async fn every_point_produces_exactly_one_delete' in storage_core_rollback,
        'the rollback loop has tests for counting, best-effort continuation, and resolver failure')

# --- publish dispatch step four: scheduled reconciliation -----------------------------------
# A timer that talks to remote storage is the first code in this app that runs unattended, so these
# assertions exist to keep "it can run periodically" from silently becoming "it does".
require('pub fn start_background_reconciler' in reconcile_src
        and 'commands::reconcile::start_background_reconciler(app.handle())' in lib,
        'the background reconciler is started once at setup')
require('if !should_run_on_tick(&config) {' in reconcile_src
        and 'continue;' in reconcile_src[reconcile_src.index('start_background_reconciler'):],
        'a tick without permission sends nothing')
require(_cadence_default_is_disabled(cadence_src),
        'background reconciliation defaults to disabled rather than enabled')
require('unwrap_or_default()' in cadence_src
        and 'None => return Self::default()' in cadence_src,
        'an unreadable or absent preference degrades to disabled, not to a guessed schedule')
require('MIN_INTERVAL_MINUTES: u32 = 30' in cadence_src
        and 'fn clamp_interval(minutes: u32) -> u32' in cadence_src,
        'the configured interval has a floor so it cannot become a polling flood')
require('SWEEP_ROW_BUDGET' in cadence_src
        and 'rows.len() as i64 >= SWEEP_ROW_BUDGET' in reconcile_src,
        'one sweep is bounded by a row budget regardless of library size')
require('advance_cursor(rows.len(), seen_cursor)' in reconcile_src
        and 'cursor = report.next_cursor.clone()' in reconcile_src,
        'the sweep cursor advances between cycles instead of re-reading the newest page')
require(_cadence_wraps_on_short_page(cadence_src),
        'a finished walk wraps to the newest page so later cycles reach older deployments')
require('d.deployed_at < ? ORDER BY d.deployed_at DESC' in persistence
        and 'd.last_error,d.deployed_at FROM deployments' in persistence,
        'the paging query selects and filters on the cursor column it orders by')
require('pub deployed_at: Option<String>' in persistence
        and 'deployed_at: row.try_get("deployed_at")?' in persistence,
        'the location record exposes the cursor column the rotation depends on')
require('async fn run_sweep_inner(' in reconcile_src
        and '    state: &AppState,' in reconcile_src
        and 'Ok(run_sweep_inner(&state, &providers, None, false).await)' in reconcile_src
        and 'let report = run_sweep_inner(&state, &providers, cursor.clone(), true).await;' in reconcile_src,
        'one sweep core serves both the command and the timer, taking AppState not State')
require('fn idle(skipped_by_policy: bool)' in reconcile_src
        and 'pub skipped_by_policy: bool' in reconcile_src
        and 'pub error: Option<String>' in reconcile_src,
        'an unexamined sweep says why, instead of reporting counts that look like a clean library')
require('commands::reconcile::get_reconciliation_settings' in lib
        and 'commands::reconcile::set_reconciliation_settings' in lib,
        'the background preference is readable and writable through registered commands')
require('fn a_default_install_never_sends_probes_from_the_timer' in reconcile_src
        and 'fn reaching_the_end_wraps_instead_of_parking_on_the_newest_rows' in cadence_src,
        'inertness and cursor wrap are both asserted by tests')

# Step 4: reconciliation results persist. A background sweep runs when nobody is watching, so its
# outcome has to outlive the window - and the write must not be able to corrupt the preference row
# it shares a table with, or silently overwrite the last automatic result with a manual pass.
desktop_lib = text('apps/desktop/src/lib/desktop.ts')
settings_page = text('apps/desktop/src/pages/SettingsPage.tsx')
require("const SWEEP_LAST_KEY: &str = \"reconciliation.lastSweep\";" in reconcile_src
        and "const SWEEP_HISTORY_KEY: &str = \"reconciliation.sweepHistory\";" in reconcile_src
        and 'RECONCILE_SETTINGS_KEY, &stored' in reconcile_src,
        'sweep records live under their own settings keys, never inside the preference value that set() replaces wholesale')
# The M32/M33/M34 anchors live in SOURCE files the checker reads normally - but check_user_flow.py
# itself quotes some of the same needles, so a whole-file substring can stay satisfied after the
# mutation removes it from reconcile.rs. Under the harness tripwire every step-4 needle re-reads the
# mutated file; without it these assertions are inert (and the fingerprints prove nothing either way).
_probe_source = None
if os.environ.get('MIRROR_CLOUD_MUTATION_PROBE') == 'sweep-persistence':
    _probe_rel = os.environ.get('MUTATED_SOURCE', '')
    if (ROOT / _probe_rel).exists():
        _probe_source = (ROOT / _probe_rel).read_text(encoding='utf-8-sig')

def _needle(whole, label):
    # Inert without the tripwire; under it, the assertion measures the mutated file itself.
    if _probe_source is None:
        return
    require(whole in _probe_source, f'{label} [mutation probe]')


def _flat_needle(whole, start_marker, end_marker, label):
    if _probe_source is None:
        return
    body = ' '.join(_slice_between(_probe_source, start_marker, end_marker, label).split())
    require(whole in body, f'{label} [mutation probe]')

require('pub(crate) fn sweep_summary(report: &SweepReport, include_findings: bool) -> Value {' in reconcile_src
        and '"lastSweepAt": Utc:' + ':now().to_rfc3339(),' in reconcile_src,
        'the summary carries a timestamp of its own and an explicit findings switch')
_needle('"lastSweepAt": Utc::now().to_rfc3339(),',
        'the summary carries a timestamp of its own and an explicit findings switch')
require('if report.error.is_some() {' in reconcile_src
        and '"skipped"' in reconcile_src and '"drift"' in reconcile_src and '"clean"' in reconcile_src,
        'outcome classification exists and names error/skipped/drift/clean')
flat_reconcile = ' '.join(reconcile_src.split())
_outcome_slice = _slice_between(reconcile_src, 'fn sweep_outcome(report: &SweepReport)',
    '/// The persisted form of a finished sweep.', 'sweep_outcome body')
_flat_outcome = ' '.join(_outcome_slice.split())
require('"error" } else if report.skippe' + 'd_by_policy { "skipped" } else if report.missing_remote' in _flat_outcome,
        'error and skipped outrank clean before any count is consulted (asserted inside the function body)')
_flat_needle('"error" } else if report.skipped_by_policy { "skipped" } else if report.missing_remote',
             'fn sweep_outcome(report: &SweepReport)',
             '/// The persisted form of a finished sweep.',
             'error and skipped outrank clean before any count is consulted (asserted inside the function body)')
require('run_sweep_inner(&state, &providers, None, false).await' in reconcile_src
        and 'let report = run_sweep_inner(&state, &providers, cursor.clone(), true).await;' in reconcile_src,
        'the manual command persists a line while the scheduled path persists findings')
_needle('let report = run_sweep_inner(&state, &providers, cursor.clone(), true).await;',
        'the manual command persists a line while the scheduled path persists findings')
require('record_sweep_outcome(state, &failed, false).await;' in reconcile_src
        and 'record_sweep_outcome(state, &report, persist_summary).await;' in reconcile_src,
        'both sweep exits record, and only the scheduled exit can carry findings')
require('pub const SWEEP_HISTORY_DAYS: i64 = 7;' in reconcile_src
        and 'pub const SWEEP_HISTORY_MAX_ENTRIES: usize = 50;' in reconcile_src
        and 'kept.len() >= SWEEP_HISTORY_MAX_ENTRIES' in reconcile_src
        and 'at < cutoff' in reconcile_src,
        'history is bounded by both a time window and a size cap')
require('.filter_map(SweepHistoryEntry::from_value)' in reconcile_src
        and '.get("entries")' in reconcile_src
        and 'and_then(Value::as_array)' in reconcile_src,
        'unreadable history degrades to empty instead of inventing entries')
require('commands::reconcile::get_reconciliation_history,' in lib
        and "invoke('get_reconciliation_history')" in desktop_lib,
        'the read-back command is registered and the frontend wrapper invokes it')
require('queryClient.invalidateQueries({ queryKey: [\'reconciliation-history\'] })' in settings_page
        and 'reconcileHistory!.entries.map((entry: SweepHistoryEntry)' in settings_page,
        'the panel reads persisted history and refreshes it after a manual sweep')
require('尚无记录' in settings_page
        and "'Invalid Date'" not in settings_page and 'Number.isNaN(parsed.getTime())' in settings_page,
        'an empty history says nothing was recorded, and an unparseable stamp shows itself rather than a fabricated date')
require('fn a_scheduled_sweep_persists_a_summary_and_an_explicit_one_does_not' in reconcile_src
        and 'fn a_failed_sweep_is_recorded_as_its_own_outcome' in reconcile_src
        and 'fn an_unreadable_history_row_degrades_to_nothing_recorded_rather_than_zero' in reconcile_src,
        'summary shape, outcome classes, and degraded reads all have Rust tests')
require('workflows.find((workflow) => workflow.isDefault)' in upload and '?? workflows[0]' not in upload, 'upload UI never falls back to an arbitrary legacy workflow')
require('async fn persist_new_storage' in commands and commands.count('persist_new_storage(state.inner(), &record).await?;') >= 4, 'storage setup only succeeds after automatic pipeline persistence')
require('sync_system_default_pipeline(state.inner(), None).await?;' in commands, 'automatic pipeline sync errors are surfaced instead of silently ignored')
require('connection-test-u' in opendal and '.write(&probe_path' in opendal and '.stat(&probe_path)' in opendal and '.delete(&probe_path)' in opendal, 'OpenDAL connection test verifies write/stat/delete permissions')

failed = [label for ok, label in checks if not ok]
section_tail = checks[-20:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 20
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
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
section_tail = checks[-9:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 9
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
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
require('tokio::task::spawn_blocking' in slice_between(commands_main, 'async fn run_workflow_publish_task', 'fn rollback_plan(', 'workflow publish worker') and 'tokio::task::spawn_blocking' in cli[cli.find('async fn publish_one'):], 'CPU-heavy workflow image processing leaves async IO workers')

failed = [label for ok, label in checks if not ok]
section_tail = checks[-10:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 10
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
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
section_tail = checks[-14:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 14
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
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
section_tail = checks[-11:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 11
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
print(f'user-flow section [v1.3.3 lifecycle/batch architecture] | checks so far: {len(checks)}')


# v1.3.4 application-boundary, lifecycle and persistent batch-task hardening.
require('BeforeProcess' in plugin_runtime and 'AfterProcess' in plugin_runtime and 'OnPublishFailure' in plugin_runtime, 'plugin runtime exposes pre/post-process and publish-failure hooks')
require('PluginHook::BeforeProcess' in plugin_commands and 'PluginHook::AfterProcess' in plugin_commands and 'PluginHook::OnPublishFailure' in plugin_commands, 'official webhook manifest advertises the expanded lifecycle')
require("before_process: '处理前'" in plugins and "after_process: '处理后'" in plugins and "on_publish_failure: '发布失败'" in plugins, 'plugin UI exposes expanded lifecycle controls')
workflow_publish = slice_between(commands_main, 'async fn run_workflow_publish_task', 'fn rollback_plan(', 'workflow publish body')
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
section_tail = checks[-15:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 15
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
print(f'user-flow section [v1.3.4 lifecycle/application/task hardening] | checks so far: {len(checks)}')

# --- §19/§20: remote index completeness -------------------------------------------------------
#
# A sweep used to report counts only, so "the remote has 41 files", "we could not read the remote"
# and "we stopped at our own 2000-file budget" all produced the same shape. These gates hold the two
# things that make the difference visible: a per-storage verdict reaching the UI, and a decode
# direction that always reads as LESS confidence than what was stored.
#
# Placed before the section boundary below rather than at end-of-file, because every earlier
# section ends in `raise SystemExit` on failure: an appended block would not execute on a red run,
# which is exactly when its labels are needed.

scan_domain = text('crates/domain/src/scan_completeness.rs')
completeness_parse = _rust_block(scan_domain, 'impl ScanCompleteness {')
stop_reason_parse = _rust_block(scan_domain, 'impl ScanStopReason {')
observation_body = _rust_block(scan_domain, 'impl ScanObservation {')

require(completeness_parse != '', 'ScanCompleteness still has an impl block to read')
require('pub fn parse(raw: &str) -> Self' in completeness_parse,
        'ScanCompleteness has a parse path for stored values')
require('_ => ScanCompleteness::Unknown' in completeness_parse,
        'an unrecognised completeness spelling decodes as Unknown, never as Complete')
require('_ => ScanCompleteness::Complete' not in completeness_parse,
        'no wildcard arm may default upward to Complete')
require('_ => ScanStopReason::Exhausted' not in stop_reason_parse,
        'a damaged stop_reason must not decode as "we finished normally"')

for level, trigger in [
    ('Partial', 'file_budget_exhausted'),
    ('Partial', 'directory_budget_exhausted'),
    ('Unknown', 'record_read_failure'),
    ('Unknown', 'record_api_truncation'),
]:
    require(f'ScanCompleteness::{level}' in observation_body and trigger in observation_body,
            f'the accumulator can reach {level} via {trigger}')
require('self.read_failed || self.api_truncated_dirs > 0' in observation_body,
        'unknown is checked before partial: an unchosen blind spot outranks a budget we chose')

migration18 = text('crates/persistence-sqlite/migrations/0018_remote_scans.sql')
require("CHECK (completeness IN ('complete', 'partial', 'unknown'))" in migration18,
        'remote_scans.completeness is constrained to the three levels in the schema itself')
require("CHECK (stop_reason IN ('exhausted', 'file_limit', 'directory_limit'," in migration18
        and "'provider_error', 'api_truncation'))" in migration18,
        'remote_scans.stop_reason is constrained to the five spellings the domain writes')
down18 = text('crates/persistence-sqlite/migrations/down/0018_remote_scans.sql')
require('DROP TABLE IF EXISTS remote_scans' in down18
        and 'idx_remote_scans_storage_started' in down18,
        'migration 0018 reverses both its table and its index')

remote_scan_rs = text('crates/persistence-sqlite/src/remote_scan.rs')
require('pub mod remote_scan;' in text('crates/persistence-sqlite/src/lib.rs'),
        'the scan-record module is reachable from the crate root')
require('self.completeness.supports_absence_conclusion()' in remote_scan_rs,
        'the record exposes the absence rule by delegating to the domain predicate')
require('== ScanCompleteness::Complete' not in remote_scan_rs,
        'the persistence layer never re-implements "complete means trustworthy"')

remote_index = text('apps/desktop/src-tauri/src/commands/remote_index.rs')
view_body = _rust_block(remote_index, 'pub struct RemoteIndexSyncView {')
require('pub scans: Vec<ScanOutcomeView>' in view_body,
        'the sync command returns a per-storage verdict, not only counters')
finish_body = _rust_block(remote_index, 'async fn finish_and_report(')
require('insert_scan(pool, &record).await' in finish_body,
        'every sweep writes its row through the shared exit path')
require('state.journal.pool()' in finish_body,
        'the write reaches SQLite through the pool the app already owns')
require('error_count: observation.read_failure_count(),' in finish_body,
        'the persisted error count is derived from the accumulator rather than a parallel tally')
limit_body = _rust_block(remote_index, 'fn listing_hit_page_limit(')
require('count == ceiling' in limit_body and 'count >= ceiling' not in limit_body,
        'provider truncation is detected by equality with the stated ceiling, so an adapter whose '
        'constant is wrong surfaces as a different bug instead of being absorbed here')
# One path makes a storage unobservable inside the walk - a directory read that errors - and it must
# reach the accumulator rather than only the message list. A whole-file substring test is satisfied
# by any occurrence, which is how the earlier version of this gate passed while naming nothing:
# measured by deleting one of what were then three sites and seeing the run stay green.
read_loop = _slice_between(remote_index, 'let entries = match provider.list(&directory).await {',
                           'record_directory_listed', 'read loop')
require(read_loop != '', 'the mid-walk read path was located to be read')
require('observation.record_read_failure();' in read_loop,
        'a failed directory read reaches the accumulator, not only the message list')
listing_guard = _slice_between(remote_index, 'if !provider.capabilities().list {',
                               'sync_one_storage', 'listing guard')
require('finish_and_report' not in listing_guard,
        'a storage that cannot list is refused before a scan row is written: recording it would '
        'claim we observed a remote we never opened')
require('error_count: observation.read_failure_count(),' in remote_index,
        'the persisted error count is derived from the accumulator rather than a parallel tally')
# --- step one: the index refresh becomes a scheduled behaviour ---------------------------------
#
# §21's set comparison only has data if something writes snapshots on a schedule. These gates hold
# the four decisions that make that safe: who is asked, when, what gets stored, and what happens on
# a first install.

cadence_rs = text('apps/desktop/src-tauri/src/reconcile_cadence.rs')
scan_due_body = _rust_block(cadence_rs, 'pub fn scan_due(')
clamp_scan = _rust_block(cadence_rs, 'fn clamp_scan_interval(')
from_value_body = _rust_block(cadence_rs, 'pub fn from_value(')

require(scan_due_body != '', 'scan_due still exists to read')
no_history_arm = _slice_between(scan_due_body, 'let Some(last) = last_scan_at else', '};',
                                'no-history arm')
flat = ' '.join(no_history_arm.split())
require(flat.startswith('let Some(last) = last_scan_at else {'),
        f'the no-history arm was located (got: {flat[:60]!r})')
require('return false;' in flat and 'return true;' not in flat,
        'a fresh install with no scan history is not due: absence does not license a crawl')
require('elapsed.num_seconds() < 0' in scan_due_body,
        'a future-dated timestamp cannot keep the job asleep forever')
require('DEFAULT_SCAN_INTERVAL_MINUTES: u32 = 24 * 60' in cadence_rs,
        'the default scan interval is the agreed 24 hours')
require('MIN_SCAN_INTERVAL_MINUTES: u32 = 60' in cadence_rs,
        'there is a floor under the scan interval')
require('minutes.clamp(MIN_SCAN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)' in clamp_scan,
        'the scan interval clamps at both ends rather than trusting input')
require('#[serde(default = "default_scan_interval")]' in cadence_rs,
        'a preference written before this field existed still parses; without it an enabled user '
        'would come back disabled after an upgrade')
require('scan_interval_minutes: clamp_scan_interval(parsed.scan_interval_minutes)'
        in from_value_body,
        'both read paths normalise the new field, not just the writer')
# The old three-field call shape must be gone everywhere: a caller that still passes two arguments
# would be a compile error CI catches, but only if nothing keeps the legacy signature alive.
# The three mutations each spread their call over several lines, so a per-line substring test
# reported the opening line of every valid call as an offender. Read a small window instead.
source_lines = settings_page.splitlines()
call_bodies = []
for index, line in enumerate(source_lines):
    if 'setReconciliationSettings(' not in line:
        continue
    body = []
    for follow in source_lines[index:index + 6]:
        body.append(follow)
        if follow.rstrip().endswith('),'):
            break
    call_bodies.append(' '.join(body))
# The test is arity, not naming: a call may supply the cadence by name or as a computed value (the
# scan control converts the drafted hours back to minutes), so looking for a particular identifier
# would flag a correct call. Three comma-separated arguments means all three settings were passed.
def _argument_count(text: str) -> int:
    """Commas sitting directly inside the call's own parentheses.

    The closing `)` is counted as still open until consumed, because a trailing comma before it is
    what separates the last two arguments; decrementing first would undercount every call by one and
    a two-argument call would look like a one-argument call.
    """
    depth = 0
    commas = 0
    for char in text:
        if char in '([{':
            depth += 1
        elif char == ',' and depth in (1, 2):
            commas += 1
        elif char in ')]}':
            depth -= 1
    return commas

legacy_calls = [body for body in call_bodies
                if _argument_count(body[body.index('setReconciliationSettings('):]) < 3]
require(not legacy_calls,
        f'every setReconciliationSettings call passes the scan cadence (offenders: {legacy_calls})')

reconcile_rs2 = text('apps/desktop/src-tauri/src/commands/reconcile.rs')
refresh_body = _rust_block(reconcile_rs2, 'async fn refresh_stale_indexes(')
require(refresh_body != '', 'the index refresh function exists')
require('if !scan_due(last, now, config.scan_interval_minutes)' in refresh_body,
        'the per-storage decision uses its own interval, not a global flag')
require('last_scan_at(pool, *storage_id).await' in refresh_body,
        'freshness comes from the scan history itself rather than a second timestamp that could '
        'disagree with the snapshot it qualifies')
require('sync_one_storage(state, &storage, provider, &mut summary).await' in refresh_body,
        'the scheduled path runs the same walk the manual button runs')
loop_body = _slice_between(reconcile_rs2, 'if !should_run_on_tick(&config)', 'run_sweep_inner',
                           'tick order')
require('refresh_stale_indexes(&state, &providers, &config).await;' in loop_body,
        'the refresh runs before the probe pass, so a tick uses the current listing')

index_rs3 = text('apps/desktop/src-tauri/src/commands/remote_index.rs')
finish3 = _rust_block(index_rs3, 'async fn finish_and_report(')
require('let store_listing = completeness == ScanCompleteness::Complete;' in finish3,
        'only a complete walk stores its listing: a partial set would let a later sweep conclude '
        'absence from a list known to be short')
require('} else if store_listing {' in finish3,
        'the store decision gates the write rather than running after it')
helper_sig = _slice_between(index_rs3, 'pub(crate) async fn sync_one_storage(', ') {',
                            'helper signature')
require('sync_one_storage(state, &storage, provider, &mut summary).await' in refresh_body,
        'the scheduled path runs the same walk the manual button runs')
require('summary: &mut RemoteIndexSyncView' in helper_sig,
        'the walk is callable by the scheduler with a provider it already built')
cmd_body = _slice_between(index_rs3, 'pub async fn sync_storage_asset_index(',
                          'Ok(summary)', 'command body')
require('!provider.capabilities().list' in cmd_body and 'finish_and_report' not in cmd_body,
        'a storage that cannot list is refused in the command, before any scan row exists')

require('observation.directory_budget_exhausted();' in remote_index
        and 'observation.file_budget_exhausted();' in remote_index,
        'both of our own budgets are recorded on the accumulator rather than only announced')

github_rs = text('crates/storage-github/src/lib.rs')
gitee_rs = text('crates/storage-gitee/src/lib.rs')
core_rs = text('crates/storage-core/src/lib.rs')
require('const CONTENTS_PAGE_LIMIT: usize = 1000;' in github_rs
        and 'Some(CONTENTS_PAGE_LIMIT)' in github_rs,
        'GitHub publishes its page ceiling from one constant used at both sites')
require('fn listing_page_limit(&self) -> Option<usize>' in core_rs,
        'the trait exposes the ceiling as a value, not as mutable post-call state')
require('async fn list_truncated' not in core_rs,
        'no stateful truncation query returned: providers are Clone + Send + Sync and listed '
        'concurrently, so a remembered flag would be read across directories')
gitee_impl = _rust_block(gitee_rs, 'impl StorageProvider for GiteeStorage {')
require('fn listing_page_limit' not in gitee_impl,
        'Gitee overrides nothing: claiming a ceiling it has not observed would misreport coverage, '
        'so the trait default is the honest answer')

desktop_ts = text('apps/desktop/src/lib/desktop.ts')
require("completeness: 'complete' | 'partial' | 'unknown'" in desktop_ts,
        'the frontend type carries the three levels instead of inferring them from error strings')
require('scans: RemoteScanOutcome[]' in desktop_ts,
        'the per-storage verdict is part of the contract the UI consumes')
# --- step two: the confirmation ladder is visible where drift is reported ----------------------
#
# The §18A ladder derived a level nobody could see outside the asset list. These gates hold the three
# things that make it readable rather than merely computed: one colour per bucket, a stated reason
# for the level, and no invented grade for an object with no local row.

reconcile_rs_s2 = text('apps/desktop/src-tauri/src/commands/reconcile.rs')
tier_rs = text('crates/domain/src/confirmation_tier.rs')
strength_impl = _rust_block(tier_rs, 'impl TierStrength {')
tier_impl = _rust_block(tier_rs, 'impl ConfirmationTier {')
require('pub fn strength(self) -> TierStrength' in tier_impl,
        'the ladder exposes a trust bucket, not only a numeric level')
require("pub fn missing_evidence(self) -> &'static str" in tier_impl,
        'every level can name what evidence it still lacks')
require(strength_impl.count('=> "') == 3,
        'all three buckets have a stable IPC spelling (a fourth would mean a new colour)')
require('ConfirmationTier::Uploaded | ConfirmationTier::RemoteObserved => TierStrength::Weak'
        in tier_impl,
        'uploaded and observed share a bucket: neither has compared bytes')
require('ConfirmationTier::Unknown => TierStrength::Unconfirmed' in tier_impl,
        'unobserved is its own bucket, never weak - weak already means "we looked"')
for test_name in ('strength_buckets_group_by_trust_not_by_kind',
                  'every_level_names_what_evidence_it_still_lacks',
                  'strength_spellings_are_stable_and_distinct',
                  'tier_spellings_are_stable_and_distinct'):
    require(f'fn {test_name}()' in tier_rs,
            f'the §18A rule behind {test_name} has a unit test naming it')

drift_view = _rust_block(reconcile_rs_s2, 'pub struct DriftEntryView {')
require("pub confirmation: Option<&'static str>" in drift_view,
        'a drift entry carries the level as a value, not a number the UI must decode')
require("pub missing_evidence: Option<&'static str>" in drift_view,
        'and the reason it sits at that level')
graded = _slice_between(reconcile_rs_s2, 'let graded = evidence.map', '});', 'grading block')
require('derive_confirmation(timestamps)' in graded,
        'the panel reuses the one derivation function instead of a second ranking')
require('finding.deployment_id.and_then(|id| clocks.get(&id))' in reconcile_rs_s2,
        'an entry with no local row grades to nothing rather than defaulting to Unknown')
# Asserted as data flow, not as a line: an earlier version stayed green when the loop filling `clocks`
# was emptied, because the insert statement was still present somewhere in the file text.
collect = _slice_between(reconcile_rs_s2, 'for row in &belief_rows', 'findings.extend',
                         'clock collection')
require('clocks.insert(' in collect and 'row.last_attempted_at' in collect
        and 'row.last_observed_at' in collect and 'row.last_verified_at' in collect,
        'the clock map is filled from the belief rows themselves, all three columns')
require('let local: Vec<LocalBelief> = belief_rows' in reconcile_rs_s2,
        'beliefs are built from the same rows the clocks come from')
# The two assertions above read a slice of the file, so an emptied feed still satisfies them if the
# statements survive elsewhere. Pin the shape of the loop header itself: it must iterate the query
# result, not a stand-in collection declared empty.
require(_slice_between(reconcile_rs_s2, 'let belief_rows', ';', 'belief binding').strip().rstrip(';')
        .removeprefix('let belief_rows').strip().startswith('= beliefs'),
        'the clock and belief inputs are the query result itself, never a stand-in collection')
belief_sql2 = _slice_between(text('crates/persistence-sqlite/src/lib.rs'),
                             'const BELIEF_QUERY: &str =', ';', 'belief sql')
for clock in ('last_attempted_at', 'last_observed_at', 'last_verified_at'):
    require(clock in belief_sql2, f'the belief query selects {clock} so the tier is derivable')

display_ts = text('apps/desktop/src/lib/confirmationDisplay.ts')
require('bg-emerald' in display_ts and 'bg-amber' in display_ts and 'bg-slate-100' in display_ts,
        'the three buckets map to three distinct existing utility classes')
require("unknown: 'unconfirmed'" in display_ts
        and "content_verified: 'strong'" in display_ts
        and "remote_observed: 'weak'" in display_ts,
        'the frontend mapping agrees with the Rust classification')
require('if (!tier) return null' in display_ts,
        'no level renders no chip; a default would invent a confirmation state')
settings_page2 = text('apps/desktop/src/pages/SettingsPage.tsx')
require(settings_page2.count('<TierChip tier={entry.confirmation} />') == 3,
        'all three drift lists show the column, not just the alarming one')
require("from '../lib/confirmationDisplay'" in settings_page2,
        'the page takes colours from the shared module rather than restating them inline')
require('无本地记录' in settings_page2,
        'a remote-only path says there is no local row instead of showing an empty cell')
verifier = text('scripts/verify_confirmation_display.mjs')
require('CONFIRMATION_DISPLAY total=' in verifier and 'process.exit(1)' in verifier,
        'the display rules run as a gate that reports and fails, not a script that only prints')
# The gate above reads the file from disk; this asserts it is actually wired into the aggregate, so
# a verifier nobody runs cannot count as coverage.
aggregate_s2 = text('scripts/verify_all.mjs')
require("'scripts/verify_confirmation_display.mjs'" in aggregate_s2
        and 'confirmation_display' in aggregate_s2,
        'the display verifier is a declared stage of verify:all, not just a runnable script')

# --- §21: reconciliation reads a scan as a set, not as a count ---------------------------------
#
# The probe path can only answer "is this object there" about objects we already named. Two things
# it structurally cannot do: discover a remote path no local row claims, and conclude absence from
# a listing that was cut short. These gates hold the rules that make those two directions legal.

drift_set_rs = text('crates/domain/src/drift_set.rs')
compare_body = _rust_block(drift_set_rs, 'pub fn compare_sets(')
observed_body = _rust_block(drift_set_rs, 'pub fn observed(&self)')
absent_body = _rust_block(drift_set_rs, 'pub fn supports_absence_conclusion(&self)')

require(compare_body != '', 'compare_sets still exists to read')
require('RemoteSide::Complete(_) => SetDriftKind::MissingRemote' in compare_body,
        'only the Complete shape may conclude absence')
require('RemoteSide::Partial(_) | RemoteSide::Untrusted =>' in compare_body
        and 'SetDriftKind::UnknownCoverage' in compare_body,
        'partial and untrusted both downgrade an absence claim to UnknownCoverage')
require('RemoteSide::Partial(_) => SetDriftKind::MissingRemote' not in compare_body,
        'a partial sweep must never reach MissingRemote')
require('RemoteSide::Untrusted => None' in observed_body,
        'an untrusted side exposes no set at all, so absence cannot be iterated out of it')
require('matches!(self, RemoteSide::Complete(_))' in absent_body,
        'the absence predicate accepts exactly one shape')

migration19 = text('crates/persistence-sqlite/migrations/0019_remote_scan_entries.sql')
require('REFERENCES remote_scans(id) ON DELETE CASCADE' in migration19,
        'entries cannot outlive the coverage verdict that qualifies them')
require('PRIMARY KEY (scan_id, remote_path)' in migration19,
        'one path per scan is stored once, so a re-walked directory cannot duplicate findings')
down19 = text('crates/persistence-sqlite/migrations/down/0019_remote_scan_entries.sql')
require('DROP TABLE IF EXISTS remote_scan_entries' in down19
        and 'idx_remote_scan_entries_path' in down19,
        'migration 0019 reverses both its table and its index')

remote_scan_rs2 = text('crates/persistence-sqlite/src/remote_scan.rs')
insert_entries = _rust_block(remote_scan_rs2, 'pub async fn insert_scan_entries(')
snapshot_fn = _rust_block(remote_scan_rs2, 'pub async fn fresh_scan_snapshot(')
require(insert_entries != '' and snapshot_fn != '',
        'the snapshot write and read paths both still exist')
require('INSERT OR IGNORE INTO remote_scan_entries' in insert_entries,
        'a duplicated path is skipped rather than aborting the batch mid-listing')
require('return Ok(None)' in snapshot_fn and 'age > max_age' in snapshot_fn,
        'a stale snapshot is refused rather than served as current evidence')
require('age < chrono::Duration::zero()' in snapshot_fn,
        'a clock-skewed future timestamp does not keep a snapshot fresh forever')
require('rows.is_empty()' in snapshot_fn,
        'a scan with no stored entries yields no snapshot; an empty set is never a valid answer')

lib_rs_p = text('crates/persistence-sqlite/src/lib.rs')
beliefs_fn = _rust_block(lib_rs_p, 'pub async fn all_deployment_beliefs(')
require(beliefs_fn != '', 'all_deployment_beliefs still exists')
# The SQL lives in BELIEF_QUERY above the function, so scoping to the body would read nothing.
# The const is sliced by name and the assertion runs against THAT: other queries in this file
# legitimately filter to online/degraded, and a whole-file test stayed green on that mutation.
belief_sql = _slice_between(lib_rs_p, 'const BELIEF_QUERY: &str =', ';', 'BELIEF_QUERY')
require(belief_sql.count('SELECT') == 1,
        'BELIEF_QUERY bounded to one statement (a runaway slice examines the rest of the file)')
require("d.status <> 'deleted'" in belief_sql,
        'the belief query excludes tombstones only, not failed rows')
require("'online','degraded'" not in belief_sql,
        'the belief query does not re-narrow to online rows - that filter is what made the '
        'unrecorded direction unreachable')

reconcile_rs = text('apps/desktop/src-tauri/src/commands/reconcile.rs')
compare_fn = _rust_block(reconcile_rs, 'async fn compare_against_snapshots(')
probe_loop = reconcile_rs[reconcile_rs.find('async fn run_sweep_inner('):
                          reconcile_rs.find('const PATHS_PER_KIND')]
require(compare_fn != '' and probe_loop != '',
        'both reconciliation halves are present to be read')
require('ScanCompleteness::Partial => RemoteSide::Partial(paths)' in compare_fn
        and 'ScanCompleteness::Unknown => RemoteSide::Untrusted' in compare_fn,
        'the stored completeness level decides which RemoteSide the sweep compares against')
require('accounting_is_complete_for(&findings)' in compare_fn,
        'the tally identity runs on every sweep, so a new kind cannot silently vanish')
# Match the CALL not the spelling: a bare `filter(f)` becomes `filter(|x| f(x))` when the iterator
# yields owned values (CI #314 caught exactly that type mismatch), and the gate must survive the fix.
require('filter(|path| is_image_path(path))' in compare_fn
        and '.filter(|row| is_image_path(&row.remote_path))' in compare_fn,
        'both sides pass through the same in-scope predicate')
require('"evidenceSource": "probe"' in probe_loop,
        'probe-path events name their source instead of leaving it implied')
require('SNAPSHOT_MAX_AGE_HOURS: i64 = 24' in reconcile_rs,
        'the freshness window is a named constant, not a number buried in a call')

index_rs2 = text('apps/desktop/src-tauri/src/commands/remote_index.rs')
finish2 = _rust_block(index_rs2, 'async fn finish_and_report(')
require('insert_scan_entries(pool, record_id, listed_paths).await' in finish2,
        'the sweep that produced a scan also stores its listing')
require('listed_paths.push(remote_path.clone())' in index_rs2,
        'the listing is collected during the walk rather than reconstructed afterwards')

desktop_ts2 = text('apps/desktop/src/lib/desktop.ts')
settings_tsx = text('apps/desktop/src/pages/SettingsPage.tsx')
require("evidenceSource: 'scan' | 'probe_only' | 'none'" in desktop_ts2,
        'the frontend type carries the evidence source as a closed set')
require('missingPaths' in desktop_ts2 and 'unrecordedPaths' in desktop_ts2
        and 'unknownPaths' in desktop_ts2,
        'all three drift kinds cross the IPC boundary')
# --- step one (cont.): the scan cadence is a user setting, not a constant -----------------------
settings_page = text('apps/desktop/src/pages/SettingsPage.tsx')
require('scanIntervalMinutes: number' in desktop_ts2,
        'the settings type carries the scan cadence across IPC')
require('MIN_SCAN_INTERVAL_MINUTES = 60' in desktop_ts2
        and 'DEFAULT_SCAN_INTERVAL_MINUTES = 24 * 60' in desktop_ts2,
        'the UI mirrors both the floor and the default so it can refuse a value the backend would '
        'silently raise')
require('scan_interval_minutes: Option<u32>' in reconcile_rs,
        'the setter takes the new field as optional: an older caller keeps working and takes the '
        'default rather than failing to bind')
require('scanIntervalSaveMutation' in settings_page
        and 'scanIntervalSaveMutation.mutate(scanDraft)' in settings_page,
        'the scan cadence saves on its own control, not folded into the probe interval save')
# Asserted on the labels, not just the handlers: an earlier version of this gate stayed green when
# both buttons were relabelled 保存间隔, because it only checked that a second mutation existed. Two
# controls with the same caption are indistinguishable to whoever reads the page.
require(settings_page.count("保存刷新间隔") == 1
        and settings_page.count("'保存间隔'") == 1,
        'the two interval controls carry distinct captions')
require('htmlFor="reconcile-scan-interval"' in settings_page
        and 'id="reconcile-scan-interval"' in settings_page,
        'the scan interval input has a label bound to it by id')
require('首次安装不会自动扫描' in settings_page,
        'the page states the no-first-scan rule where the switch is, rather than leaving it to a log')

index_gate_rs = text('apps/desktop/src-tauri/src/commands/remote_index.rs')
require('let store_listing = completeness == ScanCompleteness::Complete;' in index_gate_rs,
        'storing is gated on coverage at the write site')
require('云端有但本地没记录' in settings_tsx and '应存在但快照里没有' in settings_tsx
        and '覆盖不足，无法判断' in settings_tsx,
        'the settings page renders each kind under a distinct heading')
require('pathsOmitted' in settings_tsx,
        'a capped path list says how much it left out')


failed = [label for ok, label in checks if not ok]
section_tail = checks[-15:]
for ok, label in section_tail:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    # Every failure this section owns prints by name. The window above shows only the last 15
    # labels, so a red assertion outside it used to exit non-zero while printing nothing but OK -
    # observed directly: "FAILED: 1 check(s)" with zero FAIL lines on screen.
    for label in failed:
        print('FAIL(section) ' + label)
    raise SystemExit(f'User-flow contract FAILED: {len(failed)} of {len(checks)} accumulated check(s)')
print(f'user-flow section [piclist 19-20 remote scan completeness] | checks so far: {len(checks)}')

# --- publish dispatch step five: reconciliation reaches the user ----------------------------
# Step four shipped a background reconciler that no person can turn on: the commands existed and were
# registered, but nothing in the frontend referenced them. These gates exist so "backend complete" can
# never again be reported as "feature available" for this path.
require('getReconciliationSettings' in desktop and 'setReconciliationSettings' in desktop
        and "invoke('get_reconciliation_settings')" in desktop
        and "invoke('set_reconciliation_settings'" in desktop,
        'the desktop wrapper exposes both reconciliation settings calls to the frontend')
require('runReconciliationSweep' in desktop
        and "invoke('run_reconciliation_sweep')" in desktop,
        'the desktop wrapper exposes the manual sweep call')
require('reconcileSettings' in settings_page
        and 'reconcileToggleMutation.mutate(!reconcileSettings?.enabled)' in settings_page,
        'Settings renders a real background-reconciliation switch rather than static text')
require('后台对账' in settings_page,
        'the reconciliation section is labelled in the product language users see')
require('mutationFn: runReconciliationSweep' in settings_page
        and 'onClick={() => sweepMutation.mutate()}' in settings_page
        and '立即扫描' in settings_page,
        'Settings offers a manual sweep action wired to the command')
require('setSweepReport(report)' in settings_page
        and 'sweepReport.examined' in settings_page
        and 'sweepReport.eventsRecorded' in settings_page,
        'the sweep result is rendered from the report the backend returns')
require('sweepReport.missingRemote' in settings_page
        and 'sweepReport.unrecordedRemote' in settings_page
        and 'sweepReport.inconclusive' in settings_page,
        'drift findings are surfaced instead of only a success/failure toast')
require(_ui_interval_floor_matches_backend(desktop, cadence_src),
        'the interval control mirrors the backend floor instead of accepting any number')
require(_desktop_default_is_inert(desktop),
        "the frontend default matches the backend inert default rather than assuming enabled")

# --- piclist section seventeen: four deployment clocks --------------------------------------
# One column used to mean "written locally" while being named "verified", so a failed upload could
# leave its row looking verified. These gates hold the split in place: each cause writes one field, and
# no failure path reaches a success field.
require('pub enum TimestampCause' in timestamps_src
        and 'pub struct DeploymentTimestamps' in timestamps_src,
        'the four deployment clocks are set through one enumerated cause vocabulary')
require('pub timestamps: DeploymentTimestamps' in domain
        and 'pub recorded_at' not in domain
        and 'pub deployed_at' not in domain,
        'Deployment carries the clock group instead of a single ambiguous timestamp field')
require('fn record(mut self, cause: TimestampCause' in domain,
        'callers advance a deployment clock only through Deployment::record')
require('TimestampCause::Disproved => self,' in timestamps_src,
        'a failed content check advances no timestamp at all')
require('last_verified_at: Some(at),' in timestamps_src
        and 'TimestampCause::Proved => Self {' in timestamps_src,
        'only a passed content comparison moves last_verified_at')
require('UPDATE deployments SET status=?, last_attempted_at=? WHERE id=?' in persistence
        and 'UPDATE deployments SET status=?, public_url=COALESCE(?, public_url), last_error=?, last_error_kind=?, last_attempted_at=? WHERE id=?' in persistence,
        'status and result writes touch the attempt clock, never the verification clock')
require('last_error=?, last_error_kind=?, last_attempted_at=?' in persistence
        and '.bind(error_kind.map(|kind| kind.as_str()))' in persistence,
        'the result update carries the kind in lockstep with the message it explains')
require('if !passed {' in persistence
        and 'A mismatch records nothing here.' in persistence
        and 'UPDATE deployments SET last_verified_at=? WHERE id=?' in persistence,
        'verification recording bails before writing when the verdict is a mismatch')
require('UPDATE deployments SET remote_path=?, public_url=?, last_observed_at=?' in persistence,
        'remote-index sync records an observation rather than a write time')
require('UPDATE deployments SET last_observed_at=? WHERE id=?' in persistence
        and 'RemoteObservation::Present => {' in reconcile_src
        and 'record_deployment_observation(row.deployment_id)' in reconcile_src,
        'reconciliation stamps last_observed_at only on a positive probe')
require('.record_deployment_verification(proof.deployment_id, proof.passed)' in commands
        and '.record_deployment_verification(proof.deployment_id, proof.passed)' in cli,
        'both publish paths record verification from the real verdict, not from now')
require('ALTER TABLE deployments ADD COLUMN last_attempted_at TEXT' in migration16
        and 'ALTER TABLE deployments ADD COLUMN last_observed_at TEXT' in migration16
        and 'ALTER TABLE deployments ADD COLUMN last_verified_at TEXT' in migration16,
        'the migration adds all three new clocks')
require('UPDATE deployments SET last_attempted_at = recorded_at' in migration16
        and 'last_verified_at = recorded_at' not in migration16,
        'backfill routes old writes to the attempt clock and never into verification')
require('ALTER TABLE deployments DROP COLUMN last_attempted_at' in down16
        and 'ALTER TABLE deployments DROP COLUMN last_observed_at' in down16
        and 'ALTER TABLE deployments DROP COLUMN last_verified_at' in down16,
        'the downgrade removes exactly what the upgrade added')
require('fn a_failed_deployment_is_never_recorded_as_verified' in timestamps_src
        and 'fn a_reconciliation_probe_observes_without_verifying' in timestamps_src,
        'the §15 invariant and the probe/verify distinction are asserted by tests')
require('recorded_at' not in commands and 'recorded_at' not in cli
        and 'recorded_at' not in text('apps/desktop/src-tauri/src/commands/remote_index.rs'),
        'no entry point still writes the old single-clock column')
require(not _names_bare_verified_at(timestamps_src),
        'the clock vocabulary module does not reintroduce the bare verified_at name')
# --- piclist section eighteen: publish success is a ladder, not a boolean ---------------------
# "API returned 200 = success" was the whole story: `status = if error.is_none() { Online }`. These
# gates hold the four rungs apart, and hold each rung to its own evidence, so a future edit cannot
# quietly collapse the ladder back into the boolean it replaced.
require('pub enum ConfirmationTier' in tier_src
        and 'Unknown = 0,' in tier_src
        and 'Uploaded = 1,' in tier_src
        and 'RemoteObserved = 2,' in tier_src
        and 'ContentVerified = 3,' in tier_src
        and 'PubliclyReachable = 4,' in tier_src,
        'the confirmation ladder has explicit numbered rungs')
require('stamps.last_attempted_at.is_some()' in tier_src
        and 'if uploaded {' in tier_src
        and 'ConfirmationTier::Uploaded;' in tier_src,
        'an attempt alone yields Uploaded and no higher')
require('observed && uploaded' in tier_src
        and 'ConfirmationTier::RemoteObserved;' in tier_src,
        'RemoteObserved requires both our upload and a later independent look')
require('if verified {' in tier_src
        and 'return ConfirmationTier::ContentVerified;' in tier_src,
        'a passed content comparison is what reaches ContentVerified')
require('stamps.last_verified_at.is_some()' in tier_src,
        'level three reads the verification clock rather than any weaker evidence')
require(_tier_reports_unknown_without_evidence(tier_src),
        'absence of every clock reports Unknown rather than defaulting to success')
require('if public_url_fetched' not in tier_src
        and 'matches!(self, ConfirmationTier::PubliclyReachable)' in tier_src,
        'PubliclyReachable stays unimplemented instead of being claimed without a fetch')
require('fn derive_confirmation(stamps: &DeploymentTimestamps)' in tier_src,
        'the tier is derived from the section-seventeen clocks and never stored')
require('pub timestamps: domain::DeploymentTimestamps' in persistence
        and 'd.deployed_at,d.last_attempted_at,d.last_observed_at,d.last_verified_at' in persistence,
        'the summary query carries the clocks out so the tier can be computed at read time')
require('derive_confirmation(&deployment.timestamps).level()' in commands
        and 'pub confirmation_level: u8' in commands,
        'the desktop asset view publishes a per-copy confirmation level')
require('confirmationLevel: number' in assets_types
        and 'confirmationLabel(deployment)' in assets_page
        and '已上传' in assets_page and '远端可见' in assets_page and '内容一致' in assets_page,
        'the ladder is shown to the user in words, not only as a number')
require('Math.min(CONFIRMATION_LABELS.length - 1' in assets_page,
        'an unknown level clamps to a known label instead of rendering undefined')

# --- piclist section eighteen axis B: failure reasons travel as values ------------------------
# The defect was a single line: `error: Some(error.to_string())` threw away the variant an adapter had
# just derived from an HTTP status, so "replace your token" and "the network flinched" reached the
# database as the same kind of thing. These gates hold the structure in place end to end, because a
# column that nothing writes is indistinguishable from no column at all.
require('pub enum StorageErrorKind' in error_kind_src
        and 'Authentication,' in error_kind_src and 'Network,' in error_kind_src
        and 'RateLimited,' in error_kind_src and 'NotFound,' in error_kind_src
        and 'Conflict,' in error_kind_src and 'Rejected,' in error_kind_src
        and 'Unsupported,' in error_kind_src and 'NotImplemented,' in error_kind_src,
        'all eight failure kinds exist')
# One gate per kind, and each asserts the behaviour that motivates the kind existing at all: which
# bucket the user's next action falls into. A template round-trip check would pass for a kind nothing
# ever dispatches on.
require('StorageErrorKind::Authentication => "authentication"' in error_kind_src
        and '"authentication" => StorageErrorKind::Authentication' in error_kind_src
        and 'StorageErrorKind::Authentication | StorageErrorKind::NotFound' in error_kind_src,
        'authentication is persisted, parsed back, and counted as config-actionable')
require(_kind_is_retryable(error_kind_src, 'Network')
        and _kind_is_retryable(error_kind_src, 'RateLimited')
        and _kind_is_retryable(error_kind_src, 'Conflict'),
        'network, rate_limited and conflict are the retryable set')
require(not _kind_is_retryable(error_kind_src, 'NotFound')
        and not _kind_is_retryable(error_kind_src, 'Authentication')
        and not _kind_is_retryable(error_kind_src, 'NotImplemented'),
        'retrying cannot fix a missing target, a bad credential or our own gap')
require('StorageErrorKind::RateLimited => "rate_limited"' in error_kind_src
        and '"rate_limited" => StorageErrorKind::RateLimited' in error_kind_src,
        'rate_limited has its own spelling so throttling is not filed as a refusal')
require('StorageErrorKind::NotFound => "not_found"' in error_kind_src
        and '"not_found" => StorageErrorKind::NotFound' in error_kind_src,
        'not_found is persisted and parsed back')
require('StorageErrorKind::Conflict => "conflict"' in error_kind_src
        and '"conflict" => StorageErrorKind::Conflict' in error_kind_src,
        'conflict is persisted and parsed back')
require('StorageErrorKind::Unsupported => "unsupported"' in error_kind_src
        and '"unsupported" => StorageErrorKind::Unsupported' in error_kind_src,
        'unsupported is persisted and parsed back')
require('StorageErrorKind::NotImplemented => "not_implemented"' in error_kind_src
        and '"not_implemented" => StorageErrorKind::NotImplemented' in error_kind_src,
        'not_implemented is persisted and parsed back')
require('!StorageErrorKind::NotImplemented.is_retryable()' in error_kind_src
        or 'NotImplemented' in error_kind_src,
        'a gap in our own code is never reported as something a retry can fix')
# `rejected` is reached through the catch-all arm rather than naming itself twice, so it gets its own
# pair of assertions instead of being folded into the loop above.
require('StorageErrorKind::Rejected => "rejected"' in error_kind_src
        and '_ => StorageErrorKind::Rejected' in error_kind_src,
        'rejected is both the written form of that kind and the fallback for anything unknown')
require('_ => StorageErrorKind::Rejected' in error_kind_src,
        'an unreadable stored kind degrades to rejected rather than to a recoverable guess')
require('!kind.is_retryable()' in error_kind_src or 'pub fn is_retryable' in error_kind_src,
        'retryability is a property of the kind, not re-derived at each call site')
require('pub fn kind(&self) -> domain::StorageErrorKind' in storage_core_src,
        'a StorageError can name its own category')
require('MissingObject(String)' in storage_core_src and 'Conflict(String)' in storage_core_src,
        'the two categories adapters needed exist instead of overloading Provider')
require('error_kind: Some(error.kind())' in application_src,
        'the publish funnel records the category before rendering the message')
require('pub error_kind: Option<domain::StorageErrorKind>' in application_src,
        'PublishOutcome carries the kind alongside the text')
require('last_error_kind' in migration17 and 'ADD COLUMN last_error_kind TEXT' in migration17,
        'migration 0017 adds the column')
require('DROP COLUMN last_error_kind' in down17,
        'the downgrade removes it, paired with the upgrade in the same step')
require('last_error_kind=?, last_attempted_at=?' in persistence
        and 'error_kind.map(|kind| kind.as_str())' in persistence,
        'both deployment write paths store the kind, not only the message')
require('parse_stored_error_kind' in persistence
        and 'raw.map(|value| domain::StorageErrorKind::parse(&value))' in persistence,
        'a missing stored kind reads back as None, distinct from a recorded rejection')
require('StatusCode::NOT_FOUND {' in github_src
        and 'StorageError::MissingObject' in github_src,
        'github files a 404 as missing rather than as a generic provider rejection')
require('is_secondary_rate_limit' in github_src
        and 'folded.contains("rate limit")' in github_src,
        'github separates throttling from permission denial on secondary rate limits')
require('StatusCode::TOO_MANY_REQUESTS' in gitee_src
        and 'StatusCode::NOT_FOUND' in gitee_src and 'StatusCode::CONFLICT' in gitee_src,
        'gitee classifies throttle, missing and conflict instead of falling through')
require('opendal::ErrorKind::PermissionDenied' in opendal_src
        and 'Only kinds already proven in this dependency are matched' in opendal_src,
        'opendal matches only ErrorKind variants verified to exist, and says so')
require('Some(domain::StorageErrorKind::NotFound)' in commands
        and 'Some(domain::StorageErrorKind::Authentication)' in commands
        and 'Some(error.kind())' in commands,
        'each repair-path failure names its own category')
require('error_kind: outcome.error_kind' in commands and 'error_kind: outcome.error_kind' in cli,
        'both publish entry points carry the kind into the write record')
require('ERROR_HINTS' in assets_page and 'errorHint(deployment)' in assets_page
        and '凭证或权限问题' in assets_page and '被限流' in assets_page,
        'the UI turns the category into an instruction per kind')
require("if (!deployment.errorKind) return deployment.error ? ` · ${deployment.error}` : ''"
        in assets_page,
        'an unrecorded kind falls back to the raw message rather than inventing category advice')

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
# deployments.verified_at claimed a check that never happened (it was written as `Some(now)` next to
# `status = if error.is_none() { Online }`, with no remote read). It is now recorded_at. These
# assertions are the regression net: reintroducing the old name anywhere - field, SQL, or by editing
# 0001 instead of adding a migration - fails here rather than silently re-lending it authority.
migration14 = text('crates/persistence-sqlite/migrations/0014_rename_verified_to_recorded.sql')
require('ALTER TABLE deployments RENAME COLUMN verified_at TO recorded_at' in migration14,
        'the rename ships as an additive migration so existing databases keep their rows')
# Superseded by section seventeen: `recorded_at` was itself split into four clocks, so these now
# assert the current contract while keeping the original guarantee - the lying name stays gone.
require('pub timestamps: DeploymentTimestamps' in domain and 'pub verified_at' not in domain,
        'the domain Deployment field is the clock group and the lying name is gone from it')
require(not _names_bare_verified_at(persistence) and 'last_verified_at' in persistence,
        'no SQL string in the persistence layer still names the old column')
require(not _names_bare_verified_at(commands) and not _names_bare_verified_at(cli)
        and not _names_bare_verified_at(text('apps/desktop/src-tauri/src/commands/remote_index.rs')),
        'all three write sites name an explicit clock instead of asserting a verification they did not perform')
require('verified_at TEXT' in text('crates/persistence-sqlite/migrations/0001_init.sql'),
        '0001 keeps the original column name on purpose - migrations replay in order on a fresh database, so the rename must live in 0014')
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
require(steps == [str(i) for i in range(1, 8)], f'the onboarding dialog keeps exactly one contiguous 7-step sequence ({steps})')
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
# The updater's safety lives in three predicates the UI cannot route around; grep for them here so
# deleting any one turns the gate red (M32-style witnesses come with the next mutation batch).
updater = text('apps/desktop/src-tauri/src/commands/updater.rs')
require('pub async fn check_for_updates' in updater and 'pub async fn download_update' in updater and 'pub async fn install_update' in updater, 'the three updater commands exist')
require(updater.count('ends_with(SETUP_ASSET_SUFFIX)') >= 2, 'both asset selection and the download URL re-check the setup.exe suffix')
require('sha256 校验不一致' in updater and 'remove_file' in updater, 'a hash mismatch deletes the installer and refuses it')
# G1 trust boundary (docs/RELEASE_GATE_UPDATER.md): install takes ONLY an opaque id;
# the record comes from backend state and SHA256 is recomputed from disk pre-spawn.
require('update_id: String,' in updater and 'PendingUpdates' in updater,
        'install_update takes an opaque update id backed by PendingUpdates state, not a frontend object')
require('let recomputed = format!("{:x}", Sha256::digest(&bytes));' in updater,
        'install recomputes sha256 from the file on disk instead of trusting stored flags alone')
require('mirror-updates' in updater and 'canonicalize' in updater and '.parent()' in updater,
        'install canonicalizes and confines the installer path to the controlled directory')
require('.or_else(|| outcomes.iter().find(|outcome| outcome.error.is_none()))' not in cli, 'CLI has no first-successful fallback pick')
require('.error_for_status()' in updater and 'MAX_SETUP_BYTES' in updater, 'HTTP status is checked and a size ceiling exists')
# Audit item D (2026-10-03): the local API must never read a body before the bearer
# token passed, must time out stalled reads, and must cap concurrent connections.
local_api = text('apps/desktop/src-tauri/src/commands/integrations.rs')
head_at = local_api.index('async fn read_http_head(')
body_at = local_api.index('async fn read_http_body(')
auth_at = local_api.index('if !head.authorized(&expected)')
body_call_at = local_api.index('let body = read_http_body(&mut stream, &head, max_body)')
require(body_call_at > auth_at,
        'handle_http_connection reads the body only after the bearer check passes (auth-before-body order)')
require('LOCAL_API_HEADER_READ_TIMEOUT' in local_api and 'LOCAL_API_BODY_READ_TIMEOUT' in local_api and 'timeout(' in local_api,
        'both header and body reads are wrapped in tokio timeouts')
require('Semaphore::new(MAX_CONCURRENT_LOCAL_API_CONNECTIONS)' in local_api and 'try_acquire_owned' in local_api,
        'the accept loop bounds concurrent connections with an owned-permit semaphore')
require('MAX_JSON_BODY_BYTES' in local_api and '_ => 0,' in local_api,
        'authenticated body ceilings are per-route; unknown paths get a zero budget')
require('fn authorized(&self, expected: &str)' in local_api, 'the bearer comparison lives on HttpHead (headers only)')
desktop_lib_upd = desktop
require("invoke('check_for_updates')" in desktop_lib_upd and "invoke('download_update', { check })" in desktop_lib_upd and "invoke('install_update', { updateId })" in desktop_lib_upd, 'the frontend wires exactly the three updater commands, install passing only the opaque id')
# Release-gate contract (docs/RELEASE_GATE_UPDATER.md, approved 2026-10-02): the state machine,
# the G1 trust-boundary shape, the tag discipline and the competitor-wording rule must stay on the
# books until G5 retires them. Anchors are count==1 so a restructure trips the gate instead of
# silently orphaning it. When G1 lands, the interim assertion below flips to the real predicate:
# install_update must take an opaque id and recompute SHA256 backend-side (PendingUpdate), never a
# frontend-supplied path/verified pair.
gate_doc = text('docs/RELEASE_GATE_UPDATER.md')
for anchor in ('## G1 验收标准', '## G3 保真矩阵', '## Tag 纪律', '## 竞品表述准绳'):
    require(gate_doc.count(anchor) == 1, f'release-gate doc has exactly one "{anchor}" section')
require('RC 不使用正式版本 tag' in gate_doc, 'tag discipline states RCs never consume release tags')
require('开发 / 验证中' in gate_doc and '领先 PicList' in gate_doc, 'competitor-wording ceiling is recorded until G5')
require('PendingUpdates' in updater and 'canonicalize' in updater,
        'G1 landed: updater uses PendingUpdates state with canonicalized paths')


# Shipped 2026-10-02 and caught by the user, not by any gate: the installed Mirror Cloud v1.4.5
# refused every external link with "Command plugin:opener|open_url not allowed by ACL".
# openExternalUrl() calls plugin-opener's openUrl, but capabilities/default.json only granted
# opener:allow-default-urls (mailto/tel). The whole error-reporting chain built around this call
# could therefore only ever surface an ACL rejection. A capability list is a runtime contract;
# grep for the command string never touches it, so the witness lives here.
capabilities = json.loads((ROOT / 'apps' / 'desktop' / 'src-tauri' / 'capabilities' / 'default.json').read_text(encoding='utf-8'))
capability_perms = capabilities.get('permissions', [])
require('opener:allow-open-url' in capability_perms,
        f'capabilities grant opener:allow-open-url or every external link dies at the ACL (granted: {capability_perms})')
require('void openExternalUrl(' not in desktop_lib and "await openUrl(url)" in desktop_lib,
        'the ACL-gated command name in desktop.ts stays in sync with the permission asserted above')

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

# The layout probe compares a control's declared text-* utility against its rendered font-size, and
# reads it at ONE viewport (640). That is only a complete answer while no font size in the app
# depends on width or on a pointer state - a sm:text-xs would make the other two tiers unmeasured
# rather than measured-and-clean. This is the "a rule the code happens to follow today" case the
# file exists for: assert it, so the single-tier reading stays a reading.
RESPONSIVE_FONT = re.compile(r'\b(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|group-hover):text-(?:xs|sm|base|lg|xl)\b')
responsive_font_defs = RESPONSIVE_FONT.findall('x = "hover:text-xs"')
require(len(responsive_font_defs) == 1, 'the responsive-font detector sees a planted hover:text-xs')
require(not RESPONSIVE_FONT.findall('x = "text-xs hover:text-red-600"'),
        'the responsive-font detector does not fire on a colour utility (text-red-600 is not a size)')
responsive_hits = sorted({f"{rel}:{RESPONSIVE_FONT.search(text(rel)).group(0)}"
                          for rel in sorted(tracked_files())
                          if rel.endswith('.tsx') and RESPONSIVE_FONT.search(text(rel))})
require(not responsive_hits,
        f'no responsive or state-dependent font-size utility exists in the desktop source, because '
        f'the rendered-size check reads one viewport only (found {responsive_hits[:8]})')

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
staged = sorted(set(re.findall(r"'scripts/([A-Za-z0-9_-]+\.(?:mjs|py))'", aggregate)))
# A gate's signed baseline is as much a gate input as the gate itself: editing it changes what
# "drift" means without touching a line of code. It is matched by shape rather than by name so a
# second baseline cannot join the chain invisibly.
measured_files = sorted(set(
    [str(path.relative_to(ROOT)).replace('\\', '/') for pattern in ('scripts/verify_*.mjs', 'scripts/__fixtures__/*.mjs', 'scripts/*.baseline.json') for path in ROOT.glob(pattern)]
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
change_log_text = (ROOT / 'CHANGELOG.md').read_bytes().decode('utf-8').replace('\r\n', '\n')
require(any(ord(c) > 0x255 for c in change_log_text), 'CHANGELOG.md still holds real CJK code points (not double-encoded)')

# ---------------------------------------------------------------------------
# Stray-artifact guard.
#
# Every measurement this project produces is supposed to land in %TEMP%\image-hosting-probes\<date>,
# and the harness says so in its own usage text. Nothing enforced that, and the blind spot is not the
# one you would expect: .gitignore hides *.log / *.tmp / *.temp / *.bak / *.swp from `git status`, so
# a scratch file with a *temp* extension is invisible to the one command people use to look for junk.
# The files that actually get left behind are the other kind - a throwaway script used to patch files
# in place, which has a real source extension (.cjs / .mjs / .py) and therefore cannot be caught by
# banning an extension without banning the tooling directory.
#
# The list, and why each half is shaped the way it is:
#   STRAY_SUFFIXES - matched on extension anywhere, tracked or not, because a committed .bak is also
#       junk. All twelve currently have zero tracked matches; that is asserted below with a positive
#       control, since a census that returns 0 is only evidence if the tool can see a 1.
#   STRAY_NAME_PREFIXES - the basename declares itself throwaway. This is the rule that catches
#       tmp-readme-fix.cjs, which no extension rule could.
#   root scripts - an UNTRACKED .cjs/.mjs/.py/.js/.ps1/.sh at the repository root. Every executable
#       this repo owns lives under scripts/ (asserted: zero tracked root scripts), and an ad-hoc patch
#       script is dropped at the root by definition. Untracked-only so that adding a real tool at the
#       root is a decision, not a failure.
# Build territory (.git, node_modules, dist, target, ...) is skipped: npm writes its own .log files
# inside node_modules on purpose.
STRAY_SUFFIXES = ('.log', '.tmp', '.temp', '.bak', '.orig', '.rej', '.swp', '.save', '.patch', '.diff', '.new', '.old')
STRAY_NAME_PREFIXES = ('tmp-', 'tmp_', '.tmp-', '.tmp_', 'temp-', 'temp_', 'scratch-', 'scratch_', 'debug-', 'debug_', 'wip-', 'wip_')
ROOT_SCRIPT_SUFFIXES = ('.cjs', '.mjs', '.js', '.py', '.ps1', '.sh')
STRAY_SKIP_DIRS = {'.git', 'node_modules', 'dist', 'target', 'build', 'coverage', '.venv', '__pycache__'}


def stray_files(root, tracked_set=None):
    root = Path(root)
    if tracked_set is None:
        tracked_set = tracked_files()
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in STRAY_SKIP_DIRS)
        for f in filenames:
            rel = (Path(dirpath) / f).relative_to(root).as_posix()
            low = f.lower()
            why = None
            if low.endswith(STRAY_SUFFIXES):
                why = 'suffix'
            elif low.startswith(STRAY_NAME_PREFIXES):
                why = 'name'
            elif '/' not in rel and rel not in tracked_set and low.endswith(ROOT_SCRIPT_SUFFIXES):
                why = 'root-script'
            if why:
                found.append((rel, why))
    return sorted(found)


tracked_set = tracked_files()
require(any(p.endswith('.py') for p in tracked_set) and any(p.endswith('.md') for p in tracked_set),
        'the tracked-file census can see source (positive control for the two zeros below)')
require(not [p for p in tracked_set if p.lower().endswith(STRAY_SUFFIXES)],
        f'no tracked file carries a temp-extension name, so the suffix rule starts with zero false alarms (found {[p for p in tracked_set if p.lower().endswith(STRAY_SUFFIXES)][:6]})')
require(not [p for p in tracked_set if Path(p).name.lower().startswith(STRAY_NAME_PREFIXES)],
        'no tracked file carries a scratch-name prefix, so the name rule starts with zero false alarms')
require(not [p for p in tracked_set if '/' not in p and p.lower().endswith(ROOT_SCRIPT_SUFFIXES)],
        'every executable this repo owns lives under scripts/ or apps/, which is what makes a root-level untracked script a stray')

STRAY_PLANTED = [('tmp-readme-fix.cjs', 'name'), ('notes.log', 'suffix'), ('scratch_probe.mjs', 'name'), ('docs/outline.old', 'suffix')]
STRAY_CLEAN = [('README.md', None), ('scripts/keep.mjs', None), ('src/app.ts', None)]


def stray_fixture():
    # The fixture runs against a throwaway tree, never against the repository: a guard that plants its
    # own violation in the working copy would fail the next run of itself.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        (base / 'scripts').mkdir()
        (base / 'docs').mkdir()
        (base / 'src').mkdir()
        for rel, _ in STRAY_PLANTED + STRAY_CLEAN:
            (base / rel).write_text('x\n', encoding='utf-8')
        (base / 'node_modules').mkdir()
        (base / 'node_modules' / 'npm.log').write_text('x\n', encoding='utf-8')
        red = stray_files(base, tracked_set={r for r, _ in STRAY_PLANTED + STRAY_CLEAN})
        for rel, _ in STRAY_PLANTED:
            (base / rel).unlink()
        green = stray_files(base, tracked_set={r for r, _ in STRAY_CLEAN})
        return red, green


stray_red, stray_green = stray_fixture()
probe_dir = Path(os.environ.get('TEMP') or os.environ.get('TMP') or '.') / 'image-hosting-probes' / time.strftime('%Y-%m-%d')
probe_dir.mkdir(parents=True, exist_ok=True)
stray_out = {}
for half, rows in (('red', stray_red), ('green', stray_green)):
    p = probe_dir / f'stray-guard-{half}.txt'
    p.write_text('\n'.join(f'{r}\t{w}' for r, w in rows) + ('\n' if rows else ''), encoding='utf-8', newline='\n')
    stray_out[half] = p
require([r for r, _ in stray_red] == sorted(x for x, _ in STRAY_PLANTED),
        f'the stray guard must report every planted temp file and nothing else (got {[r for r, _ in stray_red]})')
require(all(dict(stray_red)[r] == w for r, w in STRAY_PLANTED),
        'each planted file must be reported for the rule that actually catches it (extension vs name vs root script)')
require(stray_green == [], f'the stray guard must go quiet once the planted files are removed (got {stray_green})')
require(not any(r.startswith('node_modules/') for r, _ in stray_red),
        'build territory is skipped on purpose - npm leaves .log files inside node_modules by design')
require(stray_out['red'].exists() and stray_out['red'].stat().st_size > 0,
        'the red half is saved to a file with its rows in it, because "I ran it" is not recomputable')
require(stray_out['green'].exists() and stray_out['green'].stat().st_size == 0,
        'the green half is saved too, and must be an empty file - a non-empty green output is a finding')

stray_real = stray_files(ROOT)
require(not stray_real, f'the repository contains no stray temp or scratch file (found {stray_real[:8]})')
print(f'STRAY_GUARD suffixes={len(STRAY_SUFFIXES)} nameShapes={len(STRAY_NAME_PREFIXES)} rootScriptSuffixes={len(ROOT_SCRIPT_SUFFIXES)} '
      f'selftest=red:{len(stray_red)}/green:{len(stray_green)} real_found={len(stray_real)} '
      f'outputs={probe_dir}{os.sep}stray-guard-{{red,green}}.txt '
      f'status={"earned - it reddened on a real stray" if stray_real else "not-yet-earned: never caught a real stray, only the planted one"}')

# The three "before" photographs are the only evidence of what the next colour change altered, and
# %TEMP% is the first place a cleanup deletes. They are in the repo now, and the table that
# registers them is checked here rather than trusted: a sha256 written in prose that nothing
# compares is the same "recorded but never read" decoration the shape ledger had.
baseline_img_rows = re.findall(
    r'^\| `(docs/baseline-images/[^`]+)` \| ([\d,]+) \| `([0-9a-f]{64})` \|$',
    change_log_text, re.M)
require(len(baseline_img_rows) == 8,
        f'the before/after evidence table lists eight images (found {len(baseline_img_rows)})')


def baseline_img_check(rows):
    bad = []
    for rel, bytes_str, sha in rows:
        p = ROOT / rel
        if not p.exists():
            bad.append(f'{rel}: file missing')
            continue
        data = p.read_bytes()
        if f'{len(data):,}' != bytes_str:
            bad.append(f'{rel}: bytes {len(data):,} != table {bytes_str}')
        if hashlib.sha256(data).hexdigest() != sha:
            bad.append(f'{rel}: sha256 does not match the table')
    return bad


require(not baseline_img_check(baseline_img_rows),
        f'the before-token-lift images match their registered bytes and sha256 (problems: {baseline_img_check(baseline_img_rows)})')
# Two-sided, or the check above could be reading a table that stopped describing anything.
# Guarded on a non-empty parse: the first version indexed rows[0] unconditionally and an
# unparseable table crashed the whole checker with a traceback instead of reporting one FAIL -
# which is worse than the bug it was meant to catch, because nothing else gets checked either.
if len(baseline_img_rows) == 8:
    require(bool(baseline_img_check([(baseline_img_rows[0][0], baseline_img_rows[0][1], '0' * 64)])),
            'a changed sha256 in the table must be reported, otherwise the row is decoration')
    require(bool(baseline_img_check([(baseline_img_rows[0][0], '1', baseline_img_rows[0][2])])),
            'a byte count that no longer matches the file must be reported')
    require(bool(baseline_img_check([('docs/baseline-images/gone.png', '1', '0' * 64)])),
            'a registered image that is missing from disk must be reported')
else:
    require(False, f'the before-image fixtures were skipped because the table did not parse to six rows (got {len(baseline_img_rows)}) - a broken regex reads as no findings')
print(f'BASELINE_IMAGES registered={len(baseline_img_rows)} '
      f'verified={len(baseline_img_rows) - len(baseline_img_check(baseline_img_rows))} '
      'selftest=sha256:caught bytes:caught missing:caught')

# A read-failure panel used to print the exception itself as its headline, in four pages
# (`任务读取失败：TypeError: Cannot read properties of undefined (reading 'invoke')` on screen).
# All four now route through one component that keeps the exception retrievable inside a <details>
# instead of deleting it. Asserted in both directions: the banned shape must be gone, and each page
# must actually use the component - otherwise a page could drop the component and the ban would stay
# green while the raw text came back.
FAILURE_PAGES = [
    'apps/desktop/src/pages/PluginsPage.tsx',
    'apps/desktop/src/pages/AssetsPage.tsx',
    'apps/desktop/src/pages/StoragesPage.tsx',
    'apps/desktop/src/pages/TasksPage.tsx',
]
_raw_headline = [p for p in FAILURE_PAGES if re.search(r'读取失败：\{String\(', text(p))]
require(not _raw_headline, f'no read-failure panel prints String(error) as its headline (offenders: {", ".join(_raw_headline) or "none"})')
_unused = [p for p in FAILURE_PAGES if '<ReadFailurePanel' not in text(p)]
require(not _unused, f'all four read-failure panels render the shared component (missing: {", ".join(_unused) or "none"})')
require('<details' in text('apps/desktop/src/components/ReadFailurePanel.tsx'),
        'the raw exception stays retrievable on screen (folded in a details, not deleted)')

# Single-source project state (piclist.md #29-#31: STATE.md / TASKS.md / README had drifted three ways).
# Facts must be read from git/Cargo/package.json/API by one generator, and the prose that repeats them
# is checked against that generator - never the other way round.
project_state = text('scripts/project_state.py')
require('def canonical_repo_name()' in project_state and '--verify' in project_state,
        'project_state.py both generates facts and verifies hand-written prose against them')
require(re.search(r're\.sub\(r"\^\.\*refs/tags/", ""', project_state) is not None,
        'tag names are stripped of the ls-remote "<sha>\\t" prefix before matching (a raw match silently reports "no tags")')
require('SKIP clone-URL check' in project_state,
        'the clone-URL assertion degrades visibly when the API is unreachable instead of falling back to origin, which still carries the pre-rename path')
require("PROJECT_STATE_VERIFY facts=(\\d+) problems=(\\d+)" in text('scripts/verify_all.mjs'),
        'verify_all runs project_state --verify as a stage, so drift cannot pass an aggregate green')
require('本文件不再手写事实' in text('.ai/STATE.md'),
        'STATE.md states that it holds narrative only, pointing at the generated JSON for facts')

failed = [label for ok, label in checks if not ok]
# Print every failure, then a short tail of passing checks for context. Printing only the last 20
# checks meant a failing assertion outside that window exited 1 without ever naming itself, which the
# mutation runner reported as "the oracle stayed silent" for guards that had caught the mutation.

for label in failed:
    print('FAIL ' + label)
# On a GitHub runner, a failed step's stdout needs a token to read (the logs endpoint answers 403),
# and the only public channel is the annotation list - so until now this guard could go red in CI and
# tell nobody which of its 253 assertions said no. Each failure is echoed as a workflow command so it
# lands next to the job, where anyone without credentials can read it.
if os.environ.get('GITHUB_ACTIONS') == 'true':
    for label in failed:
        print('::error::user-flow: ' + label.replace('%', '%25').replace('\r', ' ').replace('\n', ' ')[:400])
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
