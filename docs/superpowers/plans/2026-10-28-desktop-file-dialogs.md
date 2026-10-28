# Desktop File Dialogs Implementation Plan

**Goal:** Move file selection and save-path selection to the desktop platform without changing their public behavior.

**Architecture:** `platform/desktop/dialogs.ts` depends on the existing runtime and Tauri dialog plugin. `lib/desktop.ts` retains both named async functions as compatibility wrappers. Consumers and Tauri capabilities do not change.

**Tech Stack:** TypeScript, Node assert, existing TypeScript compiler, existing offline test runner.

## Files and contracts

- Create `platform/desktop/dialogs.ts`: `chooseImageFiles()` and `chooseDownloadPath(suggestedName)`.
- Modify `lib/desktop.ts` to call those functions via a real import, preserving named exports.
- Create `scripts/test_desktop_dialogs.mjs` and register it in `scripts/test_unit.mjs`.
- Browser/no-window: image chooser returns a new empty array and save chooser returns null without importing native dialog plugin.
- Native: open uses `{ multiple: true, directory: false, filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp','gif','bmp'] }] }`; null becomes [], strings become a one-item array and arrays are passed through. Save receives `{ defaultPath: suggestedName }` and returns path/null. Plugin errors and module load errors propagate unchanged.

## Steps

- [x] Load complete actual desktop and relative dependencies using TypeScript transpilation, replacing only plugin-dialog, window/Vite environment, and irrelevant toast. Assert named exports and real platform-module delegation.
- [x] Run `node --no-experimental-strip-types scripts/test_desktop_dialogs.mjs` before implementation: original behavior passes, missing platform module/delegation fails for the intended reason. Baseline 18 checks, 3 expected failures.
- [x] Add `platform/desktop/dialogs.ts` with the original functions, import existing `isTauriRuntime`, and replace old function bodies with named wrappers delegating to the real module. Do not edit consumer components or capability permissions.
- [x] Register the new test in `scripts/test_unit.mjs`. Focused test 31/0; unit runner 13 suites/0 failures; desktop build, contracts 97/97/97, user-flow 639/0, and `git diff --check` pass in the working tree. Existing Vite chunk-size and dynamic-import warnings remain.
- [ ] Report actual results and warnings to the parent for independent review. No real native dialogs, installation, .ai edits, commit, push or cloud operations.
