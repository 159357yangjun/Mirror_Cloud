# Task Domain API Implementation Plan

**Goal:** Separate the three task operations while preserving the existing public API, browser behavior, IPC arguments and errors.

**Architecture:** The new `features/tasks/api.ts` owns task commands and depends on the existing desktop runtime. `lib/desktop.ts` keeps named compatibility wrappers; callers and query keys do not change.

**Tech stack:** TypeScript, the existing Node/TypeScript test harness, Python contract guards. No new dependencies.

## Files and test boundary

- Create `apps/desktop/src/features/tasks/api.ts` for the actual three task operations.
- Modify `apps/desktop/src/lib/desktop.ts` only to delegate the existing named exports.
- Create `scripts/test_task_api.mjs` to evaluate the actual TypeScript functions and runtime with only IPC and browser globals substituted.
- Do not change pages, `.ai`, the shared test runner, or Git state in this delegated slice.

## Steps

1. First create the test and run `node scripts/test_task_api.mjs`: the original compatibility functions must pass the original browser fallback, native IPC and rejection assertions, while the missing domain module assertion fails. The domain and compatibility entry points will both run these assertions once the new module exists.
2. Create the domain implementation using the existing runtime. Preserve the exact command names and payloads, browser empty array only for list, and original return/error propagation:

   ```ts
   import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
   import type { TaskView } from '../../types'

   export async function listTasks(limit = 100): Promise<TaskView[]> {
     if (!isTauriRuntime()) return []
     return invoke('list_tasks', { limit })
   }

   export async function cancelTask(taskId: string): Promise<void> {
     return invoke('cancel_task', { taskId })
   }

   export async function retryTask(taskId: string): Promise<string> {
     return invoke('retry_task', { taskId })
   }
   ```

3. Import `* as taskApi` in `lib/desktop.ts` and replace the three bodies with `return taskApi.listTasks(limit)`, `return taskApi.cancelTask(taskId)` and `return taskApi.retryTask(taskId)`. Preserve original signatures and default.
4. Run `node scripts/test_task_api.mjs`, `npm run build` in `apps/desktop`, `python scripts/check_contracts.py`, `python scripts/check_user_flow.py`, and `git diff --check`. Review the changes, report results and leave the runner registration and commit to the parent. These tests simulate IPC and do not claim native Tauri integration or remote service coverage.
