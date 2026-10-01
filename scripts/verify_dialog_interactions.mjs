/**
 * ConfirmDialog / external-link interaction harness.
 *
 * This is the measurement tool behind two fixes: 534cc15 (unbreakable filenames overflowing the
 * confirm card) and a561161 (external links failing silently). It drives a locally installed
 * Chromium-family browser headless over CDP, so React sees trusted input events - the only way to
 * observe what a backdrop `onMouseDown`, an Escape keypress or an initial focus really does.
 * It builds nothing, packages nothing, and needs no Rust toolchain.
 *
 *   1. start the frontend only:  cd apps/desktop && npm run dev
 *   2. run a mode:               node scripts/verify_dialog_interactions.mjs gate
 *
 * Modes
 *   confirm  the five dialog behaviours: initial focus, Escape, backdrop, long text, z-index
 *   ab       the same dialog with overflow-wrap toggled, for a paired before/after reading
 *   gate     self-test proving the viewport gate really rejects a hidden window (live browser)
 *   gate-unit gate predicate exercised against the recorded readings, incl. innerWidth 0 (no browser)
 *   links    what each docs entry point shows, for whatever VITE_DOCS_BASE_URL the server has
 *   pages    visit every route in a plain browser and report whether anything crashes
 *   external the red/green pair: discarding the open promise vs reporting it, plus the primitive's
 *            rejection behaviour for a malformed value and a non-http scheme
 *   red-demo  starts scripts/__fixtures__/impostor_dev_server.mjs and asserts the identity gate
 *             refuses to measure it (exit 2 from the child is the expected outcome)
 *   visual    the measured visual baseline (type scale, radii, gaps, dead space, sequences,
 *             contrast) for every surface, plus four asserted invariants on the onboarding dialog
 *   contrast  the raw colour chain behind one flagged element, for hand-checking the ratio
 *   contrast-tier  the contrast floor: every readable text run and every control kind, on every
 *             route, under all three themes and both wallpaper extremes, judged against the surface
 *             sampled from a glyph-hidden screenshot (so gradients, backdrop-filter and the wallpaper
 *             composite are in the number). --doc=PATH additionally checks the two marked tables in
 *             that document against this run; --doc-write regenerates them from it.
 *   layout    the geometry floor: every route at 1440/1024/640 checked for horizontal overflow,
 *             clipped text, touch-target size, focus visibility, accessible names and broken images
 *   theme-surfaces  photographs each surface under all three themes and reports the ones whose
 *             rendered pixels never change - i.e. panels that ignore the selected theme
 *   settings-guard  plants an illegal out-of-band value (unknown theme, CSS-injection accent,
 *             out-of-range blur/glass, non-http wallpaper) and requires the app to mount, fall
 *             back, and refuse to write the bad value into the DOM
 *
 * Options
 *   --out DIR   default %TEMP%/image-hosting-probes/<date>; screenshots and JSON land there, never
 *               inside the repository
 *   --app URL   dev server origin, default http://127.0.0.1:1420/
 *   --edge PATH browser binary, default: first existing of Edge (x86), Edge, Chrome
 *   --tag NAME  filename suffix for reports
 *   --port N    CDP port; default is an OS-assigned free loopback port (a fixed default once
 *               attached to the developer's own running browser - see the comment at the binding)
 *   --routes A,B  restrict a sweep to named routes. The sweep then prints `SCOPE partial`, and the
 *               "every kind of surface was seen" assertions only bind a full sweep - a subset that
 *               passes has not measured the routes it skipped.
 *   --deadline MS  hard self-budget; also read from VERIFY_DEADLINE_MS. The harness stops itself and
 *               prints which combinations are UNMEASURED, rather than being killed from outside with
 *               no reading at all.
 *   --watch TEXTS  comma-separated element texts to follow across every combination (contrast-tier).
 *               Each named element gets its own min / max / cross-combination amplitude, whether or
 *               not it passes - a floor margin has to be quoted against the wobble of the element
 *               that was changed, not against whoever happens to be worst on that face.
 *   --doc PATH  check the marked tables in PATH against this run (contrast-tier), or against the
 *               source (theme_face_inventory.mjs).
 *   --doc-write  with --doc, regenerate those marked blocks from this run. Only the blocks move;
 *               the prose around them stays authored.
 *
 * Exit codes
 *   0  measured, every assertion held
 *   1  an app-level assertion failed (a real regression) or the run crashed
 *   2  harness fault: the viewport gate or the project-identity gate refused to sample. Never
 *      report a 2 as a pass or as a regression - it means nothing was measured.
 *   3  no local Chromium-family browser found
 *   4  the dev server on --app is not reachable
 *
 * Before any sample is taken the tool proves it is pointed at this project: document.title must
 * match index.html, the served /package.json must be byte-identical to the working tree, and every
 * value export in src/lib/desktop.ts must appear in the module the server returns. A stale checkout
 * on port 1420 therefore fails loudly instead of returning confident PASSes about old code.
 *
 * No third-party imports: node:child_process and node:fs, plus the fetch / WebSocket globals that
 * Node 22+ ships. Requires Node >= 22 for the global WebSocket.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { HELPERS, VISUAL_PROBE, LAYOUT_PROBE } from './verify_probes.mjs'
import { MODES, DISPATCH_RE } from './verify_modes.mjs'

const argv = process.argv.slice(2)
const MODE = argv[0] && !argv[0].startsWith('--') ? argv[0] : ''
// MODES lives in its own module so the shape ledger and this runner read the same list; here it is
// cross-checked against the dispatch statements that actually exist. Both directions matter: a name
// listed with no block spawns a browser, judges nothing and exits 0, and a block with no name is
// invisible to whoever reads the help. `help` is exempt from the comparison test because it is the
// usage branch (`if (!MODE || MODE === 'help')`), not a measurement block.
{
  const source = readFileSync(new URL(import.meta.url), 'utf8')
  const dispatched = new Set([...source.matchAll(DISPATCH_RE)].map((m) => m[1]))
  const missing = MODES.filter((m) => m !== 'help' && !dispatched.has(m))
  const extra = [...dispatched].filter((m) => !MODES.includes(m)).sort()
  if (missing.length || extra.length) {
    console.error(`HARNESS FAULT: the mode dispatch disagrees with scripts/verify_modes.mjs. declaredButAbsent=${missing.join(',') || '-'} dispatchedButUndeclared=${extra.join(',') || '-'}`)
    process.exit(2)
  }
  // Third direction: declared and dispatched is not the same as discoverable. `contrast-tier` ran for
  // weeks without appearing in the usage block, so the only person who knew it existed was the one who
  // wrote it - and a mode nobody can find is a gate nobody runs.
  const usage = source.split('*/')[0]
  const undocumented = MODES.filter((m) => m !== 'help' && !new RegExp(`^ \\*   ${m}( |  )`, 'm').test(usage))
  if (undocumented.length) {
    console.error(`HARNESS FAULT: mode(s) ${undocumented.join(', ')} are declared and dispatched but not listed in this file's usage block.`)
    process.exit(2)
  }
  if (MODE && MODE !== 'help' && !MODES.includes(MODE)) {
    console.error(`HARNESS FAULT: mode "${MODE}" is not declared, so no block would run. Declared: ${MODES.join(', ')}`)
    process.exit(2)
  }
}
// Both `--routes a,b` and `--routes=a,b` are accepted. This matters: the `=` form used to be
// ignored, so `--routes=发布,资源,云端,图库,插件,任务,设置` ran the two-route default and still
// printed a confident CONTRAST_GATE - the instrument answered while the application was never
// asked. Anything the parser cannot consume is now a hard error for the same reason.
// The accepted flag list is read back out of this file rather than typed here: a hand-maintained
// whitelist drifts the moment a mode starts using an option, and the drift shows up as an
// unhelpful "unknown option" for a flag that works.
const KNOWN_OPTS = new Set(
  [...readFileSync(new URL(import.meta.url), 'utf8').matchAll(/\b(?:opt|flag)\('([a-z0-9-]+)'/g)].map((m) => m[1]),
)
const opt = (name, fallback) => {
  const eq = argv.findIndex((a) => a.startsWith(`--${name}=`))
  if (eq !== -1) return argv[eq].slice(name.length + 3) || fallback
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : fallback
}
// Boolean switches go through this rather than a bare argv.includes, so the derivation above still
// sees them: a flag read by hand is a flag the unknown-option guard does not know about, and it would
// be rejected as a typo on the way in.
const flag = (name) => argv.some((a) => a === `--${name}`)
for (const a of argv) {
  if (!a.startsWith('--')) continue
  const name = a.slice(2).split(/[=\s]/)[0]
  if (!KNOWN_OPTS.has(name)) {
    console.error(`HARNESS FAULT: unknown option --${name}. A flag the parser ignores does not narrow the run, it fakes one. Known: ${[...KNOWN_OPTS].sort().join(', ')}`)
    process.exit(2)
  }
}
// Hard budget, in milliseconds, from --deadline or VERIFY_DEADLINE_MS. The aggregate sets it to its own
// stage timeout minus a minute so the harness always stops itself, cleanly, with the coverage it managed to
// reach printed - a stage killed from outside cannot print anything, and an unfinished sweep that
// looks like a finished one is worse than a short one.
const DEADLINE_MS = Number(opt('deadline', process.env.VERIFY_DEADLINE_MS || '')) || 0
const RUN_STARTED = Date.now()
let budgetHits = 0
if (!MODE || MODE === 'help') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  console.log(`modes: ${MODES.join(' | ')}`)
  process.exit(MODE === 'help' ? 0 : 2)
}

// Forward slashes only: a Windows path with backslashes reaching child_process.spawn through a
// shell has a habit of arriving as "C:Program Files (x86)MicrosoftEdge...".
const CANDIDATES = [
  opt('edge', ''),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)
const BROWSER = CANDIDATES.find((p) => existsSync(p))
if (!BROWSER) {
  console.error(`No local browser found. Tried:\n  ${CANDIDATES.join('\n  ')}\nPass --edge <path> to override.`)
  process.exit(3)
}

// A fixed default port is a hazard, not a convenience: measured on this box, port 9333 was held
// by the user's OWN Edge (tabs: edge://sync-confirmation-dialog, localhost:5173/showcase, a
// chrome-extension page) and this harness happily attached to it and started injecting. Bind
// port 0 and let the OS hand back something free, so a stranger can never be on our endpoint.
async function freeDebugPort() {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', () => resolve(0))
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p > 65400 ? 1024 + (p % 50000) : p))
    })
  })
}
const PORT = Number(opt('port', '')) || (await freeDebugPort())
if (!PORT) {
  console.error('Cannot obtain a free loopback port for the browser debug endpoint. Pass --port <free> explicitly; refusing to fall back to a fixed port, because a fixed port is how this harness once attached to the developer\'s own browser.')
  process.exit(2)
}
// Ownership is asserted, not assumed: if anything already answers on the port we are about to
// hand to --remote-debugging-port, we are not the ones who will own that endpoint, and every
// result would be measurements of somebody else's browser. Exiting here is the point.
if (await portAlreadyOwned(PORT)) {
  console.error(`HARNESS FAULT: something already serves CDP on port ${PORT} (/json/version answered). Refusing to attach to a browser we did not spawn - it could be a developer's real session.`)
  process.exit(2)
}
async function portAlreadyOwned(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (!res.ok) return false
    const body = await res.json()
    return Boolean(body && body.webSocketDebuggerUrl)
  } catch { return false }
}
const APP = opt('app', 'http://127.0.0.1:1420/')
const TAG = opt('tag', MODE)
const OUT = opt('out', `${(process.env.TEMP || '/tmp').replace(/\\/g, '/')}/image-hosting-probes/${new Date().toISOString().slice(0, 10)}`)
mkdirSync(OUT, { recursive: true })

// The coverage rule, as a predicate the unit mode can feed both ways. Two reasons it lives here
// rather than inline: the ceiling had never tripped on a real sweep, so inline it was an assertion
// nobody had seen fire; and the inline version's `judgedTotal &&` guard meant a sweep that judged
// NOTHING (a broken collector, not a busy page) passed with measured=0 below=0 - the emptiest
// possible green. An unknown bucket is only honest if losing it is loud AND losing everything is
// louder.
function coverageVerdict({ judged, dropped, ceiling = 0.25 }) {
  const problems = []
  if (!judged) problems.push(`judged=0: the sweep measured no run at all, so a below-count of 0 is the collector talking, not the page`)
  if (judged && dropped > judged * ceiling) {
    problems.push(`dropped=${dropped} exceeds ${Math.round(ceiling * 100)}% of judged=${judged}`)
  }
  const coverage = judged + dropped
  return { ok: !problems.length, problems, pct: coverage ? Math.round((judged / coverage) * 100) : 0 }
}

// The document projection's row comparison, lifted out of the sweep so gate-unit can plant tables at
// it. It names WHICH row moved with both values, because "1 row(s) do not match" is not actionable -
// the gate spent an entire run saying that about what turned out to be the pending colour red.
const DOC_TABLE_COLS = ['面', 'mist', 'midnight', 'sakura']
// Line endings are normalised here rather than at the call site, for the reason theme_face_inventory
// learned on 2026-10-01: this repo is checked out with core.autocrlf=true, so the committed LF blob
// arrives as CRLF in the working copy, and the byte after a BEGIN marker is \r. The call site's
// `.replace(/^\n/,'')` then never fires, the doc side starts with an empty line, and every row is read
// one slot out of phase - a projection gate that goes red while the table matches byte for byte.
const normBlock = (t) => String(t).replace(/\r\n/g, '\n').replace(/[\r\u0085\u2028\u2029]/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
const stripCountCol = (text) => normBlock(text).split('\n').map((l) => l.split('|').slice(0, -2).join('|'))
function docTableDiff(haveText, wantText) {
  const have = stripCountCol(haveText)
  const want = stripCountCol(wantText)
  const cells = (x) => String(x || '').split('|').slice(1, -1).map((c) => c.trim())
  const rows = []
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    if (have[i] === want[i]) continue
    if (want[i] === undefined) { rows.push(`the doc has a row this run did not produce: "${String(have[i] || '').trim()}"`); continue }
    if (have[i] === undefined) { rows.push(`this run produced a row the doc lacks: "${String(want[i] || '').trim()}"`); continue }
    const d = cells(have[i]), r = cells(want[i])
    const moved = d.map((c, k) => (c !== r[k] ? `${r[0]} ${DOC_TABLE_COLS[k] || `col${k}`}: doc ${c} -> run ${r[k]}` : null)).filter(Boolean)
    rows.push(moved.length ? moved.join('; ') : `row differs: doc "${String(have[i]).trim()}" vs run "${String(want[i]).trim()}"`)
  }
  return rows
}

// The layout-staleness predicates, lifted out of the sweep for the same reason `coverageVerdict` and
// `docTableDiff` are: the sweep can only feed them whatever the page happened to be doing that
// minute, so a predicate quietly disarmed (a loop bound that never runs, a misspelled field, a
// `!==` turned into `<`) would print `moved=0` in every batch and read exactly like a clean page.
// The cases below are the planted halves; `gate-unit` runs them with no browser, and the sweep
// re-runs the SAME table before it is allowed to quote a zero of its own.
//
// "did this element's box move between the sample and the photograph": 0 for unmoved, the worst axis
// delta in px for moved, null when there is nothing to compare against. null must never be counted
// as unmoved - an element that vanished from the page is the strongest form of the finding, not the
// weakest.
function rectMoved(box, live) {
  if (!Array.isArray(box) || box.length !== 4 || !Array.isArray(live) || live.length !== 4) return null
  let worst = 0
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(Number(box[i]) - Number(live[i]))
    if (!(d >= 0)) return null
    if (d > worst) worst = d
  }
  return worst > 1 ? Math.round(worst) : 0
}
// The page-level fingerprint, kept for mechanism rather than verdict: both of its reads sit BEFORE
// the photograph, so it can never see a reflow that lands inside the capture round trip. That is why
// the per-element check above is the load-bearing one, and the 58px finding in
// docs/VISUAL_BASELINE.md section 7.6 is the measurement that proved it.
function layoutDrift(a, b) {
  if (!a || !b) return 'signature missing'
  const parts = []
  if (a.n !== b.n) parts.push(`text-bearing elements ${a.n}->${b.n}`)
  if (a.sumTop !== b.sumTop) parts.push(`sum of top edges ${a.sumTop}->${b.sumTop}`)
  if (a.doc !== b.doc) parts.push(`document height ${a.doc}->${b.doc}`)
  if (a.bodyH !== b.bodyH) parts.push(`body height ${a.bodyH}->${b.bodyH}`)
  return parts.length ? parts.join(', ') : null
}
const RECT_CASES = [
  { name: 'planted 470px shift', box: [10, 100, 200, 20], live: [10, 570, 200, 20], expect: 470 },
  { name: 'the observed real shift (58px, plugin/black)', box: [329, 517, 391, 20], live: [329, 459, 391, 20], expect: 58 },
  { name: 'identical twin', box: [10, 100, 200, 20], live: [10, 100, 200, 20], expect: 0 },
  { name: '1px jitter, inside tolerance', box: [10, 100, 200, 20], live: [10, 101, 200, 20], expect: 0 },
  { name: 'live box missing (element unmounted)', box: [10, 100, 200, 20], live: undefined, expect: null },
  { name: 'recorded box malformed', box: '10,100,200,20', live: [10, 100, 200, 20], expect: null },
]
const SIG_HERE = { n: 62, sumTop: 24198, doc: 900, bodyH: 900 }
const DRIFT_CASES = [
  { name: 'identical signatures', a: SIG_HERE, b: SIG_HERE, expect: null },
  { name: 'element count moved (62->64, as observed)', a: SIG_HERE, b: { ...SIG_HERE, n: 64 }, expect: 'text-bearing elements 62->64' },
  { name: 'only the top sum moved', a: SIG_HERE, b: { ...SIG_HERE, sumTop: 23728 }, expect: 'sum of top edges 24198->23728' },
  { name: 'a signature read is missing', a: null, b: SIG_HERE, expect: 'signature missing' },
]

if (MODE === 'gate-unit') {
  // No browser, no dev server: this exercises the gate predicate against readings that were really
  // observed on this machine, including the one that produced the bogus 186.796875px card width.
  //
  // Each rejection case breaks exactly ONE clause (everything else is healthy) and names the token
  // it expects back. A case that only asserts "was rejected" proves nothing: an earlier draft had
  // the zero-width case also carrying a zero clientWidth, so deleting the innerWidth clause from the
  // predicate still passed 5/5.
  const HEALTHY = { visibility: 'visible', innerWidth: 1406, innerHeight: 803, clientWidth: 1406, clientHeight: 803 }
  const check = (run, c) => {
    const verdict = run(c.reading)
    const namedTheClause = c.expectReject === !verdict.ok && (!c.expectToken || verdict.problems.some((p) => p.startsWith(c.expectToken)))
    const extraClauses = c.expectToken ? verdict.problems.filter((p) => !p.startsWith(c.expectToken)) : []
    return { group: c.group, name: c.name, expectedReject: c.expectReject, gateRejected: !verdict.ok, problems: verdict.problems, correct: namedTheClause, unexpectedOtherClauses: extraClauses }
  }
  const results = [
    { group: 'viewport', name: 'live headless viewport', reading: { ...HEALTHY }, expectReject: false, expectToken: null },
    { group: 'viewport', name: 'hidden, sizes healthy', reading: { ...HEALTHY, visibility: 'hidden' }, expectReject: true, expectToken: 'visibilityState=hidden' },
    { group: 'viewport', name: 'innerWidth 0, everything else healthy', reading: { ...HEALTHY, innerWidth: 0 }, expectReject: true, expectToken: 'innerWidth=0' },
    { group: 'viewport', name: 'innerHeight 0, everything else healthy', reading: { ...HEALTHY, innerHeight: 0 }, expectReject: true, expectToken: 'innerHeight=0' },
    { group: 'viewport', name: 'clientWidth 0, everything else healthy', reading: { ...HEALTHY, clientWidth: 0 }, expectReject: true, expectToken: 'client=0x803' },
    { group: 'viewport', name: 'recorded connector reading (hidden + 0x0)', reading: { visibility: 'hidden', innerWidth: 0, innerHeight: 0, clientWidth: 0, clientHeight: 0 }, expectReject: true, expectToken: 'visibilityState=hidden' },
    // Coverage ceiling, both directions, on the reading the sweep really printed last run plus the
    // ways it can go wrong. The `judged=0` case is the one that mattered: written inline as
    // `if (judged && dropped > judged*0.25)`, a collector that returned nothing produced
    // measured=0 / below=0 / unresolved=0 and exited 0 - the emptiest green available.
    { group: 'coverage', name: 'last run reading (judged 2016, dropped 461)', reading: { judged: 2016, dropped: 461 }, expectReject: false },
    { group: 'coverage', name: 'dropped above the ceiling (1000 judged, 400 dropped)', reading: { judged: 1000, dropped: 400 }, expectReject: true, expectToken: 'dropped=400' },
    { group: 'coverage', name: 'dropped exactly at the ceiling (1000 judged, 250 dropped)', reading: { judged: 1000, dropped: 250 }, expectReject: false },
    { group: 'coverage', name: 'nothing judged', reading: { judged: 0, dropped: 0 }, expectReject: true, expectToken: 'judged=0' },
    { group: 'coverage', name: 'nothing judged, everything dropped', reading: { judged: 0, dropped: 900 }, expectReject: true, expectToken: 'judged=0' },
  ].map((c) => check(c.group === 'coverage' ? coverageVerdict : gateVerdict, c))
  const failed = results.filter((r) => !r.correct)
  const byGroup = (g) => results.filter((r) => r.group === g)
  // The doc projection gets its own group, on planted tables. It reports WHICH row moved now, and a
  // claim like that needs both directions: a comparison that cannot see a changed ratio pins nothing,
  // and one that cannot tell "the plugin panel had one fewer error banner this time" from a real
  // regression will be muted within a week.
  const T = (rows) => rows.join('\n')
  const HEAD = '| 面 | mist | midnight | sakura | 判读文字数（每主题） |\n|---|---|---|---|---|'
  const RUN = T([HEAD, '| 插件 | 4.74 | 4.92 | 4.93 | 28/28/28 |', '| 设置 | 4.74 | 4.92 | 4.93 | 37/37/37 |'])
  const docTableCases = [
    { name: 'doc equals run', diff: docTableDiff(RUN, RUN), expectRows: 0, expectToken: null },
    { name: 'one ratio moved (the pending 插件 red)', diff: docTableDiff(T([HEAD, '| 插件 | 4.74 | 4.08 | 4.38 | 28/26/26 |', '| 设置 | 4.74 | 4.92 | 4.93 | 37/37/37 |']), RUN), expectRows: 1, expectToken: '插件 midnight: doc 4.08 -> run 4.92' },
    { name: 'only the count column moved', diff: docTableDiff(T([HEAD, '| 插件 | 4.74 | 4.92 | 4.93 | 26/26/26 |', '| 设置 | 4.74 | 4.92 | 4.93 | 37/37/37 |']), RUN), expectRows: 0, expectToken: null },
    { name: 'doc carries a row the run did not produce', diff: docTableDiff(T([HEAD, '| 插件 | 4.74 | 4.92 | 4.93 | 28/28/28 |', '| 设置 | 4.74 | 4.92 | 4.93 | 37/37/37 |', '| 幽灵 | 1.00 | 1.00 | 1.00 | 1/1/1 |']), RUN), expectRows: 1, expectToken: 'the doc has a row this run did not produce' },
    { name: 'run produced a row the doc lacks', diff: docTableDiff(T([HEAD, '| 插件 | 4.74 | 4.92 | 4.93 | 28/28/28 |']), RUN), expectRows: 1, expectToken: 'this run produced a row the doc lacks' },
    // The line-ending half, both directions. A claim like "the projection is CRLF-tolerant" is worth
    // nothing on the positive side alone: the second case is the one that shows the normaliser did not
    // blind the comparison, and it is written in the mixed state the working copy really produces
    // (doc side CRLF, run side LF) rather than the easy both-sides-same case.
    { name: 'doc written with CRLF still equals the run', diff: docTableDiff(RUN.replace(/\n/g, '\r\n'), RUN), expectRows: 0, expectToken: null },
    { name: 'a leading blank line does not shift the rows', diff: docTableDiff('\n' + RUN, RUN), expectRows: 0, expectToken: null },
    { name: 'a moved ratio is still reported under mixed endings', diff: docTableDiff(T([HEAD, '| 插件 | 4.74 | 4.08 | 4.38 | 28/26/26 |', '| 设置 | 4.74 | 4.92 | 4.93 | 37/37/37 |']).replace(/\n/g, '\r\n'), RUN), expectRows: 1, expectToken: '插件 midnight: doc 4.08 -> run 4.92' },
  ]
  const docResults = docTableCases.map((c) => ({
    group: 'doc-table', name: c.name, expectedRows: c.expectRows, gotRows: c.diff.length,
    correct: c.diff.length === c.expectRows && (!c.expectToken || c.diff.some((d) => d.includes(c.expectToken))),
    detail: c.diff.join(' | ') || '(none)',
  }))
  // The layout-staleness predicates, with no browser in the loop. Both directions are asserted on
  // every case: a planted move must come back as that many pixels, an identical twin must come back 0,
  // and a missing or malformed box must come back null rather than 0. The third one is the case that
  // would otherwise be lost - `undefined` treated as "did not move" turns an unmounted element into a
  // pass, which is the failure mode this whole section was written to avoid.
  const staleResults = [
    ...RECT_CASES.map((c) => {
      const got = rectMoved(c.box, c.live)
      return { group: 'staleness', name: `rectMoved ${c.name}`, got: String(got), expect: String(c.expect), correct: got === c.expect }
    }),
    ...DRIFT_CASES.map((c) => {
      const got = layoutDrift(c.a, c.b)
      return { group: 'staleness', name: `layoutDrift ${c.name}`, got: String(got), expect: String(c.expect), correct: c.expect === null ? got === null : String(got).includes(c.expect) }
    }),
  ]
  writeFileSync(`${OUT}/report-gate-unit.json`, JSON.stringify({ results, docResults, staleResults }, null, 2))
  for (const r of results) console.log(`${r.correct ? 'OK  ' : 'FAIL'} ${r.group}: ${r.name} -> ${r.gateRejected ? 'rejected: ' + r.problems.join('; ') : 'accepted'}`)
  for (const r of docResults) console.log(`${r.correct ? 'OK  ' : 'FAIL'} doc-table: ${r.name} -> ${r.gotRows} row(s) reported${r.detail ? `: ${r.detail}` : ''}`)
  for (const r of staleResults) console.log(`${r.correct ? 'OK  ' : 'FAIL'} staleness: ${r.name} -> ${r.got} (expected ${r.expect})`)
  // One emitGate per predicate under test: a single tally would let the viewport cases carry a
  // coverage failure, which is the cross-group averaging this table exists to avoid. The rollup has
  // to be the LAST line - verify_all.mjs reads the last GATE_JSON of a stage and cross-checks its
  // name against the stage, so reordering these three would silently narrow what gets checked.
  for (const g of ['viewport', 'coverage']) emitGate(`gate-unit:${g}`, byGroup(g).length, byGroup(g).filter((r) => !r.correct).length)
  emitGate('gate-unit:doc-table', docResults.length, docResults.filter((r) => !r.correct).length)
  emitGate('gate-unit:staleness', staleResults.length, staleResults.filter((r) => !r.correct).length)
  const all = [...results, ...docResults, ...staleResults]
  const allFailed = all.filter((r) => !r.correct)
  emitGate('gate-unit', all.length, allFailed.length)
  console.log(`gate unit check: ${all.length - allFailed.length}/${all.length} correct (viewport ${byGroup('viewport').length - byGroup('viewport').filter((r) => !r.correct).length}/${byGroup('viewport').length}, coverage ${byGroup('coverage').length - byGroup('coverage').filter((r) => !r.correct).length}/${byGroup('coverage').length}, doc-table ${docResults.length - docResults.filter((r) => !r.correct).length}/${docResults.length}, staleness ${staleResults.length - staleResults.filter((r) => !r.correct).length}/${staleResults.length}) | reports: ${OUT}`)
  process.exit(allFailed.length ? 1 : 0)
}


const profile = `${OUT.replace(/\/+$/, '')}/.profile-${Date.now()}`
// The browser and the dev-server preflight are lazy: red-demo orchestrates child processes and must
// not fail (or burn a browser launch) because the parent's default --app is down.
let browser = null
function launchBrowser() {
  if (browser) return
  browser = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--window-size=1440,900', APP,
  ], { stdio: 'ignore' })
}

async function requireDevServer() {
  try {
    const probe = await fetch(APP, { signal: AbortSignal.timeout(4000) })
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
  } catch (error) {
    console.error(`Frontend dev server is not reachable at ${APP} (${error.message}).\nStart it first:  cd apps/desktop && npm run dev`)
    process.exit(4)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Identity gate. Navigating to a port is not the same as measuring this project: a dev server from
// an older checkout, or a different app entirely, produces confident PASSes against the wrong code.
// Three layers, none of them hardcoded, so they cannot drift from the tree they check:
//   L1 document.title must equal the <title> in the on-disk index.html
//   L2 the served /package.json must be byte-identical to the on-disk one
//   L3 every export name in the on-disk desktop.ts must appear in the module the server returns
// A mismatch exits 2: harness fault. It is never counted as a pass and never as an app regression.
// Forward slashes everywhere: these paths reach child_process.spawn as argv, and a Windows path with
// backslashes has already eaten a whole run here once (spawn reported "C:Program Files...").
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, '/').replace(/\/+$/, '')
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '')
const readRepoFile = (rel) => readFileSync(`${REPO}/${rel}`, 'utf8')

function exportNames(source) {
  // Value exports only. `export interface` / `export type` are erased by the TypeScript transform,
  // so demanding they appear in the served JS makes the gate permanently red for a reason that has
  // nothing to do with staleness - the first version of this check tripped on RemoteIndexSyncResult.
  return [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1])
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function assertProjectIdentity() {
  const faults = []
  const expectedTitle = (readRepoFile('apps/desktop/index.html').match(/<title>([^<]*)<\/title>/) || [])[1]
  const servedPackage = await fetchText(`${APP}package.json`).catch((e) => `__unreachable__ ${e.message}`)
  const onDiskPackage = readRepoFile('apps/desktop/package.json')
  if (typeof servedPackage !== 'string' || servedPackage.trim() !== onDiskPackage.trim()) {
    faults.push('L2 served /package.json differs from the working tree (different checkout or app)')
  }
  const probeModule = await fetchText(`${APP}src/lib/desktop.ts`).catch((e) => `__unreachable__ ${e.message}`)
  const missing = exportNames(readRepoFile('apps/desktop/src/lib/desktop.ts')).filter((n) => !probeModule.includes(n))
  if (missing.length) faults.push(`L3 served /src/lib/desktop.ts is missing ${missing.length} export(s) present on disk: ${missing.slice(0, 6).join(', ')}`)
  const actualTitle = await evaluate(`document.title`)
  if (expectedTitle && actualTitle !== expectedTitle) faults.push(`L1 document.title is ${JSON.stringify(actualTitle)}, index.html says ${JSON.stringify(expectedTitle)}`)
  if (faults.length) {
    console.error(`PROJECT IDENTITY GATE FAILED - refusing to measure. Exit 2 means harness fault, not a pass and not an app regression.\n  ${faults.join('\n  ')}\n  server: ${APP}`)
    // Throwing, not finish(2): finish() defers process.exit, so falling through would let the run
    // continue and print an IDENTITY line full of hardcoded success values next to its own failure.
    const error = new Error(`identity gate rejected ${APP}: ${faults.join('; ')}`)
    error.identityFault = true
    throw error
  }
  return { title: actualTitle, packageJsonMatches: true, exportsChecked: exportNames(readRepoFile('apps/desktop/src/lib/desktop.ts')).length, exportsMissing: 0 }
}

function buildProvenance() {
  // The app has no build-time version marker, and Vite reads sources from disk per request, so the
  // most this tool can honestly claim is "the tree the server is rooted at matches HEAD".
  let head = 'unknown'
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { /* git missing or not a repo: report it rather than guessing */ }
  let version = 'unknown'
  try { version = JSON.parse(readRepoFile('apps/desktop/package.json')).version } catch { /* keep unknown */ }
  return { headCommitUnderTest: head, desktopPackageVersion: version, caveat: 'the dev server injects no build-time commit marker; identity is proven by /package.json and export-name equality with HEAD, not by a version the app itself reports' }
}


