# Gallery Task Query Keys Implementation Plan

> Execute this authorized delegated slice inline with test-driven-development. Do not stage, commit, edit `.ai`, install dependencies or run actual cloud operations.

**Goal:** Replace Gallery's three remaining task-root literals with the existing `taskQueryKeys.root`, preserving batch submission, success/failure, cache scope and promise behavior.

**Architecture:** Gallery imports the existing task-key module. Its batch move, rename and delete functions retain their original queue API calls and `void` task invalidations. The user-flow assertion keeps all three queue API predicates and verifies the real shared import, exported root and three actual invalidation statements. Guard controls run in memory inside the existing Python checker; unit tests remain Node-only.

**Tech Stack:** Existing TypeScript AST/transpiler, Node assertions, real TanStack QueryClient and existing Python user-flow checker; no added dependency.

## Starting facts and files

- Local main is `9ac94065b876a72db37e1370c8d171ab904ffe12`, initially clean. Remote main read with `git ls-remote`: `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- Three sites are inside batch move/rename branches of `submitPathDialog` and `batchDeleteSelected`. Each uses `void queryClient.invalidateQueries({ queryKey: ['tasks'] })` after successful queueing. Failed queueing performs no invalidation. Move/rename then await the existing asset refresh Promise.all; delete does not refresh assets.
- Modify only `apps/desktop/src/pages/GalleryPage.tsx`, `scripts/test_task_query_keys.mjs`, `scripts/test_cloud_browser_utils.mjs`, `scripts/check_user_flow.py`, its fingerprint cells in `CHANGELOG.md`, and this plan. Keep all existing assertions, including three queue API predicates; do not modify shared key values or `.ai`.

## Execution

- [ ] Remove the Gallery-only literal exception in the existing task-key test. Retain the complete 18-site census, options and cache assertions. Add real AST batch-function execution with real task/asset keys and QueryClient, using only harmless queue/confirmation/refetch boundaries.
- [ ] Verify pending queueing, successful queueing and failed queueing for all three operations: exact arguments, success notification, selected paths, preview/dialog state, cache invalidation count/scope/order and original error copy. Keep task invalidation unawaited; move/rename still await the asset refresh and delete does not add a refresh. Confirmed cancellation does nothing.
- [ ] Run the old Gallery sources against the expanded tests and record expected red for missing shared import/use while original behavior remains green.
- [ ] Reread targets and remote; add `import { taskQueryKeys } from '../features/tasks/queryKeys'` and replace only three task-key expressions. Add the real dependency to CloudBrowser's full-component fixture.
- [ ] Replace only the old literal-key predicate with a source-aware connection helper; retain all queue API predicates. Strip comments/template prose before recognizing the real import and invalidation statements; validate the exported root from the actual key module. Add positive and missing/wrong import, wrong root, missing call and comment/string-decoy negative controls without writing source files.
- [ ] Run task keys, CloudBrowser, asset keys, unified unit tests, desktop build, contracts, shape, theme verify and diff checks. Reverse the import/key substitutions in memory and require Gallery to equal the starting source.
- [ ] Update only the changed user-flow script fingerprint using the existing generator; preserve HEAD and worktree comparisons. Record pre-commit HEAD failure honestly. Finish plan evidence and stop every edit before notifying parent to stage/commit and verify afterward.

## Evidence and limits

Results will describe the uncommitted source tree. Simulated queue calls cannot prove native IPC, real batch execution, real cloud mutation or visual behavior. Existing theme inventory drift remains a failure and no baseline or threshold will be changed.

## Observed integration evidence

- Parent resumed the slice after only the shared-consumer assertion had been edited. Extended actual batch-callback tests ran against the old Gallery: 45 checks, one expected shared-key wiring failure; all seven new behavior cases passed.
- The new source-aware guard's negative controls passed while the old Gallery connection failed. After migration, task keys 45/0 and CloudBrowser 61/0.
- Unit runner 15 suites passed; TypeScript/Vite build and IPC contracts 97/97/97 passed, retaining existing build warnings.
- The fingerprint generator changed only the user-flow row. Pre-commit user-flow 640/1 is solely the expected HEAD fingerprint difference; post-commit validation remains required.
