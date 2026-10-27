# Settings Diagnostics Panel Implementation Plan

**Goal:** Separate the system diagnostics presentation from the Settings page's query logic without changing its visible behavior or reducing existing guard coverage.

**Architecture:** Keep a pure `SystemDiagnosticsPanel` in `SettingsPage.tsx` for now: the page still owns the `useQuery` and passes its data, error, fetching state, and refetch callback. Keeping the actual JSX in the same source file preserves the existing diagnostic user-flow assertion and per-file theme inventory coverage, without modifying fingerprinted scripts or re-signing a baseline.

**Tech stack:** React, TypeScript, TanStack Query, existing React server renderer and TypeScript compiler; no new dependencies.

## File scope

- Modify `apps/desktop/src/pages/SettingsPage.tsx`: move the existing diagnostics section unchanged into a pure component in the same file; retain `['system-diagnostics']`, `getSystemDiagnostics`, refetch options, all labels, styles, error priority, statuses, counts, warnings, and refresh behavior.
- Create `scripts/test_settings_diagnostics.mjs`: render the actual inline section before extraction and, afterwards, the actual panel through the page's JSX call using React's installed server renderer; exercise the actual refresh button callback and diagnostic states.
- Add the test to the offline unit runner after the concurrent workflow slice is committed.

## Steps and verification

1. Run the test before implementation: the inline baseline must render pending, healthy, attention, error, and warning states and forward refresh; the explicit missing component/wiring checks must fail.
2. Extract exactly the existing JSX into `SystemDiagnosticsPanel`, typed with `SystemDiagnosticsView | undefined`, `unknown` error, fetching boolean, and a refresh function. Render it from the existing location using the original query values. Keep the JSX and its Tailwind classes in the same Settings source file.
3. Rerun the test and existing `test:unit`, frontend build, `python scripts/check_user_flow.py`, and `git diff --check`. Run `node scripts/theme_face_inventory.mjs --verify` and compare the Settings row and mismatch output against the untouched baseline; this inventory already reports 11 mismatched rows before this work, so it must not be reported as passed or silently re-signed.
4. Confirm the `SettingsPage.tsx` diagnostic labels and `diagnostics.warnings` remain real executable panel code, not placeholders. Inspect all changes; report the tested worktree and existing inventory failure. The React server-render test is not a real WebView or native Tauri check.
5. Do not edit `.ai`, push, install dependencies, alter the fingerprinted guards or baseline, or commit in this delegated task.
