# Changelog

## 1.4.1 - Image Loading, Tutorial Reachability, Docs Publishing

- Fix the Gallery / Assets / Cloud Browser image storm: each card rendered the same remote original twice and only the main image was lazy, so the eager blur backdrop fetched a full-size image for every mounted tile and decoded it on the main thread. Tiles now load near the viewport and decode asynchronously, enforced per `<img>` tag by `check_user_flow.py`.
- State plainly when a 资源 search only covers the loaded page instead of the whole index.
- Tell tutorials to open only UI that exists: the R2 guide pointed at a 方案 page and a 上传资源 button that have no navigation entry, and two pages quoted panel names the app does not render. `check_docs_site.py` now derives the sidebar from `AppShell.tsx` and rejects instructions whose first segment is not a real navigation item.
- Publish `website/` to GitHub Pages from `docs.yml` and build the desktop bundle against that same base URL, probing it first: reachable means the app shows online tutorial links, unpublished means the links stay hidden instead of shipping dead ones. A missing docs site no longer blocks a release.
- Document the Local HTTP API (endpoints, Bearer auth, status codes, 32 MiB behaviour, no CORS) and link it from the Settings API panel; it had been the only shipped entry point with no tutorial.

## 1.4.0 Preview - UX / Sync / Theme consolidation

- Rebrand the active development line as **图床 | Image Hosting Platform** and align desktop/docs package metadata on v1.4.0.
- Add metadata-only cloud asset index sync so existing images in GitHub / Gitee / R2 / S3 / OSS / COS / WebDAV can appear in the Asset Index without downloading image bodies.
- Keep **资源** and **图库** as separate concepts: Asset Index for metadata/output/multi-cloud state, remote Gallery for live Provider browsing.
- Harden GitHub browsing when the configured root does not exist yet and retry upload conflicts after refreshing remote state.
- Add the v1.4 Theme Engine foundation with design tokens, presets, accent color, wallpaper URL, glass strength and blur controls.
- Add first-run Help Center onboarding while keeping it reopenable from the sidebar.
- Replace misleading Typora “one-click configuration” wording with an explicit Custom Command configuration guide; the app copies the command and opens Typora but does not silently rewrite Typora settings.
- Upgrade Gallery presentation toward a photo-album layout and make copy actions explicit.
- Make the main application content area independently scrollable so long Settings / Plugins / AI sections remain reachable.
- Clean temporary cloud-index wiring scripts/workflows after the guarded implementation landed.
- Upgrade Release Bundle so `v*` tags can publish Windows installers, tracked-source archive and SHA256 checksums to GitHub Releases; manual dispatch remains a build-only preview path.
- Keep the legacy Tauri application identifier and Rust library crate name for upgrade/source compatibility while public product/package naming moves to Image Hosting Platform.

## 1.3.5 - Task Control, Plugin Observability & Diagnostics

- Added cooperative cancellation for persistent Cloud Manager batch delete/move/rename tasks.
- Added item-level progress updates that cannot revive a task after it has been cancelled.
- Added bounded retry for failed/cancelled Cloud Manager batch tasks using the original persisted payload and a maximum retry budget.
- Added Task Center cancel/retry controls plus retry-attempt visibility.
- Added migration `0013_plugin_execution_logs.sql` and persistent plugin execution audit records for hook, status, duration and failure summary.
- Audit Desktop, Typora/Local API and manual plugin executions through the same plugin repository.
- Added a plugin-page execution activity panel for recent success/failure timing.
- Added Settings system diagnostics for Local API, Storage, plugins, default Workflow and task health.

## 1.3.4 - Lifecycle Completion & Persistent Cloud Tasks

- Added `before_process`, `after_process` and `on_publish_failure` plugin hooks.
- Unified expanded lifecycle execution across Desktop, Typora and the Local HTTP API bridge.
- Upgraded the official Webhook manifest to v1.2.0 without auto-enabling newly introduced hooks.
- Added migration `0012_official_webhook_lifecycle.sql` for existing installs.
- Moved provider-neutral cloud move overwrite/fallback/rollback semantics into `application::CloudMutationCore`.
- Added persistent Task Center jobs for batch cloud delete, move and template rename.
- Updated Cloud Manager to enqueue long-running batch mutations instead of blocking the page.
- Fixed CLI `PluginContext` construction to include lifecycle metadata.

