/**
 * The one list of harness modes.
 *
 * Both the runner (scripts/verify_dialog_interactions.mjs) and the shape ledger
 * (scripts/verify_shape.mjs) read this file, so "which modes exist" has one answer. The runner
 * cross-checks the list against the dispatch statements that actually exist in its source; a name
 * listed here without a block is refused at startup, and a block without a name here is refused too.
 *
 * Keeping the list in its own module is what makes it importable. Reading it back out of the
 * runner's source with a loose regex is what produced the false reading this replaced: the pattern
 * `MODE === 'x'` also matches prose inside comments and inside the guard's own error strings, so the
 * ledger once reported a duplicate mode that did not exist.
 */
export const MODES = [
  'ab',
  'confirm',
  'contrast',
  'contrast-tier',
  'external',
  'gate',
  'gate-unit',
  'help',
  'layout',
  'links',
  'pages',
  'red-demo',
  'settings-guard',
  'theme-surfaces',
  'visual',
]

// Anchored to the dispatch statement's own shape, at the start of a line. A comment or an error
// string that merely mentions a mode name does not look like `if (MODE === 'x') {`, so neither the
// under-match (a real block missed) nor the over-match (prosed counted as a block) can pass silently:
// the two sets are compared against each other in both directions.
export const DISPATCH_RE = /^[ \t]*if \(MODE === '([a-z-]+)'\) \{/gm
