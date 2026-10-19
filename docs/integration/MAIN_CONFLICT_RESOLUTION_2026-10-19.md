# Main / TaskUI integration conflict resolution — 2026-10-19

## Immutable ancestry and audit

- Merge base: `a22c170c18941435b1c2e8033f03c48ae5949483`.
- Current protected main: `bb4d59ee050e8c4a457b39ced2a548c851cd92c8` (squashed Dev PR #5).
- Integration candidate: `3eca9cc8c51b696d3e1fc6d26d5d90853e75d3ab` (includes TaskUI UI PR #39).
- Recursive tree objects show **92 paths changed on main** relative to base. **74/92 exact blob SHA match** integrated candidate. **18** have later edits on integration. There are **zero paths** where main changed and integration still has the original baseline blob.
- For all 18 files, compared main vs integration lines and code references. Integration was deliberately chosen as current content, never overwritten from the older main snapshot.

## File-by-file resolution decisions

| File (full path) | Why integrated content wins |
|---|---|
| `CHANGELOG.md` | Retain latest signed release/change ledger; main's older fingerprint rows are superseded. |
| `apps/desktop/src-tauri/src/cli.rs` | Main CLI statements already present; integration extends CLI. |
| `apps/desktop/src-tauri/src/commands.rs` | Keep restore_guard conflict checks and atomic create_batch for files/URLs; older main per-task push loop superseded. |
| `apps/desktop/src-tauri/src/lib.rs` | Main registration statements preserved; newer commands registered. |
| `apps/desktop/src/components/AppShell.tsx` | Keep new TaskUI aria-current, skip-link, focus and responsive rail. |
| `apps/desktop/src/components/ConfirmDialog.tsx` | Keep Escape plus Tab focus trap and return focus, not main's old Escape-only behaviour. |
| `apps/desktop/src/lib/desktop.ts` | Integrated IPC bridge contains main calls and newer operations. |
| `apps/desktop/src/pages/AssetsPage.tsx` | Keep deployment confirmation plus newer private-share and asset actions. |
| `apps/desktop/src/pages/SettingsPage.tsx` | Keep differentiated update check/download/install status, migration and rollback UX. |
| `apps/desktop/src/types.ts` | Main types still present in expanded integrated types. |
| `apps/desktop/src/vite-env.d.ts` | Main globals still present in expanded types. |
| `apps/desktop/vite.config.ts` | Keep newer candidate/identity config; version still derived. |
| `crates/persistence-sqlite/src/lib.rs` | Keep provider_key, storage config, restore conflict and migration-aware storage queries. |
| `crates/storage-core/src/lib.rs` | Main provider trait statements retained. |
| `crates/storage-opendal/src/lib.rs` | Main OpenDAL statements retained; do not run protected R2 E2E. |
| `scripts/check_user_flow.py` | Preserve stricter atomic batch and restore_guard guard, superseding old exact string checks. |
| `scripts/verify_dialog_interactions.mjs` | Keep newer browser and dialog predicates; original main historical fixture retained via commit. |
| `scripts/verify_shape.baseline.json` | Keep fingerprint corresponding to integrated executable source; main old baseline is obsolete. |

## Execution and rollback controls

1. Add this audit document on the **existing integration branch**. This is a documentation-only commit.
2. Create a genuine **two-parent Git commit** with unchanged integrated source tree plus this document; parent 1 = latest integration audit commit, parent 2 = unchanged main SHA. This retains Dev PR #5 history even for superseded lines.
3. Fast-forward only the **existing** integration ref, under `expected_sha`; `force=false`. Do not create new refs, modify protected main, or delete branches.
4. Check PR #43 actual GitHub mergeability and CI **for the resulting final SHA**, not earlier green runs.
5. Only use protected main PR merge after CI and conflict verification; no tag, release, live Cloudflare write, or dangerous migration.
6. PR #40 R2, #41 seven-page audit, #42 TaskUI architecture are independent Draft deliverables; no assertion that these are already included.

**Evidence boundary:** 3-way blob/semantic comparison is not runtime proof. Cargo/SQLite migration, browser focus, native build and upgrade/rollback gates must still pass. This report records conflict decisions; it does not state that main has been merged or that code has been deployed.
