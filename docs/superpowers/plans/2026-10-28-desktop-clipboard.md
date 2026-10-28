# Desktop Clipboard Implementation Plan

**Goal:** Move the existing text-copying capability to the desktop platform while preserving both runtime paths, completion and error behavior.

**Architecture:** `platform/desktop/clipboard.ts` uses the existing runtime detection, native clipboard plugin in Tauri, and `navigator.clipboard` in a browser. The existing `lib/desktop.ts` named async export delegates through an actual import. No callers or capability permissions change.

**Tech Stack:** TypeScript, Node assert, installed TypeScript compiler; fake clipboard and plugin only.

## Files and execution

- Create `scripts/test_desktop_clipboard.mjs`: execute the complete real desktop module and real relative imports, replace only the native clipboard plugin, browser globals, Vite env and unrelated toast. Never read or write system clipboard or print test input. Cover native/browser/no-window, unchanged input identity via boolean assertion, awaited completion, void return, missing browser clipboard, plugin-load failures, Error/string rejections, and actual compatibility delegation.
- Run `node --no-experimental-strip-types scripts/test_desktop_clipboard.mjs` against the old source. Old behavior should pass; missing platform module and delegation must fail. Record results.
- Create `apps/desktop/src/platform/desktop/clipboard.ts` with the original `copyText` body and import `isTauriRuntime` from `./runtime`.
- Modify `apps/desktop/src/lib/desktop.ts`: import the platform module, keep the named async function and delegate its argument, preserving `Promise<void>` and error propagation.
- Run the focused test, existing unit runner, desktop build, contracts, user-flow and `git diff --check`; inspect final diff. The parent registers this suite later and reviews independently.
- Do not modify test_unit, `.ai`, capabilities, pages, actual clipboard, cloud services, Git history or install dependencies. Offline substitutes do not demonstrate native Tauri/WebView clipboard permissions.

## Integration evidence

- Parent registered the suite in the unit runner. Focused test: 31/0; independent review passed, build and command contracts 97/97/97 passed.
- No native clipboard was touched. Parallel Gallery tests were still at their expected red stage; the full unit runner is deferred until that slice is complete.
