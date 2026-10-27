# Assets Command API Compatibility Implementation Plan

> **For agentic workers:** Execute this approved delegated slice inline with test-driven-development. Do not create branches, edit `.ai`, install, commit, push, or execute actual cloud commands.

**Goal:** Move the existing `repairAsset` and `deleteAsset` IPC functions into the assets domain while preserving all caller behavior.

**Architecture:** The assets module uses the existing desktop runtime. Named async compatibility wrappers in `lib/desktop.ts` delegate without interpreting IDs, returned task IDs, or errors. AssetsPage stays byte-for-byte unchanged; its confirmation, mutation callbacks, cache invalidations and timers remain its responsibility.

**Tech Stack:** Existing TypeScript compiler, Node assert and the complete-module offline asset test; no new dependencies.

## Starting facts

- Local main: `218c04c3d8f668b8a7ffa3bde53e850f27fe4d8c`; initial worktree clean.
- `git ls-remote origin refs/heads/main` reports `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- `repairAsset(assetId)` currently invokes `repair_asset` with `{ assetId }` and returns a task ID string.
- `deleteAsset(assetId)` currently invokes `delete_asset` with `{ assetId }` and returns a task ID string.
- Neither operation has a browser fallback: both attempt the same invoke in native and browser contexts. Preserve rejections rather than inventing a success or an empty result.
- AssetsPage confirms deletion before calling its mutation. Success refreshes task state immediately and rechecks assets/tasks after 700 ms for delete or 1000 ms for repair. Do not move or change this code.

## File scope

- Modify `scripts/test_asset_api.mjs`: extend existing full-module tests before production changes; the native module substitute must accept only the three enumerated asset command strings, return synthetic task IDs, and never import the real Tauri core.
- Modify `apps/desktop/src/features/assets/api.ts`: add the two actual command functions below.
- Modify `apps/desktop/src/lib/desktop.ts`: replace only the two original bodies with compatibility delegation.
- Create this plan. The suite is already registered in `scripts/test_unit.mjs`; do not edit that file or any page.

## Steps

- [ ] Extend the test's fake core with a command allowlist and synthetic repair/delete task IDs. Preserve all existing list assertions.
- [ ] For each operation, assert named async compatibility export, actual domain export and delegation through the real imported module. Test native, browser and no-window execution: exact command and `{ assetId }`, unchanged returned task ID, Error and string rejections, and native-module loading failure. Missing domain functions must fail with explicit assertions.
- [ ] Run `node --no-experimental-strip-types scripts/test_asset_api.mjs` before implementation. Record the real failing count and confirm original compatibility behavior still passes.
- [ ] Reread remote HEAD and target sources, then add these functions to the existing assets domain:

```ts
export async function repairAsset(assetId: string): Promise<string> {
  return invoke('repair_asset', { assetId })
}

export async function deleteAsset(assetId: string): Promise<string> {
  return invoke('delete_asset', { assetId })
}
```

- [ ] Replace the two compatibility bodies, preserving signatures:

```ts
export async function repairAsset(assetId: string): Promise<string> {
  return assetApi.repairAsset(assetId)
}

export async function deleteAsset(assetId: string): Promise<string> {
  return assetApi.deleteAsset(assetId)
}
```

- [ ] Rerun the focused test, existing unit entry, desktop build, contracts, user-flow and `git diff --check`. Compare AssetsPage with HEAD to confirm its complete source is unchanged.
- [ ] Inspect all final changes and report observed counts, warnings and limitations. Leave changes uncommitted. Fake IPC tests do not validate native execution, permission decisions, storage rollback, actual repair/delete, or cloud safety; no such operations are authorized here. The existing theme inventory drift remains outside this slice.
