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
  { id: 'M11', file: FIXTURE, from: ' * An impostor dev server, for proving the identity gate in', to: ' * An impostor dev server, for proving the identity gate in today', oracle: 'guard', expect: `fingerprint row for ${FIXTURE} matches the file` },
  // Breaks the property itself - a non-node: import - rather than the prose that mentions it. The
  // first version of this entry edited a comment saying "no third-party dependency" and correctly
  // failed to alarm, because the guard reads the import list, not the comment.
  { id: 'M12', file: FIXTURE, from: "import { readFileSync } from 'node:fs'", to: "import { readFileSync } from 'node:fs'\nimport chalk from 'chalk'", oracle: 'guard', expect: 'the fixture adds no third-party dependency' },
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
  const cmd = oracle === 'gate-unit'
    ? [process.execPath, [`${REPO}/${HARNESS}`, 'gate-unit']]
    : [python.exe, [...python.pre, 'scripts/check_user_flow.py']]
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, encoding: 'utf8', timeout: 180_000 })
  return {
    status: r.status,
    spawnError: r.error ? String(r.error).slice(0, 120) : null,
    output: `${r.stdout || ''}${r.stderr || ''}`,
    marker: oracle === 'gate-unit' ? 'gate unit check' : 'total checks:',
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
      evidence: run.output.split('\n').filter((l) => l.startsWith('FAIL') || l.includes('-> accepted')).slice(0, 2).map((l) => l.trim().slice(0, 130)),
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
console.log(`guard mutations: ${results.length - bad.length}/${selected.length} alarms reproduced | interpreter: ${python.exe} ${python.pre.join(' ')} | tree restored: ${unrestored.length === 0 ? 'clean' : `DIRTY ${unrestored.join(', ')}`}`)
if (bad.length) console.error('Some oracle stayed silent while its property was broken. That is a harness fault, not a passing test.')
process.exit(bad.length || unrestored.length ? 2 : 0)
