/**
 * One command that reproduces every measurement conclusion in this repository.
 *
 *   cd apps/desktop && npm run verify:all
 *
 * The stages run in a fixed order, each printing its own counts, and the run stops being reported as
 * green unless all of them pass. This exists because the alternative - remembering seven entry points
 * and hoping the next person runs all seven - reliably ends with someone running one and reading it
 * as "all green".
 *
 * Order and why - stated as rules, not as numbers, because the numbering was stale for eight stages
 * before someone noticed: it claimed twelve stages while the array held nineteen, and every addition
 * had to remember to rewrite it. The authoritative count is printed by every run as `stages=N`.
 *   the static guards first: cheap, no browser, they catch contract and record drift
 *   then the predicate that needs no browser (gate-unit), then the ones that do
 *   then the dialog behaviours (confirm) and the no-Tauri route sweep (pages), which judge what they
 *     record and are listed here precisely so "it exited 0" stops meaning "nobody looked"
 *   the mutation suite runs last on purpose: it temporarily edits tracked files.
 *
 * The browser stages need the frontend dev server. If it is not reachable they are reported as
 * SKIPPED, never as passed, and the command exits 3 so a green-looking run cannot be produced by
 * simply not starting the server.
 *
 * Exit codes: 0 all stages passed; 2 a stage failed (its own failures are printed in full, above the
 * summary); 3 nothing failed but some stages were skipped.
 *
 * Run it on a clean tree. The last stage temporarily edits tracked files to prove the guards bite,
 * and it refuses to start when any of its targets already has uncommitted edits - so work-in-progress
 * shows up here as a refused stage, not as a silent skip.
 *
 * node:child_process and node:fs only; no third-party dependency.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '')
const RUN_STARTED = Date.now()
const NODE_MODE = 'scripts/verify_dialog_interactions.mjs'
const APP = process.env.VERIFY_APP || 'http://127.0.0.1:1420/'

if (process.argv.includes('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  process.exit(0)
}

function pythonCandidates() {
  // On this box `python` resolves through a WindowsApps execution alias that fails under
  // CreateProcess (node reports ENOENT), while the real interpreters sit behind it on PATH. Ask the
  // OS for every match and drop the alias instead of hardcoding an interpreter path.
  const found = []
  if (process.env.PYTHON) found.push(process.env.PYTHON)
  const where = spawnSync('where.exe', ['python'], { encoding: 'utf8', timeout: 20_000 })
  if (where.status === 0) {
    found.push(...where.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .filter((p) => !/[\\/]WindowsApps[\\/]/i.test(p)).map((p) => p.replace(/\\/g, '/')))
  }
  found.push('python', 'python3')
  return found.filter(Boolean)
}

function resolvePython() {
  // Require 3.11+: scripts/validate.py imports tomllib, so picking a 3.10 launcher previously made
  // three healthy guards look like failures.
  for (const spec of [...pythonCandidates().map((exe) => ({ exe, pre: [] })), { exe: 'py', pre: ['-3'] }]) {
    const probe = spawnSync(spec.exe, [...spec.pre, '-c', 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'], { encoding: 'utf8', timeout: 30_000 })
    const minor = Number((probe.stdout || '').trim())
    if (probe.status === 0 && minor >= 311) return spec
  }
  return null
}

const stages = [
  { name: 'validate', run: 'python', args: ['scripts/validate.py'], count: /SQLite migrations: (\d+ OK)/ },
  { name: 'check_contracts', run: 'python', args: ['scripts/check_contracts.py'], count: /frontend invokes: (\d+) \| Rust commands: (\d+) \| registered: (\d+)/ },
  { name: 'check_user_flow', run: 'python', args: ['scripts/check_user_flow.py'], count: /USERFLOW_CHECKS total=(\d+) failed=(\d+)/ },
  { name: 'check_docs_site', run: 'python', args: ['scripts/check_docs_site.py'], count: /Docs site contract OK \| total checks: (\d+)/ },
  { name: 'check_workflow_action_pins', run: 'python', args: ['scripts/check_workflow_action_pins.py'], count: /passed for (\d+) external action reference/ },
  { name: 'check_release_version', run: 'python', args: ['scripts/check_release_version.py'], count: /Cargo.lock workspace members in sync: (\d+)\/\d+ at/ },
  { name: 'check_tauri_dependency_family', run: 'python', args: ['scripts/check_tauri_dependency_family.py'], count: /tauri=([\d.]+)/ },
  { name: 'project_state', run: 'python', args: ['scripts/project_state.py', '--verify'], count: /PROJECT_STATE_VERIFY facts=(\d+) problems=(\d+)/ },
  // Two ledgers that cost no browser and catch two drift classes the other stages cannot see:
  // numbers typed into docs/VISUAL_BASELINE.md that no longer match the source, and harness content
  // that changed size or lost a mode between one commit and the next.
  { name: 'theme_face_inventory', run: 'node', args: ['scripts/theme_face_inventory.mjs', '--verify'], count: /THEME_FACE_VERIFY faces=(\d+) docLines=\d+ mismatch=(\d+)/ },
  { name: 'verify_shape', run: 'node', args: ['scripts/verify_shape.mjs', '--verify'], count: /SPLIT_SHAPE (?:OK|DRIFT) checked=(\d+) failed=(\d+)/ },
  // The token policy, wired the same round it was written. It was left out at first because it was
  // red on the tree, and that is how a policy gets quietly exempted on day one: the breach
  // (--accent-solid declared in one theme block while its family follows the theme) would have gone
  // on red in a script nobody runs. It is fixed instead - one :root declaration, no rendered pixel
  // changed - and the check is now part of the exit code.
  { name: 'token_policy', run: 'node', args: ['scripts/theme_token_census.mjs', '--verify'], count: /TOKEN_POLICY families=(\d+) breaches=(\d+)/ },
  // The confirmation ladder's colour rule (piclist §18A). Runs with no browser because the rule is a
  // pure function over level values; mounting SettingsPage to check it would measure the harness.
  { name: 'confirmation_display', run: 'node', args: ['scripts/verify_confirmation_display.mjs'], count: /CONFIRMATION_DISPLAY total=(\d+) failed=(\d+)/ },
  { name: 'gate-unit', run: 'node', args: [NODE_MODE, 'gate-unit'], gateJson: true, count: /gate unit check: (\d+\/\d+ correct)/ },
  { name: 'gate', run: 'node', args: [NODE_MODE, 'gate'], needsServer: true, gateJson: true, count: /"sawMinimizedReject": (true|false)/ },
  { name: 'ab', run: 'node', args: [NODE_MODE, 'ab'], needsServer: true, gateJson: true, count: /"deltaOverflowX": (\d+)/ },
  // `confirm` and `pages` were report-only modes: they recorded whether Escape closed the dialog and
  // whether a route collapsed, then exited 0 whatever they saw. They now carry a tally, and the tally
  // is what lets them be stages - the aggregate cross-checks GATE_JSON against the exit code both ways.
  { name: 'confirm', run: 'node', args: [NODE_MODE, 'confirm'], needsServer: true, gateJson: true, timeout: 300_000, count: /CONFIRM_GATE steps=(\d+) checked=(\d+) failed=(\d+)/ },
  { name: 'pages', run: 'node', args: [NODE_MODE, 'pages'], needsServer: true, gateJson: true, timeout: 300_000, count: /PAGES_GATE routes=(\d+) judged=(\d+) checked=(\d+) failed=(\d+)/ },
  // Conditional on VITE_DOCS_BASE_URL, so the predicate cuts both ways: an entry point that offers no
  // online link while a base URL is set is a bug, and one that offers a dead link while none is set is
  // too. It used to end in a bare finish(0) that no aggregate ran.
  { name: 'links', run: 'node', args: [NODE_MODE, 'links'], needsServer: true, gateJson: true, timeout: 300_000, count: /LINKS_GATE sites=(\d+) base=\S+ checked=(\d+) failed=(\d+)/ },
  { name: 'visual', run: 'node', args: [NODE_MODE, 'visual'], needsServer: true, gateJson: true, timeout: 600_000, count: /VISUAL_GATE total=(\d+) failed=(\d+)/ },
  { name: 'settings-guard', run: 'node', args: [NODE_MODE, 'settings-guard'], needsServer: true, gateJson: true, timeout: 600_000, count: /SETTINGS_GATE checked=(\d+).*failed=(\d+)/ },
  // `contrast-tier` IS a stage now. It was taken out of the table while it printed six findings on
  // one settings-page caption, under the rule that a stage red on the current tree turns the whole
  // aggregate into noise. Those six were the harness's own input state, not the app's: four error
  // toasts sit over the page in a browser-only run, and their drop shadow put the tail of that
  // caption on rgb(224,224,224) - a pure grey no theme in this app paints, which did not move
  // between the all-black and all-white wallpaper extremes. The sweep now dismisses the toast stack
  // before each surface and refuses the combination if any node survives, so the overlay cannot be
  // measured as a surface again. Reproduce with:
  //   node scripts/verify_dialog_interactions.mjs contrast-tier --doc=docs/VISUAL_BASELINE.md
  // Cost, printed on its own CONTRAST_GATE line: 72 combinations / 120,042 sample points in ~60s.
  { name: 'contrast-tier', run: 'node', args: [NODE_MODE, 'contrast-tier', '--doc=docs/VISUAL_BASELINE.md'], needsServer: true, gateJson: true, timeout: 600_000, count: /CONTRAST_GATE combos=(\d+).*below=(\d+)/ },
  // `theme-surfaces` IS a stage: it has been green since the palette remap (0 off-theme, 0 dead
  // exemptions) and it now also sweeps the confirm dialog and a raised toast, so a whitelist entry
  // that no surface hits any more is reported as DEAD-EXEMPTION.
  { name: 'theme-surfaces', run: 'node', args: [NODE_MODE, 'theme-surfaces'], needsServer: true, gateJson: true, timeout: 600_000, count: /SURFACE_GATE routes=(\d+).*offThemeUnwhitelisted=(\d+)/ },
  // `layout` is deliberately NOT a stage yet. Standalone it now reports 9 findings (down from 23 lines:
  // 14 of those were one sidebar bug counted through two families, and 7 more fell out when the rail
  // became scrollable). Inside this aggregate it previously produced a different result - the viewport
  // override for the 1024 tier never applied and the injected helpers disappeared before 640, which
  // surfaced as 7 invented "navigation entry point not reachable" failures. A stage that manufactures
  // findings is worse than no stage. See the CHANGELOG entry for the reproduced log; it lands once the
  // aggregate-side viewport fault is fixed and the two readings agree.
  { name: 'red-demo', run: 'node', args: [NODE_MODE, 'red-demo'], timeout: 600_000, count: /identity gate red demo: (\d+\/\d+ alarms reproduced)/ },
  { name: 'mutations', run: 'node', args: ['scripts/verify_guard_mutations.mjs'], timeout: 900_000, count: /guard mutations: (\d+\/\d+ alarms reproduced)/ },
]

function duplicateNames(list) {
  const names = list.map((s) => s.name)
  return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
}

const python = resolvePython()

// Stage names are this aggregate's only key: the summary prints them, the GATE_JSON cross-check looks
// a stage up by name, and two stages sharing a name are indistinguishable in that output - a reader
// cannot tell "deliberately measured twice over two surfaces" from "the block got pasted twice".
// Which is what just happened here: contrast-tier and theme-surfaces each landed in the table twice
// (and theme_face_inventory and verify_shape a third and fourth), costing up to 30 extra minutes of
// browser time for no second measurement at all.
const dupes = duplicateNames(stages)
if (dupes.length) {
  console.error(`AGGREGATE FAULT: duplicate stage name(s) ${dupes.join(', ')} - a stage that runs twice is not two measurements, and results looked up by name would collide.`)
  process.exit(2)
}

// The gate above had no red demo when it was written, and an assertion that has only ever printed
// nothing is indistinguishable from an assertion that cannot fire. Two fixtures, both required:
//   - the real table must read clean,
//   - a table with one row pasted twice must be named, which is exactly the accident that happened.
// `node scripts/verify_all.mjs selftest` runs them without a browser and without a stage.
if (process.argv.slice(2).includes('selftest')) {
  const cases = []
  const push = (name, got, expect) => cases.push({ name, got, expect, ok: got === expect })
  push('the current table has no duplicate name', dupes.length, 0)
  const pasted = [...stages, { name: stages[0].name }]
  const found = duplicateNames(pasted)
  push('a pasted row is reported as exactly one name', found.length, 1)
  push('and it names the row that was pasted', found[0] === stages[0].name ? 1 : 0, 1)
  const twicePasted = [...stages, { name: stages[0].name }, { name: stages[1].name }]
  push('two pasted rows are reported as two names', duplicateNames(twicePasted).length, 2)
  // This case exists because a top-level `const python = resolvePython()` went missing from this file
  // during an edit, and `node --check` passed: a dropped binding is a runtime ReferenceError, so the
  // aggregate crashed on the line after the stage table while still "compiling". Touching the real
  // binding here means the cheap self-check runs the same startup path the stages do.
  push('the preflight interpreter binding resolves', python ? 1 : 0, 1)
  const bad = cases.filter((c) => !c.ok)
  console.log(`AGGREGATE_SELFTEST cases=${cases.length} failed=${bad.length} stages=${stages.length} python=${python ? python.exe : 'unresolved'}`)
  for (const c of cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: got=${c.got} expect=${c.expect}`)
  if (bad.length) {
    console.log('verify:all self-test FAILED: the uniqueness gate cannot see the duplicate it claims to refuse, so its silence is not evidence.')
    process.exit(2)
  }
  process.exit(0)
}

// Two opposing fixtures for the paragraph above, and the negative one is the point: a demo that only
// ever reported "timed out and killed" would pass even if the kill did nothing. So the same code path
// is also run against a child that finishes in a second, and must NOT be called a timeout.
// It sits above the interpreter and dev-server preflight on purpose: the cleanup question has nothing
// to do with either, and a demo that needs `npm run dev` running is a demo nobody re-runs.
if (process.argv.slice(2).includes('timeout-demo')) {
  const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
  const fixture = 'scripts/__fixtures__/hanging_stage.mjs'
  const pidFile = `${tmpdir()}/image-hosting-timeout-${process.pid}.json`
  const budget = 4_000
  const t0 = Date.now()
  const hung = runBounded(process.execPath, [fixture, pidFile], { budget, env: process.env })
  let tree = { parent: 0, child: 0 }
  try { tree = JSON.parse(readFileSync(pidFile, 'utf8')) } catch { /* the child may not have written yet */ }
  const wall = Date.now() - t0
  let gone = false
  for (let i = 0; i < 30 && !gone; i++) {
    await new Promise((res) => setTimeout(res, 100))
    gone = !alive(tree.parent) && !alive(tree.child)
  }
  const quick = runBounded(process.execPath, ['-e', 'setTimeout(()=>{},200)'], { budget: 10_000, env: process.env })
  // If the assertion below fails, this demo is itself the orphan-maker it is testing for, so it cleans
  // up after its own failure and says that it did.
  let mopped = ''
  if (alive(tree.parent) || alive(tree.child)) {
    spawnSync('taskkill.exe', ['/PID', String(tree.parent || process.pid), '/T', '/F'], { encoding: 'utf8', timeout: 20_000 })
    mopped = ' (the demo had to kill the tree itself after the assertion failed)'
  }
  const cases = [
    { name: 'a hanging stage is stopped at its budget', ok: hung.timedOut, got: `timedOut=${hung.timedOut} wall=${wall}ms budget=${budget}ms` },
    { name: 'it is stopped near the budget, not after it', ok: wall >= budget - 200 && wall <= budget + 4_000, got: `wall=${wall}ms` },
    { name: 'the stage process is gone after the tree kill', ok: gone && !alive(tree.parent), got: `parent=${tree.parent} alive=${alive(tree.parent)}` },
    { name: 'the GRANDCHILD is gone too (this is the orphan this exists for)', ok: gone && !alive(tree.child), got: `grandchild=${tree.child} alive=${alive(tree.child)} taskkill status=${hung.killed?.status}` },
    { name: 'a stage that finishes in time is NOT reported as a timeout', ok: !quick.timedOut && quick.r.status === 0, got: `timedOut=${quick.timedOut} exit=${quick.r.status}` },
    // Which of the two mechanisms gets the credit. The control runs the same fixture through the same
    // budget with NO taskkill afterwards; if the grandchild still dies, then Node's spawnSync timeout
    // is what sweeps the tree here and the explicit kill is a backstop. Stating that matters: a comment
    // that says "the timeout kills nothing else" would send the next person to fix the wrong line.
    await (async () => {
      const pidFile2 = `${tmpdir()}/image-hosting-timeout2-${process.pid}.json`
      const bare = spawnSync(process.execPath, [fixture, pidFile2], { cwd: REPO, encoding: 'utf8', timeout: 3_000 })
      let t2 = {}
      try { t2 = JSON.parse(readFileSync(pidFile2, 'utf8')) } catch { /* not written */ }
      rmSync(pidFile2, { force: true })
      // Polled, not spun: give the OS a moment to reap the tree without burning three seconds of CPU,
      // which would otherwise show up in the timing of anything else measured on this box.
      for (let i = 0; i < 20 && alive(t2.child); i++) await new Promise((res) => setTimeout(res, 100))
      const orphan = alive(t2.child)
      if (orphan) spawnSync('taskkill.exe', ['/PID', String(t2.child), '/F'], { encoding: 'utf8', timeout: 20_000 })
      return { name: 'control: the budget ALONE (no taskkill) leaves no orphan', ok: /ETIMEDOUT/.test(String(bare.error)) && !orphan, got: `grandchild=${t2.child} survived=${orphan} (taskkill not called${orphan ? '; cleaned up after the fact' : ''})` }
    })(),
  ]
  const bad = cases.filter((c) => !c.ok)
  rmSync(pidFile, { force: true })
  console.log(`TIMEOUT_DEMO cases=${cases.length} failed=${bad.length} budget=${budget}ms`)
  for (const c of cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.got}`)
  if (bad.length) {
    console.log(`TIMEOUT_DEMO FAILED: the budget or the cleanup does not do what the stage loop claims. Do not report "timeout wired" until this is green.${mopped}`)
    process.exit(2)
  }
  console.log('timeout demo: the budget fires, the tree goes with it, and a stage that finishes is not called a timeout')
  process.exit(0)
}

if (!python) {
  console.error('verify:all cannot run: no Python 3 interpreter found (tried $PYTHON, python, py -3, python3).')
  process.exit(2)
}
// The first request to a cold Vite server can take longer than a timeout meant for a warm one, so
// probe a few times before declaring the browser-backed stages unrunnable.
let serverUp = false
for (let attempt = 0; attempt < 4 && !serverUp; attempt++) {
  try {
    serverUp = (await fetch(APP, { signal: AbortSignal.timeout(10_000) })).ok
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

console.log(`verify:all | repo ${REPO}`)
console.log(`verify:all | interpreter ${python.exe} ${python.pre.join(' ')}`)
console.log(`verify:all | dev server ${APP} ${serverUp ? 'reachable' : 'NOT reachable -> browser stages will be skipped, not passed'}`)

// The outer timeout, factored out so the `timeout-demo` branch above exercises THIS code rather than a
// copy of it.
//
// What the comment here used to assert - "the outer timeout is TerminateProcess, it kills the stage and
// nothing else, so the browser it started keeps running" - turned out to be FALSE on this machine. The
// control case in `timeout-demo` runs the same hanging fixture with no tree kill at all and the
// grandchild is gone too (measured: parent 26000 / grandchild 25492, both dead 1.5s later), so Node's
// spawnSync timeout already sweeps the process tree here. The explicit taskkill is therefore a
// backstop, not the thing doing the work: it returns 128 ("no such process") on every run, which is the
// evidence that it had nothing left to kill. Keeping it costs one spawn and covers the case where a
// future Node changes that behaviour; believing it is what would leave the orphans.
function runBounded(exe, args, { budget, env }) {
  const r = spawnSync(exe, args, { cwd: REPO, encoding: 'utf8', timeout: budget, maxBuffer: 32 * 1024 * 1024, env })
  if (!(r.error && /ETIMEDOUT/.test(String(r.error)))) return { r, timedOut: false, killed: null }
  const killed = spawnSync('taskkill.exe', ['/PID', String(r.pid), '/T', '/F'], { encoding: 'utf8', timeout: 20_000 })
  return { r, timedOut: true, killed }
}

const results = []
for (const stage of stages) {
  if (stage.needsServer && !serverUp) {
    results.push({ name: stage.name, status: 'skipped', wall: 0, detail: 'no dev server, nothing was measured' })
    console.log(`\n--- ${stage.name}: SKIPPED (no dev server at ${APP}; start it with \`npm run dev\`)`)
    continue
  }
  const cmd = stage.run === 'python' ? [python.exe, [...python.pre, ...stage.args]] : [process.execPath, stage.args]
  console.log(`\n--- ${stage.name}`)
  const budget = stage.timeout || 300_000
  // The child is told its own deadline, one minute shorter than the outer one, so a long stage stops
  // itself and prints the coverage it reached. An outer kill prints nothing at all: the run would end
  // with no statement of what was and was not measured, which is the failure mode this whole file is
  // built to avoid.
  const env = { ...process.env, VERIFY_DEADLINE_MS: String(Math.max(30_000, budget - 60_000)) }
  const stageStarted = Date.now()
  const { r, timedOut, killed } = runBounded(cmd[0], cmd[1], { budget, env })
  const wall = Date.now() - stageStarted
  if (timedOut) {
    console.log(`    TIMEOUT after ${Math.round(budget / 1000)}s: stage process ${r.pid} was still alive; tree kill ${killed.status === 0 ? 'succeeded' : `reported status ${killed.status} (${String(killed.stderr || killed.stdout).trim().slice(0, 120)})`}`)
    results.push({ name: stage.name, status: 'failed', wall, detail: `TIMED OUT at ${Math.round(budget / 1000)}s - nothing was measured by this stage` })
    continue
  }
  const output = `${r.stdout || ''}${r.stderr || ''}`
  // Print every failure line as it happens. A summary that only says "stage 3 failed" reproduces the
  // bug this command exists to prevent: the reason gets hidden behind whatever ran last.
  for (const line of output.split('\n')) {
    if (line.startsWith('FAIL') || line.includes('FAILED') || line.startsWith('Traceback') || line.startsWith('Error')) console.log(`    ${line.trim()}`)
  }
  // The stage's own machine-readable tally, cross-checked against its exit code in BOTH
  // directions. A summary line matched by a regex living in a different file than the print
  // statement drifts silently - adding viaLoad/viaApply to one gate broke its own regex and the
  // stage still scored PASSED. ok is the stage's own verdict; exit code and ok must agree, and
  // checked must be positive or "nothing examined" reads as "nothing wrong".
  const gateLine = output.split('\n').filter((l) => l.startsWith('GATE_JSON ')).pop()
  const problems = []
  let gate = null
  if (gateLine) {
    try { gate = JSON.parse(gateLine.slice('GATE_JSON '.length).trim()) } catch (error) { problems.push(`GATE_JSON unparseable: ${String(error).slice(0, 80)}`) }
  }
  if (gate) {
    for (const key of ['gate', 'checked', 'failed', 'ok']) if (!(key in gate)) problems.push(`GATE_JSON missing required key "${key}"`)
    if (gate.gate !== stage.name) problems.push(`GATE_JSON says gate="${gate.gate}" but this stage is "${stage.name}"`)
    if (!Number.isInteger(gate.checked) || gate.checked <= 0) problems.push(`checked=${gate.checked}; nothing examined is not a pass`)
    if (!Number.isInteger(gate.failed)) problems.push(`failed=${JSON.stringify(gate.failed)} is not an integer`)
    if (gate.ok !== true && gate.failed === 0 && r.status !== 0) problems.push(`exit ${r.status} with failed=0 - the stage failed for a reason its tally does not carry`)
    if (r.status === 0 && gate.ok !== true) problems.push(`exit 0 but the stage's own verdict is ok=${JSON.stringify(gate.ok)}`)
    if (r.status !== 0 && gate.ok === true) problems.push(`exit ${r.status} but the stage claims ok=true - exit code and tally disagree`)
    if (r.status === 0 && gate.failed > 0) problems.push(`exit 0 but failed=${gate.failed}`)
  } else if (stage.gateJson) {
    problems.push('no GATE_JSON line emitted by a stage that declares one')
  } else if (!output.match(stage.count)) {
    problems.push('count: NOT REPORTED by this stage - treat as a harness gap, not a pass')
  }
  const detail = r.error ? `spawn error: ${String(r.error).slice(0, 120)}`
    : problems.length ? problems.join(' | ')
    : gate ? `${gate.gate} checked=${gate.checked} failed=${gate.failed}`
    : (output.match(stage.count) || ['count present but no GATE_JSON'])[0].trim()
  results.push({ name: stage.name, status: r.status === 0 && problems.length === 0 ? 'passed' : 'failed', exit: r.status, wall, detail })
  console.log(`    => ${results[results.length - 1].status} (exit ${r.status}) ${wall / 1000 >= 10 ? `${(wall / 1000).toFixed(1)}s ` : ''}${detail}`)
}

