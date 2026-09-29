# Changelog

## Unreleased - 2026-09-29（未发版：不改 version、不打 tag，等你批准）

本轮提交：`a8eb977`、`502b25c`、`3c642af`（均在 `dev`，v1.4.4 之后）。

- **发布产物校验器**（`scripts/verify_release_assets.py`）：前三版用一次性片段核对，其中一次正则没匹配上却报了"已验证"。现在三路对账——本机重算、发布的 `SHA256SUMS.txt`、GitHub API 自带的 `assets[].digest`——并校验 tag 版本出现在每个文件名与归档内 `Cargo.toml` / `package.json` / `tauri.conf.json`，以及 `source.zip` 是否恰等于该 tag 的受版本控制树（无构建产物、无凭据型文件名、169 个文本文件按 6 类高信号模式扫零命中）。
- **删除发布链里没人消费的文档构建**：`release.yml` 的 `docs-bundle` 作业构建 `website/dist` 后上传的 artifact 无任何作业下载，它唯一的额外检查（版本一致性）在 `windows-bundle` 已跑；文档站现由 `docs.yml` 构建并发布、`ci.yml` 每次 push 重建。
- **破坏性操作改用应用内确认框**：原先 10 处 `window.confirm`（删除资源、云端删除/移动/改名、批量删除、卸载插件、敏感权限授权、重置 Local API Token、删除存储与多云组）是浏览器外观的原生框，且在 WebView2 中会挂起绘制直到被关闭。`confirmAction` 失败即关闭：关闭、Escape、点遮罩、被新请求取代一律 resolve(false)，`ConfirmDialog` 未挂载时 promise 永不 resolve，因此闸门坏掉只会挡住操作、不会放行删除。

### 本轮验证命令与实际输出

```text
$ for s in validate check_contracts check_user_flow check_workflow_action_pins \
      check_docs_site check_release_version check_tauri_dependency_family; do python scripts/$s.py; done
validate PASS  check_contracts PASS  check_user_flow PASS  check_workflow_action_pins PASS
check_docs_site PASS  check_release_version PASS  check_tauri_dependency_family PASS

$ python scripts/check_user_flow.py | tail -1
User-flow v1.3.5 task/observability/diagnostics hardening: OK | total checks: 143

$ python scripts/verify_release_assets.py --tag v1.4.4 --dir <下载目录> --api api_assets.json --repo .
Release asset verification OK | total checks: 35
      source archive is exactly the tracked tree of v1.4.4 (archive-only [], tree-only [])
      227 tracked files in the archive
      secret scan over 169 text files found nothing ([])

$ npm run build          # apps/desktop，tsc -b && vite build
✓ built in 1.13s
```

守卫做了变异验证：塞回一个 `window.confirm` → FAIL `destructive gates use the in-app dialog…`；摘掉 `<ConfirmDialog />` → FAIL `the confirm dialog is mounted at the app root`；在 release.yml 用 `npm install` → FAIL 锁消费断言。两条旧断言原本把 `window.confirm` 当作"存在确认步骤"的证据（Gallery 确认删除、插件敏感权限），已改为要求 `confirmAction`，插件那条额外要求"用户拒绝即 return"，因此保证强于改前。删除 `docs-bundle` 使旧的 `npm ci >= 2` 计数断言失效，已替换为直接断言三个工作流都不出现 `npm install` / `cargo generate-lockfile`。

### 本轮仍然没有验证的东西

1. **新确认框的视觉与交互**：焦点初始位置、Escape 与遮罩点击的实际行为、长文案换行、与其他弹层（上传对话框 / 图库预览）的 z-index 关系——只过了 `tsc`、`vite build` 和静态断言，没有运行时观察，也没装过应用。
2. **教程基址是否真的进了 v1.4.3 / v1.4.4 的包**：NSIS 压缩使二进制搜索无效，解包或安装超出授权；只有间接证据链（Pages 10:47Z 返回 200 → CI 探测步 11:01:46 → 前端构建步 11:10:26）。
3. **`openExternalUrl` 失败时用户零提示**：三处调用点都是 `onClick={() => void openExternalUrl(...)}`（`HelpCenterDialog.tsx:32`、`StorageSetupDialog.tsx:256`、`SettingsPage.tsx:328`），rejection 被吞；本轮只证明了调用点形态，没构造出 openUrl 真失败的场景。可修，未修。
4. **`3c642af` 的 CI 结论**：推送成功（代理一度全断、直连重试成功），但记录本条时 API 不可达，尚未读到该次运行的最终结果。
5. **默认分支 `main` 指向另一项目（`# depot`）**：按指令**未执行任何分支操作**，只交方案。关键事实是 `git merge-base --is-ancestor origin/main HEAD` 成立——main 是 dev 的祖先，因此 `git push origin dev:main` 是**纯快进、零提交丢失、不需要 force push**；推荐它而非"只改默认分支指针"（后者仍把 depot 的 README 留在仓库里）。影响面：Dependabot 已显式 `target-branch: dev` 故不受影响；`release.yml` 只认 `v*` tag 故推 main 不会误发版；`ci.yml` 无分支过滤故以后推 main 会跑 CI；外部已分享的 `blob/main/<老文件>` 链接在文件被改名/删除后会 404。

## 1.4.4 - Gallery Render Bound and Installer Publisher

- Bound gallery rendering: past 600 revealed entries the page reports how many remain and asks you to narrow the directory or search instead of offering another batch forever. The cap is soft, so up to about 720 files stay fully reachable with no limit message. This also bounds what 全选本页文件 can select, which previously could reach every entry you had revealed.
- Name the installer publisher. `bundle.publisher` was unset, so WiX fell back to the second segment of the identifier and the MSI reported `Manufacturer = multicloud`; publisher and copyright now carry the string from `LICENSE`. This affects Windows Installer metadata only - the `.exe` `CompanyName` version resource has no Tauri configuration key and stays empty.

## 1.4.3 - Online Tutorials Reachable

- The tutorial site is published at `https://159357yangjun.github.io/image-hosting-platform`, so this is the first bundle whose **在线文档 / 配置教程 / 本机 API 教程** entries resolve: release.yml probes one real tutorial route before building and bakes the base URL only when it answers 200.
- Document how API and Typora publishes differ from a desktop publish: they persist a `typora_publish` task but cannot raise `task://updated` or `asset://published`, so the open window refreshes by polling and auto-copy after publish does not happen.
- Give the exact Raw URL the app builds for Gitee when no custom domain is set.

## 1.4.2 - Error Channel and Cloud Onboarding Truthfulness

- Stop reporting one plugin failure twice. Those mutations declare no `onError`, so the global handler already raises a toast; the inline `window.alert` was a second report for the same event, and in WebView2 an alert suspends painting until it is dismissed. Storage pages that did own their error path now use the same toast channel instead of a native dialog, and batch enable/disable reports that the remaining plugins were left untouched rather than dumping a raw error string.
- State when the object-storage / WebDAV **public access domain** actually matters. Nothing derives an image URL from an Endpoint, so leaving it empty means the provider can only serve as a mirror or backup member; as a publish target the upload is rolled back with `Upload succeeded but the provider did not return a public URL`. The field label, the five provider step lists and the OSS / COS guides now say that conditionally, and `check_user_flow.py` pins the wording to the backend facts.
- Tutorials may only name reachable UI, and errors may only reach the user through one channel; both are now enforced per file.

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
