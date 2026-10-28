# Settings Diagnostics File Extraction Plan

> Execute this authorized slice inline with test-driven-development. Do not stage, commit, edit `.ai` or `scripts/test_unit.mjs`, install dependencies, change visual baselines or run cloud operations.

**Goal:** Move the existing pure `SystemDiagnosticsPanel` into `features/settings/SystemDiagnosticsPanel.tsx` without changing its JSX, props, query ownership, refresh callback or error presentation.

**Architecture:** SettingsPage retains its diagnostics query and the exact panel call. The panel owns only presentation. The existing Settings theme face measures both source files once, retaining the same label, primary path, 22-face census and five counters. The existing user-flow assertion retains its three predicates and label, reading the API from the page and the presentation predicates from the real panel.

## Starting evidence and scope

- Local main: `5f7dddb4bd583a3cfabcf5b1ec69561b19a18018`; remote main read with `git ls-remote`: `5c79c42a04bfde72020329679bbb5dd4f961dbbd`.
- Existing parallel desktop-dialog/storage-error files and unit-runner edits belong to other agents and will not be edited here.
- Existing diagnostics tests: 9 checks, 0 failures. User-flow: 639/0. Shape: 81/0.
- Existing theme selftest: 7/0; inventory: 22 faces plus total, `faces=23 docLines=25 mismatch=11`, exit 1. Settings counters are `329/50/10/0/0`. This failure must remain visible and identical.
- Files: SettingsPage, new SystemDiagnosticsPanel, existing diagnostics test, check_user_flow, theme_face_inventory, this plan, and only the two changed measurement-file fingerprint cells in CHANGELOG.

## Execution

- [x] Extend existing diagnostics tests before implementation: genuine named module import and real module execution; retain all nine behavior checks; compare theme rows and documented differences; prove a changed/missing panel is detected without writing source files.
- [x] Observe expected red while original presentation behavior remains green.
- [x] Recheck remote and targets, move only the existing interface/function, import the panel and remove the now-unused page type import. Keep query, icons used elsewhere, JSX and callbacks unchanged.
- [x] Migrate the existing user-flow presentation source and extend the Settings face's input sources. Preserve all counting expressions, comparison/selftests, failure codes and HEAD/working-copy fingerprint checks.
- [x] Run diagnostics tests, build, contracts, shape, theme verification and diff checks. Compare extracted JSX and remaining page against pre-split source in memory.
- [x] Update only the two changed script fingerprints with the existing generator. Record the expected two pre-commit HEAD-blob failures separately from all other user-flow checks; parent commits and verifies HEAD afterward.
- [x] Finish evidence and stop all edits before notifying parent to stage.

## Evidence

- Initial test-first result: `SETTINGS_DIAGNOSTICS_GATE checks=16 failed=5`, exit 1. The nine original behavior checks remained green; missing independent module/import, changed/missing-panel census controls and the old presentation-source predicate were the expected failures. An initial Python text-stdin encoding fault in the fixture was corrected before recording that red result.
- Final result: diagnostics `16/0`; unified offline unit runner `UNIT_SUITES total=14 failed=0`. The unchanged runner includes other agents' completed suites; this slice did not edit that file.
- After review, the daily tests were revised to recompose the current actual page and panel declarations into one in-memory page, then use a single-source Settings face. They compare every current measured row, generated table and documented difference; they do not pin a historical Git object, face count, style count or mismatch count. The guard's actual restricted membership expression is evaluated in Node with positive and three negative controls; no Python or Git subprocess dependency was added to the unit test.
- Changed-panel control adds a literal color to an actual JSX className and must increase the actual Settings literal count by one. Missing-panel control must throw. Neither writes any source file or changes a baseline.
- One-time historical comparison against the starting SHA: extracted interface/function are verbatim after removing only `export`; the rest of SettingsPage is verbatim after reversing only the added panel import and removed type import. All 22 faces and all five counters were identical before/after migration; Settings remains `329/50/10/0/0`.
- Actual theme verification still reports selftest `7/0`, `faces=23 docLines=25 mismatch=11`, exit 1, with the same document/code differences. This is a retained failure, not a PASS. No visual baseline, threshold or shape snapshot was rewritten.
- TypeScript/Vite build succeeded with existing warnings for the >500 kB bundle and ineffective Tauri core/event dynamic imports. Command contracts: `97/97/97`. Shape: `81/0`. `git diff --check` passed.
- `fingerprint_rows.mjs --patch` changed exactly two rows, leaving the other 19 intact: check_user_flow `2528L/185066B/3d6c99a8dfd42eba54dab5c1a5744f488c471f988f3d68e7cb1290f1d4445225`; theme_face_inventory `204L/12597B/69458469ded0b12568c236be14594753cc964faa2b30e11810c621e5312ecc69`. Only line/byte/hash cells changed; historical prose was retained.
- Pre-commit user-flow result: `USERFLOW_CHECKS total=639 failed=2`, exit 1. Exactly the two changed scripts fail their HEAD-blob comparisons; their working-copy fingerprints and the other 637 checks pass. The HEAD/working-copy checks remain intact. Parent must rerun after committing; this slice cannot claim post-commit success.
- During this slice, other authorized commits advanced main to `521ab1585494fa942d8c5fd861d5d6afde417a1e`; this slice remains uncommitted. No staging, commit, push, `.ai`, unit-runner edit, dependency installation or actual cloud operation was performed here. No remote CI is claimed.
- Native WebView behavior, visual pixels, real backend diagnostics and cloud operations are outside this offline slice.
