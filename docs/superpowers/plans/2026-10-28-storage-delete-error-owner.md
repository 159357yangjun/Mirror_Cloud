# Storage Delete Error Ownership Implementation Plan

> Execute this approved delegated slice inline using writing-plans, systematic-debugging and test-driven-development. Do not commit, edit `.ai` or the unit runner, install dependencies, or execute real storage operations.

**Goal:** A failed storage-connection deletion reports the existing failure message once.

**Architecture:** Keep the global MutationCache policy unchanged. The deletion mutation owns its error handler in `useMutation`; the confirmed action only calls that mutation. Confirmation and successful cache invalidations remain in their current locations.

**Tech Stack:** TypeScript, the installed TypeScript compiler, Node assert and actual TanStack QueryClient/MutationObserver. Native storage deletion is replaced with a synthetic local function.

## Starting facts and cause

- Local main is `5f7dddb4bd583a3cfabcf5b1ec69561b19a18018`; remote main is `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- Parallel file-dialog changes are outside this slice and must be preserved.
- The global mutation handler suppresses its toast only when `mutation.options.onError` exists. The delete action currently supplies an observer-level callback to `mutate`, which does not populate `mutation.options.onError`.
- Executing the real global callback, mutation options and action with a real MutationObserver and a synthetic rejection produced two identical `操作失败：Error: synthetic failure` messages.

## Files

- Create `scripts/test_storage_delete_errors.mjs`: compile the real global callback, deletion mutation options and confirmed action; execute them through actual TanStack mutation/cache classes. Substitute only deletion, confirmation and toast collection.
- Modify `apps/desktop/src/pages/StoragesPage.tsx`: move the existing deletion error callback into the mutation options and remove the per-call callback.
- Create this plan. Do not edit `main.tsx`, the global policy, `.ai` or `scripts/test_unit.mjs`.

## Steps

- [x] Write the executable regression first. Assert cancellation performs no deletion; successful confirmation passes the unchanged ID and invalidates `storages`, `storage-groups`, `workflows` in order; Error and string rejections each produce one unchanged message with no success invalidations; an observer removed before rejection still reports once; an unrelated unowned failure still reaches the global fallback.
- [x] Run `node scripts/test_storage_delete_errors.mjs` and observe duplicate-toast assertion failures from the actual deletion action. Record the counts.
- [x] Reread remote main and `StoragesPage.tsx`, then add the existing callback to the deletion mutation:

```ts
onError: (error) => notifyError(`操作失败：${String(error)}`),
```

The confirmed action becomes:

```ts
removeStorageMutation.mutate(id)
```

- [x] Rerun the regression and existing workflow-key check; run the frontend build, command-contract guard, user-flow guard and `git diff --check`.
- [x] Inspect the complete diff, record evidence and leave the three files uncommitted for parent integration and independent review. This local mutation/cache test does not prove native deletion or cloud behavior.

## Observed evidence

- Before the production change: `STORAGE_DELETE_ERRORS_GATE checks=6 failed=2`, exit 1. Error and string rejections each yielded two identical messages; cancellation, success, removed-observer reporting and the unowned global fallback already passed.
- After moving only the error callback: `STORAGE_DELETE_ERRORS_GATE checks=6 failed=0`. The removed-observer case uses a blocked synthetic deletion and releases the rejection only after unsubscribing.
- Workflow query-key tests remain `22/0`; command contracts remain `97/97/97`; user-flow remains `639/0`; `git diff --check` passed.
- TypeScript/Vite build passed, with the existing chunk-over-500-kB and ineffective dynamic-import warnings.
- These checks cover the current uncommitted worktree based on `5f7dddb4bd583a3cfabcf5b1ec69561b19a18018`, including the separate concurrent file-dialog changes. They do not prove native Tauri deletion, real cloud behavior or remote CI.
- No further file writes are pending from this delegated slice.
