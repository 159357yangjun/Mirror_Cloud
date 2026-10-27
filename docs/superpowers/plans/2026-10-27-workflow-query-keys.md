# Workflow Query Key Implementation Plan

**Goal:** Centralize the existing workflow and recipe query keys without changing values, cache matching, request options or invalidation timing.

**Architecture:** `features/workflows/queryKeys.ts` exports the two existing key values. Seven consumers use those keys at their existing `useQuery` and `invalidateQueries` call sites; no hook, mutation callback, query function, enabled condition or execution order changes.

**Tech stack:** TypeScript, TanStack Query, existing Node/TypeScript runtime and query client. No new dependency.

## Scope

- Create `apps/desktop/src/features/workflows/queryKeys.ts` with `workflowQueryKeys.workflows = ['workflows']` and `workflowQueryKeys.recipes = ['recipes']`.
- Modify `pages/WorkflowsPage.tsx` (two queries, two invalidations), `pages/PublishPage.tsx` (one invalidation), `pages/StoragesPage.tsx` (two invalidations), `pages/SettingsPage.tsx` (one invalidation), `components/StorageSetupDialog.tsx` (one invalidation), `components/UploadDialog.tsx` (one query), and `components/WorkflowSetupDialog.tsx` (one invalidation). Preserve all other code.
- Create `scripts/test_workflow_query_keys.mjs` and register it in `scripts/test_unit.mjs`.

## Verification

1. Before implementation, run the new test. It must enumerate all 11 existing query-key sites in seven source files, verify their original options and values and use the actual TanStack Query client to verify workflow-prefix invalidation and unrelated cache isolation. The missing shared module and unmigrated consumer checks must fail.
2. Add the shared keys and replace each existing literal at its original site with the corresponding shared constant; add imports. Verify no literals remain in consumers and every consumer is covered by the test.
3. Rerun the test, `npm run test:unit`, `npm run build`, `python scripts/check_contracts.py`, `python scripts/check_user_flow.py`, and `git diff --check`. Review the full diff and confirm query/mutation context and order stayed unchanged.
4. Report that `theme_face_inventory --verify` already reported 11 mismatched rows before the work if relevant; do not modify its fingerprinted checker or baseline to make this refactor pass. No real Tauri or cloud acceptance is implied by local tests.
5. Do not modify `.ai`, push, install, or commit in this delegated task.
