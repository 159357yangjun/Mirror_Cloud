# Validation Notes — v1.3.5

正式发布应在联网 Windows CI / Windows 本机完成：

```text
cargo fmt --all -- --check
cargo check --workspace --locked
cargo test --workspace --locked
npm ci
npm run build
npm run tauri build
```

并至少执行以下真实闭环：

```text
1) Publish Center / Typora / Shortcut / Shell / Local API
→ same default Workflow
→ real Provider
→ plugin lifecycle
→ public URL / Asset / Deployment / Task

2) Cloud Manager persistent batch task
→ queue batch move/delete/rename
→ progress advances per item
→ cancel during execution
→ worker stops before the next item
→ cancelled state is not revived

3) Task retry
→ fail/cancel a cloud batch task
→ retry uses the persisted original payload
→ attempt increments
→ retry is refused after max_attempts

4) Plugin execution audit
→ after_upload / failure / gallery-delete / manual hook
→ plugin_execution_logs records plugin + hook + success/failure + duration
→ Plugin page shows the same result

5) System diagnostics
→ Storage/default Workflow/Local API/plugin/task states match real runtime state
→ warnings disappear after fixing the underlying configuration

6) Upgrade existing v1.3.4 database
→ migration 0013
→ existing plugin/task rows remain unchanged
→ plugin_execution_logs becomes available
```

本次源码环境实际验证范围见 `VALIDATION_ACTUAL_2026-09-25_V1.3.5.md`。不得把源码契约验证写成真实 Rust / Windows / 云端 E2E。
