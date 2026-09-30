/**
 * Re-runnable proof that the guards around the dialog measurement chain actually bite.
 *
 *   node scripts/verify_guard_mutations.mjs            # all of them
 *   node scripts/verify_guard_mutations.mjs M7 M11     # or just the ids you want
 *
 * Each entry breaks one property in a tracked file, runs the oracle that is supposed to notice, and
 * restores the file from the bytes held in memory. It refuses to start if any target file already
 * has uncommitted edits, so it can never clobber someone's in-progress work, and it re-checks the
 * tree afterwards and reports "clean" only if every byte went back.
 *
 * Why this is a separate file rather than another mode of the harness: the guard asserts on
 * substrings of the harness source - "async function assertProjectIdentity" must be present. While
 * the mutation table lived inside that same file, the table's own literals satisfied those
 * assertions, so renaming the function left the guard green. A guard that passes because its own
 * test plan mentions the thing under test is not a guard. Keeping the mutations out of the observed
 * file removes that, and M8/M9/M10 now go red as they always should have.
 *
 * Exit codes: 0 every mutation was caught by its oracle; 2 at least one oracle stayed silent or the
 * tree was not restored (a harness fault - never report it as a passing test); 3 no Python 3 found.
 *
 * node:child_process and node:fs only; no third-party dependency.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Forward slashes: these paths reach spawn as argv, and a backslash Windows path has already eaten a
// run on this box (spawn reported "C:Program Files (x86)MicrosoftEdge...").
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '')
const HARNESS = 'scripts/verify_dialog_interactions.mjs'
const FIXTURE = 'scripts/__fixtures__/impostor_dev_server.mjs'
const DIALOG = 'apps/desktop/src/components/HelpCenterDialog.tsx'
const THEME = 'apps/desktop/src/lib/theme.ts'
const OUT = (process.env.TEMP || '/tmp').replace(/\\/g, '/').replace(/\/+$/, '') + `/image-hosting-probes/${new Date().toISOString().slice(0, 10)}`
mkdirSync(OUT, { recursive: true })

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (args.includes('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  process.exit(0)
}
const only = args.length ? new Set(args.map((a) => a.toUpperCase())) : null

const mutations = [
  { id: 'M1', file: HARNESS, from: '  if (!(reading.innerWidth > 0)) problems.push(`innerWidth=${reading.innerWidth} (needs > 0)`)', to: '', oracle: 'gate-unit', expect: 'innerWidth 0, everything else healthy -> accepted' },
  { id: 'M2', file: HARNESS, from: "  if (reading.visibility !== 'visible') problems.push(`visibilityState=${reading.visibility} (needs \"visible\")`)", to: '', oracle: 'gate-unit', expect: 'hidden, sizes healthy -> accepted' },
  { id: 'M3', file: HARNESS, from: '  if (!(reading.innerHeight > 0)) problems.push(`innerHeight=${reading.innerHeight} (needs > 0)`)', to: '', oracle: 'gate-unit', expect: 'innerHeight 0, everything else healthy -> accepted' },
  { id: 'M4', file: HARNESS, from: '  if (!(reading.clientWidth > 0) || !(reading.clientHeight > 0)) problems.push(`client=${reading.clientWidth}x${reading.clientHeight}`)', to: '', oracle: 'gate-unit', expect: 'clientWidth 0, everything else healthy -> accepted' },
  { id: 'M5', file: HARNESS, from: '  return { ok: problems.length === 0, problems }', to: '  return { ok: true, problems }', oracle: 'gate-unit', expect: 'hidden, sizes healthy -> accepted' },
  { id: 'M6', file: 'apps/desktop/package.json', from: ',\n    "verify:dialog": "node ../../scripts/verify_dialog_interactions.mjs"', to: '', oracle: 'guard', expect: 'the harness is reachable from an npm script entry' },
  { id: 'M7', file: 'CHANGELOG.md', corrupt: 'double-encode', oracle: 'guard', expect: 'CHANGELOG.md still holds real CJK code points' },
  { id: 'M8', file: HARNESS, from: 'async function assertProjectIdentity()', to: 'async function gateRemoved()', oracle: 'guard', expect: 'the harness verifies it is measuring this project' },
  { id: 'M9', file: HARNESS, from: '    error.identityFault = true\n    throw error', to: '    finish(2)', oracle: 'guard', expect: 'an identity mismatch exits as a harness fault, not a pass or a regression' },
  { id: 'M10', file: HARNESS, from: 'function|const|class|enum', to: 'function|const|class|type|interface|enum', oracle: 'guard', expect: 'the export comparison ignores type exports that the TS transform erases' },
  // One byte changed in a measured file, table left stale. This trips the working-copy half of the
  // check while the edit is uncommitted, and the HEAD-blob half once it is committed without the
  // table being updated - the two halves the guard now compares.
  { id: 'M11', file: FIXTURE, from: ' * An impostor dev server, for proving the identity gate in', to: ' * An impostor dev server, for proving the identity gate in today', oracle: 'guard', expect: `fingerprint row for ${FIXTURE} matches the working copy` },
  // Breaks the property itself - a non-node: import - rather than the prose that mentions it. The
  // first version of this entry edited a comment saying "no third-party dependency" and correctly
  // failed to alarm, because the guard reads the import list, not the comment.
  { id: 'M12', file: FIXTURE, from: "import { readFileSync } from 'node:fs'", to: "import { readFileSync } from 'node:fs'\nimport chalk from 'chalk'", oracle: 'guard', expect: 'the fixture adds no third-party dependency' },
  // The four visual invariants added for the onboarding dialog. Each breaks the property, not the
  // prose about it: dropping the `!` really does hand the button back to styles.css, and adding a
  // second ordinal list really does restate the six steps.
  { id: 'M13', file: DIALOG, from: 'text-[12px]! font-medium! text-[var(--accent)] hover:underline', to: 'text-[12px] font-medium text-[var(--accent)] hover:underline', oracle: 'guard', expect: 'is discarded by styles.css' },
  { id: 'M14', file: DIALOG, from: '          </div>\n        </div>\n      </section>', to: '          </div>\n          <div className="mt-5 text-sm font-semibold">推荐的第一次使用顺序</div>\n          <div className="mt-4 grid grid-cols-5 gap-2">{[\'连接 GitHub\', \'上传 1 张图\'].map((t, i) => <div key={t} className="rounded-xl px-3 py-3 text-[12px]! font-medium!">{i + 1}.{t}</div>)}</div>\n        </div>\n      </section>', oracle: 'guard', expect: 'the duplicated five-chip ordering block stays deleted' },
  { id: 'M15', file: DIALOG, from: 'text-[var(--text-secondary)]">先完成第一次真实云端上传', to: 'text-[var(--text-muted)]">先完成第一次真实云端上传', oracle: 'guard', expect: 'the dialog avoids the muted grey measured at' },
  { id: 'M16', file: DIALOG, from: ' [font-variant-numeric:tabular-nums]', to: '', oracle: 'guard', expect: 'the STEP ordinals are tabular' },
  // The geometry tier's own red proof, using the shape this repo really shipped: 534cc15 added
  // overflow-wrap so a 64-character hashed filename stops running out of the 440px card. Take it
  // away and the layout sweep must see the text cut - the document-level number will not.
  { id: 'M17', file: 'apps/desktop/src/components/ConfirmDialog.tsx', from: 'mt-2 break-words text-xs', to: 'mt-2 text-xs', oracle: 'layout', expect: 'own-text run(s) cut with no ellipsis and no title' },
  // Two boundaries now guard the same property, and each needs its own mutation: deleting the
  // apply-side guard is observable in the browser, deleting the load-side one is not (apply still
  // catches it), so only a static assertion can tell the second layer was removed. Proving one
  // red does not prove the other is load-bearing.
  { id: 'M18', file: THEME, from: 'if (isThemeKey(preferences.theme)) {', to: 'if (true) {', oracle: 'settings', expect: 'unknown theme written straight into the DOM' },
  { id: 'M19', file: THEME, from: 'theme: isThemeKey(parsed.theme) ? parsed.theme : DEFAULT_THEME_PREFERENCES.theme,', to: 'theme: parsed.theme,', oracle: 'guard', expect: 'the load boundary rejects an unknown stored theme key' },
]

const selected = only ? mutations.filter((m) => only.has(m.id)) : mutations
if (!selected.length) {
  console.error(`no mutation ids matched ${[...only].join(', ')}; known: ${mutations.map((m) => m.id).join(' ')}`)
  process.exit(2)
}

const touched = [...new Set(selected.map((m) => m.file))]
const dirty = touched.filter((rel) => execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: REPO, encoding: 'utf8' }).trim())
if (dirty.length) {
  console.error(`refusing to run: these files already have uncommitted edits, and restoring them would destroy that work:\n  ${dirty.join('\n  ')}`)
  process.exit(2)
}

// `python` is not launchable from node on this box: without a shell it is ENOENT, and cmd.exe
// resolves it to a dead WindowsApps stub that exits 1 with no output - which is indistinguishable
// from "the guard alarmed". Probe for a real interpreter instead of trusting an exit code.
function pythonCandidates() {
  // `python` on this box resolves through a WindowsApps execution alias that fails under
  // CreateProcess (node reports ENOENT), so ask the OS for every match and drop the alias rather
  // than hardcoding an interpreter path.
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
  // Require 3.11+: the oracle chain includes guards importing tomllib, and picking a 3.10 launcher
  // would report "the guard stayed silent" for a reason that has nothing to do with the mutation.
  for (const spec of [...pythonCandidates().map((exe) => ({ exe, pre: [] })), { exe: 'py', pre: ['-3'] }]) {
    const probe = spawnSync(spec.exe, [...spec.pre, '-c', 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'], { encoding: 'utf8', timeout: 30_000 })
    const minor = Number((probe.stdout || '').trim())
    if (probe.status === 0 && minor >= 311) return spec
  }
  return null
}
const python = resolvePython()
if (!python) {
  console.error('no Python >= 3.11 interpreter found (tried $PYTHON, where.exe python, python, python3, py -3); the guard oracle cannot run.')
  process.exit(3)
}

const runOracle = (oracle) => {
  // The layout oracle drives a real browser, so it is pinned to one tier and one route: the
  // unbreakable-filename fixture inside the confirm card. That keeps a mutation that needs a
  // browser at roughly the cost of one page load instead of the full 21-combination sweep.
  const cmd = oracle === 'gate-unit'
    ? [process.execPath, [`${REPO}/${HARNESS}`, 'gate-unit']]
    : oracle === 'layout'
      ? [process.execPath, [`${REPO}/${HARNESS}`, 'layout', '--tier', '640', '--routes', 'confirm-longname', '--port', String(9500 + (process.pid % 50))]]
      : oracle === 'settings'
        ? [process.execPath, [`${REPO}/${HARNESS}`, 'settings-guard', '--port', String(9600 + (process.pid % 50))]]
        : [python.exe, [...python.pre, 'scripts/check_user_flow.py']]
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, encoding: 'utf8', timeout: oracle === 'layout' || oracle === 'settings' ? 420_000 : 180_000 })
  return {
    status: r.status,
    spawnError: r.error ? String(r.error).slice(0, 120) : null,
    output: `${r.stdout || ''}${r.stderr || ''}`,
    marker: oracle === 'gate-unit' ? 'gate unit check' : oracle === 'layout' ? 'LAYOUT_GATE' : oracle === 'settings' ? 'SETTINGS_GATE' : 'USERFLOW_CHECKS',
  }
}

// Files are checked out with CRLF under core.autocrlf=true, so a multi-line anchor written with \n
// matches nothing. A miss is reported as "anchor stale", never skipped as a pass.
const adapt = (text, needle) => (text.includes('\r\n') ? needle.replace(/\n/g, '\r\n') : needle)

const results = []
for (const m of selected) {
  const path = `${REPO}/${m.file}`
  const original = readFileSync(path)
  try {
    let mutated
    if (m.corrupt === 'double-encode') {
      // The exact corruption this guard exists for: read the raw bytes as Latin-1 (one char per
      // byte, all <= 0xFF) and re-encode as UTF-8. Every CJK character becomes two characters, and
      // the file still decodes as UTF-8 afterwards, so a parse check stays green.
      mutated = Buffer.from(original.toString('latin1'), 'utf8')
    } else {
      const text = original.toString('utf8')
      const needle = adapt(text, m.from)
      mutated = text.includes(needle) ? text.replace(needle, adapt(text, m.to)) : undefined
    }
    if (mutated === undefined || Buffer.from(mutated).equals(original)) {
      results.push({ id: m.id, file: m.file, applied: false, note: 'anchor missing - mutation definition is stale' })
      continue
    }
    writeFileSync(path, mutated)
    const run = runOracle(m.oracle)
    const oracleRan = run.output.includes(run.marker)
    results.push({
      id: m.id, file: m.file, oracle: m.oracle, applied: true, spawnError: run.spawnError, oracleRan,
      guardAlarmed: oracleRan && run.status !== 0 && run.status !== null,
      namedExpectedFailure: run.output.includes(m.expect),
      observedExit: run.status,
      // Show the line that actually names the expected failure first. Slicing the raw FAIL list
      // printed the sidebar's unrelated-but-real complaints and hid the one being proved.
      evidence: (() => {
        const lines = run.output.split('\n').filter((l) => l.startsWith('FAIL') || l.includes('-> accepted'))
        const named = lines.filter((l) => l.includes(m.expect))
        return [...new Set([...named, ...lines])].slice(0, 3).map((l) => l.trim().slice(0, 150))
      })(),
    })
  } finally {
    writeFileSync(path, original)
  }
}

const unrestored = touched.filter((rel) => execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: REPO, encoding: 'utf8' }).trim())
const bad = results.filter((r) => !r.applied || !r.guardAlarmed || !r.namedExpectedFailure)
writeFileSync(`${OUT}/report-guard-mutations.json`, JSON.stringify({ results, unrestored }, null, 2))
for (const r of results) {
  const head = `${r.applied && r.guardAlarmed && r.namedExpectedFailure ? 'OK  ' : 'FAIL'} ${r.id} ${r.file}`
  console.log(r.note ? `${head} (${r.note})` : `${head} -> oracle ran: ${r.oracleRan}, exit ${r.observedExit}, named expected failure: ${r.namedExpectedFailure}${r.spawnError ? `, spawnError: ${r.spawnError}` : ''}${r.evidence && r.evidence.length ? `\n      ${r.evidence.join('\n      ')}` : ''}`)
}
// Machine-readable tally for verify:all. Same schema as the harness modes' GATE_JSON line: checked
// is what was actually attempted, so "0 attempted" can never be read as "0 failed".
console.log(`GATE_JSON ${JSON.stringify({ gate: 'mutations', checked: selected.length, failed: bad.length, ok: bad.length === 0 && unrestored.length === 0, unrestored: unrestored.length })}`)
console.log(`guard mutations: ${results.length - bad.length}/${selected.length} alarms reproduced | interpreter: ${python.exe} ${python.pre.join(' ')} | tree restored: ${unrestored.length === 0 ? 'clean' : `DIRTY ${unrestored.join(', ')}`}`)
if (bad.length) console.error('Some oracle stayed silent while its property was broken. That is a harness fault, not a passing test.')
process.exit(bad.length || unrestored.length ? 2 : 0)