const failed = results.filter((x) => x.status === 'failed')
const skipped = results.filter((x) => x.status === 'skipped')
console.log('\n===== verify:all summary =====')
for (const x of results) console.log(`${x.status.toUpperCase().padEnd(7)} ${x.name}  ${x.detail}`)
// Cost, printed on the aggregate's own line rather than left to whoever thinks to time it. This is
// the same rule every gate here already follows - a gate too expensive to run dies the same way a
// blind one does - and the aggregate is the one number nobody was measuring. The stage walls sum to
// more than the run because each stage also pays interpreter and browser startup.
const totalWall = Date.now() - RUN_STARTED
const byCost = [...results].sort((a, b) => b.wall - a.wall)
console.log(`verify:all | wall=${(totalWall / 1000).toFixed(1)}s stages=${results.length} sumOfStageWalls=${(results.reduce((a, x) => a + x.wall, 0) / 1000).toFixed(1)}s`)
console.log(`verify:all | cost (slowest first): ${byCost.slice(0, 6).map((x) => `${x.name}=${(x.wall / 1000).toFixed(1)}`).join(' ')}`)
console.log(`verify:all | ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped of ${results.length}`)
if (failed.length) console.error('At least one stage failed. Read its FAIL lines above; each stage prints all of them.')
else if (skipped.length) console.error('Nothing failed, but stages were skipped: this run did NOT reproduce the browser-backed conclusions.')
process.exit(failed.length ? 2 : skipped.length ? 3 : 0)