// The aggregate reads this line instead of pattern-matching a human-readable summary. Two reasons:
// a field added to the prose line (viaLoad/viaApply did exactly that) silently breaks a regex in
// another file, and a prose line cannot be schema-checked. checked must be the number of things
// actually examined, so checked=0 is distinguishable from failed=0 by construction.
function emitGate(name, checked, failed, extra) {
  const payload = { gate: name, checked: Number(checked) || 0, failed: Number(failed) || 0, ok: (Number(failed) || 0) === 0, ...extra }
  console.log(`GATE_JSON ${JSON.stringify(payload)}`)
}

// Exiting while a CDP socket or the browser child is still closing trips a libuv assertion on
// Windows, so give both a moment to shut down first.
// finish() used to schedule the exit and return, so the code after it kept running: a fault that
// called finish(2) then threw (because the fault had already torn down the page state) reached
// main().catch, which called finish(1) - a second scheduled exit that wins, because both timers fire
// and the last one decides. One code, recorded once, and an exception that unwinds instead of
// returning, so nothing after a verdict can overwrite it or print under it.
let finishCode = null
class HarnessFinishing extends Error { constructor(code) { super(`harness finished with exit ${code}`); this.code = code } }
function finish(code) {
  if (finishCode === null) {
    finishCode = code
    try { ws.close() } catch {}
    try { browser?.kill() } catch {}
    setTimeout(() => process.exit(finishCode), 300)
  }
  throw new HarnessFinishing(code)
}

async function waitForTarget() {
  let last = []
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      last = await res.json()
      const page = last.find((t) => t.type === 'page' && t.url.startsWith(APP))
      if (page) return page
    } catch {}
    await sleep(500)
  }
  // An Edge left behind by an earlier run keeps listening on the fixed default port, and this call
  // happily attaches to that stranger instead of the browser just spawned. Naming the tabs makes
  // "no page target" diagnosable; --port <other> is the workaround.
  const seen = last.map((t) => t.url || t.type).slice(0, 4).join(', ') || 'no targets at all'
  throw new Error(`no page target on port ${PORT}; that browser's tabs are: ${seen}. If a previous run's headless browser is still holding the port, rerun with --port <free>.`)
}

let idSeq = 0
const pending = new Map()
const events = []
const consoleErrors = []
let ws

function send(method, params = {}) {
  const id = ++idSeq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function on(method, params = {}) {
  ws.send(JSON.stringify({ method, params }))
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

// A hidden window or a 0x0 viewport silently changes the layout baseline itself: the same
// max-w-[440px] card measured 186.796875px there and 440px in a real viewport, so every geometry
// number taken without this check is an artefact, not a regression. Text and attribute readings
// survive it; widths, rects, hit-tests and screenshots do not.
//
// The decision is a pure function so the 0-width branch stays testable: this machine cannot make a
// live page report innerWidth 0 (setDeviceMetricsOverride ignores 0, and a minimized window keeps
// reporting its last real size), so the only honest way to prove that branch is to feed the
// predicate the readings that were actually observed - see the `gate-unit` mode.
function gateVerdict(reading) {
  const problems = []
  if (reading.visibility !== 'visible') problems.push(`visibilityState=${reading.visibility} (needs "visible")`)
  if (!(reading.innerWidth > 0)) problems.push(`innerWidth=${reading.innerWidth} (needs > 0)`)
  if (!(reading.innerHeight > 0)) problems.push(`innerHeight=${reading.innerHeight} (needs > 0)`)
  if (!(reading.clientWidth > 0) || !(reading.clientHeight > 0)) problems.push(`client=${reading.clientWidth}x${reading.clientHeight}`)
  return { ok: problems.length === 0, problems }
}

async function assertRealViewport(stage) {
  const v = await evaluate(`({ visibility: document.visibilityState, hidden: document.hidden, innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, hasFocus: document.hasFocus(), dpr: devicePixelRatio })`)
  const verdict = gateVerdict(v)
  if (!verdict.ok) throw new Error(`VIEWPORT GATE FAILED at "${stage}": ${verdict.problems.join('; ')} | ${JSON.stringify(v)}`)
  return v
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const p = `${OUT}/${name}.png`
  writeFileSync(p, Buffer.from(r.data, 'base64'))
  return p
}

async function clickAt(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  }
  await sleep(120)
}

async function pressAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(80)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(80)
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(120)
}


