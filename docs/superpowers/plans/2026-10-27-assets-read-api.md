# Assets Read API Implementation Plan

> **For agentic workers:** Execute this approved delegated slice inline, using writing-plans and test-driven-development. Do not create a branch, install dependencies, edit `.ai`, commit, push, or access cloud storage.

**Goal:** Extract only the read-only `listAssets` operation while preserving its public entry, default limit, browser fallback, results and failures.

**Architecture:** `features/assets/api.ts` depends on the existing desktop runtime and `AssetView`. `lib/desktop.ts` retains a named async compatibility function and delegates to the domain module. AssetsPage and PublishPage retain their imports, query keys, request limits, polling and UI.

**Tech Stack:** Existing TypeScript compiler, Node assert, current desktop runtime and offline IPC substitutes; no new dependency.

## Source facts and fixed scope

- Local main starts at `fa817d97233fb48277ae9291df94eae2001a82d1`; the initial working tree is clean.
- Remote main was read with `git ls-remote origin refs/heads/main`: `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- AssetsPage calls `listAssets(assetLimit)` with initial 200, increments of 200 up to 10000, query key `['assets', assetLimit]` and 2500 ms polling.
- PublishPage calls `listAssets(6)` with query key `['assets', 'publish-recent']` and no configured polling.
- Do not move repair/delete, private previews, signing, portable assets, plugin commands, or any query keys.

## Files

- Create `apps/desktop/src/features/assets/api.ts`: actual list operation.
- Modify `apps/desktop/src/lib/desktop.ts`: add the assets import and retain its named compatibility entry.
- Create `scripts/test_asset_api.mjs`: compile full product modules, following their actual relative imports; substitute Tauri core, window and Vite environment. The unrelated toast boundary must fail if called.
- Modify `scripts/test_unit.mjs`: register the offline asset API suite.
- Create this plan; no other file is in scope.

## Execution

- [x] Create the executable test first. Load the complete real desktop module and runtime with the installed TypeScript compiler; do not inject an `assetApi` variable into an extracted wrapper. Record calls at the native core boundary.
- [x] Check the named compatibility function, the domain module and actual compatibility delegation. Exercise both entries once the domain exists: browser/no-window empty arrays with zero native module loads; omitted/undefined/6/200/0/10000 limits; same result object; unchanged Error and string rejections; native module-load failure.
- [x] Run `node --no-experimental-strip-types scripts/test_asset_api.mjs` before implementation. Existing list behavior must pass; the missing domain and compatibility-delegation assertions must fail. Record the observed counts rather than claiming a green baseline.
- [x] After rereading remote HEAD and target files, create the domain implementation:

```ts
import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { AssetView } from '../../types'

export async function listAssets(limit = 200): Promise<AssetView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_assets', { limit })
}
```

- [x] Add `import * as assetApi from '../features/assets/api'` to desktop.ts and change only its existing function body:

```ts
export async function listAssets(limit = 200): Promise<AssetView[]> {
  return assetApi.listAssets(limit)
}
```

- [x] Register `'test_asset_api.mjs'` in the existing suites array. Run the focused test again; both actual entry points must pass with no swallowed errors.
- [x] Run `node scripts/test_unit.mjs`, `npm run build` in `apps/desktop`, `python scripts/check_contracts.py`, `python scripts/check_user_flow.py` and `git diff --check`. Inspect the entire final diff and the three new files.
- [x] Report actual outcomes and existing build warnings. Tests simulate IPC and do not prove native Tauri or cloud integration. The pre-existing theme inventory has 11 mismatched rows and is neither changed nor re-signed. Leave all changes uncommitted for the parent review.

## Observed evidence

- Before implementation: `ASSET_API_GATE checks=14 failed=2`, process exit 1; only the missing domain and compatibility-delegation assertions failed, while the original list behavior passed.
- After implementation: `ASSET_API_GATE checks=25 failed=0`, including complete-module import/delegation checks and both entry points.
- Unified runner: `UNIT_SUITES total=11 failed=0`.
- `npm run build`: TypeScript and Vite succeeded; existing warnings remain for a chunk over 500 kB and ineffective dynamic imports of Tauri core/event modules.
- Command contracts: frontend invokes/Rust commands/registrations `97/97/97`; user-flow `639/0`; `git diff --check` passed.
- These results describe the uncommitted worktree based on `fa817d97233fb48277ae9291df94eae2001a82d1`, not a new commit or remote CI result. No native Tauri, real storage, installer, or migration operation was exercised.
