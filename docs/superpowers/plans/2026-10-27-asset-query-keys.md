# Asset Query Keys Implementation Plan

> **For agentic workers:** Execute this authorized delegated slice inline with test-driven-development. Do not edit `.ai`, commit, push, install dependencies, change fixed guards, or run cloud operations.

**Goal:** Centralize the 13 existing asset cache keys without changing values, parameters, matching, refresh order or caller behavior.

**Architecture:** `features/assets/queryKeys.ts` owns the root, limit and recent keys. The seven consumers retain their original `useQuery` and invalidation calls. In particular, Gallery and StorageBrowser keep both explicit root/recent invalidations in their original order even though root invalidation already includes the recent prefix.

**Tech Stack:** Existing TypeScript compiler, Node assertions and real TanStack Query client, with offline execution of actual source expressions; no new dependency.

## Starting facts

- Local main is `d734139fb6ac17df023024d4495a10d95df26f16`, with a clean worktree.
- `git ls-remote origin refs/heads/main` reports `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- Seven files have 13 sites: AssetsPage 3, PublishPage 1, TasksPage 1, UploadDialog 1, GalleryPage 4, StorageBrowserDialog 2 and CloudIndexSyncBanner 1.
- Query values remain `['assets', assetLimit]` and `['assets', 'publish-recent']`. All other asset invalidations retain the original root/recent choice.
- Gallery has two `Promise.all` groups and StorageBrowser one; each still evaluates refetch, root invalidation, then explicit recent invalidation. Do not remove the overlapping recent call.
- AssetsPage retains 2500 ms polling and 700/1000 ms delayed refreshes; PublishPage retains `listAssets(6)` without polling. Tasks/Upload subscriptions retain their callbacks and task-key behavior.

## Files

- Create `apps/desktop/src/features/assets/queryKeys.ts`.
- Modify only equivalent asset-key expressions and imports in `pages/AssetsPage.tsx`, `pages/PublishPage.tsx`, `pages/TasksPage.tsx`, `pages/GalleryPage.tsx`, `components/UploadDialog.tsx`, `components/StorageBrowserDialog.tsx`, `components/CloudIndexSyncBanner.tsx` under `apps/desktop/src`.
- Create `scripts/test_asset_query_keys.mjs`; register it in `scripts/test_unit.mjs`.
- Add the real asset-key module to `scripts/test_task_query_keys.mjs` event dependencies and `scripts/test_cloud_browser_utils.mjs` component dependencies. Keep all existing assertions and cases.
- Create this plan. No fixed guard, baseline, `.ai`, API or Rust file changes.

## Execution

- [x] Write the test first: enumerate all 13 actual AST sites and their original options; require the shared module and genuine imports. Test both list limits and recent/root values.
- [x] Execute every source invalidation call with a real QueryClient. Root must invalidate root, both limits, recent and recent children; recent must leave root/lists untouched while invalidating its own prefix. Tasks and unrelated data must remain unchanged.
- [x] Execute the three actual `Promise.all` expressions with a harmless refetch stub and real QueryClient. Require the original refetch/root/recent order and both explicit calls; do not execute any surrounding delete/move/sync function.
- [x] Run `node --no-experimental-strip-types scripts/test_asset_query_keys.mjs` on old sources. Original behavior checks must pass, while missing shared-module/import assertions fail. Record actual counts.
- [x] After rereading remote HEAD and the targets, create:

```ts
export const assetQueryKeys = {
  root: ['assets'] as const,
  list: (limit: number) => ['assets', limit] as const,
  publishRecent: ['assets', 'publish-recent'] as const,
}
```

- [x] In the seven consumers add `import { assetQueryKeys } from '../features/assets/queryKeys'` and substitute root/list/recent expressions at the same sites. Register `'test_asset_query_keys.mjs'` in the existing runner. Keep the Gallery task literals and every fixed guard intact.
- [x] Rerun the new suite and existing event/cloud-browser suites, then the complete offline unit entry, desktop build, contracts, user-flow and `git diff --check`.
- [x] Reverse only the added imports/key substitutions in memory and compare all seven consumers with HEAD. Each must be identical, proving that confirmation, mutation callbacks, timers and order were preserved. Report evidence and limitations without committing; existing theme inventory drift remains outside this slice.

## Observed evidence

- Before implementation: `ASSET_KEYS_GATE checks=31 failed=2`, exit 1. Only the shared-module and actual-import checks failed; every original cache effect and all three refresh groups passed.
- After implementation: `ASSET_KEYS_GATE checks=31 failed=0`. Existing task-key tests remain `38/0` and cloud-browser tests remain `61/0`, with all old assertions retained.
- Unified offline runner: `UNIT_SUITES total=12 failed=0`.
- TypeScript/Vite build succeeded; existing warnings remain for a chunk over 500 kB and ineffective Tauri core/event dynamic imports.
- Command contracts `97/97/97`, user-flow `639/0`, and `git diff --check` passed.
- All seven consumers are identical to their HEAD sources after reversing only the new imports/key expressions in memory.
- Theme selftest `7/0`; theme inventory remains `mismatch=11`, exit 1. This existing failure was not fixed, skipped, or re-signed.
- These results describe the uncommitted worktree based on `d734139fb6ac17df023024d4495a10d95df26f16`, not a new commit or remote CI. Tests execute actual refresh expressions with an in-memory QueryClient and do not prove native/webview behavior, real query transport, cloud writes or deletion.