if (MODE === 'red-demo') {
  // Re-runnable proof that the identity gate alarms. Both impostor servers are deliberately wrong;
  // a red here is the expected outcome, and the demo only passes if the gate refuses to measure.
  // If either child exits 0, the gate has stopped biting - that is reported as exit 2, not as a pass.
  const cases = [
    {
      fixture: 'other-app', port: 14571, expectClause: 'L1 document.title',
      why: 'a different project owns the port; measuring it would produce confident PASSes about code that is not ours',
    },
    {
      fixture: 'stale-source', port: 14572, expectClause: 'L3 served /src/lib/desktop.ts',
      why: 'right title and byte-identical /package.json, but the served module predates one current export - the only way to catch "same app, older checkout"',
    },
  ]
  const results = []
  for (const c of cases) {
    // Both ports are acquired fresh. They used to be derived from the parent's debug port
    // (PORT + c.port - 14570), which was harmless while PORT was the fixed 9333 and became
    // intermittent once PORT came from the ephemeral range: the derived value could land on a port
    // already in use, the fixture would fail to bind, and the child would then report a plain
    // exit 1 with the gate never having been asked to reject anything.
    const fixturePort = await freeDebugPort()
    const childPort = await freeDebugPort()
    const fixture = spawn(process.execPath, [`${REPO}/scripts/__fixtures__/impostor_dev_server.mjs`, c.fixture, String(fixturePort)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let fixtureErr = ''
    let fixtureExited = null
    fixture.stderr.on('data', (d) => { fixtureErr += d })
    fixture.on('exit', (code) => { fixtureExited = code })
    await sleep(900)
    if (fixtureExited !== null) {
      console.log(`HARNESS FAULT: the ${c.fixture} fixture died before the child ran (exit ${fixtureExited}${fixtureErr ? `: ${fixtureErr.trim().slice(0, 160)}` : ''}) - "not rejected" here would be a missing fixture, not a broken gate.`)
      results.push({ case: c.fixture, expectedExit: 2, actualExit: null, gateRejected: false, namedExpectedClause: false, harnessFault: 'fixture exited early' })
      continue
    }
    const url = `http://127.0.0.1:${fixturePort}/`
    const child = spawnSync(process.execPath, [SELF, 'ab', '--app', url, '--port', String(childPort)], { encoding: 'utf8', timeout: 180_000 })
    const output = `${child.stdout || ''}${child.stderr || ''}`
    const rejected = child.status === 2 && output.includes('PROJECT IDENTITY GATE FAILED')
    const namedClause = output.includes(c.expectClause)
    results.push({
      case: c.fixture, url, expectedExit: 2, actualExit: child.status,
      gateRejected: rejected, namedExpectedClause: namedClause, whyThisRedIsExpected: c.why,
      evidence: output.split('\n').filter((l) => /PROJECT IDENTITY|^  L\d|identity gate rejected|HARNESS FAULT|FAILED/.test(l)).slice(0, 4),
    })
    fixture.kill()
    if (fixtureErr) console.error(`fixture ${c.fixture} stderr: ${fixtureErr.trim()}`)
  }
  writeFileSync(`${OUT}/report-red-demo.json`, JSON.stringify(results, null, 2))
  for (const r of results) {
    console.log(`${r.gateRejected && r.namedExpectedClause ? 'OK  ' : 'FAIL'} ${r.case.padEnd(13)} exit=${r.actualExit} (want 2) rejected=${r.gateRejected} named=${r.namedExpectedClause}`)
    for (const line of r.evidence) console.log(`      ${line.trim()}`)
    console.log(`      why this red is expected: ${r.whyThisRedIsExpected}`)
  }
  const broken = results.filter((r) => !r.gateRejected || !r.namedExpectedClause)
  emitGate('red-demo', results.length, broken.length)
  console.log(`identity gate red demo: ${results.length - broken.length}/${results.length} alarms reproduced | reports: ${OUT}`)
  if (broken.length) console.error('The gate did NOT alarm. Treat this as a harness fault, not as a passing test.')
  process.exit(broken.length ? 2 : 0)
}


async function main() {
  await requireDevServer()
  launchBrowser()
  const page = await waitForTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
      if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails)
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        consoleErrors.push({ type: msg.params.type, text: msg.params.args.map((a) => a.description || a.value || a.type).join(' ') })
      }
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Target.setDiscoverTargets', { discover: true })

  const report = { mode: MODE, steps: [] }
  const record = (name, data) => report.steps.push({ name, ...data })
  // Gates run before anything is measured, and before waiting for the app to mount: an impostor
  // server never mounts it, so a gate placed after the mount wait spends 20s timing out first.
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!!document.body && (document.title !== '' || document.body.children.length > 0)`)) break
    await sleep(250)
  }
  console.log('VIEWPORT', JSON.stringify(await assertRealViewport('after-navigation')))
  report.identity = await assertProjectIdentity()
  report.provenance = buildProvenance()
  console.log('IDENTITY', JSON.stringify(report.identity))
  console.log('PROVENANCE', JSON.stringify(report.provenance))

  // wait for the React app to mount
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('nav button')`)
    if (ready) break
    await sleep(500)
  }
  await evaluate(HELPERS)
  await assertRealViewport('after-mount')
  await evaluate(`(function(){const c=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='关闭教程');if(c)c.click();return true;})()`)
  await sleep(300)

  // ---- go to Settings and open the confirm dialog with a trusted click ----
  const ALL_ROUTES = ['发布', '资源', '云端', '图库', '插件', '任务', '设置']
  const routeList = () => (opt('routes', '') ? opt('routes', '').split(',') : ALL_ROUTES)
  const goto = async (label) => {
    await scrollToAndClick(`(function(){const b=window.__H.byText('nav button', ${JSON.stringify(label)});if(!b)throw new Error('nav not found: '+Array.from(document.querySelectorAll('nav button')).map(x=>(x.textContent||'').trim()).join(','));return b;})()`)
    await sleep(250)
  }
  // Scroll an element (located by a page-side expression) into view and click its centre with
  // trusted input; returns the box actually used so the report can show the hit coordinates.
  const scrollToAndClick = async (locatorExpr) => {
    // styles.css sets scroll-behavior:smooth, so an instant scroll + a short settle poll is
    // required before reading the rect a trusted click will use.
    const box = await evaluate(`(async function(){const el=${locatorExpr};if(!el)throw new Error('locator null');el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});for(let i=0;i<20;i++){const r=el.getBoundingClientRect();if(r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth)return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,inView:true,settledAfterMs:i*50};await new Promise(res=>setTimeout(res,50))}const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,inView:false};})()`)
    if (!box.inView) {
      const why = await evaluate(`(function(){const el=${locatorExpr};const chain=[];let n=el;while(n&&n.tagName){const cs=getComputedStyle(n);chain.push({tag:n.tagName,cls:(n.className||'').toString().slice(0,40),oy:cs.overflowY,sh:n.scrollHeight,ch:n.clientHeight,st:n.scrollTop});n=n.parentElement}const b2=el.getBoundingClientRect();el.scrollIntoView({block:'center'});return {before:b2.y,after:el.getBoundingClientRect().y,innerH:innerHeight,docOY:getComputedStyle(document.documentElement).overflowY,bodyOY:getComputedStyle(document.body).overflowY,scrollingElement:(document.scrollingElement||{}).tagName,chain:chain.slice(0,10)};})()`)
      throw new Error('element not in view after scroll: ' + JSON.stringify({ box, why }))
    }
    await clickAt(box.cx, box.cy)
    return box
  }

  const openConfirm = async () => {
    await goto('设置')
    consoleErrors.length = 0
    await scrollToAndClick(`window.__H.byText('main button', '重置 Token')`)
    await sleep(250)
    const diag = await evaluate(`(function(){const d=window.__H.dialog();if(d)return {present:true,vp:[innerWidth,innerHeight]};const b=window.__H.byText('main button','重置 Token');return {present:false,vp:[innerWidth,innerHeight],visibility:document.visibilityState,btnFound:!!b,btnDisabled:b?b.disabled:null,btnBox:b?window.__H.box(b):null,heading:document.querySelector('main h1')?document.querySelector('main h1').textContent:null};})()`)
    if (!diag.present) throw new Error('confirm dialog did not open: ' + JSON.stringify(diag))
    return diag
  }

  if (MODE === 'confirm') {
    // freeze entrance animations before sampling geometry
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await openConfirm()
    await assertRealViewport('1-initial-focus')
    const s1 = await evaluate(`window.__H.state()`)
    record('1-initial-focus', { state: s1 })
    record('1b-pre-open-actionError-absent', { note: 'actionError is page-local; see step 2 absence test' })
    await shot('01-opened')

    // ---- Escape ----
    await pressEscape()
    const s2 = await evaluate(`({ ...window.__H.state(), settingsError: (function(){ const t=Array.from(document.querySelectorAll('main *')).map(e=>e.textContent||''); return t.some(x=>x.includes('Token')&&x.includes('失败')); })(), unhandled: ${JSON.stringify([])} })`)
    const stillThere = await evaluate(`!!window.__H.dialog()`)
    const errBox = await evaluate(`Array.from(document.querySelectorAll('main div,p,span')).map(e=>(e.textContent||'').trim()).filter(x=>x.length<200&&/失败|错误|Token/.test(x)).slice(0,8)`)
    record('2-escape', { dialogPresentAfterEscape: stillThere, settingsErrorNodes: errBox, consoleErrors: consoleErrors.slice(0, 5) })

    // ---- reopen, backdrop mouse-down ----
    await openConfirm()
    const overlayBox = await evaluate(`window.__H.box(window.__H.overlay())`)
    const hitBefore = await evaluate(`(function(){const o=window.__H.overlay();const el=document.elementFromPoint(8,8);return {tag:el.tagName, isOverlay: el===o, containsDialog: !!(el&&el.contains(window.__H.dialog()))};})()`)
    await pressAt(8, Math.min(8, overlayBox.h - 1))
    await sleep(150)
    const afterBackdrop = await evaluate(`!!window.__H.dialog()`)
    record('3-backdrop-mousedown', { hitTestAtCorner: hitBefore, dialogPresentAfterBackdropPress: afterBackdrop })

    // ---- reopen, mousedown inside dialog body must NOT close ----
    await openConfirm()
    const titleBox = await evaluate(`window.__H.box(window.__H.dialog().querySelector('h2'))`)
    await pressAt(titleBox.cx, titleBox.cy)
    await sleep(150)
    const afterInside = await evaluate(`!!window.__H.dialog()`)
    record('3b-inside-mousedown-keeps-open', { dialogPresentAfterPressingTitle: afterInside })

    // ---- reopen, X (关闭) button ----
    await openConfirm()
    const xBox = await evaluate(`window.__H.box(window.__H.buttons()[0])`)
    await clickAt(xBox.cx, xBox.cy)
    await sleep(150)
    const afterX = await evaluate(`!!window.__H.dialog()`)
    record('3c-x-button', { dialogPresentAfterCloseButton: afterX })

    // ---- reopen, Enter / Space on focused Cancel ----
    await openConfirm()
    const enterTest = []
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(200)
    enterTest.push(await evaluate(`!!window.__H.dialog()`) ? 'still-open' : 'closed')
    record('4-enter-activates-focused-cancel', { result: enterTest[0] })

    // ---- long text: Chinese filename + batch delete copy ----
    await openConfirm()
    const LONG = await evaluate(`(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p');
      const name = '关于进一步加强校园跑打卡系统整改工作的通知final-2026-v3(1).png';
      p.textContent = '确定永久删除选中的 128 个远端文件吗？\\n\\n' +
        '2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本.png\\n' +
        'IMG_20260928_141530_副本(2)(3).HEIC.png\\n' +
        '这是一段没有任何空格可以断开的超长中文文件名aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png\\n' +
        'https://example.com/very/long/path/segment/that/keeps/going/and/going/without/any/breaks/image-final-version-2026.png\\n' +
        '对应的 Publisher Deployment 状态会同步更新。';
      d.querySelector('h2').textContent = '批量永久删除 · 2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本.png';
      d.querySelectorAll('button')[2].textContent = '永久删除 128 个文件（含超长确认按钮文案测试）';
      window.__H.dialog().parentElement.offsetHeight;
      return window.__H.state();
    })()`)
    await assertRealViewport('4-long-text-1440')
    await shot('05-long-text-1440')
    const overflowInfo = await evaluate(`(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p'); const sec = d;
      const r = sec.getBoundingClientRect(); const pr = p.getBoundingClientRect();
      const bs = window.__H.buttons(); const confirm = bs[bs.length-1]; const cr = confirm.getBoundingClientRect();
      return {
        viewport: [window.innerWidth, window.innerHeight],
        sectionRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
        pRect: { w: Math.round(pr.width), h: Math.round(pr.height) },
        pScrollWidth: p.scrollWidth, pClientWidth: p.clientWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        confirmBtnRect: { x: Math.round(cr.x), right: Math.round(cr.right), w: Math.round(cr.width), bottom: Math.round(cr.bottom) },
        confirmFullyVisible: cr.right <= window.innerWidth && cr.bottom <= window.innerHeight && cr.x >= 0 && cr.y >= 0,
        sectionFullyVisible: r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.x >= 0 && r.y >= 0,
        documentHasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        pWhiteSpace: getComputedStyle(p).whiteSpace,
        lineCountFromRect: (()=>{ const nodes = Array.from(p.getClientRects()); return new Set(nodes.map(n=>Math.round(n.y))).size; })(),
      };
    })()`)
    record('4-long-text-1440', { overflow: overflowInfo, longState: { present: LONG.present, sectionWidth: LONG.sectionWidth } })

    const measure = `(function(){
      if (document.visibilityState !== 'visible' || innerWidth <= 0 || innerHeight <= 0) throw new Error('VIEWPORT GATE FAILED inside sampler: ' + document.visibilityState + ' ' + innerWidth + 'x' + innerHeight);
      const d = window.__H.dialog(); const p = d.querySelector('p'); const o = window.__H.overlay();
      const r = d.getBoundingClientRect(); const bs = window.__H.buttons(); const confirm = bs[bs.length-1]; const cr = confirm.getBoundingClientRect();
      const cancel = bs[bs.length-2].getBoundingClientRect(); const or = o.getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        section: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        pScrollWidth: p.scrollWidth, pClientWidth: p.clientWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        confirm: { x: Math.round(cr.x), y: Math.round(cr.y), right: Math.round(cr.right), bottom: Math.round(cr.bottom) },
        cancel: { x: Math.round(cancel.x), right: Math.round(cancel.right), w: Math.round(cancel.width) },
        buttonsOnSameRow: Math.abs(cr.y - cancel.y) < 4,
        confirmFullyVisible: cr.right <= innerWidth && cr.left >= 0 && cr.bottom <= innerHeight && cr.top >= 0,
        sectionFullyVisible: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0,
        overlayOverflowY: getComputedStyle(o).overflowY, overlayScrollable: o.scrollHeight > o.clientHeight,
        overlayScrollDelta: o.scrollHeight - o.clientHeight,
        docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`

    // The real reachable floor: tauri.conf.json minWidth 640 / minHeight 480. 420 is below that
    // floor and is measured only as the CSS contract at a narrow width, labelled as such.
    for (const [w, h, label] of [[420, 720, 'below-app-minimum-420x720'], [640, 480, 'app-minimum-640x480']]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await sleep(250)
      await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
      const sample = await assertRealViewport(`5-${label}`)
      const value = await evaluate(measure)
      await shot(`06-long-text-${w}x${h}`)
      record(`5-long-text-${label}`, { gate: sample, measured: value })
      if (w === 640) {
        await evaluate(`(function(){
          const p = window.__H.dialog().querySelector('p');
          const names = Array.from({length: 14}, (_, i) => '2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本-' + (i+1) + '.png');
          p.textContent = '确定永久删除选中的 14 个远端文件吗？\\n\\n' + names.join('\\n') + '\\n\\n对应的 Publisher Deployment 状态会同步更新。';
          return true;
        })()`)
        await sleep(150)
        await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
        const tallGate = await assertRealViewport('5-app-minimum-tall')
        const tall = await evaluate(measure)
        await shot('07-many-names-640x480')
        record('5-long-text-app-minimum-14-lines', { gate: tallGate, measured: tall })
      }
    }
    await send('Emulation.clearDeviceMetricsOverride')
    await sleep(200)

    // ---- z-index / stacking ----
    await evaluate(`(function(){const d=window.__H.dialog();if(d)window.__H.buttons()[window.__H.buttons().length-2].click();return true;})()`)
    await sleep(150)
    const z = {}
    // confirm overlay
    await openConfirm()
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await assertRealViewport('6-confirm-stacking')
    z.confirm = await evaluate(`(function(){const o=window.__H.overlay();const cs=getComputedStyle(o);return {z:cs.zIndex,pos:cs.position,chain:window.__H.stackingChain('[role=dialog][aria-modal="true"]'),order:Array.from(o.parentElement.children).map(c=>c.tagName+'.'+(c.className||'').toString().split(' ').filter(x=>x.startsWith('z-')||x==='fixed').join('+')).slice(-6),siblingIndex:Array.from(o.parentElement.children).indexOf(o),siblingCount:o.parentElement.children.length};})()`)
    await shot('08-confirm-open')
    z.confirmAt95 = true

    // Toast layer while the confirm is open. Plugins/Tasks call `invoke` unconditionally, so in a
    // plain browser they always fail and always raise a toast; a direct DOM click is used because
    // the confirm overlay would swallow a real pointer event on the sidebar.
    z.toastTrigger = []
    for (const route of ['插件', '任务']) {
      const fired = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('nav button')).find(x=>(x.textContent||'').trim()===${JSON.stringify(route)});if(!b)return 'nav missing';b.click();return 'clicked';})()`)
      z.toastTrigger.push(`${route}:${fired}`)
      await sleep(800)
      if (await evaluate(`(function(){const t=document.querySelector('.pointer-events-none.fixed.bottom-4');return !!t && t.children.length > 0})()`)) break
    }
    await assertRealViewport('6-toast-hit-test')
    z.toast = await evaluate(`(function(){const t=document.querySelector('.pointer-events-none.fixed.bottom-4');if(!t||!t.children.length)return {present:false, containerExists:!!t};const cs=getComputedStyle(t);const r=t.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2, Math.min(r.y+r.height/2, window.innerHeight-1));const o=window.__H.overlay();return {present:true,z:cs.zIndex,toasts:Array.from(t.children).map(c=>(c.textContent||'').trim().slice(0,90)),hitTestAtToastCenter:{tag:el&&el.tagName,isToastOrChild:t.contains(el),isConfirmOrChild:!!(o&&o.contains(el))},pointerEvents:cs.pointerEvents,confirmStillOpen:!!o,veilOverToast:o?{backgroundColor:getComputedStyle(o).backgroundColor,backdropFilter:getComputedStyle(o).backdropFilter||getComputedStyle(o).webkitBackdropFilter}:null};})()`)
    if (!z.toast.present) throw new Error('toast co-occurrence not reproduced: ' + JSON.stringify(z.toast))
    await shot('10-toast-behind-confirm')
    z.confirmStillOpen = await evaluate(`!!window.__H.dialog()`)

    // the two layers that genuinely tie at z-[95]: prove which one wins by source order
    await assertRealViewport('6-tie-hit-test')
    z.tie = await evaluate(`(function(){
      const o = window.__H.overlay();
      const synth = document.createElement('div');
      synth.className = 'fixed inset-0 z-[95] grid place-items-center bg-slate-950/30';
      synth.innerHTML = '<section style="width:200px;height:80px;background:#fff" data-synth="1"></section>';
      document.querySelector('main').appendChild(synth);
      const r = synth.getBoundingClientRect();
      const hit = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
      const res = {
        synthZ: getComputedStyle(synth).zIndex,
        synthIsAncestorOfMain: document.querySelector('main').contains(synth),
        hitAtViewportCentre: hit ? (hit.tagName + '.' + (hit.className||'').toString().split(' ').slice(0,3).join('.')) : null,
        hitInsideConfirm: !!(o && o.contains(hit)),
        hitIsSynth: !!(hit && (hit === synth || synth.contains(hit))),
        confirmOrderVsSynth: (()=>{ const c = Array.from(document.querySelectorAll('div.fixed.inset-0')); return c.indexOf(o) - c.indexOf(synth); })(),
      };
      synth.remove();
      return res;
    })()`)

    // real co-occurrence: UploadDialog (z-50) under the confirm overlay
    await evaluate(`(function(){const bs=window.__H.buttons();bs[bs.length-2].click();return true;})()`)
    await sleep(120)
    await goto('发布')
    const urlBtn = await scrollToAndClick(`Array.from(document.querySelectorAll('main button')).find(b=>(b.textContent||'').includes('图片 URL'))`)
    await sleep(250)
    await assertRealViewport('6-upload-dialog')
    z.uploadAlone = await evaluate(`(function(){const u=Array.from(document.querySelectorAll('div.fixed.inset-0')).find(d=>getComputedStyle(d).zIndex==='50');if(!u)return {present:false};return {present:true,z:getComputedStyle(u).zIndex,chain:window.__H.stackingChain('div.fixed.inset-0'),sectionMaxWidth:getComputedStyle(u.querySelector('section')).maxWidth};})()`)
    record('6-z-index-and-stacking', z)
    await shot('09-upload-dialog')
  }

  if (MODE === 'pages') {
    // Does a missing Tauri runtime take the page down? Visit every route with trusted clicks.
    const sweep = []
    for (const label of ['发布', '资源', '云端', '图库', '插件', '任务', '设置']) {
      consoleErrors.length = 0
      let entry = { label }
      try {
        await goto(label)
      } catch (e) {
        entry.gotoError = String(e).slice(0, 160)
      }
      await sleep(900)
      entry.after = await evaluate(`(function(){
        const root = document.getElementById('root');
        return {
          heading: document.querySelector('main h1') ? document.querySelector('main h1').textContent : null,
          rootChildren: root ? root.children.length : -1,
          rootTextLen: root ? (root.textContent||'').trim().length : -1,
          sidebarAlive: !!document.querySelector('nav button'),
          toastTexts: Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim().slice(0,140)),
        };
      })()`)
      entry.consoleErrors = consoleErrors.slice(0, 4).map((e) => (e.text || e.exception?.description || JSON.stringify(e)).slice(0, 220))
      entry.unhandledRejections = consoleErrors.filter((e) => e.type === 'error' && /invoke|TAURI|__TAURI/i.test(e.text || '')).length
      await shot(`p-${label}`)
      sweep.push(entry)
    }
    record('8-browser-only-route-sweep', sweep)
  }

  if (MODE === 'ab') {
    // Paired before/after in ONE viewport with ONE injected text: the fix is a single CSS
    // property, so toggling it back reproduces the pre-fix computed style exactly. That is
    // stronger evidence than two runs (same content, same moment, no drift in the rest of the page).
    await openConfirm()
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await assertRealViewport('ab:open')
    const inject = `(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p');
      p.textContent = '确定永久删除选中的 128 个远端文件吗？\\n\\n' +
        'a3f9c21be7d84f05c6b18d27ea49f30b5c8d7e12a6b4f90c3d5e7a1b2c4d6e8f0.png\\n' +
        'https://cdn.example.com/a/very/long/path/segment/that/keeps/going/without/any/breaks/final-version-2026.png\\n' +
        '对应的 Publisher Deployment 状态会同步更新。';
      return true;
    })()`
    const sample = `(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p'); const sec = d;
      const cs = getComputedStyle(p); const sr = sec.getBoundingClientRect(); const pr = p.getBoundingClientRect();
      const cardRight = Math.round(sr.right);
      // how far the painted text reaches past the card's right border
      let maxRight = 0; for (const r of p.getClientRects()) maxRight = Math.max(maxRight, r.right);
      const ranges = [];
      const node = p.firstChild;
      if (node && node.nodeType === 3) {
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, node.length);
        for (const r of range.getClientRects()) maxRight = Math.max(maxRight, r.right);
      }
      return {
        viewport: [innerWidth, innerHeight],
        overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak, whiteSpace: cs.whiteSpace,
        pClientWidth: p.clientWidth, pScrollWidth: p.scrollWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        cardRight, textReachesTo: Math.round(maxRight), paintedPastCardBy: Math.round(maxRight) - cardRight,
        cardWidth: Math.round(sr.width), cardHeight: Math.round(sr.height),
        docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ranges: ranges.length,
      };
    })()`
    const after = await evaluate(inject + `;${sample}`)
    await shot('ab-after-break-words')
    await evaluate(`(function(){const p=window.__H.dialog().querySelector('p');p.style.overflowWrap='normal';p.style.wordBreak='normal';window.__H.dialog().querySelector('h2').style.overflowWrap='normal';return true;})()`)
    await sleep(200)
    const beforeSample = await evaluate(sample)
    await shot('ab-before-break-words')
    record('ab-wrap-paired', { afterFix: after, beforeFix: beforeSample, deltaOverflowX: beforeSample.pOverflowX - after.pOverflowX })
    // ab used to exit 0 no matter what it measured - it reported a number and the aggregate's regex
    // decided what it meant. The assertion belongs here: with the fix in place the paragraph must
    // not overflow its own box, and the pre-fix sample must still show the overflow, otherwise the
    // pair proved nothing.
    const abBroken = []
    if (after.pOverflowX > 1) abBroken.push(`fixed state still overflows by ${after.pOverflowX}px`)
    if (beforeSample.pOverflowX - after.pOverflowX <= 1) abBroken.push(`the before/after pair is not discriminating (delta ${beforeSample.pOverflowX - after.pOverflowX}px)`)
    for (const b of abBroken) console.log(`FAIL ab: ${b}`)
    emitGate('ab', 1, abBroken.length, { deltaOverflowX: beforeSample.pOverflowX - after.pOverflowX })
    writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    finish(abBroken.length ? 1 : 0)
  }

  if (MODE === 'links') {
    // What the user actually sees at each of the three docs call sites, for whatever
    // VITE_DOCS_BASE_URL the dev server was started with. Tag comes from argv[4].
    const woCount = () => events.filter((e) => e.method === 'Page.windowOpen').length
    const tcCount = () => events.filter((e) => e.method === 'Target.targetCreated').length
    const readToasts = `(function(){return Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim())})()`
    const out = { baseEnv: await evaluate(`(async function(){const m=await import('/src/lib/desktop.ts');return {docsBaseUrl: m.getDocsBaseUrl(), providerGuideUrl: m.getProviderGuideUrl('github'), localApiGuideUrl: m.getLocalApiGuideUrl()}})()`), sites: {} }

    const sample = async (key, wo, tc) => ({
      ...out.sites[key],
      afterClick: {
        newWindowOpenEvents: woCount() - wo,
        newTabs: tcCount() - tc,
        urlsOpened: events.filter((e) => e.method === 'Page.windowOpen').slice(wo).map((e) => e.params.url),
        toastTexts: await evaluate(readToasts),
        consoleErrors: consoleErrors.slice(0, 4).map((e) => (e.text || JSON.stringify(e)).slice(0, 160)),
      },
    })

    const locate = (expr) => evaluate(`(function(){const b=${expr};if(!b)return {found:false};return {found:true,label:(b.textContent||'').trim(),aria:b.getAttribute('aria-label'),title:b.getAttribute('title')};})()`)
    const clickEl = (expr) => scrollToAndClick(`(function(){const b=${expr};if(!b)throw new Error('locator null');return b;})()`)

    // A: HelpCenterDialog
    consoleErrors.length = 0
    let wo = woCount(); let tc = tcCount()
    await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()")
    await sleep(400)
    out.sites.A_helpCenterDialog = await locate("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()")
    if (out.sites.A_helpCenterDialog.found) {
      await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()")
      await sleep(1600)
      out.sites.A_helpCenterDialog = await sample('A_helpCenterDialog', wo, tc).then((r) => ({ ...out.sites.A_helpCenterDialog, ...r }))
    }
    await shot(`lA-${TAG}`)
    await clickEl("(function(){return document.querySelector('button[aria-label=\"关闭教程\"]')})()")
    await sleep(300)

    // B: SettingsPage
    consoleErrors.length = 0
    wo = woCount(); tc = tcCount()
    await goto('设置')
    await sleep(500)
    out.sites.B_settingsPage = await locate("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码')})()")
    if (out.sites.B_settingsPage.found) {
      await clickEl("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码')})()")
      await sleep(1600)
      out.sites.B_settingsPage = await sample('B_settingsPage', wo, tc).then((r) => ({ ...out.sites.B_settingsPage, ...r }))
    }
    await shot(`lB-${TAG}`)

    // C: StorageSetupDialog (guide panel is collapsed until 配置教程 is clicked)
    consoleErrors.length = 0
    wo = woCount(); tc = tcCount()
    await goto('云端')
    await sleep(500)
    await clickEl("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='添加存储')})()")
    await sleep(500)
    await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim().startsWith('GitHub'))})()")
    await sleep(600)
    await clickEl(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='配置教程')})()`)
    await sleep(500)
    out.sites.C_storageSetupDialog = await locate(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return top?Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档'):null})()`)
    out.sites.C_storageSetupDialog.panelCopy = await evaluate(`(function(){
      const top = Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();
      if (!top) return null;
      const el = Array.from(top.querySelectorAll('div,p')).find(x=>(x.textContent||'').includes('教程内置在应用里'));
      return el ? (el.textContent||'').trim() : null;
    })()`)
    if (out.sites.C_storageSetupDialog.found) {
      await clickEl(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()`)
      await sleep(1600)
      out.sites.C_storageSetupDialog = await sample('C_storageSetupDialog', wo, tc).then((r) => ({ ...out.sites.C_storageSetupDialog, ...r }))
    }
    await shot(`lC-${TAG}`)

    out.openedTabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()))
      .filter((t) => t.type === 'page' && !t.url.startsWith(APP))
      .map((t) => ({ url: t.url.slice(0, 120), title: (t.title || '').slice(0, 70) }))
    record('links-under-this-base', out)
    writeFileSync(`${OUT}/report-links-${TAG}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 2))
    finish(0)
  }

  if (MODE === 'gate') {
    // The gate has to be demonstrated red under exactly the conditions that produced the bogus
    // 186.796875px card width, otherwise it is decoration.
    const attempts = []
    const tryIt = async (name, setup, expectFail) => {
      let outcome
      try {
        if (setup) await setup()
        const v = await assertRealViewport(name)
        outcome = { passed: true, viewport: v }
      } catch (e) {
        outcome = { passed: false, error: String(e.message).slice(0, 220) }
      }
      attempts.push({ name, expectedFail: expectFail, ...outcome, gateWorked: expectFail ? !outcome.passed : outcome.passed })
    }
    await tryIt('control', null, false)
    // Emulation.setVisibilityStateOverride does not exist in this Edge build, and
    // setDeviceMetricsOverride silently ignores width/height 0 - neither can reproduce the bad
    // reading, so neither is claimed as a demonstration. The minimized-window case below is real.
    let w = null
    try { w = await send('Browser.getWindowForTarget') } catch (e) { attempts.push({ name: 'window minimized', skipped: String(e.message).slice(0, 120) }) }
    if (w) {
      await send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'minimized' } })
      await sleep(700)
      await tryIt('window minimized', null, true)
      await send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'normal' } })
      await sleep(700)
      await tryIt('window restored', null, false)
    }
    record('gate-self-test', {
      attempts,
      notDemonstrable: [
        'innerWidth=0 could not be reproduced through CDP in headless (setDeviceMetricsOverride rejects/ignores 0); the branch is justified by the connector reading taken earlier this session: visibility=hidden, inner=[0,0], client=[0,0], screen=[0,0]',
        'Emulation.setVisibilityStateOverride is unavailable in this Edge build, so the visibility branch is exercised only through a genuinely minimized window',
      ],
    })
    const broken = attempts.filter((a) => a.gateWorked === false)
    const sawMinimizedReject = attempts.some((a) => a.name === 'window minimized' && a.passed === false && String(a.error).includes('VIEWPORT GATE FAILED'))
    if (!sawMinimizedReject) broken.push({ name: 'no real rejection observed' })
    writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ attempts, sawMinimizedReject, broken: broken.map((b) => b.name) }, null, 2))
    ws.close(); browser.kill()
    emitGate('gate', attempts.length, broken.length, { sawMinimizedReject })
    process.exit(broken.length ? 4 : 0)
  }

  if (MODE === 'visual') {
    // Visual baseline. Every number here is computed from the running app, not estimated from a
    // screenshot, so "it looks better now" can be checked by diffing two runs of this mode.
    await evaluate(VISUAL_PROBE)
    const surfaces = [
      { name: 'publish', open: async () => { await goto('发布') } },
      { name: 'help-center', open: async () => { await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()") } },
      { name: 'confirm', open: async () => { await openConfirm() } },
      { name: 'upload', open: async () => { await goto('发布'); await scrollToAndClick(`Array.from(document.querySelectorAll('main button')).find(b=>(b.textContent||'').includes('图片 URL'))`) } },
      { name: 'assets', open: async () => { await goto('资源') } },
      { name: 'storages', open: async () => { await goto('云端') } },
      { name: 'gallery', open: async () => { await goto('图库') } },
      { name: 'plugins', open: async () => { await goto('插件') } },
      { name: 'tasks', open: async () => { await goto('任务') } },
      { name: 'settings', open: async () => { await goto('设置') } },
    ]
    const clickEl = async (expr) => { await scrollToAndClick(expr); await sleep(400) }
    const baseline = { provenance: buildProvenance(), viewport: await assertRealViewport('visual:start'), fonts: await evaluate(`window.__V.fonts()`), palette: await evaluate(`window.__V.palette()`), surfaces: [] }
    for (const s of surfaces) {
      try { await s.open() } catch (error) { baseline.surfaces.push({ name: s.name, error: String(error).slice(0, 140) }); continue }
      await evaluate(`document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});true`)
      await sleep(150)
      await assertRealViewport('visual:' + s.name)
      const rootSel = s.name === 'help-center' ? `Array.from(document.querySelectorAll('div.fixed.inset-0')).sort((a,b)=>getComputedStyle(b).zIndex-a.zIndex||0)[0]`
        : s.name === 'confirm' ? `window.__H.overlay()`
        : s.name === 'upload' ? `Array.from(document.querySelectorAll('div.fixed.inset-0')).find(d=>getComputedStyle(d).zIndex==='50')`
        : `document.querySelector('main')`
      const shotPath = await shot(`vis-${s.name}`)
      const m = await evaluate(`(function(){
        const root = ${rootSel};
        if (!root) return { missing: true };
        const cards = root.querySelectorAll('article, section').length;
        return {
          rootClass: (root.className||'').toString().slice(0,60),
          cards,
          scale: window.__V.scale(root).slice(0, 10),
          shapes: window.__V.shapes(root),
          deadSpace: window.__V.deadSpace(root, 'article'),
          utilityDrift: window.__V.utilityDrift(root),
          sequences: window.__V.sequences(root),
          numeric: window.__V.numeric(root).slice(0, 8),
          heading: (root.querySelector('h1,h2')||{}).textContent || null,
        };
      })()`)
      // A dialog that scrolls hides half of its own evidence; capture the tail so the baseline
      // document can be checked against a picture rather than against the sampler's word.
      if (!m.missing) {
        m.scroll = await evaluate(`(function(){
          const root = ${rootSel}; if (!root) return null;
          const sc = [root, ...root.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY));
          if (!sc) return { scrollable: false, clientHeight: 0, scrollHeight: 0 };
          sc.scrollTop = sc.scrollHeight;
          return { scrollable: true, clientHeight: sc.clientHeight, scrollHeight: sc.scrollHeight, hiddenBelowPx: sc.scrollHeight - sc.clientHeight };
        })()`)
        if (m.scroll && m.scroll.scrollable) {
          await sleep(120)
          m.shotTail = await shot(`vis-${s.name}-tail`)
          await evaluate(`(function(){const root=${rootSel};const sc=[root,...root.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+8&&/auto|scroll/.test(getComputedStyle(e).overflowY));if(sc)sc.scrollTop=0;return true})()`)
          await sleep(80)
        }
      }
      baseline.surfaces.push({ name: s.name, shot: shotPath, ...m })
      if (s.name === 'help-center' || s.name === 'confirm' || s.name === 'upload') { await pressAt(8, 8); await sleep(250) }
    }
    writeFileSync(`${OUT}/visual-baseline.json`, JSON.stringify(baseline, null, 2))
    // A probe whose regex silently degrades (see the single-backslash trap in utilityDrift) reports
    // "no drift" exactly like a working probe does. Refuse to distinguish the two: if no element on
    // any surface carried a size utility, the probe is broken, not the app.
    const blind = baseline.surfaces.filter((s) => s.utilityDrift && s.utilityDrift.checked > 0 && s.utilityDrift.matched === 0)
    if (blind.length) {
      console.log(`HARNESS FAULT: the size-utility probe matched 0 of ${blind.map((s) => `${s.name}(${s.utilityDrift.checked})`).join(', ')} leaves - the selector is broken, so "no drift" is not a result.`)
      finish(2)
    }
    console.log('PALETTE', JSON.stringify(baseline.palette))
    // The onboarding dialog is the one interface this round was allowed to change, so its baseline
    // numbers are promoted from "reported" to "asserted": without this the mode measures a
    // regression and still exits 0, and "it looks better now" stays unverifiable.
    const hc = baseline.surfaces.find((s) => s.name === 'help-center')
    const regressions = []
    if (!hc || hc.missing) regressions.push('the onboarding dialog could not be opened')
    else {
      if (hc.shapes.belowAA.length) regressions.push(`${hc.shapes.belowAA.length} text runs below 4.5:1 (${hc.shapes.belowAA.map((x) => x.sample.slice(0, 10) + '@' + x.fontSize + '=' + x.contrast).join(', ')})`)
      const drifted = Object.values(hc.utilityDrift.drift).reduce((a, b) => a + b, 0)
      if (drifted) regressions.push(`${drifted} buttons render at a size their own class does not declare (${Object.keys(hc.utilityDrift.drift).join('; ')})`)
      if (hc.sequences.numberedItems) regressions.push(`a second numbered sequence reappeared next to the ${hc.sequences.steps} steps (${hc.sequences.ordinals.join(', ')})`)
      const tab = (hc.numeric || []).filter((n) => n.variant === 'tabular-nums').length
      if (hc.sequences.steps && tab !== hc.sequences.steps) regressions.push(`${hc.sequences.steps - tab} of ${hc.sequences.steps} STEP ordinals are not tabular-nums`)
    }
    for (const r of regressions) console.log(`FAIL ${r}`)
    // Machine-readable tally on every exit path, so verify:all can tell "4 regressions" from a run
    // that never reached the assertions.
    console.log(`VISUAL_GATE total=4 failed=${regressions.length}`)
    if (regressions.length) console.log(`visual: ${regressions.length} regression(s) on the onboarding dialog`)
    else console.log('visual: onboarding dialog holds its baseline (0 below 4.5:1, 0 discarded button sizes, 1 sequence, all ordinals tabular)')
    console.log(JSON.stringify({ viewport: baseline.viewport, fonts: baseline.fonts, surfaces: baseline.surfaces.map((x) => ({ name: x.name, cards: x.cards, sizes: (x.scale || []).length, belowAA: (x.shapes?.belowAA || []).length })) }, null, 2))
    emitGate('visual', 4, regressions.length)
    finish(regressions.length ? 1 : 0)
  }

  if (MODE === 'contrast-tier') {
    const t0 = Date.now()
    const cpu0 = process.cpuUsage()
    // Named-element readings. The floor-margin rule needs the wobble of the element that was
    // actually changed, and once that element passes it stops being the worst run on its face - so
    // the artifact kept the floor of some neighbour and the number the rule asks for did not exist.
    // --watch=<text> records every matching run in every combination, passing or not, so the
    // amplitude is that element's own and not borrowed from whoever happens to be worst.
    const watchNeedles = opt('watch', '') ? opt('watch', '').split(',').map((s) => s.trim()).filter(Boolean) : []
    const watchSeen = new Map()
    // What is actually stacked at a pixel. It used to be fetched only for the first three FAILING
    // runs, which makes it a field that exists in the artifact and is empty in every passing batch -
    // so the one question it answers ("is this paint or is this position") was unanswerable exactly
    // when the numbers looked fine. Now it is a shared helper, used by failures and by watch rows.
    const paintChainAt = (x, y) => evaluate(`(function(){const h=document.elementFromPoint(${x},${y});const chain=[];let n=h;for(let i=0;i<6&&n;i++){const cs=getComputedStyle(n);chain.push(n.tagName.toLowerCase()+(typeof n.className==='string'&&n.className?'.'+n.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+'{bg:'+cs.backgroundColor+',img:'+(cs.backgroundImage==='none'?'-':cs.backgroundImage.slice(0,28))+'}');n=n.parentElement}return chain.join(' < ')})()`)
    // The sweep's own wall clock, split by phase. Without this, "make the gate faster" can only be
    // answered by guessing, and the guess is usually wrong about which half costs anything.
    const cost = { nav: 0, quiet: 0, prep: 0, collect: 0, fixtures: 0, shot: 0, sample: 0 }
    // Which page load the quiescence wait was last satisfied for, and the text length it settled at.
    let quietFor = '', quietLen = -1
    // Contrast measured off rendered pixels, not off token pairs. The wallpaper is a user-supplied
    // image, so no fixed foreground can be reasoned about analytically; the envelope is the two
    // extreme images a user could pick - entirely black and entirely white - and the real page is
    // rendered behind each. Token-vs-token would report a number the user never sees.
    const THEMES = [['default', ''], ['midnight', 'midnight'], ['sakura', 'sakura']]
    const WALLS = [['none', 'none'], ['black', 'linear-gradient(#000,#000)'], ['white', 'linear-gradient(#fff,#fff)']]
    const ROUTES = routeList()
    const rows = []
    const failures = []
    // Document drift and app defects are different buckets and were printed as one number: a stale
    // row in VISUAL_BASELINE.md made CONTRAST_GATE say `below=3` when one surface was actually under
    // threshold. Both still stop the run; they just no longer borrow each other's count.
    const docDrift = []
    // Its own bucket, so `below` keeps meaning "runs below their threshold" and a denominator fault
    // cannot be read as a contrast finding, or the other way round.
    const denomFindings = []
    // A third bucket again, for the same reason: "the layout moved between the geometry read and the
    // photograph" makes that combination's pixels belong to a different layout than its coordinates.
    // That is neither a contrast finding nor a content difference, and folding it into either count
    // would let a stale sample be reported as an unreadable surface.
    const driftFindings = []
    const combosTotal = THEMES.length * WALLS.length * (ROUTES.length + 1)
    let comboIndex = 0
    const allControls = []
    const gridStats = { text: 0, disagreed: 0, centreWouldHaveMissed: 0, fallbacks: 0, worstDelta: 0, points: 0 }
    let controlDone = false
    // Six named control kinds, each measured against the surface it actually sits on (the pixel
    // photographed at its own centre), never against a neighbouring panel: a primary button's
    // background IS its surface. Classification reads the element's own classes/tag, so a new
    // button shape falls into `ghost` and is still judged rather than going uncounted.
    const controlKind = (c) => {
      if (c.tag === 'input' || c.tag === 'select' || c.tag === 'textarea') return 'field'
      if (/bg-red-(500|600|700)/.test(c.cls)) return 'danger-fill'
      if (/bg-\[var\(--accent\)\]|bg-indigo-(500|600|700)|bg-slate-950/.test(c.cls)) return 'primary-fill'
      if (/bg-(white|slate-(50|100))/.test(c.cls)) return 'subtle-fill'
      // Icon-only controls carry their name in title/aria-label, so the label is short and the box
      // is square: this is the one kind whose ink is a glyph, judged at 3:1 as non-text.
      if (c.text.length <= 8 && /\b(size-[89]|size-1[01]|p-1\.5|p-2)\b/.test(c.cls)) return 'icon'
      return 'ghost'
    }
    // One predicate, used by the text sweep, by the control sweep and by the control that proves
    // the sweep's own skip counters are live. Written as a string with a flag argument so the
    // control cannot end up testing a copy of the logic.
    // A cheap layout fingerprint: how many text-bearing elements there are, where their tops add up
    // to, and how tall the document is. Any reflow between the two reads moves at least one of the
    // three. No regex here on purpose - this string is injected, and a single backslash would be
    // eaten by the template and leave a fingerprint that silently never changes.
    const SIG = `(function(){var sel='p,span,div,button,a,li,h1,h2,h3,h4,label,td,th,code,pre',n=0,s=0;var all=document.querySelectorAll(sel);for(var i=0;i<all.length;i++){var e=all[i];var t=e.textContent||'';if(!t.trim())continue;var r=e.getBoundingClientRect();if(r.height<=0)continue;n++;s+=Math.round(r.top)}return {n:n,sumTop:s,doc:document.documentElement.scrollHeight,bodyH:document.body?document.body.scrollHeight:0}})()`
    // Read the live box of every element the sweep marked, with the SAME clamping the collector used,
    // so box-to-box comparison is apples-to-apples instead of "clamped versus unclamped". Returns
    // ctid -> [left, top, width, height]. An id that is absent is a row whose element is no longer on
    // the page, which is the strongest form of the same finding and must not be read as a match.
    const RECHECK = `(function(){var m=document.querySelectorAll('[data-ctid]'),o={};for(var i=0;i<m.length;i++){var e=m[i],r=e.getBoundingClientRect();var vx=Math.max(r.left,0),vy=Math.max(r.top,0);o[e.getAttribute('data-ctid')]=[Math.round(vx),Math.round(vy),Math.round(Math.min(r.right,innerWidth)-vx),Math.round(Math.min(r.bottom,innerHeight)-vy)]}return o})()`
    // One pixel of one photograph, read back the same way the sampler reads it. Used only on a
    // combination already found stale, to ask the question the first screenshot cannot answer about
    // itself: which layout does it actually show?
    const PIXEL_AT = `(async function(b64,x,y){const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src='data:image/png;base64,'+b64});const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const c=cv.getContext('2d');c.drawImage(img,0,0);const d=c.getImageData(Math.round(x),Math.round(y),1,1).data;return [d[0],d[1],d[2]]})`
    // Name the block that appeared or vanished, instead of inferring it from "the only other thing
    // that differs between combinations". Walks the moved element's own section and lists what sits
    // above it with real heights and margins.
    const BLOCKS_AROUND = `(function(el){let sec=null,n=el;for(let i=0;i<10&&n;i++){if(n.tagName==='SECTION'){sec=n;break}n=n.parentElement}if(!sec)return {found:false};const own=sec.getBoundingClientRect();const above=[];let p=sec.previousElementSibling;for(let j=0;j<4&&p;j++){const cs=getComputedStyle(p);const r=p.getBoundingClientRect();above.push(p.tagName.toLowerCase()+(typeof p.className==='string'&&p.className?'.'+p.className.trim().split(/\\s+/).slice(0,3).join('.'):'')+'{top:'+Math.round(r.top)+' h:'+Math.round(r.height)+' mt:'+cs.marginTop+' mb:'+cs.marginBottom+'}');p=p.previousElementSibling}return {found:true,secTop:Math.round(own.top),sec:sec.tagName.toLowerCase()+(typeof sec.className==='string'?'.'+sec.className.trim().split(/\\s+/).slice(0,3).join('.'):''),above:above}})`
    // `rectMoved` and `layoutDrift` are defined at module scope, next to their fixture tables, so the
    // sweep and `gate-unit` cannot drift apart into two copies of the same comparison.
    const COLLECT_TEXTS = `(function(controls, dialogOnly){
            // Monotonic and page-global: the text sweep and the control sweep are two calls over the same page, and a
            // per-call counter plus a clear-at-start wiped the first call marks, so every text row came back
            // with "no sampled point belonged to this run" - the ownership test was rejecting its own rows.
            const out=[]; let offcanvas=0, occluded=0, clipped=0, offscreen=0, nonText=0, containers=0, foreignOnly=0; const occlBy={};
            // dialogOnly narrows the sweep to the dialog subtree. Without it the "对话框" face also collected
            // the page behind the dialog, because main/aside/header are in the base selector list - which went
            // unnoticed while an error-toast stack was occluding most of that page, and showed up the moment the
            // toasts stopped being re-raised: the row went from 5 runs to 37 and its worst ratio moved with it.
            const SEL_TEXT = dialogOnly ? '[role=dialog] *' : 'main *, aside *, header *, [role=dialog] *'
            const SEL_CTL = dialogOnly ? '[role=dialog] button, [role=dialog] input, [role=dialog] a, [role=dialog] select' : 'main button, main input, main a, main select, aside button, aside input, header button, [role=dialog] button, [role=dialog] input, [role=dialog] a, [role=dialog] select'
            for (const e of document.querySelectorAll(controls ? SEL_CTL : SEL_TEXT)) {
              if (!controls && e.children.length) continue;
              // A form control has no rendered ink of its own in the text sense: an input's textContent is
              // empty and its value is a string the browser may not paint at all (a checkbox's value is
              // literally "on"). Collected as "readable text" it scored the glyph's own colour against the
              // accent fill the browser paints, and produced a 1.04:1 finding that describes nothing.
              if (!controls && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.tagName)) continue;
              if (controls && e.disabled) continue;
              // A checkbox/radio/range carries no ink of its own - its textContent is the literal
              // value "on". Judging it as a text run invents a failure and hides the real one, which
              // is that the browser paints the control from its own palette. Counted, reported, and
              // checked separately via color-scheme.
              if (controls && e.tagName === 'INPUT' && /^(checkbox|radio|range|color|file|submit|reset|button)$/.test(e.type || '')) { nonText++; continue }
              const ownText=Array.from(e.childNodes).some(function(n){ return n.nodeType===3 && (n.textContent||'').trim().length>0 });
              // A wrapper button whose label is the concatenation of its descendants has no ink of its
              // own: sampling its box reads the big gradient icon tile inside it and calls the button's
              // inherited colour unreadable - the drop-zone button was reported at 1.76:1 against
              // rgb(52,42,172), a pixel that belongs to a decoration, not to any glyph. The descendant
              // text rows are already in the sweep, so the container is skipped and counted.
              if (controls && !ownText && (e.textContent || '').trim()) { containers++; continue }
              const t=(e.textContent||e.value||e.getAttribute('aria-label')||e.getAttribute('title')||e.placeholder||'').trim(); if(!t) continue;
              const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
              // Counted separately from clipped: a run entirely outside the fold is neither
              // judged nor excused here - it is simply out of this sweep's reach, and the report
              // has to say how many of them there are.
              if (r.bottom<2||r.top>innerHeight-2||r.right<2||r.left>innerWidth-2) { offscreen++; continue };
              const cs=getComputedStyle(e);
              if (cs.visibility==='hidden'||Number(cs.opacity)<0.9) continue;
              // The ink lives where the glyphs are, not in the border box. A paragraph that contains
              // a grey <code> chip has a box covering the chip, but no ink of its own sits on the
              // chip - sampling the box called that 4.44:1 while the sentence next to it is on the
              // card at 6:1. Each direct text node's own client rects are the surface a reader
              // actually sees behind that run, so those are the sample region.
              const inkRaw=[];
              for (const n of e.childNodes) {
                if (n.nodeType!==3 || !(n.textContent||'').trim()) continue;
                try { const rg=document.createRange(); rg.selectNodeContents(n);
                  for (const q of rg.getClientRects()) if (q.width>=2&&q.height>=2) inkRaw.push([q.left,q.top,q.width,q.height]);
                } catch (err) {}
              }
              // Clamped to the element's own box: a Range reports the layout rect of the whole line,
              // which sticks out of a truncated or overflow-hidden element. Sampling out there would
              // judge the ink against a surface the run is never painted on.
              const ink=inkRaw.map((q) => {
                const x=Math.max(q[0], r.left), y=Math.max(q[1], r.top)
                const x2=Math.min(q[0]+q[2], r.right), y2=Math.min(q[1]+q[3], r.bottom)
                return [Math.round(x), Math.round(y), Math.round(Math.max(0, x2-x)), Math.round(Math.max(0, y2-y))]
              }).filter((q) => q[2]>=2 && q[3]>=2);
              const radius=Math.max(parseFloat(cs.borderTopLeftRadius)||0, parseFloat(cs.borderTopRightRadius)||0, parseFloat(cs.borderBottomLeftRadius)||0, parseFloat(cs.borderBottomRightRadius)||0);
              if (!ink.length) {
                // No text node of its own (an icon button named through title/aria-label): the whole
                // border box is the candidate region, and here the rounded corner does matter - a
                // point inside the geometric corner is outside the painted fill and reads the card
                // behind the button, which is how white-on-white got reported as 1:1.
                const pad=Math.min(Math.max(2, Math.ceil(radius) + 1), Math.max(2, Math.floor(Math.min(r.width, r.height) / 2) - 1));
                ink.push([Math.round(r.left + pad), Math.round(r.top + pad), Math.round(Math.max(0, r.width - 2 * pad)), Math.round(Math.max(0, r.height - 2 * pad))]);
              }
              // The centre of the element is NOT a valid sample point: an element that is half
              // scrolled out has its centre outside the captured canvas, and getImageData there
              // returns transparent black - which this gate then reported as a real 1.31:1 defect
              // over a "rgb(0,0,0)" background. Sample the centre of the part the user can see, and
              // refuse the row when that part is too small to carry ink.
              const vx=Math.max(r.left,0), vy=Math.max(r.top,0), vw=Math.min(r.right,innerWidth)-vx, vh=Math.min(r.bottom,innerHeight)-vy;
              if (vw<4||vh<4) { clipped++; continue }
              const x=Math.round(vx+vw/2), y=Math.round(vy+vh/2);
              if (x<0||y<0||x>=innerWidth||y>=innerHeight) { offcanvas++; continue }
              const hit=document.elementFromPoint(x,y);
              if (!hit || !(hit===e||e.contains(hit)||hit.contains(e))) {
                occluded++;
                // A skip counter without a name is how "we silently judged half the page" hides itself.
                const key = hit ? hit.tagName.toLowerCase() + '.' + String(typeof hit.className === 'string' ? hit.className : '').slice(0, 40).trim() : 'null'
                occlBy[key] = (occlBy[key] || 0) + 1
                continue
              }
              // Ownership is decided HERE, next to the geometry it is derived from, and the surviving
              // points are stored. Deciding it later meant comparing stored rects against a live DOM
              // that had already moved (the sidebar transitions its width, a toast can reflow the page),
              // and 37 ordinary rows came back as "no point belongs to this run" - the filter was
              // rejecting its own rows, not a neighbour's pixels. The mark has to exist before the
              // loop that asks who owns a pixel, which the first version of this block got wrong.
              const pts = []
              let foreign = 0
              for (const q of ink) {
                const x0 = Math.max(0, q[0]), y0 = Math.max(0, q[1])
                const x1 = Math.min(innerWidth - 1, q[0] + q[2] - 1), y1 = Math.min(innerHeight - 1, q[1] + q[3] - 1)
                if (x1 < x0 || y1 < y0) continue
                const fw = x1 - x0, fh = y1 - y0
                const stepX = Math.max(3, Math.ceil(fw / 10)), stepY = Math.max(3, Math.ceil(fh / 6))
                const xs = []
                for (let dx = 0; dx < fw; dx += stepX) xs.push(dx)
                if (!xs.length || xs[xs.length - 1] !== fw) xs.push(fw)
                const ys = []
                for (let dy = 0; dy < fh; dy += stepY) ys.push(dy)
                if (!ys.length || ys[ys.length - 1] !== fh) ys.push(fh)
                for (const dy of ys) for (const dx of xs) {
                  const px = x0 + dx, py = y0 + dy
                  const h = document.elementFromPoint(px, py)
                  if (!h) { foreign++; continue }
                  if (h === e) { pts.push([px, py]); continue }
                  // A descendant still counts only when it paints nothing of its own. The last six
                  // failures were one caption judged on an inline chip nested inside it: closest()
                  // said "mine" because the chip is a child, while the pixel was the chip's own
                  // slate-200 fill - so the run was scored against a surface none of its glyphs
                  // touch. An svg (no background, no fill of its own) stays owned, which is what
                  // keeps icon buttons in the sweep.
                  if (!(e.contains(h))) { foreign++; continue }
                  const hs = getComputedStyle(h)
                  const paints = (hs.backgroundColor && hs.backgroundColor !== 'rgba(0, 0, 0, 0)' && hs.backgroundColor !== 'transparent')
                    || (hs.backgroundImage && hs.backgroundImage !== 'none')
                    || (hs.opacity && Number(hs.opacity) < 1)
                  if (paints) foreign++; else pts.push([px, py])
                }
              }
              if (!pts.length) { foreignOnly++; continue }
              const size = parseFloat(cs.fontSize);
              const bold=Number(cs.fontWeight)>=600;
              // cls is reported so a failure names its call site; without it the only way back to
              // the source is the composited rgb(), which cannot distinguish two shades that round
              // to the same triple.
              // The ancestor paint stack, walked from the SAME elementFromPoint result in the SAME
              // evaluation that produced the geometry. Fetching it in a later round trip is how the
              // chain ended up describing a page that had already reflowed: on the anomalous readings
              // the panel was missing from the chain entirely, which a repaint cannot do to a hit
              // test but a stale coordinate does to both at once.
              const chain=[]; { let n=hit; for (let i=0;i<6&&n;i++){ const c2=getComputedStyle(n); chain.push(n.tagName.toLowerCase()+(typeof n.className==='string'&&n.className?'.'+n.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+'{bg:'+c2.backgroundColor+',img:'+(c2.backgroundImage==='none'?'-':c2.backgroundImage.slice(0,28))+'}'); n=n.parentElement } }
              // Mark the element itself, first write wins, so the photograph and the coordinates can be
              // compared against THAT element afterwards. A page-level fingerprint can say "something
              // reflowed somewhere" and cannot say whether it moved the element whose pixel I sampled;
              // the two sweeps share one id per element, so a run collected by both is checked twice
              // against the same live rect.
              let ctid = Number(e.getAttribute('data-ctid') || 0); if (!ctid) { ctid = (window.__CTID = (window.__CTID || 0) + 1); e.setAttribute('data-ctid', String(ctid)) }
              out.push({ pts, foreign, kind: controls ? 'control' : 'text', text:t.slice(0,26), size, bold, color:cs.color, cls:(typeof e.className==='string'?e.className:'').slice(0,120), tag:e.tagName.toLowerCase(), threshold: (size>=24&&bold)?3:4.5, x, y, box:[vx,vy,vw,vh], ink, rects:ink.length, bgi:cs.backgroundImage.slice(0,60), hit:hit.tagName.toLowerCase()+((typeof hit.className==='string'?hit.className:'').slice(0,50)), chain: chain.join(' < '), ctid });
            }
            return { rows: out.slice(0, 400), skipped: { clipped, offcanvas, occluded, offscreen, nonText, containers, foreignOnly }, occlBy, truncated: Math.max(0, out.length-400) };
          })`
    // The pixel sampler, kept as a page-side function so the sweep and the control that proves the
    // sweep works execute the SAME code - a control measured against a copy of the logic proves the
    // copy, not the logic.
    const SAMPLE_FN = `(async function (b64, items) {
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64 });
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
            const lum = (c) => { const g = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * g(c[0]) + 0.7152 * g(c[1]) + 0.0722 * g(c[2]) }
            // Canvas, not a regex: Tailwind v4 serialises colours as oklch()/color-mix(), which an
            // rgb() matcher silently drops - that is what made 179 of 314 runs "unresolved" here.
            const pcv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
            const parse = (s) => {
              if (!s || s === 'transparent' || s === 'none') return null
              pcv.fillStyle = '#010203'; pcv.fillStyle = s
              const norm = String(pcv.fillStyle)
              if (norm === '#010203' || norm === 'rgb(1, 2, 3)') return null
              pcv.clearRect(0, 0, 1, 1); pcv.fillStyle = norm; pcv.fillRect(0, 0, 1, 1)
              const d = pcv.getImageData(0, 0, 1, 1).data
              return [d[0], d[1], d[2], d[3] / 255]
            }
            // A canvas pixel with alpha 0 is NOT black: it is unpainted. Read as rgb(0,0,0) it gave
            // every light foreground a 1.04:1 "failure" over a fake black background, and the numbers
            // were internally impossible (white ink on black is 20:1, not 1.04:1) - which is how the
            // bug was caught. Unpainted points are excluded and counted; a row whose every point is
            // unpainted is unresolved, which stops the run, rather than a fabricated finding.
            const at = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[3] < 250 ? null : [d[0], d[1], d[2]] }
            const ratioOf = (f, bg) => {
              const a = f[3]
              const over = [f[0] * a + bg[0] * (1 - a), f[1] * a + bg[1] * (1 - a), f[2] * a + bg[2] * (1 - a)]
              const l1 = Math.max(lum(over), lum(bg)), l2 = Math.min(lum(over), lum(bg))
              return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
            }
            return items.map((t) => {
              if (t.x >= img.width || t.y >= img.height) return { ...t, ratio: null, why: 'sample point outside the captured canvas' }
              // The points were chosen where the run's own glyphs are, and only those the run paints
              // over - both decided in the page at collection time (see COLLECT_TEXTS). What is left
              // here is reading pixels: one raster grab per fragment rather than per point, because
              // this sweep covers ~2700 rows x 72 combinations and a per-pixel getImageData turned a
              // 12-minute gate into something nobody would run. The cost printed on CONTRAST_GATE
              // exists because a gate that is too expensive dies the same way a blind one does.
              const f = parse(t.color)
              if (!f) return { ...t, bg: 'n/a', ratio: null, why: 'unparsable colour' }
              const pts = (t.pts || []).filter((p) => p[0] < img.width && p[1] < img.height)
              if (!pts.length) return { ...t, ratio: null, why: 'no owned point inside the captured canvas (foreign=' + t.foreign + ')' }
              let worst = null, worstBg = null, best = null, points = 0, unpainted = 0
              for (const [px, py] of pts) {
                const bg = at(px, py)
                if (!bg) { unpainted++; continue }
                const r = ratioOf(f, bg)
                points++
                if (worst === null || r < worst) { worst = r; worstBg = bg }
                if (best === null || r > best) best = r
              }
              if (!points) return { ...t, bg: 'unpainted', ratio: null, why: 'every owned canvas point was unpainted (' + unpainted + ')' }
              const centreBg = at(t.x, t.y)
              const a = f[3]
              return { ...t, bg: worstBg.join(','), fg: [f[0] * a + worstBg[0] * (1 - a), f[1] * a + worstBg[1] * (1 - a), f[2] * a + worstBg[2] * (1 - a)].map((v) => Math.round(v)).join(','), ratio: worst, bestRatio: best, centreRatio: centreBg ? ratioOf(f, centreBg) : null, centreBg: centreBg ? centreBg.join(',') : 'unpainted', sampledPoints: points, unpainted, inkRects: t.rects, fellBack: !t.rects, spread: Math.round((best - worst) * 100) / 100 }
            })
          })`
    // Without this, clipped=0/occluded=0 in the report means either "nothing was hidden" or "the
    // branch was never reachable", and the two are indistinguishable from the output.
    const SWEEP_CONTROL = `(function(){
      const collect = window.__COLLECT
      const before = collect(false).skipped
      const host = document.querySelector('main') || document.body
      // 400px below the fold: must land in the offscreen counter.
      const below = document.createElement('div')
      below.style.cssText = 'position:absolute;left:8px;top:' + (innerHeight + 400) + 'px;width:220px;height:20px;font-size:12px'
      below.textContent = 'LCTL offscreen caption'
      // Straddling the fold edge with 3px showing: too little ink to sample, must land in clipped.
      const straddle = document.createElement('div')
      straddle.style.cssText = 'position:absolute;left:8px;top:' + (innerHeight - 3) + 'px;width:220px;height:40px;font-size:12px'
      straddle.textContent = 'LCTL straddling caption'
      const under = document.createElement('div')
      under.style.cssText = 'position:fixed;left:40px;top:120px;width:180px;height:26px;font-size:12px;background:transparent'
      under.textContent = 'LCTL occluded caption'
      const over = document.createElement('div')
      over.style.cssText = 'position:fixed;left:30px;top:110px;width:220px;height:60px;background:var(--app-bg);z-index:50'
      host.appendChild(below); host.appendChild(straddle); host.appendChild(under); document.body.appendChild(over)
      const after = collect(false).skipped
      const leaked = collect(false).rows.filter((r) => r.text.indexOf('LCTL') === 0)
      below.remove(); straddle.remove(); under.remove(); over.remove()
      return { before, after, leakedIntoSweep: leaked.map((r) => r.text), controlRows: collect(true).rows.length }
    })`

    const applyTheme = (t) => evaluate(`(function(){const r=document.documentElement;if(${JSON.stringify(t)})r.dataset.theme=${JSON.stringify(t)};else delete r.dataset.theme;return r.dataset.theme||'default'})()`)
    const applyWall = (w) => evaluate(`(function(){const r=document.documentElement;if(${JSON.stringify(w)}==='none'){r.style.setProperty('--wallpaper','none');delete r.dataset.wallpaper}else{r.style.setProperty('--wallpaper',${JSON.stringify(w)});r.dataset.wallpaper='true'}return r.dataset.wallpaper==='true'?'on':'off'})()`)
    // Resolve after n painted frames. Used instead of a fixed sleep wherever the thing being waited
    // for is "the browser has drawn the change": a constant has to be sized for the slowest machine
    // and still returns too early on that machine, while paying on every fast one.
    const frames = (n) => evaluate(`new Promise(function(r){var left=${n || 1};function step(){if(--left<=0){r(1)}else{requestAnimationFrame(step)}}requestAnimationFrame(step)})`)

    const EXPECTED_BG = { default: '#f6f7fb', midnight: '#090d16', sakura: '#fff8fb' }
    for (const [themeName, themeValue] of THEMES) {
      await applyTheme(themeValue)
      // A cream background under midnight tokens would read as a contrast failure the app does not
      // have, so confirm the theme actually took before believing anything measured under it.
      const applied = await evaluate(`(function(){const cs=getComputedStyle(document.documentElement);return {attr:document.documentElement.dataset.theme||'default',appBg:cs.getPropertyValue('--app-bg').trim(),surface:cs.getPropertyValue('--surface').trim()}})()`)
      if (applied.attr !== themeName || applied.appBg.toLowerCase() !== EXPECTED_BG[themeName]) {
        console.log(`HARNESS FAULT: asked for theme "${themeName}" but the document reports attr="${applied.attr}" --app-bg=${applied.appBg} (expected ${EXPECTED_BG[themeName]}); the app re-applied its own theme, so nothing under it is attributable.`)
        finish(2)
      }
      // Native form controls are the one surface the CSS tokens cannot reach, so the theme has to
      // announce its polarity to the browser as well. This is the assertion that makes the
      // checkbox skip in the sweep safe: the control is not judged as text, but it IS judged for
      // following the theme.
      const native = await evaluate(`(function(){
        const scheme = getComputedStyle(document.documentElement).colorScheme;
        const boxes = Array.from(document.querySelectorAll('main input, aside input')).filter(function(i){ return /^(checkbox|radio)$/.test(i.type) });
        const dark = /(^|\\s)dark(\\s|$)/.test(scheme);
        return { scheme: scheme, dark: dark, boxes: boxes.length };
      })()`)
      const wantDark = themeValue === 'midnight'
      if (native.dark !== wantDark) {
        console.log(`NATIVE-CONTROLS ${themeName}: color-scheme resolves to "${native.scheme}" but this theme is ${wantDark ? 'dark' : 'light'}; ${native.boxes} checkbox/radio control(s) would be painted from the browser's opposite palette.`)
        failures.push(`NATIVE-CONTROLS ${themeName}: color-scheme="${native.scheme}" (want ${wantDark ? 'dark' : 'light'}), ${native.boxes} native box(es) on the page`)
      }
      // (a) token against token, for the record - the number a reader would compute by hand.
      const tokens = await evaluate(`(function(){
        const cs=getComputedStyle(document.documentElement);
        const g=(n)=>cs.getPropertyValue(n).trim();
        return { muted: g('--text-muted'), secondary: g('--text-secondary'), primary: g('--text-primary'), surface: g('--surface'), soft: g('--surface-soft'), appBg: g('--app-bg') };
      })()`)
      // Route-major, wallpaper-minor. A wallpaper is a custom property on documentElement, so the
      // page stays mounted and only repaints; navigating between surfaces is what actually costs.
      // The first version looped wallpaper-major and paid 576 page loads for what 192 measure
      // identically - PHASE-COST put nav at 32.5s of 49.8s, which is why the loops are ordered this
      // way and not the other. Readings to prove "identically": measured/points/below must not move.
      for (const label of ROUTES.concat(['对话框'])) {
        if (budgetHits) break
        // The confirm dialog is appended as an eighth surface rather than a separate pass because
        // it is the only place this app puts a filled primary button, a filled danger button and an
        // icon-only button all together; without it three of the six control kinds are unmeasured
        // and the table reports n/a, which is not a pass.
        const tNav = Date.now()
        const dialogFace = label === '对话框'
        // The dialog face is not navigated here: openConfirm() does its own goto plus click, and a
        // page load resets the wallpaper, so it has to run inside the pass that sets it. Measured,
        // not assumed - with the open hoisted out of the wallpaper loop, pass 1 saw the dialog
        // (rows=5) and pass 2 saw none, and the assertion below stopped the run.
        if (!dialogFace) await goto(label)
        cost.nav += Date.now() - tNav
        for (const [wallName, wallValue] of WALLS) {
          if (DEADLINE_MS && Date.now() - RUN_STARTED > DEADLINE_MS) {
            budgetHits++
            console.log(`BUDGET: stopping the grid after ${comboIndex}/${combosTotal} combinations at ${Math.round((Date.now() - RUN_STARTED) / 1000)}s of a ${Math.round(DEADLINE_MS / 1000)}s budget. The remaining ${combosTotal - comboIndex} are UNMEASURED, not clean.`)
            break
          }
          // Where the sweep's own wall clock goes. Printed as PHASE-COST on its line, because the
          // alternative is guessing which of "navigate / wait / collect / photograph / sample" to
          // optimise - and the guess (sampling, for anyone reading this) was wrong: it is navigation.
          let mark = Date.now()
          if (dialogFace) await openConfirm()
          await applyWall(wallValue)
          cost.nav += Date.now() - mark; mark = Date.now()
          await evaluate(`window.__L ? window.__L.settle() : document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});true`)
          await frames(2)
          // A toast is a transient overlay whose drop shadow paints onto whatever is underneath it.
          // The six "settings caption at 4.12:1" findings this sweep printed were exactly that: four
          // `invoke is undefined` error toasts sit over the page in a browser-only harness, and their
          // shadow put the tail of one caption on rgb(224,224,224) - a pure grey that no theme in this
          // app paints and that did not move between the wallpaper extremes. So the stack is dismissed
          // before each surface is captured, and the emptiness is asserted rather than assumed: a
          // reading taken under an overlay has to say so on its own line.
          const toastClear = await evaluate(`(async function(){
            try {
              const m = await import('/src/store/useToastStore.ts');
              const s = m.useToastStore.getState();
              const before = s.toasts.length;
              s.toasts.slice().forEach(function(t){ s.dismiss(t.id) });
              // A query that has not failed yet can raise a toast after this call returns, so
              // dismissing alone is a race: one run printed "1 toast node still painted after
              // dismissing 0". The store is emptied to keep the DOM from accumulating, and the
              // overlay is taken out of the paint so the property being asserted is one the sweep
              // actually controls.
              var st = document.getElementById('sweep-no-overlay');
              if (!st) { st = document.createElement('style'); st.id = 'sweep-no-overlay'; st.textContent = '[role=alert],[role=status]{display:none !important}'; document.head.appendChild(st) }
              return { before: before, after: m.useToastStore.getState().toasts.length };
            } catch (e) { return { error: String(e) } }
          })()`)
          // Wait for the thing the next line asserts, not for a fixed 120ms.
          let toastNodes = 0
          for (let attempt = 0; attempt < 20; attempt++) {
            await frames(1)
            toastNodes = await evaluate(`Array.prototype.filter.call(document.querySelectorAll('[role=alert],[role=status]'), function(n){ return n.offsetParent !== null }).length`)
            if (!toastNodes) break
            await sleep(25)
          }
          if (toastClear.error) {
            console.log(`HARNESS FAULT: cannot dismiss the toast stack before sampling (${toastClear.error}); an overlay's shadow would be measured as if it were the page's surface.`)
            finish(2)
          }
          if (toastNodes) {
            console.log(`HARNESS FAULT: ${toastNodes} toast node(s) still painted on ${themeName}/${wallName}/${label} after dismissing ${toastClear.before}; this combination's surface readings are taken under an overlay and are not attributable to the theme.`)
            finish(2)
          }
          cost.prep += Date.now() - mark; mark = Date.now()
          // Wait for the page to stop changing before it is photographed. The sweep's own denominator
          // was drifting run to run (1890 / 1921 / 1923 readable rows) because this app renders an error
          // banner for every query that has failed so far, and in a browser-only harness those failures
          // land asynchronously. A gate whose candidate set depends on which races won cannot have its
          // output pinned in a document, so the reading is taken from a quiet page: three consecutive
          // samples of the same text length, or the run says so and stops.
          // The full wait runs once per page load, not once per wallpaper pass - what moves is the
          // async error state, and the wallpaper is a custom property on the same mounted document.
          // Later passes pay one comparison and fall back to the full wait if the text moved anyway.
          let quiet = null
          if (quietFor === `${themeName}|${label}` && quietLen === await evaluate(`document.body.innerText.length`)) {
            quiet = { stable: true, waited: 0, len: quietLen }
          }
          if (!quiet) {
            let last = -1, stable = 0, waited = 0
            while (waited < 4000) {
              const len = await evaluate(`document.body.innerText.length`)
              if (len === last) { if (++stable >= 3) { quiet = { stable: true, waited, len }; break } } else { stable = 0; last = len }
              await sleep(120); waited += 120
            }
            if (!quiet) quiet = { stable: false, waited, len: last }
            quietFor = `${themeName}|${label}`
            quietLen = quiet.len
          }
          if (!quiet.stable) { console.log(`HARNESS FAULT: the page was still changing after ${quiet.waited}ms of quiet-waiting on ${themeName}/${wallName}/${label} (text length ${quiet.len}); the candidate set is not stable enough to sample.`); finish(2) }
          cost.quiet += Date.now() - mark; mark = Date.now()
          await assertRealViewport(`contrast:${themeName}/${wallName}/${label}`)
          const dpr = await evaluate(`window.devicePixelRatio`)
          if (dpr !== 1) { console.log(`HARNESS FAULT: devicePixelRatio is ${dpr}, not 1 - pixel sampling would be offset. Aborting.`); finish(2) }
          if (dialogFace) {
            // The face is named for the dialog, so it is only that face if a dialog is actually up.
            const open = await evaluate(`document.querySelectorAll('[role=dialog]').length`)
            if (!open) { console.log(`HARNESS FAULT: the 对话框 face ran with ${open} [role=dialog] elements on screen in ${themeName}/${wallName}; whatever it measured, it was not the confirm dialog.`); finish(2) }
          }
          // Optimistic concurrency on the page itself. Geometry is collected before the glyph-hidden
          // screenshot, so anything that reflows in between makes the sampled pixels belong to a
          // different layout than the coordinates - which is the one remaining way MC-2's two causes
          // can be told apart (a stale screenshot versus a real non-ancestor painting there). The
          // signature is read on both sides of that window and reported; it is NOT silently retried,
          // because "it moved" is the measurement, not an error to paper over.
          const sigA = await evaluate(SIG)
          const texts = await evaluate(`(function(){window.__COLLECT=${COLLECT_TEXTS};return window.__COLLECT(false, ${dialogFace})})()`)
          const sigGeom = await evaluate(SIG)
          if (texts.truncated) { console.log(`HARNESS FAULT: ${texts.truncated} more readable runs beyond the ${texts.rows.length} sampled in ${themeName}/${wallName}/${label}; the tally would be a partial one.`); finish(2) }
          // Controls are the item 1.4.11 object: a button or field judged against the surface it
          // actually sits on, not against a neighbouring panel of convenience.
          const ctl = await evaluate(`window.__COLLECT(true, ${dialogFace})`)
          cost.collect += Date.now() - mark; mark = Date.now()
          // The three sampling fixtures run once per theme: each takes its own screenshot, so running
          // them on all 72 combinations would double the sweep for no additional evidence.
          if (!controlDone) {
            controlDone = true
          // Second sampling fixture, pointing the other way: a leaf caption whose line fragment runs
          // under an adjacent chip. Judged on its own ink it is fine; judged on the fragment's right
          // edge it reads the chip and becomes an invented failure - which is exactly the false red the
          // box-edge version of this sampler produced on the settings page. The fixture asserts the two
          // readings disagree in THIS direction, so a future change back to edges cannot pass quietly.
          const chip = await (async () => {
            await evaluate(`(function(){
              const host = document.querySelector('main') || document.body
              const p = document.createElement('p')
              p.id = 'chip-lctl'
              p.style.cssText = 'position:fixed;left:320px;top:260px;margin:0;font-size:12px;line-height:20px;color:var(--text-primary);white-space:nowrap'
              p.textContent = '夹具文字夹具文字夹具文字夹具文字'
              host.appendChild(p)
              const rg = document.createRange(); rg.selectNodeContents(p)
              const q = rg.getClientRects()[0]
              // Covering the last 40% of the fragment, not a 6px sliver: the assertion needs grid
              // points to fall on the chip whatever the stride, and a fixture that only works when the
              // sample lands on 6 pixels is a fixture that fails for the wrong reason.
              const c = document.createElement('div')
              c.id = 'chip-lctl-block'
              c.style.cssText = 'position:fixed;height:28px;background:var(--text-primary);left:' + Math.round(q.right - q.width * 0.4) + 'px;width:' + Math.round(q.width * 0.4 + 20) + 'px;top:256px'
              host.appendChild(c)
              return true
            })()`)
            await evaluate(`(function(){const s=document.createElement('style');s.id='chip-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important}';document.head.appendChild(s);return true})()`)
            const cShot = await send('Page.captureScreenshot', { format: 'png' })
            await evaluate(`(function(){const s=document.getElementById('chip-hide');if(s)s.remove();return true})()`)
            const crow = await evaluate(`window.__COLLECT(false).rows.filter(function(r){return r.text.indexOf('夹具文字')===0})`)
            const geom = await evaluate(`(function(){
              const p = document.getElementById('chip-lctl'), c = document.getElementById('chip-lctl-block')
              if (!p || !c) return { present: !p ? 'p missing' : 'chip missing' }
              const rp = p.getBoundingClientRect(), rc = c.getBoundingClientRect()
              const rg = document.createRange(); rg.selectNodeContents(p.firstChild)
              const q = rg.getClientRects()[0]
              const probe = [Math.round(q.right), Math.round(q.right - 1), Math.round(q.right - 3), Math.round(q.right - 6)]
              return { pRect: [Math.round(rp.left), Math.round(rp.top), Math.round(rp.width), Math.round(rp.height)],
                chipRect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
                fragmentRight: Math.round(q.right), fragmentLeft: Math.round(q.left),
                ownershipAt: probe.map(function(x){ const h = document.elementFromPoint(x, Math.round((rc.top + rc.bottom) / 2)); return x + '->' + (h ? h.tagName + '#' + (h.id || '(no id)') : 'null') }) }
            })()`)
            const cSampled = crow.length ? await evaluate(`(${SAMPLE_FN})(${JSON.stringify(cShot.data)}, ${JSON.stringify(crow)})`) : []
            await evaluate(`(function(){['chip-lctl','chip-lctl-block'].forEach(function(i){const e=document.getElementById(i);if(e)e.remove()})})()`)
            return cSampled[0] || null
          })()
          const cBad = []
          if (!chip) cBad.push('the chip fixture caption was not collected, so the ink-versus-edge distinction is unproven in the safe direction')
          else {
            if (!(chip.ratio >= chip.threshold)) cBad.push(`ink reading ${chip.ratio}:1 should PASS ${chip.threshold}:1 - the run is being judged on the chip next to it, which is the false red this fixture exists to catch (bg rgb ${chip.bg})`)
            if (!(chip.foreign > 0)) cBad.push(`the run kept ${chip.sampledPoints} points and rejected ${chip.foreign} as belonging to something else; expected the chip's pixels to be counted as foreign, so the ownership rule is not being exercised by this fixture`)
          }
          if (cBad.length) { console.log(`HARNESS FAULT: chip control: ${cBad.join('; ')}`); finish(2) }
          if (chip) console.log(`CHIP-CONTROL ink=${chip.ratio}:1 (rgb ${chip.bg}) judged=${chip.sampledPoints} refused=${chip.foreign} - the neighbour's pixels are counted and not judged, which is the direction that used to invent failures`)
          // Proves the multi-point grid is not decoration. A caption planted on a white-to-#333
          // gradient reads 7.x:1 at its centre - which the single-point sampler accepted - and 1.7:1
          // at the dark end. The control asserts the grid disagrees with the centre point, so if the
          // grid ever degrades back to one sample the gate stops instead of going quiet.
          const gradient = await (async () => {
            await evaluate(`(function(){
              const host = document.querySelector('main') || document.body
              const box = document.createElement('div')
              box.id = 'grad-lctl'
              // Sized so the text run spans the ramp: an ink rect that stops short of the dark end
              // would legitimately pass, and the control would then prove nothing.
              box.style.cssText = 'position:fixed;left:320px;top:200px;width:132px;height:22px;font-size:12px;line-height:22px;color:#000000;white-space:nowrap;background-image:linear-gradient(to right,#ffffff,#333333)'
              box.textContent = 'LCTLGRAD 渐变夹具文字'
              host.appendChild(box)
              return true
            })()`)
            await evaluate(`(function(){const s=document.createElement('style');s.id='grad-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important}';document.head.appendChild(s);return true})()`)
            const gShot = await send('Page.captureScreenshot', { format: 'png' })
            await evaluate(`(function(){const s=document.getElementById('grad-hide');if(s)s.remove();return true})()`)
            const grow = await evaluate(`window.__COLLECT(false).rows.filter(function(r){return r.text.indexOf('LCTLGRAD')===0})`)
            // The alarm line has to say which filter dropped the plant, or "not collected" is a
            // mystery and the next person re-runs the whole sweep to find out.
            const why = await evaluate(`(function(){
              const b = document.getElementById('grad-lctl'); if(!b) return { exists:false }
              const r = b.getBoundingClientRect(); const cs = getComputedStyle(b)
              const hit = document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2))
              return { exists:true, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], children:b.children.length, text:(b.textContent||'').slice(0,20),
                visibility:cs.visibility, opacity:cs.opacity, position:cs.position, inMain: !!b.closest('main'),
                hit: hit ? hit.tagName + '.' + String(hit.className||'').slice(0,30) : null,
                viewport:[innerWidth,innerHeight] }
            })()`)
            const gShot2 = gShot
            const gSampled = grow.length ? await evaluate(`(${SAMPLE_FN})(${JSON.stringify(gShot2.data)}, ${JSON.stringify(grow)})`) : []
            await evaluate(`(function(){const b=document.getElementById('grad-lctl');if(b)b.remove();return true})()`)
            return { planted: grow.length, why, row: gSampled[0] || null }
          })()
          const gBad = []
          if (!gradient.planted || !gradient.row) gBad.push(`the gradient caption was not planted or not collected, so the multi-point grid is unproven; plant state ${JSON.stringify(gradient.why)}`)
          else {
            const g = gradient.row
            if (!(g.centreRatio >= 4.5)) gBad.push(`centre reads ${g.centreRatio}:1, expected to PASS 4.5:1 - the control is no longer a case the single point would have waved through`)
            if (!(g.ratio < 4.5)) gBad.push(`worst point reads ${g.ratio}:1, expected to FAIL 4.5:1 on a ramp that ends at #333333 (centre ${g.centreRatio}:1) - the grid is sampling one pixel again`)
            if (!(g.spread > 0)) gBad.push(`spread across the box is ${g.spread}, expected >0 - every sampled point returned the same pixel`)
          }
          if (gBad.length) { console.log(`HARNESS FAULT: gradient control: ${gBad.join('; ')}`); finish(2) }
          if (gradient.row) console.log(`GRADIENT-CONTROL centre=${gradient.row.centreRatio}:1 (rgb ${gradient.row.centreBg}) worst=${gradient.row.ratio}:1 (rgb ${gradient.row.bg}) spread=${gradient.row.spread} points=${gradient.row.sampledPoints} - the grid disagrees with the centre point, which is what makes it worth running`)
            const c = await evaluate(`(function(){window.__COLLECT=${COLLECT_TEXTS};window.__SAMPLE=${SAMPLE_FN};return (${SWEEP_CONTROL})()})()`)
            const moved = (k) => c.after[k] - c.before[k]
            const bad = []
            if (moved('clipped') < 1) bad.push('clipped did not move (' + c.before.clipped + ' -> ' + c.after.clipped + ') although a caption straddles the fold with only 3px of ink showing')
            if (moved('offscreen') < 1) bad.push('offscreen did not move (' + c.before.offscreen + ' -> ' + c.after.offscreen + ') although a caption sits 400px below the fold')
            if (moved('occluded') < 1) bad.push('occluded did not move (' + c.before.occluded + ' -> ' + c.after.occluded + ') although an opaque plate was laid over a caption')
            if (c.leakedIntoSweep.length) bad.push(`the planted captions reached the sweep (${c.leakedIntoSweep.join(', ')}) - the skip branches are not what removed them`)
            if (!c.controlRows) bad.push('the control sweep found 0 interactive elements, so control-vs-surface ratios cannot be reported at all')
            if (bad.length) { console.log(`HARNESS FAULT: the contrast sweep cannot see its own blind spots: ${bad.join('; ')}`); finish(2) }
            console.log(`SWEEP-CONTROL clipped ${c.before.clipped}->${c.after.clipped} offscreen ${c.before.offscreen}->${c.after.offscreen} occluded ${c.before.occluded}->${c.after.occluded} control-rows=${c.controlRows} (all skip counters proven live; the sweep only vouches for what it can see)`)
          }
          cost.fixtures += Date.now() - mark; mark = Date.now()
          // Hide the glyphs, photograph what is left: that photograph IS the background the text
          // sits on, gradients, blur and wallpaper included.
          await evaluate(`(function(){const s=document.createElement('style');s.id='lctl-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}';document.head.appendChild(s);return true})()`)
          const sigShot = await evaluate(SIG)
          const shotData = await send('Page.captureScreenshot', { format: 'png' })
          // Immediately after the photograph, before anything else is dispatched: comparing these live
          // boxes to the recorded ones turns "the page reflowed somewhere" into "the element whose
          // pixel I sampled moved by N px", which is the difference MC-2 cannot be argued about.
          const shotRects = await evaluate(RECHECK)
          await evaluate(`(function(){const s=document.getElementById('lctl-hide');if(s)s.remove();return true})()`)
          cost.shot += Date.now() - mark; mark = Date.now()
          const sampled = await evaluate(`(${SAMPLE_FN})(${JSON.stringify(shotData.data)}, ${JSON.stringify(texts.rows.concat(ctl.rows))})`)
          cost.sample += Date.now() - mark; mark = Date.now()
          if (!sampled.length) { console.log(`HARNESS FAULT: ${themeName}/${wallName}/${label} yielded 0 readable runs - an empty sweep is not a pass.`); finish(2) }
          // Row-level layout verdict: every run's own element, measured again now that the photograph
          // exists. moved = the pixel came from a layout those coordinates no longer describe;
          // gone = the element is off the page entirely; uncomparable = the instrument cannot tell,
          // which is reported and never folded into "did not move".
          const staleRows = [], goneRows = [], uncomparableRows = []
          for (const s of sampled) {
            let verdict = 'fresh'
            if (!s.ctid) { verdict = 'uncomparable'; uncomparableRows.push(s) }
            else {
              const live = shotRects[String(s.ctid)]
              if (!live) { verdict = 'gone'; goneRows.push(s) }
              else {
                const movedBy = rectMoved(s.box, live)
                if (movedBy === null) { verdict = 'uncomparable'; uncomparableRows.push(s) }
                else if (movedBy > 0) { verdict = 'moved'; staleRows.push({ text: (s.text || '').slice(0, 24), kind: s.kind, movedBy, ratio: s.ratio, threshold: s.threshold, bg: s.bg, from: s.box, to: live, ctid: s.ctid, x: s.x, y: s.y }) }
              }
            }
            s.layoutVerdict = verdict
          }
          // Name what actually owns the stale coordinate. Without this the shift is a number and the
          // thing that caused it stays a guess - which is how I ended up writing "the 58px must be the
          // error panel" on the strength of it being the only other difference between combos.
          // paintChainAt is the helper already used for failures and watch rows; reusing it here means
          // one instrument, not a second copy of the hit-test logic.
          for (const s of staleRows.slice(0, 2)) s.ownerAtStalePoint = await paintChainAt(s.x, s.y)
          for (const s of staleRows.slice(0, 2)) if (s.ctid) s.ownerOfLiveBox = await paintChainAt(s.to[0] + 2, s.to[1] + 2)
          // Which layout does the first photograph show? The reflow is known to land between the last
          // read before the capture and the re-read after it, so the picture could belong to either
          // side. A second photograph settles it - but only if the page has not moved AGAIN since the
          // re-read, which is checked rather than assumed, and with the glyphs hidden again so the two
          // photographs are comparable (a visible glyph would differ for an unrelated reason).
          let photoTest = null
          let blockAbove = null
          if (staleRows.length) {
            const first = staleRows[0]
            const recheck2 = await evaluate(RECHECK)
            const now = recheck2[String(first.ctid)]
            const settled = !!now && rectMoved(now, first.to) === 0
            await evaluate(`(function(){const s=document.createElement('style');s.id='lctl-hide2';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}';document.head.appendChild(s);return true})()`)
            const shot2 = await send('Page.captureScreenshot', { format: 'png' })
            const px2 = await evaluate(`(${PIXEL_AT})(${JSON.stringify(shot2.data)}, ${first.x}, ${first.y})`)
            await evaluate(`(function(){const s=document.getElementById('lctl-hide2');if(s)s.remove();return true})()`)
            blockAbove = await evaluate(`(${BLOCKS_AROUND})(document.querySelector('[data-ctid="${first.ctid}"]'))`)
            const shot1 = String(first.bg || '').split(',').map((v) => Number(v))
            const agrees = Array.isArray(px2) && shot1.length === 3 && px2.every((v, i) => Math.abs(v - shot1[i]) <= 1)
            photoTest = {
              at: [first.x, first.y], text: first.text, shot1: first.bg, shot2: Array.isArray(px2) ? px2.join(',') : null,
              layoutSettledSinceRecheck: settled, sameAsFirstPhotograph: agrees,
              verdict: !settled ? 'undecidable - the page moved again between the re-read and the second photograph'
                : agrees ? 'the first photograph shows the CURRENT layout: the recorded coordinates are the stale side'
                  : 'the first photograph shows the OTHER layout: coordinates and pixels agree, so the re-read is the odd one out',
            }
            console.log(`STALE-PHOTO ${themeName}/${wallName}/${label}: at (${first.x},${first.y}) "${first.text}" shot1=rgb(${first.bg}) shot2=rgb(${photoTest.shot2 || 'n/a'}) layoutSettled=${settled ? 1 : 0} -> ${photoTest.verdict}`)
            if (blockAbove && blockAbove.found) console.log(`STALE-BLOCK ${themeName}/${wallName}/${label}: section ${blockAbove.sec} top=${blockAbove.secTop} above: ${blockAbove.above.join(' ') || '(none)'}`)
          }
          const below = sampled.filter((s) => s.ratio !== null && s.ratio < s.threshold)
          // When a row fails, say what is actually stacked under it. Guessing at a colour from its
          // rgb triple is how I spent three rounds attributing this to chips, tiles and rounding.
          for (const b of below.slice(0, 3)) b.under = await paintChainAt(b.x, b.y)
          const unresolved = sampled.filter((s) => s.ratio === null)
          const worst = sampled.filter((s) => s.ratio !== null).sort((a, b) => a.ratio - b.ratio)[0]
          // A colour the tool cannot parse is not a row that passed: it is a row that was never
          // judged. It used to print `unresolved=N` and still exit 0 - the same shape as an alarm
          // tag that never reaches the exit code, so it now stops the run.
          if (unresolved.length) { console.log(`HARNESS FAULT: ${unresolved.length} run(s) in ${themeName}/${wallName}/${label} yielded no ratio (${unresolved.slice(0, 3).map((u) => u.text + ' ' + u.why).join('; ')}); the tally would be partial.`); finish(2) }
          if (texts.skipped.offcanvas) { console.log(`HARNESS FAULT: ${texts.skipped.offcanvas} run(s) had a sample point outside the captured canvas in ${themeName}/${wallName}/${label}; the viewport containment check and the canvas disagree.`); finish(2) }
          for (const s of sampled) {
            if (s.kind !== 'text' || s.ratio === null) continue
            gridStats.text++
            const delta = Math.abs(s.ratio - s.centreRatio)
            if (delta >= 0.2) {
              gridStats.disagreed++
              if (delta > gridStats.worstDelta) gridStats.worstDelta = Math.round(delta * 100) / 100
              if (s.ratio < s.threshold && s.centreRatio >= s.threshold) gridStats.centreWouldHaveMissed++

            }
            if (s.fellBack) gridStats.fallbacks++
            gridStats.points += s.sampledPoints || 0
          }
          const ctlRows = sampled.filter((s) => s.kind === 'control')
          for (const c of ctlRows) allControls.push({ theme: themeName, wallpaper: wallName, route: label, ...c, kind: controlKind(c) })
          rows.push({ theme: themeName, wallpaper: wallName, route: label, measured: sampled.length, controls: ctlRows.length, skipped: texts.skipped, below: below.length, unresolved: unresolved.length, worstRatio: worst ? worst.ratio : null, worstText: worst ? worst.text : null, worstBg: worst ? worst.bg : null, belowList: below, tokens })
          // The measured set itself, by identity, in the artifact. Without this the only thing a
          // reader can compare between two batches is a COUNT, and a count that changes says
          // nothing about which run appeared or vanished - which is the difference between
          // "the page rendered differently" and "the sweep went blind for one combination".
          rows[rows.length - 1].sig = { geom: sigGeom, shot: sigShot, pre: sigA }
          rows[rows.length - 1].drift = {
            geomToShot: layoutDrift(sigGeom, sigShot),
            preToGeom: layoutDrift(sigA, sigGeom),
          }
          rows[rows.length - 1].stale = {
            moved: staleRows.length,
            gone: goneRows.length,
            uncomparable: uncomparableRows.length,
            worstMovedBy: staleRows.length ? Math.max(...staleRows.map((s) => s.movedBy)) : 0,
            photoTest,
            blockAbove,
            examples: staleRows.slice(0, 3).concat(goneRows.slice(0, 2).map((g) => ({ text: (g.text || '').slice(0, 24), kind: g.kind, gone: true }))),
          }
          rows[rows.length - 1].keys = sampled.map((s) => `${s.kind}|${s.tag || ''} ${(s.cls || '').split(/\s+/).slice(0, 3).join('.')}|${(s.text || '').slice(0, 40)}`).sort()
          // The grid-vs-centre disagreement, kept for PASSING runs too. The floor margin rule is
          // "at least the measured wobble", and before this line the only spreads in the artifact
          // belonged to runs that had already failed - so the number the rule needs was unavailable
          // precisely in the case the rule is meant to govern.
          const spreads = sampled.filter((s) => s.kind === 'text' && typeof s.spread === 'number').map((s) => ({ v: s.spread, t: (s.text || '').slice(0, 30), r: s.ratio, c: s.centreRatio })).sort((a, b) => b.v - a.v)
          rows[rows.length - 1].maxSpread = spreads.length ? spreads[0] : null
          rows[rows.length - 1].textSpreadCount = spreads.length
          for (const needle of watchNeedles) {
            const hits = sampled.filter((s) => s.kind === 'text' && (s.text || '').includes(needle))
            if (!watchSeen.has(needle)) watchSeen.set(needle, [])
            for (const h of hits) watchSeen.get(needle).push({
              combo: `${themeName}/${wallName}/${label}`, ratio: h.ratio, centre: h.centreRatio, spread: h.spread,
              bg: String(h.bg || ''), fg: String(h.fg || ''), size: h.size,
              // Position and paint owner, so "the background under this element changed" can be split
              // into two different claims instead of being guessed at: a moved sample point (rect
              // differs) versus a genuinely repainted surface (same rect, different owner or paint).
              box: Array.isArray(h.box) ? h.box.join(',') : String(h.box || ''),
              ink: Array.isArray(h.ink) ? JSON.stringify(h.ink) : String(h.ink || ''),
              hit: String(h.hit || ''),
              // One name, one value: this used to carry two `chain` keys in the same literal, and the
              // first (a stripped, late-fetched owner) was silently overwritten by the second. JS lets
              // that pass syntax-checking, so a reader comparing chains was comparing the same-source
              // one while believing the artifact held both. Full chain keeps the computed colours, the
              // stripped one answers "which element chain" without letting a repaint look like a
              // different element.
              chain: String(h.chain || ''),
              chainIds: String(h.chain || '').split(' < ').map((s) => s.split('{')[0].trim()).join('<'),
              // The layout verdict for this combination, read on both sides of the geometry -> photograph
              // window. A needle whose anomalous readings all land in a moved combination is a stale
              // sample; one whose readings land in unmoved combinations is the other branch of MC-2.
              sampleMoved: rows[rows.length - 1].drift.geomToShot,
              layoutVerdict: h.layoutVerdict,
              // Both kept on purpose: chain is same-source with the geometry, under is a later round
              // trip. Where they disagree the page moved in between, which is the thing that made the
              // first version of this evidence untrustworthy - and the disagreement is itself readable.
              under: await paintChainAt(h.x, h.y),
            })
          }
          if (below.length) failures.push(`CONTRAST ${themeName}/${wallName}/${label}: ${below.length}/${sampled.length} readable runs below their threshold - worst ${worst.ratio}:1 (need ${worst.threshold}) "${worst.text}" ${worst.size}px ${worst.bold ? 'bold' : 'regular'} fg rgb(${worst.fg}) on sampled rgb(${worst.bg})`)
          // A palette re-tune across three themes is exactly the change where every number can
          // pass and the screen still looks wrong, so each combination is photographed as well.
          rows[rows.length - 1].shot = await shot(`ct-${themeName}-${wallName}-${label}`)
          // One line per combination, as it finishes. Without it a long run and a stalled run look the
          // same from outside, and the only way to tell them apart was reaching for ps on a pid that
          // turned out to belong to a different project.
          comboIndex++
          console.log(`COMBO ${comboIndex}/${combosTotal} ${themeName}/${wallName}/${label} elapsed=${Math.round((Date.now() - RUN_STARTED) / 1000)}s rows=${sampled.length} points=${sampled.reduce((a, x) => a + (x.sampledPoints || 0), 0)} rejected=${sampled.reduce((a, x) => a + (x.foreign || 0), 0)} toasts=${toastClear.before} moved=${staleRows.length} gone=${goneRows.length} unchecked=${uncomparableRows.length}`)
          if (label === '对话框') { await pressEscape(); await sleep(200) }
        }
      }
    }
    await evaluate(`(function(){delete document.documentElement.dataset.theme;document.documentElement.style.setProperty('--wallpaper','none');delete document.documentElement.dataset.wallpaper;return true})()`)
    const KINDS = ['primary-fill', 'danger-fill', 'subtle-fill', 'field', 'icon', 'ghost']
    // Identity in both directions: every control row the sweep counted must reach the aggregation.
    // A field written after a spread (kind overwritten by ...c) silently emptied the aggregation
    // while every per-combo tally still looked correct.
    const ctlTotal = rows.reduce((a, r) => a + r.controls, 0)
    if (allControls.length !== ctlTotal) { console.log(`HARNESS FAULT: the sweep counted ${ctlTotal} control rows but the aggregation holds ${allControls.length} - control-vs-surface ratios are being dropped somewhere.`); finish(2) }
    // The kinds live on different surfaces: the only text inputs are on 云端/设置, the only filled
    // danger button is in the dialog. Demanding all six kinds from a --routes subset would fail for
    // the right reason with the wrong message, so the requirement is asserted only when the sweep
    // actually covers every surface, and a partial run says so on its own line.
    const fullSweep = ROUTES.length === ALL_ROUTES.length
    if (!fullSweep) console.log(`SCOPE partial sweep: ${ROUTES.length} of ${ALL_ROUTES.length} surfaces (${ROUTES.join(', ')}) - the per-control kind coverage below is a subset, not a verdict on the app`)
    if (fullSweep && !KINDS.every((k) => allControls.some((c) => c.kind === k))) { console.log(`HARNESS FAULT: no control of kind(s) ${KINDS.filter((k) => !allControls.some((c) => c.kind === k)).join(', ')} was found on any surface; the per-control table would report n/a for them, which is not a pass.`); finish(2) }
    const perControl = []
    for (const theme of THEMES.map((t) => t[0])) {
      for (const kind of KINDS) {
        const set = allControls.filter((c) => c.theme === theme && c.kind === kind)
        if (!set.length) { perControl.push({ theme, kind, measured: 0, worst: null }); continue }
        const w = set.slice().sort((a, b) => a.ratio - b.ratio)[0]
        perControl.push({ theme, kind, measured: set.length, worst: w.ratio, need: w.threshold, at: `${w.route}/${w.wallpaper}`, text: w.text, fg: w.fg, bg: w.bg, cls: w.cls, below: set.filter((c) => c.ratio < c.threshold).length })
        if (set.some((c) => c.ratio < c.threshold)) failures.push(`CONTROL-CONTRAST ${theme}/${kind}: ${set.filter((c) => c.ratio < c.threshold).length}/${set.length} control(s) below their threshold against their own surface - worst ${w.ratio}:1 (need ${w.threshold}) "${w.text}" on ${w.route} rgb(${w.bg}), fg rgb(${w.fg}), class "${w.cls}"`)
      }
    }
    console.log('CONTROLS ' + perControl.map((p) => `${p.theme}/${p.kind}=${p.worst === null ? 'n/a' : p.worst + ':1'}${p.below ? '(' + p.below + ' below)' : ''}`).join(' '))
    // The two tables that go into docs/VISUAL_BASELINE.md, generated here so a hand-typed number in
    // the document is checked against the run that produced it. A table nobody can re-run is prose.
    const floor = {}
    for (const r of rows) {
      const k = `${r.route}|${r.theme}`
      if (!floor[k] || r.worstRatio < floor[k].ratio) floor[k] = { ratio: r.worstRatio, text: r.worstText, n: r.measured }
    }
    const faceTable = ['| 面 | mist | midnight | sakura | 判读文字数（每主题） |', '|---|---|---|---|---|']
    for (const label of ROUTES.concat(['对话框'])) {
      const g = (t) => (floor[`${label}|${t}`] ? floor[`${label}|${t}`].ratio : null)
      const n = (t) => (floor[`${label}|${t}`] ? floor[`${label}|${t}`].n : 0)
      faceTable.push(`| ${label} | ${g('default')} | ${g('midnight')} | ${g('sakura')} | ${n('default')}/${n('midnight')}/${n('sakura')} |`)
    }
    const ctlTable = ['| 控件类型 | mist | midnight | sakura | 判读控件数（每主题） |', '|---|---|---|---|---|']
    for (const kind of KINDS) {
      const g = (t) => { const p = perControl.find((x) => x.theme === t && x.kind === kind); return p && p.worst !== null ? p.worst : 'n/a' }
      const n = (t) => { const p = perControl.find((x) => x.theme === t && x.kind === kind); return p ? p.measured : 0 }
      ctlTable.push(`| ${kind} | ${g('default')} | ${g('midnight')} | ${g('sakura')} | ${n('default')}/${n('midnight')}/${n('sakura')} |`)
    }
    const tables = { 'CONTRAST_FACE_TABLE': faceTable.join('\n'), 'CONTRAST_CONTROL_TABLE': ctlTable.join('\n') }
    const docPath = opt('doc', '')
    if (docPath && flag('doc-write')) {
      // The comparison above just caught six hand-typed rows that no longer matched the run, which is
      // the same drift class the fingerprint table had. So the numbers now come from this process
      // instead of from whoever remembers to retype them: only the marked blocks are touched, the
      // prose around them stays authored by a person, and the line-ending style of the file is kept
      // (core.autocrlf checks it out CRLF; rewriting to LF would turn a six-row update into a
      // whole-file diff).
      const doc = readFileSync(docPath, 'utf8')
      const eol = doc.includes('\r\n') ? '\r\n' : '\n'
      let text = doc
      let wrote = 0
      for (const [tag, want] of Object.entries(tables)) {
        const b = text.indexOf(`<!-- ${tag}:BEGIN -->`), e = text.indexOf(`<!-- ${tag}:END -->`)
        if (b === -1 || e === -1 || e < b) { console.log(`HARNESS FAULT: --doc-write needs both markers for ${tag} in ${docPath}`); finish(2) }
        text = text.slice(0, b + (`<!-- ${tag}:BEGIN -->`).length) + '\n' + want + '\n' + text.slice(e)
        wrote += want.split('\n').length
      }
      if (text.includes('\r\n') !== doc.includes('\r\n')) { console.log(`HARNESS FAULT: --doc-write would change the line endings of ${docPath}`); finish(2) }
      writeFileSync(docPath, text.split(/\r?\n/).join(eol), 'utf8')
      console.log(`DOC-TABLE wrote ${wrote} generated lines into ${docPath} (marked blocks only)`)
      // No early exit: the comparison below re-reads the file and checks what was just written, and
      // the grid-evidence, coverage and budget assertions all still have to run. A writer that
      // returned before them would license a table generated by a run that never proved its own
      // sampler was awake.
    }
    // Denominator stability. Wallpaper is supposed to change paint, not content - so for one route
    // under one theme, the three wallpaper combos must measure the SAME set of runs. They do not:
    // PluginsPage.tsx:18 polls plugin-execution-logs every 2.5s, and whichever combos happen to be
    // photographed while that query has failed show two extra runs (the error panel) that the others
    // do not. Consequence measured today: which (theme,wallpaper) carries the failing ratio changes
    // from batch to batch, so a 0 is not evidence that nothing is below threshold.
    // Multiset comparison, not Set: the identity string is built from tag+class+text and two runs on
    // one page can share it (云端 shows 38 measured against 37 distinct keys), which the printed
    // identity line below reports as false rather than hiding.
    const denomDrift = []
    const byRouteTheme = new Map()
    for (const r of rows) {
      if (!Array.isArray(r.keys)) continue
      const k = `${r.route}|${r.theme}`
      if (!byRouteTheme.has(k)) byRouteTheme.set(k, [])
      byRouteTheme.get(k).push(r)
    }
    let identityFalse = 0
    const unverifiedGroups = new Map()
    for (const [k, list] of [...byRouteTheme.entries()].sort()) {
      for (const r of list) {
        const uniq = new Set(r.keys).size
        if (uniq !== r.measured) {
          identityFalse++
          // Quarantined, not smoothed: the identity string is tag+class+text, and two runs on one
          // page can share it. Making it injective would need a position, and a position shifts when
          // anything above is added - which turns every real content change into a false diff and
          // gets this gate muted inside a week. So a group whose runs cannot be told apart is one
          // this sweep did NOT verify, and that refusal has to cost the run something.
          unverifiedGroups.set(k, (unverifiedGroups.get(k) || 0) + 1)
        }
      }
      const base = list[0]
      for (const o of list.slice(1)) {
        const a = [...base.keys].sort(), b = [...o.keys].sort()
        const onlyA = a.filter((x) => { const i = b.indexOf(x); if (i === -1) return true; b.splice(i, 1); return false })
        const onlyB = [...b]
        if (onlyA.length || onlyB.length) {
          denomDrift.push(`${k}: ${base.wallpaper} measured ${base.measured} and ${o.wallpaper} measured ${o.measured} - the difference is content, not paint. only in ${base.wallpaper}: ${onlyA.slice(0, 2).join(' ; ') || '(none)'} ; only in ${o.wallpaper}: ${onlyB.slice(0, 2).join(' ; ') || '(none)'}`)
        }
      }
    }
    for (const needle of watchNeedles) {
      const got = watchSeen.get(needle) || []
      if (!got.length) { console.log(`WATCH ${JSON.stringify(needle)} present=0/${rows.length} - nothing matched, so this element contributes no amplitude and any margin quoted for it would be invented`); continue }
      const rs = got.map((g) => g.ratio).filter((v) => typeof v === 'number')
      const lo = Math.min(...rs), hi = Math.max(...rs)
      const perTheme = {}
      for (const g of got) { const t = g.combo.split('/')[0]; if (!perTheme[t] || g.ratio < perTheme[t]) perTheme[t] = g.ratio }
      // Two different things called "wobble" here: how far the grid reading disagrees with the
      // centre reading on ONE element in ONE combination (the instrument's own spread), and how far
      // the same element moves ACROSS combinations (which is what a floor margin has to survive).
      const spreadMax = Math.max(...got.map((g) => g.spread || 0))
      // The discriminator: same rect + different bg means the paint changed; different rect means the
      // sample moved. Both are printed as counts so a claim about either is checkable, not inferred.
      const rects = new Set(got.map((g) => g.box)), hitsSet = new Set(got.map((g) => g.hit)), chains = new Set(got.map((g) => g.chain))
      const bgByRect = new Map()
      for (const g of got) { if (!bgByRect.has(g.box)) bgByRect.set(g.box, new Set()); bgByRect.get(g.box).add(g.bg) }
      // The MC-2 fork, decided per needle instead of argued. The distinct-count line above can only say
      // "the readings differ"; which of the two causes it is needs the same-source layout verdict that
      // this combination carried.
      const movedCombos = new Set(got.filter((g) => g.sampleMoved).map((g) => g.combo))
      const distinctBg = new Set(got.map((g) => g.bg))
      // Group by the identity-only chain: the full chain string embeds the computed colours, so two
      // readings of the SAME element over a repainted surface would count as two different chains and
      // the phrase "one chain, many backgrounds" would be unfalsifiable.
      const bgByChain = new Map()
      for (const g of got) { if (!bgByChain.has(g.chainIds)) bgByChain.set(g.chainIds, new Set()); bgByChain.get(g.chainIds).add(g.bg) }
      const sameChainManyBg = [...bgByChain.entries()].filter(([, s]) => s.size > 1).length
      // "No ancestor's solid colour equals the sampled pixel" is a FILTER, not a verdict: a gradient, a
      // background-image or the wallpaper composite legitimately matches nothing, and calling that a
      // non-ancestor painter is the exact misattribution this case already retracted once. So the
      // ancestor-image count rides along, and only a reading that matches no solid colour AND has no
      // background-image anywhere in its chain is unexplained by its own ancestors.
      const triple = (s) => { const m = String(s).match(/\d+/g); return m && m.length >= 3 ? `${m[0]},${m[1]},${m[2]}` : null }
      const unexplained = got.filter((g) => {
        const want = triple(g.bg)
        if (!want) return false
        const nodes = g.chain.split(' < ')
        if (nodes.some((n) => triple((n.match(/\{bg:([^,]*)/) || [])[1]) === want)) return false
        return !nodes.some((n) => /,img:(?!-)/.test(n))
      }).length
      const verdicts = { fresh: 0, moved: 0, gone: 0, uncomparable: 0 }
      for (const g of got) verdicts[g.layoutVerdict in verdicts ? g.layoutVerdict : 'uncomparable']++
      console.log(`WATCH-CAUSE ${JSON.stringify(needle)}: distinctBackgrounds=${distinctBg.size} sampledFromMovedCombinations=${movedCombos.size}/${new Set(got.map((g) => g.combo)).size} distinctAncestorChains=${new Set(got.map((g) => g.chainIds)).size} chainsCarryingMoreThanOneBackground=${sameChainManyBg} readingsMatchNoAncestorSolidColorAndNoAncestorImage=${unexplained}/${got.length} thisElementsOwnLayout={fresh:${verdicts.fresh} moved:${verdicts.moved} gone:${verdicts.gone} uncomparable:${verdicts.uncomparable}}`)
      const sameRectManyBg = [...bgByRect.entries()].filter(([, s]) => s.size > 1).length
      console.log(`WATCH ${JSON.stringify(needle)} present=${got.length}/${rows.length} ratio min=${Math.round(lo * 100) / 100} max=${Math.round(hi * 100) / 100} crossComboAmplitude=${Math.round((hi - lo) * 100) / 100} withinRunMaxSpread=${Math.round(spreadMax * 100) / 100} perThemeFloor=${Object.entries(perTheme).map(([k, v]) => `${k}:${Math.round(v * 100) / 100}`).join(' ')} distinctRects=${rects.size} distinctPaintOwners=${hitsSet.size} distinctAncestorChainReadings=${chains.size} rectsWithMoreThanOneBackground=${sameRectManyBg} bg={${[...new Set(got.map((g) => g.bg))].join(' | ')}}`)
      if (sameRectManyBg) console.log(`WATCH-PAINT ${JSON.stringify(needle)}: ${sameRectManyBg} rect value(s) carry more than one sampled background while the element box did not move - that is a repaint, not a sample shift`)
      else if (rects.size > 1) console.log(`WATCH-PAINT ${JSON.stringify(needle)}: ${rects.size} different boxes, one background per box - the readings come from different positions, so no repaint is demonstrated`)
    }
    if (watchNeedles.length) console.log(`WATCH_SUMMARY needles=${watchNeedles.length} withReadings=${[...watchSeen.values()].filter((v) => v.length).length} absent=${watchNeedles.filter((n) => !(watchSeen.get(n) || []).length).length}`)
    console.log(`DENOM_STABILITY combos=${rows.length} routeThemeGroups=${byRouteTheme.size} contentDifferences=${denomDrift.length} nonInjectiveIdentityReads=${identityFalse} unverifiedGroups=${unverifiedGroups.size}`)
    // Layout drift across the geometry -> photograph window, counted before anything reads it. The two
    // halves are not the same claim: geomToShot is the one that can stale the sampled pixels, while
    // preToGeom only says at which stage the page reflowed, so it locates and is not gated.
    const moved = rows.filter((r) => r.drift && r.drift.geomToShot)
    const movedCollect = rows.filter((r) => r.drift && r.drift.preToGeom)
    // The predicate's own red half, in the same pass and through the same function. A fingerprint guard
    // is unusually easy to kill silently: a misspelled field comparison returns null on every pair and
    // prints `moved=0`, which reads exactly like a clean sweep. So the fixtures below are the only
    // evidence that a zero here was earned.
    const ctlMoved = layoutDrift({ n: 10, sumTop: 100, doc: 900, bodyH: 900 }, { n: 11, sumTop: 130, doc: 900, bodyH: 900 })
    const ctlTwin = layoutDrift({ n: 10, sumTop: 100, doc: 900, bodyH: 900 }, { n: 10, sumTop: 100, doc: 900, bodyH: 900 })
    const ctlHeight = layoutDrift({ n: 10, sumTop: 100, doc: 900, bodyH: 900 }, { n: 10, sumTop: 100, doc: 912, bodyH: 900 })
    if (!ctlMoved || ctlTwin !== null || !ctlHeight) {
      console.log(`HARNESS FAULT: the layout-drift predicate disagrees with its own fixtures (moved=${JSON.stringify(ctlMoved)}, twin=${JSON.stringify(ctlTwin)}, heightOnly=${JSON.stringify(ctlHeight)}); a guard that cannot see a planted move cannot see a real one.`); finish(2)
    }
    console.log(`GEOMETRY_DRIFT selftest movedCaught=${ctlMoved ? 1 : 0} twinIgnored=${ctlTwin === null ? 1 : 0} singleFieldCaught=${ctlHeight ? 1 : 0} combos=${rows.length} geomToShotMoved=${moved.length} preToGeomMoved=${movedCollect.length}`)
    // A zero from this guard has to be read as one of two different things, so it says which: a probe
    // that cannot see a move also reports zero. The selftest above is the difference.
    if (!moved.length) console.log(`GEOMETRY_DRIFT-NULL geomToShotMoved=0: the page-level fingerprint saw no reflow inside the geometry -> photograph window in any of ${rows.length} combinations, and the selftest above shows it can see one. The per-element verdict below is the load-bearing reading; this line only says the whole-page summary did not change shape.`)
    for (const r of moved.slice(0, 5)) console.log(`GEOMETRY_DRIFT ${r.theme}/${r.wallpaper}/${r.route}: ${r.drift.geomToShot} - the ${r.measured} run(s) in this combination carry coordinates read before that reflow`)
    for (const r of movedCollect.slice(0, 3)) console.log(`GEOMETRY_DRIFT-COLLECT ${r.theme}/${r.wallpaper}/${r.route}: ${r.drift.preToGeom} - reflowed between the first fingerprint read and the last; this says nothing about which runs moved, so the per-element verdict below is the one that is read`)
    // The per-element verdict, which is the guard the fingerprint exists to explain. Three totals are
    // printed because they are three different claims, and uncomparable is deliberately not folded into
    // fresh: a row the instrument cannot check is a row that was not checked.
    // The predicate's own red half, in the same pass and through the same function, over the SAME case
    // table gate-unit asserts on. A fingerprint or box comparison is unusually easy to kill silently:
    // disarmed, it returns "no move" for every pair and prints a zero that reads exactly like a clean
    // sweep. So no zero from this section may be quoted unless every case came back as expected.
    const fixtureFailures = []
    for (const c of RECT_CASES) {
      const got = rectMoved(c.box, c.live)
      if (got !== c.expect) fixtureFailures.push(`rectMoved "${c.name}" -> ${String(got)}, expected ${String(c.expect)}`)
    }
    for (const c of DRIFT_CASES) {
      const got = layoutDrift(c.a, c.b)
      if (c.expect === null ? got !== null : !String(got || '').includes(c.expect)) fixtureFailures.push(`layoutDrift "${c.name}" -> ${String(got)}, expected it to name "${c.expect}"`)
    }
    if (fixtureFailures.length) {
      console.log(`HARNESS FAULT: the layout-staleness predicates disagree with their own fixtures (${fixtureFailures.slice(0, 3).join(' | ')}); a guard that cannot see a planted 470px move cannot see a real one, and its zero would be a number, not a result.`); finish(2)
    }
    const staleCombos = rows.filter((r) => r.stale && (r.stale.moved || r.stale.gone))
    const staleRunTotal = rows.reduce((a, r) => a + (r.stale ? r.stale.moved : 0), 0)
    const goneRunTotal = rows.reduce((a, r) => a + (r.stale ? r.stale.gone : 0), 0)
    const uncomparableTotal = rows.reduce((a, r) => a + (r.stale ? r.stale.uncomparable : 0), 0)
    // Its own total, computed here: `judgedTotal` is declared further down this block and reading it
    // from above is a ReferenceError that node --check does not catch, which is the failure this file
    // already has a comment about.
    const sampledTotal = rows.reduce((a, r) => a + r.measured, 0)
    console.log(`GEOMETRY_STALE selftest rectCases=${RECT_CASES.length} driftCases=${DRIFT_CASES.length} allAsExpected=1 combos=${rows.length} combosWithStaleRuns=${staleCombos.length} movedRuns=${staleRunTotal} goneRuns=${goneRunTotal} uncomparableRuns=${uncomparableTotal} of ${sampledTotal} sampled`)
    for (const r of staleCombos.slice(0, 5)) console.log(`GEOMETRY_STALE ${r.theme}/${r.wallpaper}/${r.route}: ${r.stale.moved} moved + ${r.stale.gone} unmounted of ${r.measured} run(s), worst ${r.stale.worstMovedBy}px - ${r.stale.examples.map((s) => `${s.gone ? 'gone' : s.movedBy + 'px'} "${s.text}"`).join(' ; ')}${r.stale.examples[0] && r.stale.examples[0].ownerAtStalePoint ? ` ; at the stale point now: ${String(r.stale.examples[0].ownerAtStalePoint).split(' < ').slice(0, 2).join(' < ')}` : ''}`)
    if (!staleCombos.length && !moved.length) console.log(`GEOMETRY_STALE-NULL moved=0 gone=0 with a predicate that caught a planted 470px move and still calls a 1px jitter fresh, so this zero is "no sampled element moved in any of ${rows.length} combinations", not "the check is blind". It governs only the batch that ran it, and it cannot see an element that stayed put while something behind it repainted - that case is WATCH-PAINT, not this line.`)
    for (const r of staleCombos) driftFindings.push(`CONTRAST-STALE-ELEMENT ${r.theme}/${r.wallpaper}/${r.route}: ${r.stale.moved} sampled run(s) whose own element measured differently after the photograph (worst ${r.stale.worstMovedBy}px) and ${r.stale.gone} whose element is no longer on the page, so those pixels belong to a layout their coordinates do not describe - ${r.stale.examples.map((s) => `${s.gone ? 'gone' : s.movedBy + 'px'} "${s.text}"`).join(' ; ')}`)
    for (const r of moved) driftFindings.push(`CONTRAST-STALE ${r.theme}/${r.wallpaper}/${r.route}: the layout moved between the geometry read and the glyph-hidden photograph (${r.drift.geomToShot}), so these ${r.measured} readings sample a layout their own coordinates do not describe`)
    for (const [k, n] of [...unverifiedGroups.entries()].sort()) denomFindings.push(`CONTRAST-DENOM-UNVERIFIED ${k}: ${n} combo(s) have runs the identity string cannot tell apart (distinct keys < measured runs), so this group's set equality was NOT established and it cannot count as verified`)
    if (denomDrift.length) {
      for (const d of denomDrift) denomFindings.push(`CONTRAST-DENOM ${d}`)
      console.log(`CONTRAST-DENOM ${denomDrift.length} route/theme group(s) disagree across wallpapers; a below=0 from this sweep is not a pass on those routes`)
    }
    if (docPath) {
      const doc = readFileSync(docPath, 'utf8')
      for (const [tag, want] of Object.entries(tables)) {
        const b = doc.indexOf(`<!-- ${tag}:BEGIN -->`), e = doc.indexOf(`<!-- ${tag}:END -->`)
        if (b === -1 || e === -1 || e < b) { docDrift.push(`${tag} the markers <!-- ${tag}:BEGIN --> / <!-- ${tag}:END --> are not both present in ${docPath}`); continue }
        const have = doc.slice(b + (`<!-- ${tag}:BEGIN -->`).length, e).replace(/^\n/, '').replace(/\n$/, '')
        // Pin the ratios, not the row counts. Two runs minutes apart agree exactly (measured=1902
        // points=121602 twice), but a run an hour earlier gave 1929 - the quiescence wait guarantees
        // "the page is not mid-render when photographed", not "the page contains the same text next
        // time", and in a browser-only harness which error banners exist is content, not timing. The
        // worst-ratio columns are what this section is about and they did not move, so the count
        // column prints for humans and is dropped from the comparison.
        const wantLines = stripCountCol(want)
        const haveLines = stripCountCol(have)
        const rowDiff = docTableDiff(have, want)
        // Both directions, or "ignore one column" is just a quieter gate:
        //  - a changed RATIO must still be reported (the thing this table exists to pin),
        //  - a changed COUNT alone must not be (the drift this run is proving is content, not defect).
        const probe = wantLines.slice()
        probe[probe.length - 1] = probe[probe.length - 1].replace(/(\d+\.\d+)/, '1.00')
        const ratioCaught = probe.filter((l, i) => stripCountCol(want)[i] !== l).length > 0
        const countIgnored = stripCountCol(want).join('\n') === stripCountCol(want.replace(/(\| )\d+\/\d+\/\d+( \|)$/, '$1999/999/999$2')).join('\n')
        if (!ratioCaught || !countIgnored) {
          docDrift.push(`${tag} DOC-TABLE SELF-TEST FAILED in ${docPath}'s comparison: ratioCaught=${ratioCaught} countIgnored=${countIgnored} - a projection that cannot see a changed ratio is not pinning anything, and one that still sees a changed count did not drop the column.`)
        }
        if (rowDiff.length) docDrift.push(`${tag} ${rowDiff.length} row(s) in ${docPath} do not match this run: ${rowDiff.slice(0, 4).join(' | ')}${rowDiff.length > 4 ? ` (+${rowDiff.length - 4} more)` : ''}. --doc-write regenerates it, but only sign numbers you mean to keep: if the run is worse than the doc, regenerating makes the regression the baseline.`)
      }
      console.log(`${docDrift.some((f) => f.startsWith('CONTRAST_')) ? 'DOC-TABLE mismatch' : 'DOC-TABLE ok'} for ${docPath}`)
    }
    writeFileSync(`${OUT}/contrast-tier.json`, JSON.stringify({ provenance: buildProvenance(), note: 'backgrounds are sampled from a screenshot taken with glyphs hidden, so gradients, backdrop-filter and the wallpaper composite are all included; wallpaper envelope is an all-black and an all-white image; controls are judged against their own rendered surface', themes: THEMES.map((t) => t[0]), wallpapers: WALLS.map((w) => w[0]), perControl, faceTable: faceTable.join('\n'), ctlTable: ctlTable.join('\n'), rows, watch: Object.fromEntries(watchSeen) }, null, 2))
    if (budgetHits) { console.log(`CONTRAST_GATE INCOMPLETE: covered ${comboIndex}/${combosTotal} combinations inside the ${DEADLINE_MS}ms budget; the unmeasured remainder is not a pass.`); finish(2) }
    for (const f of failures.concat(docDrift, denomFindings, driftFindings)) console.log(`FAIL ${f}`)
    console.log('TOKENS ' + JSON.stringify(rows.filter((r, i, a) => a.findIndex((x) => x.theme === r.theme) === i).map((r) => ({ theme: r.theme, ...r.tokens }))))
    // The planted gradient proves the grid CAN disagree with a single pixel. This proves it does so on
    // this app's real surfaces: if no row's worst point ever differed from its centre point, the
    // multi-point sampler is equivalent to the old one here and the extra cost is decoration - which
    // is the claim worth breaking, so it is asserted rather than assumed.
    console.log(`GRID-EVIDENCE textRows=${gridStats.text} disagreeWithCentre=${gridStats.disagreed} worstDelta=${gridStats.worstDelta} centreWouldHaveMissed=${gridStats.centreWouldHaveMissed} inkFallbacks=${gridStats.fallbacks}`)
    if (!gridStats.disagreed) { console.log('HARNESS FAULT: no real surface had a worst point differing from its centre point by >=0.2 - the multi-point grid changes no verdict on this app, so either it degraded to one pixel or the range claim in docs/VISUAL_BASELINE.md 4.2 is unsupported.'); finish(2) }
    if (gridStats.fallbacks > gridStats.disagreed + 10) { console.log(`HARNESS FAULT: ${gridStats.fallbacks} rows fell back to the single centre point against ${gridStats.disagreed} the grid disagreed with - the ink rects are being discarded too often for the range to be trustworthy.`); finish(2) }
    const skipped = rows.reduce((a, r) => ({ clipped: a.clipped + r.skipped.clipped, offcanvas: a.offcanvas + r.skipped.offcanvas, occluded: a.occluded + r.skipped.occluded, offscreen: a.offscreen + r.skipped.offscreen, nonText: a.nonText + r.skipped.nonText, containers: a.containers + (r.skipped.containers || 0), foreignOnly: a.foreignOnly + (r.skipped.foreignOnly || 0) }), { clipped: 0, offcanvas: 0, occluded: 0, offscreen: 0, nonText: 0, containers: 0, foreignOnly: 0 })
    // An `unknown`/skipped bucket without a ceiling is an escape hatch: a sweep that loses half the
    // page to "occluded" prints a smaller below-count and looks healthier. The predicate itself is
    // unit-checked both ways in gate-unit; here it runs on the real totals.
    const judgedTotal = rows.reduce((a, r) => a + r.measured, 0)
    const droppedTotal = rows.reduce((a, r) => a + r.skipped.occluded + r.skipped.containers + r.skipped.foreignOnly, 0)
    const unresolvedTotal = rows.reduce((a, r) => a + r.unresolved, 0)
    const cov = coverageVerdict({ judged: judgedTotal, dropped: droppedTotal })
    if (!cov.ok) {
      console.log(`HARNESS FAULT: coverage ceiling breached - ${cov.problems.join('; ')} (occluded=${skipped.occluded} containers=${skipped.containers} foreignOnly=${skipped.foreignOnly}); the sweep is no longer looking at most of what it claims to cover.`)
      finish(2)
    }
    const occlTop = Object.entries(rows.reduce((a, r) => { for (const [k, v] of Object.entries(r.occlBy || {})) a[k] = (a[k] || 0) + v; return a }, {})).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`PHASE-COST ${Object.entries(cost).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join(' ')} of ${((Object.values(cost).reduce((a, b) => a + b, 0)) / 1000).toFixed(1)}s accounted for ${combosTotal} combinations (the rest is theme/wallpaper switching and reporting)`)
    console.log(`COVERAGE judged=${judgedTotal} dropped=${droppedTotal} (${cov.pct}% of candidates) ceiling=75% topOccluders=${occlTop || '-'}`)
    // Computed, not a literal: this line used to print `unresolved=0` unconditionally, which is the
    // one number on the row that could never disagree with the run that produced it.
    console.log(`CONTRAST_GATE combos=${rows.length} routes=${ROUTES.length} measured=${judgedTotal} below=${failures.length} docDrift=${docDrift.length} denom=${denomFindings.length} drift=${driftFindings.length} unresolved=${unresolvedTotal} gridDisagreed=${gridStats.disagreed} points=${gridStats.points} nodeWall=${Math.round((Date.now() - t0) / 1000)}s nodeCpu=${(() => { const c = process.cpuUsage(cpu0); return ((c.user + c.system) / 1e6).toFixed(1) })()}s skipped=${JSON.stringify(skipped)}`)
    // The identity is printed so a reader can see the four buckets were not merged anywhere downstream.
    const stopping = failures.length + docDrift.length + denomFindings.length + driftFindings.length
    console.log(`CONTRAST_TALLY below=${failures.length} + docDrift=${docDrift.length} + denom=${denomFindings.length} + drift=${driftFindings.length} = stopping=${stopping}`)

    emitGate('contrast-tier', rows.reduce((a, r) => a + r.measured, 0), stopping, { combos: rows.length, routes: ROUTES.length, below: failures.length, docDrift: docDrift.length, denom: denomFindings.length, drift: driftFindings.length, unresolved: rows.reduce((a, r) => a + r.unresolved, 0), gridDisagreed: gridStats.disagreed, inkFallbacks: gridStats.fallbacks, skipped })
    console.log(stopping ? `contrast: ${stopping} stopping finding(s) (${failures.length} below threshold, ${docDrift.length} document projection, ${denomFindings.length} denominator, ${driftFindings.length} stale layout) across ${rows.length} theme/wallpaper/route combinations` : `contrast: every readable run meets its threshold in all ${rows.length} combinations`)
    finish(stopping ? 1 : 0)
  }

  if (MODE === 'settings-guard') {
    // The URL-parameter shape does not exist in this app (no location.search / URLSearchParams /
    // Astro.url anywhere in tracked sources). Its real equivalent is here: values that arrive from
    // outside the render - localStorage, a user-typed wallpaper URL, a colour picker - are written
    // straight into documentElement and decide which CSS applies. An unvalidated value there is the
    // same defect as ?mode=xyz blanking a page: the UI silently selects a rule set that does not
    // exist. Each case plants one illegal value, reloads through the real entry point, and asserts
    // the app still mounts, reports, and refuses to write the bad value into the DOM.
    const KEY = 'image-hosting-platform.appearance-v1'
    const DEFAULTS = { theme: 'mist', accent: '#4f46e5', wallpaper: '', blur: 18, glass: 88 }
    const CASES = [
      { field: 'theme', illegal: 'banana', note: 'an unknown data-theme selects no CSS block and silently keeps :root values' },
      { field: 'accent', illegal: 'red; } body { display:none', note: 'injected into a style property - must not reach the CSSOM' },
      { field: 'blur', illegal: 9999, note: 'out of range must clamp, not disable all painting' },
      { field: 'glass', illegal: -5, note: 'negative transparency' },
      { field: 'wallpaper', illegal: 'javascript:alert(1)', note: 'non-http scheme must be refused' },
      { field: 'theme', illegal: null, note: 'wrong type entirely', raw: '{"theme":42,"accent":null}' },
    ]
    const results = []
    const failures = []
    const original = await evaluate(`window.localStorage.getItem(${JSON.stringify(KEY)})`)
    for (const c of CASES) {
      const written = c.raw || JSON.stringify({ ...DEFAULTS, [c.field]: c.illegal })
      await evaluate(`(function(){window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(written)});return true})()`)
      consoleErrors.length = 0
      await send('Page.navigate', { url: APP })
      let mounted = false
      for (let i = 0; i < 40; i++) {
        await sleep(250)
        mounted = await evaluate(`(function(){const r=document.getElementById('root');return !!(r && r.children.length && (r.textContent||'').trim().length > 50)})()`)
        if (mounted) break
      }
      const state = await evaluate(`(function(){
        const root=document.documentElement, cs=getComputedStyle(root);
        const acc=cs.getPropertyValue('--accent').trim(), bl=cs.getPropertyValue('--backdrop-blur').trim(), gl=cs.getPropertyValue('--glass-strength').trim();
        return {
          themeAttr: root.dataset.theme || '(absent)',
          appBg: cs.getPropertyValue('--app-bg').trim(),
          accent: acc, blur: bl, glass: gl,
          wallpaperAttr: root.dataset.wallpaper || '(absent)',
          wallpaperVar: cs.getPropertyValue('--wallpaper').trim().slice(0, 40),
          rootTextLen: (document.getElementById('root')||{}).textContent ? document.getElementById('root').textContent.trim().length : 0,
          bodyDisplay: getComputedStyle(document.body).display,
          hiddenCount: Array.from(document.body.querySelectorAll('*')).filter((e)=>getComputedStyle(e).display==='none').length,
        }
      })()`)
      const errs = consoleErrors.filter((e) => e.type === 'error' || e.exceptionDetails).slice(0, 3).map((e) => (e.text || e.exceptionDetails?.exception?.description || '').slice(0, 140))
      const entry = { field: c.field, illegal: String(c.illegal ?? 'wrong-type'), wrote: written, mounted, state, errors: errs, note: c.note }
      results.push(entry)
      const bad = []
      if (!mounted) bad.push('app did not mount (blank screen)')
      if (state.bodyDisplay === 'none') bad.push('body was hidden by the injected value')
      if (errs.length) bad.push(`uncaught error on load: ${errs[0]}`)
      if (!['(absent)', 'mist', 'midnight', 'sakura'].includes(state.themeAttr)) bad.push(`unknown theme written into the DOM: data-theme="${state.themeAttr}"`)
      if (!/^#[0-9a-f]{6}$/i.test(state.accent)) bad.push(`non-hex accent reached the CSSOM: --accent=${state.accent}`)
      if (state.appBg !== '#f6f7fb' && state.themeAttr === '(absent)') bad.push(`theme attribute absent but --app-bg=${state.appBg} (half-applied state)`)
      const blurNum = parseFloat(state.blur), glassNum = parseFloat(state.glass)
      if (!(blurNum >= 0 && blurNum <= 36)) bad.push(`blur escaped its clamp: ${state.blur}`)
      if (!(glassNum >= 45 && glassNum <= 100)) bad.push(`glass escaped its clamp: ${state.glass}`)
      if (c.field === 'wallpaper' && state.wallpaperAttr === 'true') bad.push(`a non-http wallpaper value was accepted: ${state.wallpaperVar}`)
      for (const b of bad) failures.push(`SETTINGS ${c.field}=${entry.illegal}: ${b}`)
      // Print the reasons on the same line as the case. The first version only printed the state
      // and kept the reasons in the JSON, so a real alarm was unmatchable by anything reading the
      // transcript - including the mutation runner that checks this mode.
      console.log(`${bad.length ? 'FAIL' : 'OK  '} settings ${c.field}=${entry.illegal} -> mounted=${mounted} theme=${state.themeAttr} accent=${state.accent} blur=${state.blur} glass=${state.glass} wallpaper=${state.wallpaperAttr} textLen=${state.rootTextLen}${bad.length ? ' | ' + bad.join(' | ') : ''}`)
    }
    // The load path above cannot see the apply boundary's own behaviour: once apply also rejects,
    // a broken load guard is invisible through a reload. So drive apply directly, bypassing
    // loadThemePreferences entirely - that is what a settings panel, a migration or a test does.
    const DIRECT = ['banana', 42, '', 'MIDNIGHT', 'mist; background:url(#x)']
    for (const value of DIRECT) {
      const before = await evaluate(`document.documentElement.dataset.theme || '(absent)'`)
      const r = await evaluate(`(async function(){
        try {
          const m = await import('/src/lib/theme.ts');
          m.applyThemePreferences({ theme: ${JSON.stringify(value)}, accent: '#4f46e5', wallpaper: '', blur: 18, glass: 88 });
          return { threw: false, err: '' };
        } catch (e) { return { threw: true, err: String(e).slice(0, 120) }; }
      })()`)
      const after = await evaluate(`(function(){return {attr: document.documentElement.dataset.theme || '(absent)', accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}})()`)
      const bad = []
      if (r.threw) bad.push(`apply threw instead of ignoring the bad value: ${r.err}`)
      if (!['(absent)', 'mist', 'midnight', 'sakura'].includes(after.attr)) bad.push(`unknown theme written straight into the DOM: data-theme="${after.attr}"`)
      if (after.accent !== '#4f46e5') bad.push(`a bad theme key also stopped the other fields applying: --accent=${after.accent}`)
      const entry = { field: 'apply-direct', illegal: JSON.stringify(value), themeBefore: before, themeAfter: after.attr, threw: r.threw, note: 'calls applyThemePreferences without going through loadThemePreferences' }
      results.push(entry)
      for (const b of bad) failures.push(`SETTINGS apply(${JSON.stringify(value)}): ${b}`)
      console.log(`${bad.length ? 'FAIL' : 'OK  '} settings apply(${JSON.stringify(value)}) direct -> threw=${r.threw} data-theme=${after.attr} accent=${after.accent}${bad.length ? ' | ' + bad.join(' | ') : ''}`)
      await evaluate(`(function(){delete document.documentElement.dataset.theme;return true})()`)
    }
    await evaluate(`(function(){${original === null ? `window.localStorage.removeItem(${JSON.stringify(KEY)})` : `window.localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(original)})`};return true})()`)
    await send('Page.navigate', { url: APP })
    writeFileSync(`${OUT}/report-settings.json`, JSON.stringify({ provenance: buildProvenance(), cases: results, failures }, null, 2))
    console.log(`SETTINGS_GATE checked=${CASES.length + DIRECT.length} viaLoad=${CASES.length} viaApply=${DIRECT.length} failed=${failures.length}`)
    emitGate('settings-guard', CASES.length + DIRECT.length, failures.length, { viaLoad: CASES.length, viaApply: DIRECT.length })
    console.log(failures.length ? `settings-guard: ${failures.length} failure(s) - an out-of-band value reached the UI or blanked it` : `settings-guard: all ${CASES.length + DIRECT.length} illegal values fell back or were refused (${CASES.length} through load, ${DIRECT.length} straight into apply), none blanked the app`)
    finish(failures.length ? 1 : 0)
  }

  if (MODE === 'theme-surfaces') {
    // Which surfaces do not follow the theme at all. Not a grep for a class name: the same element
    // is photographed under all three themes and compared to itself. A surface whose rendered
    // pixels are identical in default, midnight and sakura is ignoring the theme, whatever its
    // classes say - and a hard-coded white panel under a dark theme is not a contrast nit, it is
    // a white block floating on a dark UI.
    const applyTheme = (t) => evaluate(`(function(){const r=document.documentElement;if(${JSON.stringify(t)})r.dataset.theme=${JSON.stringify(t)};else delete r.dataset.theme;return r.dataset.theme||'default'})()`)
    const THEMES = [['default', ''], ['midnight', 'midnight'], ['sakura', 'sakura']]
    const ROUTES = routeList()
    // Deliberately theme-invariant, each with the reason. Anything outside this list that fails to
    // move is a finding.
    const WHITELIST = [
      // Four entries used to sit here - the modal scrim, the accent-filled button and the two toast
      // layers - and the DEAD-EXEMPTION rule below found none of them matched anything this run.
      // Not because those surfaces are unreachable (they are swept now, as 对话框 and 提示), but
      // because the palette remap made them follow the theme: bg-red-50 renders 254,242,242 under a
      // light theme and 43,21,25 under midnight. An exemption for a surface that moves is a licence
      // for a surface that has not moved yet.
      { re: /app-upload-button/, why: 'primary upload action: filled slate-950 with white label in all three themes, by design' },
      // Deliberately NOT whitelisted: pale status tints (bg-amber-50 and friends). The hue is
      // semantic, the luminance is not - whitelisting these by hue is what let a 1.02:1 banner
      // pass this gate as "by design". If a tint is to be exempt it must be exempt by name, here,
      // with a reason that survives a dark theme.
    ]
    // Two overlay surfaces are appended to the sweep: a whitelist entry that no sweep can ever
    // reach is a licence with no evidence behind it, and the modal scrim, the accent-filled button
    // and the toast pair were sitting in that list excusing surfaces this gate had never looked at.
    const SURFACES = ROUTES.concat(['对话框', '提示'])
    const raiseToasts = async () => {
      const r = await evaluate(`(async function(){
        try {
          const m = await import('/src/store/useToastStore.ts')
          if (typeof m.notifyError !== 'function' || typeof m.notifySuccess !== 'function') return { ok: false, why: 'notifyError/notifySuccess are not exported: ' + Object.keys(m).join(',') }
          m.notifyError('SURFACE 错误提示文案')
          m.notifySuccess('SURFACE 成功提示文案')
          return { ok: true }
        } catch (e) { return { ok: false, why: String(e).slice(0, 160) } }
      })()`)
      if (!r.ok) { console.log(`HARNESS FAULT: cannot raise a toast in order to sample it (${r.why}); the toast whitelist entries are then unexercised and must be deleted.`); finish(2) }
      await sleep(300)
      const seen = await evaluate(`document.querySelectorAll('[role=alert], [role=status]').length`)
      if (!seen) { console.log('HARNESS FAULT: the toast store accepted two pushes but no [role=alert]/[role=status] node exists, so the toast surface was never on screen to sample.'); finish(2) }
      return r
    }
    // Control: plant one surface that follows the theme and one that does not, and require the
    // test to tell them apart. Without this, "42 frozen" is indistinguishable from "the sampler
    // cannot see a background change".
    await goto(ROUTES[0])
    await applyTheme('')
    const ctl = await (async () => {
      await evaluate(`(function(){
        const host=document.querySelector('main')||document.body;
        // Pinned into the viewport: appended at the end of main these two panels sit below the
        // fold, the sample point falls outside the screenshot, and both read black - which made
        // the "follows the theme" panel look frozen too. The control caught its own bug.
        const a=document.createElement('div'); a.id='ctl-follows'; a.style.cssText='position:fixed;left:8px;top:8px;z-index:2147483000;background:var(--surface);width:200px;height:60px'; a.textContent='follows';
        const b=document.createElement('div'); b.id='ctl-ignores'; b.style.cssText='position:fixed;left:8px;top:80px;z-index:2147483000;background:#ffffff;width:200px;height:60px'; b.textContent='ignores';
        host.appendChild(a); host.appendChild(b); return true;
      })()`)
      const seen = {}
      for (const [name, value] of THEMES) {
        await applyTheme(value)
        await sleep(120)
        await evaluate(`(function(){const s=document.createElement('style');s.id='lctl-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important}';document.head.appendChild(s);return true})()`)
        const sd = await send('Page.captureScreenshot', { format: 'png' })
        await evaluate(`(function(){const s=document.getElementById('lctl-hide');if(s)s.remove();return true})()`)
        seen[name] = await evaluate(`(async function(){
          const img=new Image(); await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src='data:image/png;base64,${sd.data}'});
          const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
          const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
          const at=(sel)=>{const e=document.querySelector(sel); if(!e) return null; const r=e.getBoundingClientRect(); const p=ctx.getImageData(Math.round(r.left+6),Math.round(r.top+6),1,1).data; return [p[0],p[1],p[2]].join(',')};
          return { follows: at('#ctl-follows'), ignores: at('#ctl-ignores') };
        })()`)
      }
      await applyTheme('')
      await evaluate(`(function(){['ctl-follows','ctl-ignores'].forEach(i=>{const e=document.getElementById(i); if(e)e.remove()}); return true})()`)
      const same = (x, y) => { if (!x || !y) return false; const a = x.split(',').map(Number), b = y.split(',').map(Number); return Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2 }
      return {
        followsMoves: !(same(seen.default.follows, seen.midnight.follows) && same(seen.default.follows, seen.sakura.follows)),
        ignoresFrozen: same(seen.default.ignores, seen.midnight.ignores) && same(seen.default.ignores, seen.sakura.ignores),
        detail: seen,
      }
    })()
    if (!ctl.followsMoves || !ctl.ignoresFrozen) {
      console.log(`HARNESS FAULT: the theme-surface test cannot tell a theme-following panel from a hard-coded one (followsMoves=${ctl.followsMoves}, ignoresFrozen=${ctl.ignoresFrozen}, samples=${JSON.stringify(ctl.detail)}). Its counts measure nothing.`)
      finish(2)
    }
    console.log(`CONTROL surfaces -> var(--surface) panel changed across themes=${ctl.followsMoves} (${ctl.detail.default.follows} -> ${ctl.detail.midnight.follows} -> ${ctl.detail.sakura.follows}); #ffffff panel stayed frozen=${ctl.ignoresFrozen} (${ctl.detail.default.ignores})`)
    const failures = []
    const rows = []
    let unownedTotal = 0

    for (const label of SURFACES) {
      await applyTheme('')
      if (label === '对话框') await openConfirm()
      else if (label === '提示') await raiseToasts()
      else await goto(label)
      await evaluate(`window.__L ? window.__L.settle() : document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});true`)
      await assertRealViewport(`surfaces:${label}`)
      const marked = await evaluate(`(function(){
        let i = 0;
        // An overlay occludes what is under it, and the sampler reads the pixel, not the element:
        // with the confirm dialog up, a card on the page behind it was being judged on the dialog's
        // red button and reported as "this card does not follow the theme". So a face that is an
        // overlay is enumerated as that overlay and nothing else.
        const SEL = ${JSON.stringify(label === '对话框' ? '[role=dialog] *' : label === '提示' ? '[role=alert], [role=status]' : 'main *, aside *, section *')};
        for (const e of document.querySelectorAll(SEL)) {
          const r = e.getBoundingClientRect();
          if (r.width < 120 || r.height < 48) continue;
          if (!(e.textContent || '').trim()) continue;
          const cs = getComputedStyle(e);
          if (cs.display === 'inline' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.9) continue;
          e.setAttribute('data-tsid', String(i++));
        }
        // A toast is the one semantic surface that is small by design (one line of 12px text in a
        // 38px box), so the 120x48 floor above would never mark it and its whitelist entry would be
        // unexercised. Marked by role instead, at its real size.
        for (const e of document.querySelectorAll('[role=alert], [role=status]')) {
          const r = e.getBoundingClientRect();
          if (r.width < 80 || r.height < 20) continue;
          e.setAttribute('data-tsid', String(i++));
        }
        return i;
      })()`)
      if (!marked) { rows.push({ route: label, skipped: 'no surface candidates' }); continue }
      const samples = {}
      for (const [themeName, themeValue] of THEMES) {
        await applyTheme(themeValue)
        await sleep(120)
        await evaluate(`(function(){const s=document.createElement('style');s.id='lctl-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}';document.head.appendChild(s);return true})()`)
        const sd = await send('Page.captureScreenshot', { format: 'png' })
        await evaluate(`(function(){const s=document.getElementById('lctl-hide');if(s)s.remove();return true})()`)
        samples[themeName] = await evaluate(`(async function(){
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${sd.data}' });
          const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
          const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
          const out = {};
          let unowned = 0;
          for (const e of document.querySelectorAll('[data-tsid]')) {
            const r = e.getBoundingClientRect();
            // A sample point outside the viewport is clamped onto the canvas edge and reads the
            // same pixel in every theme - which would look exactly like a frozen surface.
            if (r.width < 2 || r.height < 2) continue;
            const sx = Math.round(r.left + 6), sy = Math.round(r.top + 6);
            if (sx < 0 || sy < 0 || sx >= innerWidth || sy >= innerHeight) continue;
            const x = Math.max(0, Math.min(img.width - 1, sx));
            const y = Math.max(0, Math.min(img.height - 1, sy));
            const p = ctx.getImageData(x, y, 1, 1).data;
            const cs = getComputedStyle(e);
            // The pixel at a box's corner is not necessarily that box's paint: an overlapping
            // sibling was being charged to a card that merely shared its coordinates, and reported
            // under the card's class. So the reading is attributed to whoever actually paints the
            // point, and the row is labelled with THAT element - an alarm then names the surface that
            // does not follow the theme instead of an innocent one it happens to sit under.
            const painterOf = (node) => {
              let n = node;
              while (n && n.nodeType === 1) {
                const s = getComputedStyle(n);
                const bg = s.backgroundColor;
                const paints = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (s.backgroundImage && s.backgroundImage !== 'none');
                if (paints) return n;
                n = n.parentElement;
              }
              return null;
            }
            const hitEl = document.elementFromPoint(sx, sy);
            const painter = hitEl ? painterOf(hitEl) : null;
            const owner = painter || e;
            const oc = getComputedStyle(owner);
            const clsText = (owner.className || '').toString().trim();
            unowned += painter && painter !== e && !painter.hasAttribute('data-tsid') ? 1 : 0;
            out[e.getAttribute('data-tsid')] = {
              bg: [p[0], p[1], p[2]].join(','),
              cls: clsText.slice(0, 60),
              text: (owner.textContent || '').trim().slice(0, 24),
              fg: oc.color,
              point: [sx, sy],
              // Kept so a reader can see when the box and the painter differ, which is the whole
              // reason this attribution exists.
              box: (e.className || '').toString().trim().slice(0, 40),
              attributed: owner === e ? 'self' : 'painter',
              sel: owner.tagName.toLowerCase() + '.' + clsText.split(/\\s+/).slice(0, 2).join('.'),
            }
          }
          return { surfaces: out, unowned };
        })()`)
      }
      unownedTotal += Object.values(samples).reduce((a, v) => a + ((v && v.unowned) || 0), 0)
      const owned = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, (v && v.surfaces) || {}]))
      for (const id of Object.keys(owned.default || {})) {
        const d = owned.default[id], m = owned.midnight[id], s = owned.sakura[id]
        if (!m || !s) continue
        const same = (a, b) => { const p = (v) => v.split(',').map(Number), x = p(a), y = p(b); return Math.abs(x[0] - y[0]) <= 2 && Math.abs(x[1] - y[1]) <= 2 && Math.abs(x[2] - y[2]) <= 2 }
        const frozen = same(d.bg, m.bg) && same(d.bg, s.bg)
        const wl = WHITELIST.find((w) => w.re.test(d.cls))
        rows.push({ route: label, sel: d.sel, cls: d.cls, text: d.text, point: d.point, refused: d.refused, default: d.bg, midnight: m.bg, sakura: s.bg, frozen, whitelisted: wl ? wl.why : null })
        if (frozen && !wl) failures.push(`OFF-THEME ${label}: ${d.sel} renders the identical rgb(${d.bg}) in all three themes (text "${d.text}"; sampled at ${d.point}, attributed to ${d.attributed}${d.box && d.box !== d.cls ? ` instead of the box under it ${d.box}` : ''}) - it does not follow the theme and is not whitelisted`)
      }
      if (label === '对话框') { await pressEscape(); await sleep(250) }
      if (label === '提示') { await evaluate(`(async function(){const m=await import('/src/store/useToastStore.ts');const s=m.useToastStore.getState();s.toasts.forEach(function(t){s.dismiss(t.id)});return true})()`); await sleep(150) }
    }
    await applyTheme('')
    const frozenCount = rows.filter((r) => r.frozen).length
    // An exemption that matches nothing is not inert: it is a licence waiting for the next defect
    // that happens to fit its pattern. Every entry must be earning its place on this run.
    for (const w of WHITELIST) {
      const used = rows.filter((r) => r.frozen && w.re.test(r.cls)).length
      if (!used) failures.push(`DEAD-EXEMPTION theme-surfaces: /${w.re.source}/ ("${w.why}") matched 0 of ${rows.length} sampled surfaces this run - delete it, or it will quietly excuse a future one`)
    }
    writeFileSync(`${OUT}/theme-surfaces.json`, JSON.stringify({ provenance: buildProvenance(), note: 'a surface is OFF-THEME when the pixel photographed 6px inside its top-left corner is identical (<=2/255 per channel) under default, midnight and sakura', whitelist: WHITELIST.map((w) => w.why), rows }, null, 2))
    if (budgetHits) { console.log(`CONTRAST_GATE INCOMPLETE: covered ${comboIndex}/${combosTotal} combinations inside the ${DEADLINE_MS}ms budget; the unmeasured remainder is not a pass.`); finish(2) }
    for (const f of failures) console.log(`FAIL ${f}`)
    // Printed, not capped. A first version capped this at 25% and tripped immediately at 316/186,
    // because the marked set is "boxes at least 120x48" while the element that actually paints a
    // point is usually a small unmarked child - so the number measures the gate's own granularity,
    // not a loss of coverage. A ceiling needs a denominator that means something; this one does not,
    // so it reports and stays out of the exit code.
    console.log(`SURFACE_GATE routes=${ROUTES.length} surfaces=${rows.length} frozen=${frozenCount} offThemeUnwhitelisted=${failures.length} whitelisted=${rows.filter((r) => r.frozen && r.whitelisted).length} paintedByUnmarked=${unownedTotal}`)
    emitGate('theme-surfaces', rows.length, failures.length, { frozen: frozenCount })
    console.log(failures.length ? `theme-surfaces: ${failures.length} surface(s) ignore the theme` : `theme-surfaces: every sampled surface follows the theme (${frozenCount} frozen, all whitelisted)`)
    finish(failures.length ? 1 : 0)
  }

  if (MODE === 'layout') {
    // The geometry floor. `pages` proves a route painted; it measures no box, so horizontal
    // overflow, silently clipped text, sub-threshold touch targets, an invisible focus ring and a
    // broken image all pass there. Each tier is a CSS-viewport override of a real window size the
    // app can be resized to (640x480 is tauri.conf.json's minWidth x minHeight), not a phone.
    const TIERS = [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 640, height: 480 },
    ]
    const ROUTES = routeList()
    const TOUCH = Number(opt('touch', '44'))
    const onlyTier = opt('tier', '') ? Number(opt('tier', '')) : null
    const tiers = onlyTier ? TIERS.filter((t) => t.width === onlyTier) : TIERS
    if (!tiers.length) { console.error(`unknown --tier ${onlyTier}; known: ${TIERS.map((t) => t.width).join(' ')}`); finish(2) }

    await evaluate(LAYOUT_PROBE)

    const results = []
    const failures = []
    const skippedFindings = []
    const stuckLoading = []
    // Per page/width: how many cut families were emitted before grouping, and how many clipping root
    // causes there actually are. This is the number that stops a future reader adding the lines back
    // up and calling the total a defect count.
    const cutIdentity = []
    const railProofTotals = []
    // Distinct transient-overlay controls, aggregated across every route and tier that showed them.
    const overlayTargets = new Map()
    let overlayProbeTotal = 0
    const fontSwallow = new Map()
    const fontSwallowByRoute = []
    let fontSwallowProbeTotal = 0
    // Positive control with two placements, because the document-level criterion and the per-element
    // criterion must be shown to be different tests: a 2400px box planted inside a clipping ancestor
    // must be caught only by the per-element one. Without this, "0 failures" across 21 page/width
    // combinations is indistinguishable from a sweep that cannot see anything.
    const control = await evaluate(`(function(){
      window.__L.settle();
      const wide = () => { const d = document.createElement('div'); d.style.cssText = 'width:2400px;height:12px;background:red'; return d };
      const LONG = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop';
      const host = document.querySelector('main') || document.body;
      const clipper = Array.from(host.querySelectorAll('*')).find((e) => { const cs = getComputedStyle(e); return cs.overflowX !== 'visible' && !/auto|scroll/.test(cs.overflowX) && e.clientWidth > 40 && e.clientWidth < innerWidth });
      const baseline = window.__L.geometry(0);
      const report = { baselineDocOverflow: baseline.docOverflowPx, baselineClips: baseline.clippedByAncestorTotal };
      const probe = {};
      if (clipper) {
        // Text-bearing, because the ancestor-clip criterion is defined over text leaves: content
        // that is silently cut where a reader would look for it.
        const d = document.createElement('div');
        d.style.cssText = 'width:2400px;height:12px;white-space:nowrap;font-size:12px;overflow:visible';
        d.textContent = 'LCTL' + LONG;
        clipper.appendChild(d);
        const g = window.__L.geometry(0);
        const mine = g.clippedByAncestor.filter((c) => c.text && c.text.indexOf('LCTL') === 0)
        probe.clippedPlacement = { docOverflowPx: g.docOverflowPx, clippedByAncestorTotal: g.clippedByAncestorTotal, caught: mine.length > 0, worst: mine.length ? Math.max(...mine.map((c) => c.excess)) : null };
        d.remove()
      }
      else probe.clippedPlacement = { skipped: 'no non-scrolling clipping ancestor found on this page' };
      const d2 = wide(); document.documentElement.appendChild(d2); const g2 = window.__L.geometry(0);
      probe.scrollPlacement = { docOverflowPx: g2.docOverflowPx, docPx: g2.docOverflowPx - baseline.docOverflowPx, viewportPx: g2.viewportOverflowPx, caughtByDoc: g2.docOverflowPx > baseline.docOverflowPx, caughtByViewport: g2.viewportOverflowPx > 0 };
      d2.remove();
      // Negative controls: the four known false-positive sources. Each plants something that must
      // NOT be reported, so an exclusion that never fires cannot be mistaken for a clean page.
      const mk = (css, text) => { const d = document.createElement('span'); d.style.cssText = css; d.textContent = text; return d };
      const sr = mk('position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0', LONG);
      const rail = mk('display:block;width:60px;overflow-x:auto;white-space:nowrap;font-size:12px', LONG);
      const real = mk('display:block;width:60px;overflow:hidden;white-space:nowrap;font-size:12px', LONG);
      host.appendChild(sr); host.appendChild(rail); host.appendChild(real);
      const g3 = window.__L.geometry(0);
      const hit = (needle) => g3.clipped.some((c) => c.text === needle);
      probe.negative = {
        srOnlySkipped: g3.skipSrOnly > baseline.skipSrOnly && !hit(LONG),
        scrollRailSkipped: g3.skipScrollRail > baseline.skipScrollRail,
        realCutStillCaught: g3.clippedTotal > baseline.clippedTotal,
        realCutDelta: g3.clippedTotal > baseline.clippedTotal ? Math.max(...g3.clipped.map((c) => c.delta)) : null,
      };
      sr.remove(); rail.remove(); real.remove();
      // The reachability pair: a leaf inside a scroll rail is reachable, so it must NOT be reported;
      // the rail itself, when an outer overflow:hidden cuts it, must be reported at its own level.
      const outer = document.createElement('div'); outer.style.cssText = 'width:180px;overflow:hidden'
      const inner = document.createElement('div'); inner.style.cssText = 'width:400px;overflow-x:auto;white-space:nowrap;font-size:12px'
      const leaf = document.createElement('span'); leaf.textContent = 'LCTL2' + LONG
      inner.appendChild(leaf); outer.appendChild(inner); host.appendChild(outer)
      const g4 = window.__L.geometry(0)
      probe.railThenOuter = {
        leafNotFlagged: !g4.clippedByAncestor.some((c) => c.text && c.text.indexOf('LCTL2') === 0),
        railFlagged: g4.containersCut.some((c) => c.excess > 100),
        worst: Math.max(0, ...g4.containersCut.map((c) => c.excess)),
      }
      outer.remove();
      // Two focus controls, one in each direction. A ring drawn on a wrapper must read as visible
      // (otherwise every component library that styles :focus-within is a false red), and a bare
      // outline:none with no substitute must read as invisible (otherwise the test is decorative).
      const sheet = document.createElement('style');
      sheet.textContent = '.lctl-none{outline:none !important;box-shadow:none !important;border:1px solid rgb(200,200,200);background:rgb(255,255,255)}' +
        '.lctl-wrap{display:inline-block}.lctl-wrap:focus-within{box-shadow:0 0 0 3px rgba(79,70,229,.55)}';
      document.head.appendChild(sheet);
      const fa0 = document.createElement('button'); fa0.className = 'lctl-none'; fa0.textContent = 'lctlNoRing';
      const wrap = document.createElement('div'); wrap.className = 'lctl-wrap';
      const fb0 = document.createElement('button'); fb0.className = 'lctl-none'; fb0.textContent = 'lctlWrapperRing';
      wrap.appendChild(fb0); host.appendChild(fa0); host.appendChild(wrap);
      window.__L.markFocusables();
      fa0.focus(); const stopA = window.__L.focusNow();
      fb0.focus(); const stopB = window.__L.focusNow();
      probe.focus = { noRingRed: stopA.visible === false, wrapperRingGreen: stopB.visible === true, ringLevel: stopB.ringLevel, aChanged: stopA.changed, bChanged: stopB.changed };
      fa0.remove(); wrap.remove(); sheet.remove();
      // Cross-axis control: a horizontal rail that also cuts vertically. A single boolean that
      // stops the chain on "any axis scrolls" excuses the vertical cut as well - this shape is
      // what distinguishes per-axis from per-element.
      const xRail = document.createElement('div')
      xRail.style.cssText = 'width:200px;height:26px;overflow-x:auto;overflow-y:hidden;font-size:12px;line-height:18px'
      xRail.innerHTML = '<span id="lctl-yvictim">LCTLY' + ' y-brim ' + LONG + '</span>'
      const tall = document.createElement('div'); tall.style.cssText = 'height:40px'
      tall.appendChild(xRail); host.appendChild(tall)
      const g5 = window.__L.geometry(0)
      const vic = g5.clippedByAncestor.filter((c) => c.text && c.text.indexOf('LCTLY') === 0)
      probe.crossAxis = {
        yCaught: vic.some((c) => c.lostY > 1),
        xExcused: vic.length > 0 && vic.every((c) => c.lostX <= 1),
        lostY: vic.length ? Math.max(...vic.map((c) => c.lostY)) : null,
        lostX: vic.length ? Math.max(...vic.map((c) => c.lostX)) : null,
      }
      tall.remove();
      // Touch-target controls. Two exclusions were just added to the probe - measure the label
      // instead of the control's own box, and count transient-overlay controls separately - and an
      // exclusion that has never fired is indistinguishable from a page with nothing to exclude. So
      // each is planted twice, once where it must apply and once where it must not swallow a defect:
      // a 13px checkbox inside a 220x60 label is fine and must go quiet, a checkbox inside an 18px
      // label is NOT fine (the label is the target and it is under the floor) and must still be
      // reported, naming the label. The overlay pair checks both halves of the split: moved out of
      // the page total, but still reported once.
      const mkCtl = (tag, css) => { const x = document.createElement(tag); x.style.cssText = css; return x };
      const bigL = mkCtl('label', 'display:flex;align-items:center;gap:6px;width:220px;height:60px;font-size:12px');
      bigL.appendChild(document.createTextNode('LCTLbig'));
      const bigIn = mkCtl('input', 'width:13px;height:13px'); bigL.appendChild(bigIn);
      const smallL = mkCtl('label', 'display:inline-flex;align-items:center;width:60px;height:18px;font-size:10px');
      smallL.appendChild(document.createTextNode('LCTLsmall'));
      const smallIn = mkCtl('input', 'width:13px;height:13px'); smallL.appendChild(smallIn);
      const forL = mkCtl('label', 'display:block;width:200px;height:50px;font-size:12px'); forL.textContent = 'LCTLfor';
      forL.htmlFor = 'lctl-chk-for';
      const forIn = mkCtl('input', 'width:13px;height:13px'); forIn.id = 'lctl-chk-for';
      const ovWrap = mkCtl('div', 'position:fixed;bottom:8px;right:8px;width:260px');
      ovWrap.setAttribute('role', 'status');
      const ovBtn = mkCtl('button', 'width:16px;height:16px;padding:0;font-size:9px;overflow:hidden'); ovBtn.textContent = 'LCTLov';
      ovWrap.appendChild(ovBtn);
      const gT0 = window.__L.geometry(${TOUCH});
      host.appendChild(bigL); host.appendChild(smallL); host.appendChild(forIn); host.appendChild(forL); host.appendChild(ovWrap);
      const g6 = window.__L.geometry(${TOUCH});
      const named = (needle) => g6.smallTargets.filter((c) => c.text && c.text.indexOf(needle) === 0);
      // Delta against the same page with nothing planted, not an absolute: the real page contributes
      // its own rescued targets, and an assertion written as ">= 2" would pass on those alone.
      const dRescued = g6.rescuedByLabel - gT0.rescuedByLabel;
      const dOverlay = g6.overlayInstances - gT0.overlayInstances;
      probe.touch = {
        pageTotal: g6.smallTotal,
        bigLabelRescued: dRescued === 2 && named('LCTLbig').length === 0,
        forLabelRescued: named('LCTLfor').length === 0 && dRescued === 2,
        smallLabelCaught: named('LCTLsmall').length === 1 && named('LCTLsmall')[0].sel.indexOf('measured as label') !== -1,
        smallLabelSize: named('LCTLsmall').length ? [named('LCTLsmall')[0].w, named('LCTLsmall')[0].h] : null,
        overlaySplitOut: named('LCTLov').length === 0 && g6.overlaySmall.some((o) => o.text === 'LCTLov'),
        overlayRecorded: dOverlay === 1,
        dRescued, dOverlay,
      };
      bigL.remove(); smallL.remove(); forIn.remove(); forL.remove(); ovWrap.remove();
      // SELF-CLIP pair. The vertical half of the criterion just gained a precondition (the element
      // has to clip on the axis being judged), so both directions need a plant: a box that genuinely
      // cuts its own text must still be caught, and the 刷新 shape - a line box taller than its own
      // non-clipping box - must stop being reported. Without the second half, "the finding went away"
      // and "the criterion was blinded" look identical.
      const inkH = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return Math.round(rg.getBoundingClientRect().height * 10) / 10 };
      const cutY = mkCtl('div', 'width:120px;height:14px;overflow:hidden;font-size:12px;line-height:24px');
      cutY.textContent = 'LCTLclipy 两行文字';
      const noClip = mkCtl('button', 'display:flex;align-items:center;height:40px;width:34px;padding:0;font-size:16px;line-height:24px;overflow:visible');
      noClip.textContent = 'LCTLnoclip刷新文字';
      host.appendChild(cutY); host.appendChild(noClip);
      const g7 = window.__L.geometry(0);
      const cutRec = (n) => g7.clipped.filter((c) => c.text && c.text.indexOf(n) === 0);
      probe.selfClip = {
        clipYCaught: cutRec('LCTLclipy').length === 1 && cutRec('LCTLclipy')[0].vDelta > 1 && cutRec('LCTLclipy')[0].hDelta === 0,
        clipYDelta: cutRec('LCTLclipy').length ? [cutRec('LCTLclipy')[0].hDelta, cutRec('LCTLclipy')[0].vDelta] : null,
        clipYOf: (function () { const c = getComputedStyle(cutY); return c.overflowX + '/' + c.overflowY })(),
        noClipIgnored: cutRec('LCTLnoclip').length === 0,
        // A green half only means something if the plant actually has the shape being excused. The
        // first version of this plant used Latin text, which does not wrap, so it measured 21px of
        // ink in a 40px box and "passed" by never reproducing the defect at all.
        plantReproduces: inkH(noClip) > noClip.getBoundingClientRect().height,
        noClipInkH: inkH(noClip),
        noClipBoxH: Math.round(noClip.getBoundingClientRect().height * 10) / 10,
        noClipOf: (function () { const c = getComputedStyle(noClip); return c.overflowX + '/' + c.overflowY })(),
      };
      cutY.remove(); noClip.remove();
      // TEXT-ESCAPE pair. The SELF-CLIP narrowing took the 534cc15 shape (a 64-character hash with
      // overflow-wrap removed) down with it: that text is not cut, it paints past the card edge, and
      // it needed its own criterion rather than a reverted false positive. The green half has to
      // prove hand-off, not deletion - a run clipped by an ancestor must leave TEXT-ESCAPE and show
      // up in the ancestor-clip family, never vanish from both.
      const LONGX = 'LCTLescapeabcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz';
      const esc = mkCtl('div', 'width:260px;overflow:visible;white-space:nowrap;font-size:12px');
      esc.textContent = LONGX;
      const escHost = mkCtl('div', 'width:200px;overflow:hidden');
      const escClipped = mkCtl('div', 'width:260px;overflow:visible;white-space:nowrap;font-size:12px');
      escClipped.textContent = 'LCTLesclip' + LONGX.slice(10);
      escHost.appendChild(escClipped);
      const gE0 = window.__L.geometry(0);
      document.documentElement.appendChild(esc); document.documentElement.appendChild(escHost);
      const gE1 = window.__L.geometry(0);
      const escRec = (n) => gE1.textEscapedAll.filter((c) => c.text && c.text.indexOf(n) === 0);
      probe.textEscape = {
        caught: escRec('LCTLescape').length === 1 && escRec('LCTLescape')[0].excess > 1,
        excess: escRec('LCTLescape').length ? escRec('LCTLescape')[0].excess : null,
        clippedHandedOff: escRec('LCTLesclip').length === 0
          && gE1.clippedByAncestor.some((c) => c.text && c.text.indexOf('LCTLesclip') === 0),
        clippedStillReported: gE1.clippedByAncestorTotal > gE0.clippedByAncestorTotal,
        dEscape: gE1.textEscapedTotal - gE0.textEscapedTotal,
      };
      esc.remove(); escHost.remove();
      // FONT-SWALLOW pair. The plant carries its own copy of the bug - an unlayered element rule that
      // outranks the utility layer - so this control keeps proving the mechanism after the app's own
      // reset is fixed, instead of freezing today's defect in place. The second plant declares the
      // same utility with an inline size, which must agree, so the check cannot be "any button
      // carrying text-xs is guilty".
      const fsSheet = document.createElement('style');
      fsSheet.textContent = 'button.lctl-swallow{font:inherit}';
      document.head.appendChild(fsSheet);
      const fsBad = mkCtl('button', ''); fsBad.className = 'lctl-swallow text-xs'; fsBad.textContent = 'LCTLfsBad';
      const fsGood = mkCtl('button', 'font-size:12px'); fsGood.className = 'text-xs'; fsGood.textContent = 'LCTLfsGood';
      const fsRef = mkCtl('span', 'position:absolute;left:-9999px;top:0'); fsRef.className = 'text-xs'; fsRef.textContent = 'r';
      const gF0 = window.__L.geometry(${TOUCH});
      host.appendChild(fsBad); host.appendChild(fsGood); host.appendChild(fsRef);
      const gF1 = window.__L.geometry(${TOUCH});
      const refWant = getComputedStyle(fsRef).fontSize;
      probe.fontChain = {
        dTotal: gF1.fontSwallowTotal - gF0.fontSwallowTotal,
        caught: gF1.fontSwallowTotal - gF0.fontSwallowTotal === 1,
        refWant,
        gotBad: getComputedStyle(fsBad).fontSize,
        gotGood: getComputedStyle(fsGood).fontSize,
        badIsSwallowed: getComputedStyle(fsBad).fontSize !== refWant,
        goodAgrees: getComputedStyle(fsGood).fontSize === refWant,
      };
      fsBad.remove(); fsGood.remove(); fsRef.remove(); fsSheet.remove();
      const after = window.__L.geometry(0);
      probe.removedCleanly = after.clippedByAncestorTotal === baseline.clippedByAncestorTotal && after.docOverflowPx === baseline.docOverflowPx;
      probe.nodes = baseline.nodes; probe.textLeaves = baseline.textLeaves;
      probe.baselineDocOverflow = baseline.docOverflowPx; probe.baselineClips = baseline.clippedByAncestorTotal;
      return probe;
    })()`)
    const bad = []
    if (!control.clippedPlacement.caught) bad.push(`the per-element criterion missed a 2400px box planted inside an overflow:hidden ancestor (got ${JSON.stringify(control.clippedPlacement)})`)
    if (!control.scrollPlacement.caughtByDoc && !control.scrollPlacement.caughtByViewport) bad.push('neither criterion reacted to a 2400px box appended to documentElement')
    if (!control.removedCleanly) bad.push('the control leaked: counts did not return to baseline after removing the planted boxes')
    if (!control.negative.realCutStillCaught) bad.push('negative control failed: a genuinely cut overflow:hidden text run was NOT reported - the exclusions are swallowing real defects')
    if (!control.railThenOuter.leafNotFlagged) bad.push('a leaf inside a scroll rail was reported as cut, although scrolling brings it into view')
    if (!control.railThenOuter.railFlagged) bad.push(`the scroll rail itself was not reported although an outer overflow:hidden cuts it (worst container cut ${control.railThenOuter.worst}px)`)
    if (!control.focus.noRingRed) bad.push(`focus control failed: a button with outline:none and no box-shadow read as having a visible focus state (changed=${control.focus.aChanged})`)
    if (!control.focus.wrapperRingGreen) bad.push(`focus control failed: a ring drawn on the wrapper was missed, so real component-library rings would be false reds (changed=${control.focus.bChanged}, ringLevel=${control.focus.ringLevel})`)
    if (!control.crossAxis.yCaught) bad.push(`cross-axis control failed: a vertical cut behind a horizontal rail was excused (lostY=${control.crossAxis.lostY}) - the stop rule is not per-axis`)
    if (!control.crossAxis.xExcused) bad.push(`cross-axis control failed: the horizontal rail's own scrollable axis was reported as a cut (lostX=${control.crossAxis.lostX}) - now over-correcting`)
    for (const [k, why] of [['srOnlySkipped', 'a visually-hidden sr-only span was counted as cut-off text'], ['scrollRailSkipped', 'an overflow-x:auto rail was counted as a clip rather than a reachable scroll']]) {
      if (!control.negative[k]) bad.push(`negative control failed: ${why}`)
    }
    // The two touch-target exclusions added this round, each with the half that must NOT fire.
    if (!control.touch.bigLabelRescued) bad.push(`touch control failed: a 13px checkbox inside a 220x60 label was still charged to the page (rescued delta=${control.touch.dRescued}) - the count would fault the app for a box no finger aims at`)
    if (!control.touch.forLabelRescued) bad.push(`touch control failed: a label associated by for= was not treated as the control's touch target (rescued delta=${control.touch.dRescued})`)
    if (!control.touch.smallLabelCaught) bad.push(`touch control failed: a checkbox whose own label is 18px tall was NOT reported (found ${JSON.stringify(control.touch.smallLabelSize)}) - the label rule is swallowing a real sub-floor target`)
    if (control.touch.smallLabelCaught && control.touch.smallLabelSize.join('x') !== '60x18') bad.push(`touch control: the sub-floor label was reported at ${JSON.stringify(control.touch.smallLabelSize)} instead of the label box 60x18 - the finding would name the wrong element to fix`)
    if (!control.touch.overlaySplitOut) bad.push('touch control failed: a button inside a [role=status] overlay was counted in the page total')
    if (!control.touch.overlayRecorded) bad.push(`touch control failed: the overlay button was dropped rather than aggregated (overlay instance delta=${control.touch.dOverlay}) - splitting it out must report it once, not lose it`)
    if (!control.selfClip.clipYCaught) bad.push(`SELF-CLIP precondition blinded the vertical half: a 14px box with overflow ${control.selfClip.clipYOf} cutting a 24px line was not reported (h/v delta ${JSON.stringify(control.selfClip.clipYDelta)})`)
    if (!control.selfClip.noClipIgnored) bad.push(`SELF-CLIP still charges a box that does not clip: ink ${control.selfClip.noClipInkH}px inside a ${control.selfClip.noClipBoxH}px box with overflow ${control.selfClip.noClipOf} was reported as cut text`)
    if (!control.selfClip.plantReproduces) bad.push(`SELF-CLIP green-half plant is vacuous: its ink box (${control.selfClip.noClipInkH}px) never exceeded its ${control.selfClip.noClipBoxH}px box, so it does not reproduce the shape the precondition excuses`)
    if (!control.fontChain.caught) bad.push(`FONT-SWALLOW counted ${control.fontChain.dTotal} control(s) for a plant pair that should move it by exactly 1 - the declared-versus-rendered check is not tracking its own input`)
    if (!control.fontChain.badIsSwallowed) bad.push(`FONT-SWALLOW plant is not a real swallow: the planted button rendered ${control.fontChain.gotBad}, same as its declared ${control.fontChain.refWant} - the control proves nothing`)
    if (!control.fontChain.goodAgrees) bad.push(`FONT-SWALLOW green half broken: the plant that declares text-xs and sets its size inline rendered ${control.fontChain.gotGood} while the utility itself measures ${control.fontChain.refWant} - the check would report controls that are behaving`)
    if (!control.textEscape.caught) bad.push(`TEXT-ESCAPE missed a 260px nowrap run sitting in a chain that clips nowhere (excess ${control.textEscape.excess}px) - the criterion written to replace the false SELF-CLIP reading cannot see the shape it exists for`)
    if (!control.textEscape.clippedHandedOff) bad.push('TEXT-ESCAPE did not hand off: the identical run inside an overflow:hidden ancestor either still counts as an escape, or has left both criteria')
    if (!control.textEscape.clippedStillReported) bad.push('the clipped escape plant was reported by neither criterion - the exclusion deleted a defect instead of routing it to the ancestor-clip family')
    if (control.textEscape.dEscape !== 1) bad.push(`TEXT-ESCAPE moved by ${control.textEscape.dEscape} for a plant pair that must move it by exactly 1 - one of the two halves is not doing what its name says`)
    // The divergence is the point, not a failure: the clip placement leaves the document-level
    // number untouched while the per-element one fires. Recorded so nobody re-merges them later.
    const docBlindToClip = control.clippedPlacement.caught && control.clippedPlacement.docOverflowPx === control.baselineDocOverflow
    console.log(`CONTROL-A (a) wide box -> VIEWPORT-OVERFLOW +${control.scrollPlacement.viewportPx}px and DOC-OVERFLOW +${control.scrollPlacement.docPx}px, each fired once`)
    console.log(`CONTROL-B (b) ancestor hidden -> CLIP-BY-ANCESTOR +${control.clippedPlacement.worst}px while DOC-OVERFLOW stayed at ${control.clippedPlacement.docOverflowPx}px (baseline ${control.baselineDocOverflow}px) => document-level blind here: ${docBlindToClip ? 'YES' : 'no'}`)
    console.log(`CONTROL-C (c) self hidden -> SELF-CLIP +${control.negative.realCutDelta}px; overflow:hidden was NOT accepted as an escape hatch`)
    console.log(`CONTROL-negatives -> sr-only skipped=${control.negative.srOnlySkipped}, overflow-x:auto rail skipped=${control.negative.scrollRailSkipped}`)
    console.log(`CONTROL-D rail-then-outer -> leaf inside a scroll rail left alone=${control.railThenOuter.leafNotFlagged}; the rail itself reported when an outer overflow:hidden cuts it=${control.railThenOuter.railFlagged} (worst ${control.railThenOuter.worst}px)`)
    console.log(`CONTROL-F cross-axis -> rail overflow-x:auto + overflow-y:hidden: vertical cut reported=${control.crossAxis.yCaught} (lostY ${control.crossAxis.lostY}px), horizontal excused=${control.crossAxis.xExcused} (lostX ${control.crossAxis.lostX}px)`)
    console.log(`CONTROL-E focus -> outline:none+no-shadow reads invisible=${control.focus.noRingRed}; ring drawn on a wrapper reads visible=${control.focus.wrapperRingGreen} (found at ancestor depth ${control.focus.ringLevel})`)
    console.log(`CONTROL-T touch -> 13px checkbox inside a 220x60 label excused=${control.touch.bigLabelRescued}; for=-associated label excused=${control.touch.forLabelRescued}; 13px checkbox inside an 18px label still RED=${control.touch.smallLabelCaught} (measured ${control.touch.smallLabelSize ? control.touch.smallLabelSize.join('x') : 'n/a'} = the label box, which is the element to fix); [role=status] button out of the page count=${control.touch.overlaySplitOut} and reported once rather than lost=${control.touch.overlayRecorded} (rescued delta=${control.touch.dRescued}, overlay instances delta=${control.touch.dOverlay})`)
    console.log(`CONTROL-G self-clip -> a 14px overflow:${control.selfClip.clipYOf} box cutting a 24px line is still reported=${control.selfClip.clipYCaught} (h/v delta ${JSON.stringify(control.selfClip.clipYDelta)}); a ${control.selfClip.noClipBoxH}px button whose ink box is ${control.selfClip.noClipInkH}px with overflow ${control.selfClip.noClipOf} is no longer reported=${control.selfClip.noClipIgnored} - nothing clips there, so nothing was cut`)
    console.log(`CONTROL-H font -> planted an unlayered element rule over a text-xs utility: swallowed plant renders ${control.fontChain.gotBad} against the utility's own ${control.fontChain.refWant} (reported=${control.fontChain.badIsSwallowed}), inline-sized plant renders ${control.fontChain.gotGood} (not reported=${control.fontChain.goodAgrees}), count moved by ${control.fontChain.dTotal} for a pair that must move it by 1`)
    console.log(`CONTROL-I escape -> a 260px nowrap run in a chain that clips nowhere is reported=${control.textEscape.caught} (+${control.textEscape.excess}px past its own box); the same run inside an overflow:hidden ancestor left TEXT-ESCAPE and is reported by the ancestor-clip family instead=${control.textEscape.clippedHandedOff} (still reported there=${control.textEscape.clippedStillReported}); count moved by ${control.textEscape.dEscape} for a pair that must move it by 1`)
    console.log(`COVERAGE: the sr-only exclusion is proven only by the planted control. In a browser-only harness no plugin row renders, so the app's own .sr-only element (PluginsPage.tsx:175) is never reached - the branch works, the app path is unexercised.`)
    console.log(`COVERAGE: nodes=${control.nodes} textLeaves=${control.textLeaves} restored=${control.removedCleanly}`)
    if (bad.length) {
      for (const b of bad) console.log(`HARNESS FAULT ${b}`)
      finish(2)
    }
    for (const tier of tiers) {
      await send('Emulation.setDeviceMetricsOverride', { width: tier.width, height: tier.height, deviceScaleFactor: 1, mobile: false })
      // The override is asynchronous: reading innerWidth on the next tick returns the PREVIOUS
      // tier's width, which under verify:all made the 1024 tier abort and then blame the app.
      let took = false
      for (let i = 0; i < 20 && !took; i++) {
        await sleep(150)
        took = (await evaluate(`innerWidth`)) === tier.width
      }
      if (!took) { console.log(`HARNESS FAULT: the ${tier.width}x${tier.height} override never applied (innerWidth reports ${await evaluate('innerWidth')}); refusing to report anything measured at the wrong width.`); finish(2) }
      const v = await assertRealViewport(`layout:${tier.width}x${tier.height}`)
      if (v.innerWidth !== tier.width) {
        failures.push(`tier ${tier.width}: the override did not take - innerWidth reports ${v.innerWidth}`)
        continue
      }
      // If the document reloaded, the injected helpers are gone and every locator throws on
      // undefined. That must stop the run: reporting it per route turns one harness fault into
      // seven invented "navigation not reachable" findings.
      if (!(await evaluate(`!!(window.__H && window.__H.byText && window.__L)`))) {
        console.log(`HARNESS FAULT: the injected helpers are gone at tier ${tier.width} (window.__H/window.__L undefined) - the document reloaded mid-run, so no route here can be attributed to the app.`)
        finish(2)
      }
      for (const label of ROUTES) {
        const entry = { tier: `${tier.width}x${tier.height}`, route: label }
        try {
          if (label === 'confirm-longname') {
            // The 534cc15 shape: a 64-character hashed filename with no break opportunities inside a
            // 440px card. With overflow-wrap in place it wraps; strip it and the text runs out of
            // the card, which is what the per-element criterion exists to catch.
            await openConfirm()
            await evaluate(`(function(){const d=window.__H.dialog();const p=d.querySelector('p');p.textContent='确定永久删除选中的 128 个远端文件吗？\\n\\na3f9c21be7d84f05c6b18d27ea49f30b5c8d7e12a6b4f90c3d5e7a1b2c4d6e8f0.png\\nIMG_20260930_142530_原图_未命名.png';return true})()`)
          } else {
            await goto(label)
          }
        } catch (error) {
          entry.navError = String(error).slice(0, 150)
          failures.push(`${entry.tier} ${label}: navigation entry point not reachable - ${entry.navError}`)
          results.push(entry)
          continue
        }
        // Measure a loaded page. A route still showing a spinner has not laid out its real content,
        // and in a browser-only harness the data may never arrive at all - so this is recorded as
        // its own named condition rather than silently measured as if it were the shipped page.
        entry.spinnerWaitMs = await evaluate(`(async function(){
          const spinning = () => document.querySelectorAll('[class*="animate-spin"]').length;
          for (let i = 0; i < 40; i++) { if (!spinning()) return i * 250; await new Promise((r) => setTimeout(r, 250)); }
          return 10000;
        })()`)
        entry.spinnersAtMeasure = await evaluate(`document.querySelectorAll('[class*="animate-spin"]').length`)
        entry.settled = await evaluate(`window.__L.settle()`)
        await sleep(80)
        await assertRealViewport(`layout:${tier.width}:${label}`)
        if (entry.settled.geomCount) {
          console.log(`HARNESS FAULT: ${entry.tier} ${label} - ${entry.settled.geomCount} animation(s) move geometry and could not be settled (${entry.settled.geomRunning.map((r) => r.anim + ' on ' + r.sel).join('; ')}); any rect here is a mid-transition frame.`)
          finish(2)
        }
        const g = await evaluate(`window.__L.geometry(${tier.width === 640 ? TOUCH : 0})`)
        entry.geom = g
        // Nothing examined is not the same as nothing found; refuse to let an empty document report
        // a clean layout.
        if (!g.nodes || !g.textLeaves) {
          console.log(`HARNESS FAULT: ${entry.tier} ${label} - the sweep saw ${g.nodes} element(s) and ${g.textLeaves} text leaf(s); a page with no measured content cannot pass a layout gate.`)
          await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
          finish(2)
        }
        // A page still showing a spinner has not laid out its content, so whatever the sweep reads
        // there describes a loading state. Those routes enter neither the findings nor the pass
        // tally - they are reported as skipped, with their own count.
        const skippedHere = !!entry.spinnersAtMeasure
        const emit = (msg) => { if (skippedHere) skippedFindings.push(msg); else failures.push(msg) }
        if (skippedHere) {
          entry.stuckLoading = true
          if (!stuckLoading.includes(`${entry.tier} ${label}`)) stuckLoading.push(`${entry.tier} ${label}`)
        }
        if (g.docOverflowPx > 1) emit(`DOC-OVERFLOW ${entry.tier} ${label}: documentElement.scrollWidth ${g.docScrollWidth} exceeds innerWidth ${g.innerWidth} by ${g.docOverflowPx}px (a scrollbar / unreachable content)`)
        if (g.viewportOverflowPx > 1) emit(`VIEWPORT-OVERFLOW ${entry.tier} ${label}: ${g.offenders.length} element(s) extend past the viewport edge, widest +${g.offenders[0].over}px at ${g.offenders[0].sel} "${g.offenders[0].text}"`)
        // One clipping event, one finding. The three cut lists used to be emitted as three separate
        // families, so a single overflowing subtree produced one line for the control it cut, one for
        // its container and one for any text leaf - 14 lines for one bug, and the next reader counts
        // 14 defects. They are now grouped by the thing that can only be shared by accident: which
        // ancestor cut, on which axis.
        const cutRecords = [
          ...(g.clippedByAncestor || []).map((c) => ({ ...c, bucket: 'text' })),
          ...(g.controlsCut || []).map((c) => ({ ...c, bucket: 'control' })),
          ...(g.containersCut || []).map((c) => ({ ...c, bucket: 'container' })),
        ]
        const roots = new Map()
        for (const c of cutRecords) {
          const key = `${c.by}|${c.axis}`
          if (!roots.has(key)) roots.set(key, { by: c.by, axis: c.axis, overflow: c.overflow, members: [] })
          roots.get(key).members.push(c)
        }
        for (const rc of roots.values()) {
          const tally = rc.members.reduce((a, m) => { a[m.bucket] = (a[m.bucket] || 0) + 1; return a }, {})
          const worst = rc.members.reduce((a, m) => (m.excess > a.excess ? m : a), rc.members[0])
          emit(`CUT-ROOT ${entry.tier} ${label}: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')} element(s) cut by ${rc.by} on ${rc.axis} (overflow ${rc.overflow}) - worst +${worst.excess}px "${worst.text}" at ${worst.sel}`)
        }
        // The identity is printed because the whole point of grouping is a count a reader can trust,
        // and a count that cannot disagree with its own input is not a count. Two independent ways to
        // reach the same number must agree, and the listed records must add up to the pre-truncation
        // totals or the grouping is hiding the difference.
        const distinctKeys = new Set(cutRecords.map((c) => `${c.by}|${c.axis}`)).size
        const membersSum = [...roots.values()].reduce((a, rc) => a + rc.members.length, 0)
        const listed = cutRecords.length
        const totals = (g.clippedByAncestorTotal || 0) + (g.controlsCutTotal || 0) + (g.containersCutTotal || 0)
        cutIdentity.push({ tier: entry.tier, route: label, families_before: [g.clippedByAncestorTotal, g.controlsCutTotal, g.containersCutTotal].filter((n) => n).length, root_causes: roots.size, listed, membersSum, distinctKeys, records_total: totals, truncated: Math.max(0, totals - listed) })
        if (roots.size !== distinctKeys || membersSum !== listed) {
          console.log(`HARNESS FAULT: LAYOUT-IDENTITY ${entry.tier} ${label}: root_causes=${roots.size} distinct_keys=${distinctKeys} members=${membersSum} listed=${listed} - the grouping does not account for its own records, so its count is not a count.`)
          finish(2)
        }
        // "A rail stops the chain" is only an exemption if the content is reachable by scrolling it.
        // Without this line the sidebar fix could have passed by making the gate quiet instead of
        // making the button reachable, and the two look identical from the failure count.
        if (g.railProof && g.railProof.unreachable.length) {
          for (const u of g.railProof.unreachable.slice(0, 3)) {
            emit(`RAIL-UNREACHABLE ${entry.tier} ${label}: "${u.text}" at ${u.sel} hangs past the ${u.axis} edge and its rail ${u.rail} cannot bring it into view (rail moved=${u.moved}, visible after scrolling=${u.visible}, scrollSize=${u.scrollSize} clientSize=${u.clientSize})`)
          }
        }
        if (g.railProof) railProofTotals.push({ tier: entry.tier, route: label, proven: g.railProof.proven, unreachable: g.railProof.unreachable.length })
        if (g.clippedTotal) emit(`SELF-CLIP ${entry.tier} ${label}: ${g.clippedTotal} own-text run(s) cut with no ellipsis and no title - worst ${g.clipped[0].hDelta}px horizontal / ${g.clipped[0].vDelta}px vertical ink "${g.clipped[0].text}" at ${g.clipped[0].sel} [box ${g.clipped[0].m.height}px (client ${g.clipped[0].m.clientHeight} / scroll ${g.clipped[0].m.scrollHeight}), line-height ${g.clipped[0].m.lineHeight} on font ${g.clipped[0].m.fontSize}, padding ${g.clipped[0].m.pad}, overflow ${g.clipped[0].m.overflow}, ink box ${g.clipped[0].m.inkH}px tall extending ${JSON.stringify(g.clipped[0].m.inkOver)} past the border box]`)
        if (g.smallTotal) emit(`TOUCH-TARGET ${entry.tier} ${label}: ${g.smallTotal} page-owned clickable target(s) under ${TOUCH}x${TOUCH} (${Object.entries(g.smallByKind).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}) - smallest ${g.smallTargets[0].w}x${g.smallTargets[0].h} "${g.smallTargets[0].text}" at ${g.smallTargets[0].sel}`)
        // Transient overlays are counted, not dropped: they collect into one finding per distinct
        // control, naming every route that showed it. The alternative - one line per route - charged
        // five routes with the toast component's own close button.
        for (const o of (g.overlaySmall || [])) {
          const key = `${entry.tier}|${o.sel}|${o.w}x${o.h}`
          if (!overlayTargets.has(key)) overlayTargets.set(key, { tier: entry.tier, sel: o.sel, w: o.w, h: o.h, text: o.text, instances: 0, routes: new Set() })
          const agg = overlayTargets.get(key)
          agg.instances += o.occurrences
          agg.routes.add(label)
        }
        overlayProbeTotal += g.overlayInstances || 0
        if (g.rescuedByLabel || g.overlayInstances) entry.overlayExcluded = { rescuedByLabel: g.rescuedByLabel, overlayInstances: g.overlayInstances }
        if (g.textEscapedTotal) emit(`TEXT-ESCAPE ${entry.tier} ${label}: ${g.textEscapedTotal} text run(s) wider than their own box with nothing clipping anywhere up the chain - the glyphs paint past the container edge - worst +${g.textEscaped[0].excess}px past a ${g.textEscaped[0].clientWidth}px box "${g.textEscaped[0].text}" at ${g.textEscaped[0].sel}`)
        if (g.fontSwallowTotal) {
          // One CSS rule, not one defect per route: the sidebar and every shared control reappear on
          // all seven, so seven lines would be summed by the next reader as seven problems. The
          // per-route numbers survive as a census line; the finding is emitted once, below.
          for (const f of (g.fontSwallowedAll || [])) {
            const key = `${f.sel}|${f.util}|${f.want}->${f.got}`
            if (!fontSwallow.has(key)) fontSwallow.set(key, { sel: f.sel, util: f.util, want: f.want, got: f.got, wantLH: f.wantLH, gotLH: f.gotLH, text: f.text, n: 0, tiers: new Set(), routes: new Set() })
            const agg = fontSwallow.get(key)
            agg.n++
            agg.routes.add(label)
            agg.tiers.add(entry.tier)
          }
          fontSwallowProbeTotal += g.fontSwallowTotal
          fontSwallowByRoute.push({ tier: entry.tier, route: label, n: g.fontSwallowTotal })
        }
        if (g.brokenImages.length) emit(`BROKEN-IMAGE ${entry.tier} ${label}: ${g.brokenImages.length} image(s) with naturalWidth 0 - ${g.brokenImages.map((b) => b.src).join(', ')}`)
        entry.exclusions = { srOnly: g.skipSrOnly, ellipsis: g.skipEllipsis, title: g.skipTitle, scrollRail: g.skipScrollRail, fixed: g.skipFixed, railX: g.railX, railY: g.railY, textLeaves: g.textLeaves, measuredLeaves: g.measuredLeaves, targetRescuedByLabel: g.rescuedByLabel, targetInOverlay: g.overlayInstances }
        if (tier.width === 640) {
          const seen = []
          entry.focusableCount = await evaluate(`window.__L.markFocusables()`)
          await evaluate(`document.activeElement && document.activeElement.blur && document.activeElement.blur();true`)
          for (let i = 0; i < 12; i++) {
            for (const type of ['rawKeyDown', 'keyUp']) {
              await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
            }
            await sleep(40)
            const f = await evaluate(`window.__L.focusNow()`)
            seen.push(f)
          }
          entry.focusStops = seen
          const onControl = seen.filter((f) => !f.left)
          const noRing = onControl.filter((f) => f.visible === false)
          const noName = onControl.filter((f) => !f.name)
          if (noRing.length) failures.push(`FOCUS-RING ${entry.tier} ${label}: ${noRing.length}/${onControl.length} tab stops whose rendering does not change when focused (no outline, ring, border or background delta) - ${noRing.slice(0, 3).map((f) => f.sel + ' [resting ' + f.outline + ']').join('; ')}`)
          if (noName.length) failures.push(`FOCUS-NAME ${entry.tier} ${label}: ${noName.length}/${onControl.length} tab stops with no accessible name (aria-label, text, alt, title, placeholder, wrapping or for= label, aria-labelledby all empty) - ${noName.slice(0, 3).map((f) => f.sel + '<' + f.tag + '>').join('; ')}`)
        }
        await shot(`lay-${label}-${tier.width}`)
        if (label === 'confirm-longname') { await pressEscape(); await sleep(200) }
        results.push(entry)
      }
    }
    await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    // The overlay targets became their own findings: one line per distinct control, carrying the
    // route count and instance count with it. Identity: instances is what the probe saw, routes is
    // where - if instances were spread over more keys than this map holds, the aggregation lost one.
    const ov = [...overlayTargets.values()].filter((o) => o.instances > 0)
    const ovDropped = overlayTargets.size - ov.length
    for (const o of ov) failures.push(`TOUCH-TARGET ${o.tier} overlay(toast): ${o.w}x${o.h} "${o.text}" at ${o.sel} - ${o.instances} instance(s) across ${o.routes.size} route(s) [${[...o.routes].join(' ')}]; transient, so charged to the toast component rather than to those routes`)
    const ovInstances = ov.reduce((a, o) => a + o.instances, 0)
    console.log(`LAYOUT_OVERLAY distinct_controls=${ov.length} instances=${ovInstances} probe_reported=${overlayProbeTotal} routes_involved=${new Set(ov.flatMap((o) => [...o.routes])).size} keys_seen_only_on_skipped_pages=${ovDropped}`)
    // The probe's own per-page count is the denominator the aggregation has to account for. A merge
    // that silently loses an instance, or a bucket that skips a page it should not have, shows up
    // here as a mismatch instead of as a smaller, tidier number.
    if (ovInstances !== overlayProbeTotal) { console.log(`HARNESS FAULT: LAYOUT-OVERLAY-IDENTITY aggregated instances=${ovInstances} != probe reported=${overlayProbeTotal} - the overlay aggregation does not account for what the probe counted`); finish(2) }
    // The font finding, emitted once for the whole app rather than once per route, with the per-route
    // census printed beside it. Identity: the distinct-control occurrence sum has to equal what the
    // probe counted page by page, or the dedupe quietly dropped a control.
    const fsOccurrences = [...fontSwallow.values()].reduce((a, f) => a + f.n, 0)
    const fsRoutes = new Set(fontSwallowByRoute.map((r) => r.route))
    if (fontSwallow.size) {
      const worst = [...fontSwallow.values()].sort((a, b) => (b.routes.size - a.routes.size) || a.sel.localeCompare(b.sel))[0]
      failures.push(`FONT-SWALLOW app-wide (read at 640x480, ${ROUTES.length === ALL_ROUTES.length ? 'every route' : `a ${fsRoutes.size}-route subset`}): ${fontSwallow.size} distinct control(s) on ${fsRoutes.size} route(s) whose own text-* class is not the rendered font-size - e.g. "${worst.text}" at ${worst.sel} declares ${worst.util} (${worst.want}) and renders ${worst.got}, line-height ${worst.wantLH} -> ${worst.gotLH}; cause is one unlayered element reset outranking the utility layer, not ${fontSwallow.size} call sites`)
    }
    console.log(`FONT_SWALLOW distinct_controls=${fontSwallow.size} per_route=${fontSwallowByRoute.map((r) => `${r.route}=${r.n}`).join(' ')} instances_sum=${fontSwallowProbeTotal} deduped_occurrences=${fsOccurrences}`)
    if (fsOccurrences !== fontSwallowProbeTotal) { console.log(`HARNESS FAULT: FONT-SWALLOW-IDENTITY deduped_occurrences=${fsOccurrences} != probe instances_sum=${fontSwallowProbeTotal} - the dedupe lost a control, so distinct_controls under-reads`); finish(2) }
    const summary = { provenance: buildProvenance(), note: 'widths are Emulation.setDeviceMetricsOverride CSS viewports, not real device screens; 640x480 is the app minimum window from tauri.conf.json', stuckLoading, tiers: results, failures }
    writeFileSync(`${OUT}/layout-baseline.json`, JSON.stringify(summary, null, 2))
    if (budgetHits) { console.log(`CONTRAST_GATE INCOMPLETE: covered ${comboIndex}/${combosTotal} combinations inside the ${DEADLINE_MS}ms budget; the unmeasured remainder is not a pass.`); finish(2) }
    for (const f of failures) console.log(`FAIL ${f}`)
    if (stuckLoading.length) console.log(`STUCK-LOADING (excluded from both the findings and the pass tally; browser-only harness, no Rust invoke): ${stuckLoading.join(' | ')}`)
    if (skippedFindings.length) console.log(`SKIPPED-FINDINGS ${skippedFindings.length} condition(s) seen only on stuck-loading pages, listed for the record and NOT counted as failures:\n  ${skippedFindings.map((s) => s.slice(0, 120)).join('\n  ')}`)
    const checked = tiers.length * ROUTES.length
    const matched = results.filter((r) => r.geom && !r.stuckLoading).length
    const skipped = checked - matched
    // A skipped page is not a page that passed. The stuck-loading exclusion used to print a
    // warning line and still exit 0 - the shape flagged in the cross-repo report - so the set of
    // tolerated skips is now named, and a skip outside it fails the run. Empty means nothing at
    // all may be skipped: adding a route here is a written-down decision, not a silent one.
    const STUCK_OK = new Set()
    for (const r of results) {
      if (r.stuckLoading && !STUCK_OK.has(r.route)) failures.push(`LAYOUT-SKIP ${r.tier} ${r.route}: the page never finished loading under the browser-only harness, so nothing about its geometry was judged, and "${r.route}" is not in the named exclusion set`)
    }
    // Three exit codes because "no problems found" and "did not look at anything" are different
    // claims: 0 looked and clean, 1 findings, 2 harness fault, 3 nothing was measured at all.
    const ci = cutIdentity.reduce((a, r) => ({
      pages: a.pages + (r.root_causes ? 1 : 0),
      families_before: a.families_before + r.families_before,
      root_causes: a.root_causes + r.root_causes,
      listed: a.listed + r.listed,
      total: a.total + r.records_total,
      truncated: a.truncated + r.truncated,
    }), { pages: 0, families_before: 0, root_causes: 0, listed: 0, total: 0, truncated: 0 })
    console.log(`LAYOUT_FAMILIES pages_with_cuts=${ci.pages} family_lines_before_grouping=${ci.families_before} distinct_root_causes=${ci.root_causes} lines_not_double_counted=${ci.families_before - ci.root_causes} records_listed=${ci.listed} records_total=${ci.total} truncated=${ci.truncated}`)
    // The identity that makes the previous line a count rather than a presentation choice: every
    // record the probe found is either listed here or accounted for by the truncation, never neither.
    if (ci.listed + ci.truncated !== ci.total) {
      console.log(`HARNESS FAULT: LAYOUT-IDENTITY records_listed=${ci.listed} + truncated=${ci.truncated} != records_total=${ci.total} - cut records are unaccounted for, so distinct_root_causes under-reads.`)
      finish(2)
    }
    // RAIL-PROOF negative control. Until this exists, `unreachable=0` is a reading and not a gate:
    // nothing has shown the proof can report a failure, and three earlier versions of this criterion
    // were each wrong in a way that produced *more* unreachable rows, not fewer. So the control
    // plants a rail that genuinely cannot reach its content and requires the proof to name it -
    // while printing all three candidate criteria side by side, so a red here can only be read as
    // "unreachable because scrolling cannot bring it into view", never as a regression to one of the
    // three old bugs.
    const railCtl = await evaluate(`(function(){
      const host = document.createElement('div')
      host.id = 'rail-ctl'
      host.style.cssText = 'position:absolute;left:8px;top:' + Math.round(innerHeight + 260) + 'px;width:240px;z-index:1'
      const rail = document.createElement('div')
      rail.style.cssText = 'height:40px;overflow-y:auto;position:relative'
      const child = document.createElement('div')
      child.id = 'rail-ctl-child'
      // Negative offset: the rail clips upward and no scroller can scroll to a negative position,
      // so this is the shape that is genuinely unreachable. The first version of this plant parked
      // the child below the rail's origin and the control failed - not the proof - because
      // scrollIntoView walks outwards and an ancestor scroller could still bring it into view. That
      // is the right behaviour for the criterion and the wrong shape for a negative control.
      child.style.cssText = 'position:absolute;left:0;top:-30px;height:18px;width:200px;background:rgb(1,2,3)'
      child.textContent = 'LCTLRAIL'
      rail.appendChild(child); host.appendChild(rail); document.body.appendChild(host)
      const view = innerHeight
      const rect0 = child.getBoundingClientRect()
      // criterion 1 (wrong): the whole box must sit inside the viewport
      const wholeBox = rect0.top >= -1 && rect0.bottom <= view + 1
      // criterion 2 (wrong): scroll the RAIL to its extreme and look again
      const before = rail.scrollTop
      try { rail.scrollTo({ top: rail.scrollHeight, behavior: 'instant' }) } catch (e) { rail.scrollTop = rail.scrollHeight }
      const railMoved = rail.scrollTop > before
      const rect1 = child.getBoundingClientRect()
      const band1 = Math.min(rect1.bottom, view) - Math.max(rect1.top, 0)
      const afterRailExtreme = (rect1.top >= -1 && rect1.bottom <= view + 1) || band1 >= 8
      // criterion 3 (the one shipped): scroll the ELEMENT into view
      try { child.scrollIntoView({ block: 'center', behavior: 'instant' }) } catch (e) { child.scrollIntoView() }
      const rect2 = (function(){ let r = child.getBoundingClientRect(); let n = child.parentElement
        while (n) { const cs = getComputedStyle(n)
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const q = n.getBoundingClientRect()
            const top = Math.max(r.top, q.top), left = Math.max(r.left, q.left)
            r = { top, left, bottom: Math.max(top, Math.min(r.bottom, q.bottom)), right: Math.max(left, Math.min(r.right, q.right)) } }
          n = n.parentElement } return r })()
      const band2 = Math.min(rect2.bottom, view) - Math.max(rect2.top, 0)
      const afterElementScroll = band2 >= 8
      const scrollSize = rail.scrollHeight, clientSize = rail.clientHeight
      host.remove()
      return { rect0: [Math.round(rect0.top), Math.round(rect0.bottom)], wholeBox, railMoved, afterRailExtreme, afterElementScroll, scrollSize, clientSize, view }
    })()`)
    // Re-measure the page with the plant still in place would need the plant to survive the evaluate,
    // so the shipped criterion is run against a second, identical plant inside the probe's own path.
    const railCtlProbe = await evaluate(`(async function(){
      // Park at the document origin first: an absolute top offset is measured from the containing
      // block, so planting while the page is scrolled puts the plant somewhere other than where the
      // control intended, and it silently lands inside the viewport instead of past it.
      window.scrollTo(0, 0)
      const host = document.createElement('div')
      host.id = 'rail-ctl2'
      host.style.cssText = 'position:absolute;left:8px;top:' + Math.round(window.scrollY + innerHeight + 260) + 'px;width:240px;z-index:1'
      const rail = document.createElement('div')
      rail.style.cssText = 'height:40px;overflow-y:auto;position:relative'
      const child = document.createElement('div')
      child.style.cssText = 'position:absolute;left:0;top:-30px;height:18px;width:200px;background:rgb(1,2,3)'
      child.textContent = 'LCTLRAIL2'
      rail.appendChild(child); host.appendChild(rail); document.body.appendChild(host)
      const bare = await window.__L.geometry(0)
      const g = await window.__L.geometry(0)
      const railEl = host.firstElementChild, childEl = railEl.firstElementChild
      const cr = childEl.getBoundingClientRect(), rr = railEl.getBoundingClientRect()
      const diag = {
        childRect: [Math.round(cr.top), Math.round(cr.bottom)], railRect: [Math.round(rr.top), Math.round(rr.bottom)],
        railOverflowY: getComputedStyle(railEl).overflowY, childPosition: getComputedStyle(childEl).position,
        pastViewport: cr.bottom > innerHeight + 1, docTopBefore: 0, inAll: document.contains(child),
        railY_without: bare.railY, railY_with: g.railY, railDelta: g.railY - bare.railY,
        proven_without: bare.railProof.proven, proven_with: g.railProof.proven,
      }
      host.remove()
      const plant = g.railProof.unreachable.filter((u) => u.text.indexOf('LCTLRAIL2') === 0)
      // Both numbers, from the same source as the arrays they count. The first version asserted on
      // the plant-filtered length while printing the unfiltered total, so the artifact could carry
      // total=2 with one row in it - the second element was counted by the gate and invisible in
      // the file, which is the same "reading and set not from the same place" fault the denominator
      // check is about.
      const pageOthers = g.railProof.unreachable.filter((u) => u.text.indexOf('LCTLRAIL2') !== 0)
      return { unreachable: plant, plantCount: plant.length, pageOthers, total: g.railProof.unreachable.length, proven: g.railProof.proven, diag }
    })()`)
    const ctlProblems = []
    if (railCtl.wholeBox || railCtl.afterRailExtreme || railCtl.afterElementScroll) {
      ctlProblems.push(`the plant is not actually unreachable (wholeBox=${railCtl.wholeBox} afterRailExtreme=${railCtl.afterRailExtreme} afterElementScroll=${railCtl.afterElementScroll}) - a control that passes cannot prove anything fails`)
    }
    if (railCtl.railMoved) ctlProblems.push(`the planted rail scrolled (moved=true, scrollSize=${railCtl.scrollSize} clientSize=${railCtl.clientSize}) - it was meant to be a rail that cannot reach its content`)
    if (!railCtlProbe.plantCount) ctlProblems.push(`RAIL-PROOF did not report the planted unreachable element at all (plant count=${railCtlProbe.plantCount} of total=${railCtlProbe.total}) - the proof cannot fail, so its 0 is not evidence`)
    if (railCtlProbe.total !== railCtlProbe.plantCount + railCtlProbe.pageOthers.length) ctlProblems.push(`RAIL-CONTROL identity broken: total=${railCtlProbe.total} != plant=${railCtlProbe.plantCount} + page others=${railCtlProbe.pageOthers.length} - the control's own arithmetic does not account for what it counted`)
    if (railCtlProbe.pageOthers.length) console.log(`RAIL-CONTROL NOTE ${railCtlProbe.pageOthers.length} element(s) on the control page are unreachable at the DEFAULT window (not a measured tier), and none of them is the plant: ${railCtlProbe.pageOthers.map((u) => `${u.text} at ${u.sel}`).join(' ; ').slice(0, 220)}`)
    // Pit ③, the third of the three this control was written for. The proof scrolls every scrollable
    // ancestor to prove reachability; if it does not put them back, the SECOND geometry() call on the
    // same page measures a scrolled page - which is how one run came out proven=123 and the next 100.
    // Two calls are taken here on purpose (bare then g), so a lost restore shows up as disagreement
    // between them rather than as a number nobody can check. Until this line existed the restore was
    // guarded by nothing but the printed diagnostic.
    if (railCtlProbe.diag.railDelta !== 0 || railCtlProbe.diag.proven_without !== railCtlProbe.diag.proven_with) {
      ctlProblems.push(`the reachability proof does not restore what it scrolled: two geometry() calls on one page disagree (proven_without=${railCtlProbe.diag.proven_without} proven_with=${railCtlProbe.diag.proven_with} railDelta=${railCtlProbe.diag.railDelta}) - whichever one the sweep happened to take is the number you get, and 712/0 is not reproducible`)
    }
    console.log(`RAIL-CONTROL diag ${JSON.stringify(railCtlProbe.diag)} | criteria side by side: whole-box-fits=${railCtl.wholeBox} after-rail-extreme-scroll=${railCtl.afterRailExtreme} after-element-scroll(shipped)=${railCtl.afterElementScroll} | rail moved=${railCtl.railMoved} scrollSize=${railCtl.scrollSize}/clientSize=${railCtl.clientSize} | probe flagged the plant=${railCtlProbe.plantCount} (proven=${railCtlProbe.proven} unreachable_total=${railCtlProbe.total} of_which_page=${railCtlProbe.pageOthers.length})`)
    // Both halves in one artifact: the red side (plant present, proof must name it) and the green
    // side (plant gone, back to the page's own reading). A file with only the failure would let the
    // passing state go unrecorded, and "I ran it twice" is not recomputable.
    const railAfter = railProofTotals.reduce((a, r) => a + r.proven, 0)
    writeFileSync(`${OUT}/layout-rail-control.json`, JSON.stringify({
      red_side: { plant: railCtl, probe: railCtlProbe, flagged: railCtlProbe.unreachable.length > 0 },
      green_side: { pages: railProofTotals.length, proven: railAfter, unreachable: railProofTotals.reduce((a, r) => a + r.unreachable, 0) },
      problems: ctlProblems,
    }, null, 2))
    console.log(`RAIL-CONTROL artifact ${OUT}/layout-rail-control.json red_flagged=${railCtlProbe.unreachable.length > 0} green_proven=${railAfter}`)
    if (ctlProblems.length) {
      for (const m of ctlProblems) console.log(`HARNESS FAULT: RAIL-CONTROL: ${m}`)
      finish(2)
    }
    const rp = railProofTotals.reduce((a, r) => ({ proven: a.proven + r.proven, unreachable: a.unreachable + r.unreachable }), { proven: 0, unreachable: 0 })
    console.log(`RAIL-PROOF elements_past_viewport_needing_a_rail=${rp.proven + rp.unreachable} proven_reachable_by_scrolling=${rp.proven} unreachable=${rp.unreachable}`)
    console.log(`LAYOUT_GATE checked=${checked} matched=${matched} skipped=${skipped} failures=${failures.length}`)
    if (!matched) { console.log('layout: nothing was measured - this is NOT a pass.'); finish(3) }
    emitGate('layout', matched, failures.length, { checked: tiers.length * ROUTES.length, skipped })
    console.log(failures.length ? `layout: ${failures.length} geometry failure(s) across ${matched} measured page/width combinations (${skipped} skipped)` : `layout: no horizontal overflow, no unflagged clipping, touch targets and focus rings hold at ${tiers.map((t) => t.width).join('/')} across ${matched} combinations (${skipped} skipped, not counted as passed)`)
    finish(failures.length ? 1 : 0)
  }

  if (MODE === 'contrast') {
    // Colour chains for the elements the visual audit flagged, so the contrast numbers can be
    // checked by hand rather than trusted from a formula.
    await scrollToAndClick(`(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()`)
    await sleep(400)
    const chains = await evaluate(`(function(){
      const parse=(c)=>{const m=/rgba?\\(([^)]+)\\)/.exec(c||'');if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
      const chain=(el)=>{const rows=[];let n=el;while(n&&n.nodeType===1){const cs=getComputedStyle(n);rows.push({tag:n.tagName,cls:(n.className||'').toString().slice(0,44),color:cs.color,bg:cs.backgroundColor,bgi:cs.backgroundImage.slice(0,24),op:cs.opacity});n=n.parentElement}return rows};
      const dlg=Array.from(document.querySelectorAll('div.fixed.inset-0')).pop();
      // Both of these used to look up an exact leaf string ("连接 GitHub", "STEP") that the dialog
      // never produces - the chip wraps its ordinal in a span and the label reads "STEP 1" - so the
      // mode printed two empty arrays that looked like "nothing found" rather than "probe broken".
      // Last match, not first: an ancestor's textContent satisfies these patterns too, and reading
      // the ancestor reports its inherited colour instead of the one actually on screen.
      const byText=(re)=>Array.from(dlg.querySelectorAll('*')).filter(e=>re.test((e.textContent||'').trim())).pop();
      return {
        closeX: chain(dlg.querySelector('button[aria-label="关闭教程"]')||dlg.querySelector('button[aria-label="关闭"]')).slice(0,5),
        chip: chain(byText(/^\\d+\\.[\\u4e00-\\u9fa5]/)).slice(0,5),
        stepWord: chain(byText(/^STEP\\s*\\d+$/i)).slice(0,5),
        bodyP: chain(Array.from(dlg.querySelectorAll('p')).find(e=>(e.textContent||'').includes('填写 Owner'))).slice(0,4),
      };
    })()`)
    console.log(JSON.stringify(chains, null, 1))
    finish(0)
  }

  if (MODE === 'external') {
    const woCount = () => events.filter((e) => e.method === 'Page.windowOpen').length
    const tcCount = () => events.filter((e) => e.method === 'Target.targetCreated').length
    const feedback = `(function(){return {
      toastTexts: Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim().slice(0,160)),
      inlineError: Array.from(document.querySelectorAll('main *')).map(e=>(e.childElementCount===0?(e.textContent||'').trim():'')).filter(t=>t&&/失败|错误|无法|不可用/.test(t)&&t.length<160).slice(0,4),
    };})()`

    const results = {}

    // ---- site A: HelpCenterDialog.tsx:32 "在线文档" ----
    consoleErrors.length = 0
    const aWo = woCount(); const aTc = tcCount()
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助');if(!b)throw new Error('help button missing');return b;})()")
    await sleep(400)
    results.A_helpCenter = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');if(!b)return {found:false};b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {found:true,label:(b.textContent||'').trim(),url:null};})()`)
    if (results.A_helpCenter.found) {
      const box = await scrollToAndClick("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');})()")
      results.A_helpCenter.clickedAt = [Math.round(box.cx), Math.round(box.cy)]
      await sleep(1500)
      results.A_helpCenter.afterClick = {
        windowOpenCalls: events.slice(events.length).length,
        newWindowOpenEvents: woCount() - aWo,
        newTabs: tcCount() - aTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(aWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
    }
    await shot('10-help-center-online-docs')
    // close the help overlay so the next site's trusted click is not swallowed by it
    await scrollToAndClick("(function(){const b=document.querySelector('button[aria-label=\"关闭教程\"]');if(!b)throw new Error('help close missing');return b;})()")
    await sleep(300)

    // ---- site B: SettingsPage.tsx:328 "完整调用教程与状态码" ----
    consoleErrors.length = 0
    const bWo = woCount(); const bTc = tcCount()
    await goto('设置')
    await sleep(500)
    results.B_settings = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码');if(!b)return {found:false,texts:Array.from(document.querySelectorAll('main button')).map(x=>(x.textContent||'').trim()).filter(t=>t).slice(0,24)};return {found:true,label:(b.textContent||'').trim()};})()`)
    if (results.B_settings.found) {
      await scrollToAndClick("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码');})()")
      await sleep(1500)
      results.B_settings.afterClick = {
        newWindowOpenEvents: woCount() - bWo,
        newTabs: tcCount() - bTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(bWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
    }
    await shot('11-settings-local-api-link')

    // ---- site C: StorageSetupDialog.tsx:256 "在线文档" inside the provider setup panel ----
    consoleErrors.length = 0
    const cWo = woCount(); const cTc = tcCount()
    await goto('云端')
    await sleep(500)
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='添加存储');if(!b)throw new Error('添加存储 missing');return b;})()")
    await sleep(500)
    results.C_openedProviderPicker = await evaluate(`(function(){return {cards: Array.from(document.querySelectorAll('button')).map(x=>(x.textContent||'').trim()).filter(t=>t.includes('开始配置')).length};})()`)
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim().startsWith('GitHub'));if(!b)throw new Error('GitHub card missing');return b;})()")
    await sleep(600)
    results.C_afterProviderCard = await evaluate(`(function(){
      const top = Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();
      return { overlay: !!top, heading: top ? (top.querySelector('h2,h3')||{}).textContent : null, hasGuideToggle: !!(top && Array.from(top.querySelectorAll('button')).some(x=>(x.textContent||'').trim()==='配置教程')) };
    })()`)
    if (results.C_afterProviderCard.hasGuideToggle) {
      await scrollToAndClick(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='配置教程');})()`)
      await sleep(500)
    }
    results.C_guide = await evaluate(`(function(){
      const overlays = Array.from(document.querySelectorAll('div.fixed.inset-0'));
      const top = overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();
      const b = top ? Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档') : null;
      return { setupOverlayFound: !!top, guideButtonFound: !!b, heading: top ? (top.querySelector('h2,h3')||{}).textContent : null };
    })()`)
    if (results.C_guide.guideButtonFound) {
      await scrollToAndClick(`(function(){const overlays=Array.from(document.querySelectorAll('div.fixed.inset-0'));const top=overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');})()`)
      await sleep(1500)
      results.C_guide.afterClick = {
        newWindowOpenEvents: woCount() - cWo,
        newTabs: tcCount() - cTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(cWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
      results.C_guide.hrefShape = await evaluate(`(function(){const overlays=Array.from(document.querySelectorAll('div.fixed.inset-0'));const top=overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();const b=Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');const r=b.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)};})()`)
    }
    await shot('13-provider-guide')

    // ---- does the primitive actually reject? (before the fix nothing could observe this) ----
    consoleErrors.length = 0
    results.D_primitiveRejects = await evaluate(`(async function(){
      const m = await import('/src/lib/desktop.ts');
      const out = {};
      for (const [name, url] of [['malformed','not a url at all/guides/github/'], ['non-http scheme','ftp://example.com/docs'], ['unreachable but valid','https://definitely-not-a-real-docs-host.invalid/image-hosting-platform']]) {
        try { await m.openExternalUrl(url); out[name] = 'resolved'; }
        catch (e) { out[name] = 'rejected: ' + String(e).slice(0, 90); }
        await new Promise(r=>setTimeout(r,120));
      }
      return out;
    })()`)

    // ---- the exact before/after difference at the call site, on a quiet toast stack ----
    consoleErrors.length = 0
    results.E_voidVsWrapper = await evaluate(`(async function(){
      const m = await import('/src/lib/desktop.ts');
      const read = () => Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim()).filter(t=>t.includes('打开链接失败'));
      const wait = (ms) => new Promise(r=>setTimeout(r,ms));
      let quiet = 0;
      while (read().length && quiet < 120) { await wait(250); quiet++; }
      const baseline = read().length;
      void m.openExternalUrl('not a url at all/guides/github/');
      await wait(900);
      const afterVoid = read().length;
      await wait(1200);
      while (read().length) { await wait(250); }
      m.openExternalUrlOrReport('not a url at all/guides/github/');
      await wait(900);
      const afterWrapper = read().length;
      return { baseline, toastsAfterVoidCall: afterVoid - baseline, toastsAfterWrapperCall: afterWrapper, sample: read()[0] || null };
    })()`)
    results.E_voidVsWrapper.pageErrorsDuringProbe = consoleErrors.slice(0, 4).map((e) => (e.text || e.exception?.description || JSON.stringify(e)).slice(0, 140))

    record('7-external-url-sites', results)
    report.tabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())).map((t) => ({ type: t.type, url: t.url.slice(0, 120), title: (t.title || '').slice(0, 60) }))
  }

  writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  finish(0)
}

main().catch((e) => {
  // A HarnessFinishing error is the normal end of a run that already reached a verdict, not a
  // failure to report; and if a verdict is already recorded nothing here may replace it.
  if (e instanceof HarnessFinishing || finishCode !== null) return
  console.error('FAILED', e)
  // Deferred exit, same reason as finish(): calling process.exit while the CDP socket and the browser
  // child are still tearing down aborts the process on Windows (0xC0000409), which the red-demo
  // parent then reads as "the gate did not reject".
  try { finish(e && e.identityFault ? 2 : 1) } catch (inner) { if (!(inner instanceof HarnessFinishing)) throw inner }
})