## 1.3.3 - Lifecycle Hooks & Batch Cloud Operations

- Add explicit plugin lifecycle hooks with persisted per-plugin user selections; legacy installs default to `after_upload` only.
- Add host-runtime hook gating and first-class `after_upload`, `on_gallery_delete` and `manual_trigger` events.
- Let Webhook Publisher optionally receive real cloud-delete events with storage/path metadata without making plugin failures roll back a completed remote delete.
- Add Cloud Manager batch move and safe template batch rename with `{name}`, `{stem}`, `{ext}` and `{index}` placeholders.
- Keep batch mutations bounded to 100 files, preserve destination overwrite protection and reconcile Deployment locations after successful moves.
- Split cloud-management and plugin commands into dedicated Rust command modules to continue reducing the monolithic Tauri API layer.
- Expand command contracts to 60/60/60 and source user-flow/reliability/lifecycle contracts to 103 checks.

## 1.3.2 - Zero-context Upload & Cloud Manager Mutations

- Add a real global shortcut (`CommandOrControl+Shift+U`) that uploads the clipboard image through the existing default Workflow and writes final URLs back to the clipboard.
- Persist the global-shortcut preference and actually unregister the OS shortcut when disabled so the key combination is released for other applications.
- Add a Windows Explorer current-user image context-menu integration backed by `--shell-upload`; no administrator-level registry write is required.
- Keep shell, shortcut, Typora, Local HTTP API and desktop uploads on the same default Workflow / multi-cloud / plugin path.
- Extend `StorageProvider` with move/create-directory capabilities and implement native OpenDAL rename/create-dir operations.
- Add safe cloud move fallback (download → upload → delete), destination-overwrite protection and rollback of the destination if source deletion fails.
- Reconcile SQLite Deployment `remote_path` / `public_url` after cloud moves and mark active deployments deleted after batch cloud deletes.
- Upgrade Cloud Manager with create directory, rename, move, multi-select and bounded batch delete controls.
- Expand source user-flow/reliability/integration/cloud-manager contracts from 79 to 93 checks and Tauri command contracts from 49/49/49 to 57/57/57.

## 1.3.1 - Integration Layer & Background Publisher

- Add a token-protected Local HTTP API bound only to `127.0.0.1:36677` for scripts, ShareX-style tools, editor integrations and future agents.
- Reuse the existing default Workflow bridge for both raw-body and local-path HTTP uploads; no second uploader implementation is introduced.
- Keep the Local API token in OS Credential Store and support in-app token rotation that invalidates previous clients immediately.
- Add a real Tauri system tray entry; closing the main window hides it instead of terminating the background publisher, while the tray menu provides explicit open/quit actions.
- Move Typora/output/integration commands out of the monolithic `commands.rs` into `commands/integrations.rs` as the first command-layer decomposition.
- Move CPU-heavy workflow image decode/resize/encode work to Tokio blocking workers for both desktop and CLI/Typora paths.
- Add Settings UI for Local API status, token copy/rotation and call examples.
- Harden command-contract validation to scan nested Rust command modules and keep frontend/Rust/Tauri registration at 49/49/49.
- Expand source user-flow/reliability/integration contracts from 69 to 79 checks.

## 1.3.0 - Publisher Core, Publish Center & Cloud Manager

