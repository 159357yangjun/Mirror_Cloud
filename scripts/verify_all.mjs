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
 * Order and why:
 *   1-7  the seven static guards: cheap, no browser, they catch contract and record drift
 *   8    gate-unit     the viewport gate predicate, no browser needed
 *   9    gate          the viewport gate against a genuinely minimised real window
 *   10   ab            the confirm-card overflow, paired before/after in one viewport
 *   11   red-demo      the identity gate refusing two kinds of impostor server
 *   12    mutations    proves each of the guards above actually alarms when its property is broken
 *   The mutation suite runs last on purpose: it temporarily edits tracked files.
 *
 * Stages 9-11 need the frontend dev server. If it is not reachable they are reported as SKIPPED,
 * never as passed, and the command exits 3 so a green-looking run cannot be produced by simply not
 * starting the server.
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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '')
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
  { name: 'check_release_version', run: 'python', args: ['scripts/check_release_version.py'], count: /Release version consistent: ([\d.]+)/ },
  { name: 'check_tauri_dependency_family', run: 'python', args: ['scripts/check_tauri_dependency_family.py'], count: /tauri=([\d.]+)/ },
  { name: 'gate-unit', run: 'node', args: [NODE_MODE, 'gate-unit'], count: /gate unit check: (\d+\/\d+ correct)/ },
  { name: 'gate', run: 'node', args: [NODE_MODE, 'gate'], needsServer: true, count: /"sawMinimizedReject": (true|false)/ },
  { name: 'ab', run: 'node', args: [NODE_MODE, 'ab'], needsServer: true, count: /"deltaOverflowX": (\d+)/ },
  { name: 'visual', run: 'node', args: [NODE_MODE, 'visual'], needsServer: true, timeout: 600_000, count: /VISUAL_GATE total=(\d+) failed=(\d+)/ },
  { name: 'settings-guard', run: 'node', args: [NODE_MODE, 'settings-guard'], needsServer: true, timeout: 600_000, count: /SETTINGS_GATE checked=(\d+) failed=(\d+)/ },
  // `layout` is deliberately NOT a stage yet. Standalone it reports 23 real geometry findings;
  // inside this aggregate the viewport override for the 1024 tier never applied and the injected
  // helpers disappeared before 640, which surfaced as 7 invented "navigation entry point not
  // reachable" failures. A stage that manufactures findings is worse than no stage. See
  // CHANGELOG "verify:all 里没接 layout" for the reproduced log; it lands with the fix.
  { name: 'red-demo', run: 'node', args: [NODE_MODE, 'red-demo'], timeout: 600_000, count: /identity gate red demo: (\d+\/\d+ alarms reproduced)/ },
  { name: 'mutations', run: 'node', args: ['scripts/verify_guard_mutations.mjs'], timeout: 900_000, count: /guard mutations: (\d+\/\d+ alarms reproduced)/ },
]

const python = resolvePython()
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

const results = []
for (const stage of stages) {
  if (stage.needsServer && !serverUp) {
    results.push({ name: stage.name, status: 'skipped', detail: 'no dev server, nothing was measured' })
    console.log(`\n--- ${stage.name}: SKIPPED (no dev server at ${APP}; start it with \`npm run dev\`)`)
    continue
  }
  const cmd = stage.run === 'python' ? [python.exe, [...python.pre, ...stage.args]] : [process.execPath, stage.args]
  console.log(`\n--- ${stage.name}`)
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, encoding: 'utf8', timeout: stage.timeout || 300_000, maxBuffer: 32 * 1024 * 1024 })
  const output = `${r.stdout || ''}${r.stderr || ''}`
  // Print every failure line as it happens. A summary that only says "stage 3 failed" reproduces the
  // bug this command exists to prevent: the reason gets hidden behind whatever ran last.
  for (const line of output.split('\n')) {
    if (line.startsWith('FAIL') || line.includes('FAILED') || line.startsWith('Traceback') || line.startsWith('Error')) console.log(`    ${line.trim()}`)
  }
  const match = output.match(stage.count)
  const detail = r.error ? `spawn error: ${String(r.error).slice(0, 120)}`
    : match ? `${stage.count.source.includes('sawMinimizedReject') ? 'sawMinimizedReject=' : ''}${match[0].trim()}`
    : 'count: NOT REPORTED by this stage - treat as a harness gap, not a pass'
  results.push({ name: stage.name, status: r.status === 0 ? 'passed' : 'failed', exit: r.status, detail })
  console.log(`    => ${results[results.length - 1].status} (exit ${r.status}) ${detail}`)
}

const failed = results.filter((x) => x.status === 'failed')
const skipped = results.filter((x) => x.status === 'skipped')
console.log('\n===== verify:all summary =====')
for (const x of results) console.log(`${x.status.toUpperCase().padEnd(7)} ${x.name}  ${x.detail}`)
console.log(`verify:all | ${results.length} stages: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`)
if (failed.length) console.error('At least one stage failed. Read its FAIL lines above; each stage prints all of them.')
else if (skipped.length) console.error('Nothing failed, but stages were skipped: this run did NOT reproduce the browser-backed conclusions.')
process.exit(failed.length ? 2 : skipped.length ? 3 : 0)
