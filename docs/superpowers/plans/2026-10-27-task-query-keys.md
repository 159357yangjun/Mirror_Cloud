# Task Query Key Implementation Plan

**Goal:** Centralize task keys outside the three Gallery invalidations while preserving all existing key arrays, event updates, invalidation timing, query arguments and polling.

**Architecture:** `features/tasks/queryKeys.ts` exports a root key `['tasks']`, `list(limit)` returning `['tasks', limit]`, and `publishRecent` equal to `['tasks', 'publish-recent']`. TasksPage, PublishPage, UploadDialog and AssetsPage use these at existing call sites. Gallery retains its three real root-key literals because the fingerprinted `check_user_flow.py` explicitly verifies their current spelling; this is an incomplete migration, not a claim that every task key is centralized.

**Tech stack:** TypeScript, TanStack Query, existing Node and TypeScript compiler; no new dependency.

## Scope and fixed behavior

- `TasksPage.tsx`: `['tasks', taskLimit]` for the query and event patch, root for cancel/retry/terminal invalidations; retain 1500 ms polling and taskLimit dependency.
- `PublishPage.tsx`: `['tasks', 'publish-recent']`, `listTasks(6)`, 1500 ms polling.
- `UploadDialog.tsx`: root `['tasks']` for query, event patch and invalidations; retain the calculated list limit, enabled condition, polling, task-id filtering, and event behavior.
- `AssetsPage.tsx`: four root invalidations remain at their original immediate and 700/1000 ms delayed sites.
- `GalleryPage.tsx`: its three actual root-key invalidations remain unchanged and remain covered by `check_user_flow.py`; test their equivalence and actual prefix invalidation.
- Add `scripts/test_task_query_keys.mjs` to `scripts/test_unit.mjs`.

## Steps and verification

1. Test before implementation: scan actual source query/invalidation/patch sites, confirm the original key arrays, options and counts, execute both actual `task://updated` effect callbacks with an actual QueryClient, and test root prefix invalidation; shared-module and migration assertions should fail because no task key module exists.
2. Introduce only the key module and substitute the corresponding keys in the four specified consumers. Leave Gallery, query/mutation logic and event subscriptions untouched.
3. Re-run the new test, `npm run test:unit`, `npm run build`, `python scripts/check_contracts.py`, `python scripts/check_user_flow.py`, and `git diff --check`. Reverse the imports/key substitutions and compare all four consumers with HEAD to establish that no other source or ordering changed.
4. Keep the current theme inventory's already-recorded 11 mismatches distinct from this change; do not alter fingerprinted guards or the historical baseline. Local QueryClient tests do not imply native Tauri or cloud validation.
5. Do not commit, push, install, or update `.ai` in this delegated task.