- Move Storage Group strategy semantics into `application::PublisherCore`; Tauri now delegates `mirror_all` and ordered primary/backup failover instead of owning those rules.
- Make a new Publish Center the default desktop entry: current target, quick target switching, drag/drop, clipboard, URL, output-format controls, recent assets and recent tasks.
- Keep every Publish Center action on the existing hidden workflow/task path instead of introducing a second uploader implementation.
- Upgrade Gallery/Storage Browser with remote download and confirmed permanent delete.
- Reconcile direct cloud deletes back into SQLite by marking every matching active Deployment as deleted.
- Add two Tauri cloud-management commands and keep frontend/backend/registration contracts at 47/47/47.
- Preserve v1.2.5 integrity hardening, plugin Permission Gate and OS credential isolation.
- Product direction is informed by PicGo's low-friction upload flow and PicList's cloud-management/task experience, without copying their Electron/npm-plugin security model.

## 1.2.5 - Publish Integrity Hardening

- Let backup failover survive desktop preflight instead of rejecting a group when Primary is temporarily unhealthy.
- Validate URL batches before task creation so an invalid later URL cannot leave hidden partial tasks.
- Make new remote paths unique per publish and protect shared legacy remote objects during deletion.
- Verify repair sources against the stored content hash before copying them to other clouds.
- Persist Typora partial/cloud/plugin warnings as completed-with-warning, matching the desktop task model.
- Add compensation cleanup when a safe unique remote upload succeeds but local persistence fails.
- Strengthen object-storage and Gitee connection tests, automatic-pipeline setup, long-history loading and public URL validation.

## 1.2.4 - Explicit Plugin Authorization

- Separate plugin Manifest declarations from user-granted permissions; declaration alone no longer authorizes a capability.
- Persist `granted_permissions_json` in SQLite and add migration `0010_plugin_permission_grants.sql`.
- Existing plugins keep only baseline `read_asset`; plugins requesting network, secrets, or external writes are disabled until the user explicitly re-authorizes them.
- Add `set_plugin_permissions` as a Tauri command and share the same grant state across desktop uploads and Typora CLI uploads.
- Add plugin-page permission confirmation before enabling a plugin with missing grants, plus a one-click way to revoke sensitive grants.
- Keep v1.2.3 reliability fixes: real backup failover, GitHub write-access validation, multimodal AI Caption, remote SHA verification and automatic hidden publish chain.
- Expand user-flow/reliability regression contracts from 33 to 40 checks.
- Dependency lock policy remains honest: networked CI generates the resolved lock files and then uses `cargo --locked` / `npm ci`; this offline package does not fabricate lockfiles.

## 1.2.3 - Publish Reliability & Plugin Safety

- Keep the hidden automatic publish chain introduced in v1.2.2 and preserve the single user flow across local, URL, clipboard and Typora uploads.
- Make `primary_with_backups` real failover semantics: mirrors always publish, backups publish only if the primary fails or cannot be initialized.
- Make GitHub connection tests reject tokens that can read the repository but do not have effective repository write access.
- Send the actual remote image as OpenAI-compatible `image_url` multimodal content for AI Image Caption.
- Enforce plugin manifest permissions inside the host runtime for asset reads, network calls, secrets and external writes.
- Upgrade existing official AI Caption plugin manifests to request `secret` permission.
- Pin direct npm dependency versions and make CI/release resolve lock files first, then build with `cargo --locked` and `npm ci`; publish the resolved locks as an artifact.
- Expand user-flow regression checks from 22 to 33 contracts.
- Retain plugin output persistence, post-plugin `asset://published`, OS credential storage for AI keys and automatic default target repair.

## 1.2.1 - Plugin Switches

- Replace the primary “方案” navigation entry with a single plugin control surface.
- Make installed plugins first-class on/off switches; add enable-all and disable-all actions.
- Enabled plugins now participate automatically after successful uploads, including Typora uploads.
- Keep workflow records as an internal processing compatibility layer instead of exposing them as a primary product concept.
- Update Typora and upload copy so users think in terms of upload target + enabled plugins.

## 1.2.0 - Plugin Runtime + AI Planner

- Add manifest-based plugin runtime and plugin marketplace UI.
- Add plugin persistence migration and enable/disable/config/remove commands.
- Add template, webhook and OpenAI-compatible AI prompt host runtimes.
- Add AI provider settings and natural-language workflow planner.
- Keep third-party native code disabled; WASM sandbox remains future work.
