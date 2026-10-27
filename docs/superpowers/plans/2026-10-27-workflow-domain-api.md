# Workflow Domain API Implementation Plan

**Goal:** Move the six workflow/recipe operations into a domain module without changing the existing desktop API, browser fallback, IPC contracts, or cache behavior.

**Architecture:** `platform/desktop/runtime.ts` owns the existing runtime detection and dynamic Tauri invocation; `features/workflows/api.ts` owns the workflow operations. `lib/desktop.ts` retains named thin wrappers for compatibility and for the browser project's existing export identity check. Workflow screens may import the domain API directly; other consumers keep the compatibility entry point.

**Tech stack:** TypeScript, React, TanStack Query, existing Node and TypeScript compiler, Python contract guards. No new dependency or framework.

## Files and scope

- Create `apps/desktop/src/platform/desktop/runtime.ts`: unchanged Tauri detection and asynchronous invoke.
- Create `apps/desktop/src/features/workflows/api.ts`: `listRecipes`, `listWorkflows`, `createWorkflowFromRecipe`, `createCustomWorkflow`, `setDefaultWorkflow`, `deleteWorkflow`.
- Modify `apps/desktop/src/lib/desktop.ts`: import runtime, retain `isTauriRuntime` and the six workflow named wrappers; keep all other APIs intact.
- Modify `apps/desktop/src/pages/WorkflowsPage.tsx` and `apps/desktop/src/components/WorkflowSetupDialog.tsx` to use the domain API. Keep `['recipes']` and `['workflows']` keys and all invalidation timing unchanged; other consumers remain compatible.
- Create `scripts/test_workflow_api.mjs`; register it in `scripts/test_unit.mjs`.

## Steps and acceptance

1. Run `node scripts/test_workflow_api.mjs` before implementation. The six original APIs must pass browser fallback and IPC contract tests; the missing domain/runtime module checks must fail. Recorded baseline: 10 checks, 2 expected failures.
2. Move the existing `isTauriRuntime` and generic dynamic `invoke` implementation into the platform module, preserving the public named wrapper in `desktop.ts`.
3. Copy the six original implementations into the domain API with unchanged command strings, payloads, return types, exceptions, and mock recipe reference. Replace the six old bodies with named thin wrappers calling the domain functions; do not use a re-export invisible to the current identity check.
4. Point the workflow page and setup dialog at the domain API, preserving query keys, mutation success and dialog behavior. Add the new test to the offline unit runner.
5. Run `node scripts/test_workflow_api.mjs`, `npm run test:unit`, `npm run build`, `python scripts/check_contracts.py`, `python scripts/check_user_flow.py`, and `git diff --check`. Inspect every final diff, including tests and exports. The Node test executes real TypeScript and substitutes native IPC; it is not native Tauri or real cloud acceptance.
6. Do not push, install dependencies, change `.ai` records, or commit in this delegated task; hand over the result and evidence for integration review.
