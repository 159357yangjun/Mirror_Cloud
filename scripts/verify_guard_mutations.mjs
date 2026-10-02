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
const PROBES = 'scripts/verify_probes.mjs'
const OUT = (process.env.TEMP || '/tmp').replace(/\\/g, '/').replace(/\/+$/, '') + `/image-hosting-probes/${new Date().toISOString().slice(0, 10)}`
mkdirSync(OUT, { recursive: true })

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (args.includes('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  process.exit(0)
}
const only = args.length ? new Set(args.map((a) => a.toUpperCase())) : null

const mutations = [
  // Four gates added in the same batch as the claims they police. Each one is a real red, not a
  // re-statement of the guard: the oracle has to notice, and if the oracle stays silent the suite
  // exits 2.
  // A theme-invariant surface is allowed only by a named, reasoned whitelist entry. M21 adds an
  // entry that excuses nothing today, which is a licence for whatever fits it tomorrow.
  {
    id: 'M21', file: HARNESS, oracle: 'surfaces', expect: 'DEAD-EXEMPTION theme-surfaces',
    from: "      { re: /app-upload-button/, why: 'primary upload action: filled slate-950 with white label in all three themes, by design' },",
    to: "      { re: /zzz-nothing-in-this-app-matches-me/, why: 'a planted exemption for a surface no sweep can reach' },\n      { re: /app-upload-button/, why: 'primary upload action: filled slate-950 with white label in all three themes, by design' },",
  },
  // The contrast gate reads the worst point across the run's own ink, not one centre pixel. M22
  // turns the sampler back into a single-point one. Which fixture notices was measured, not guessed:
  // it is the CHIP control that fires first ("kept 66 points and rejected 0 as belonging to something
  // else"), because a centre-only sampler stops looking at the fragment edges where the neighbour's
  // pixels live. The gradient control would disagree too, but the run stops at the first fault, so the
  // expectation names the alarm that actually goes off.
  {
    id: 'M22', file: HARNESS, oracle: 'contrast', expect: 'chip control',
    from: '                const px = x0 + dx, py = y0 + dy',
    to: '                const px = Math.round((x0 + x1) / 2), py = Math.round((y0 + y1) / 2)',
  },
  // Alpha-thinned text cannot have a guaranteed ratio at all, because what it composites onto is
  // the user's wallpaper. M23 puts one instance back. The anchor is SettingsPage, not the help
  // dialog: the dialog has no `text-slate-400` left after this round's alpha sweep, and a stale
  // anchor is reported as stale rather than skipped.
  {
    id: 'M23', file: 'apps/desktop/src/pages/SettingsPage.tsx', oracle: 'guard', expect: 'readable text never thins itself with an alpha modifier',
    from: 'text-slate-400', to: 'text-slate-400/70', all: true,
  },
  // A mode name that matches no block used to spawn the browser, judge nothing, and exit 0.
  // This one is the INVERSE shape of every other mutation here, and it has to be: M21-M23 break a
  // property and require the guard to alarm, whereas this breaks the guard itself - so "the guard
  // still alarms" is not achievable and was never a test. What proves the guard is load-bearing is
  // both halves: unmutated, the run must refuse and name the mode; mutated, the same command must go
  // quiet and exit 0. `removesGuard` makes the runner require that pair.
  {
    id: 'M24', file: HARNESS, oracle: 'bogus-mode', expect: 'is not declared, so no block would run', removesGuard: true,
    from: "if (MODE && MODE !== 'help' && !MODES.includes(MODE)) {", to: 'if (false) {',
  },
  // finish() recorded a verdict and then kept running: a later catch could schedule a second exit
  // and win. M25 re-creates exactly that - a catch that calls finish(1) after a fault called
  // finish(2) - and the oracle is the exit code itself, which must still be 2.
  // M25 was drafted and then withdrawn, and the reason is worth keeping here: the latch is only
  // observable when some path asks for a second verdict after finish() already recorded one, and
  // after the fix no such path exists (finish() throws, so the run stops unwinding). A mutation
  // that cannot change what the oracle sees is not a test, so the exit-code latch is covered only
  // by the symptom that produced it - see the CHANGELOG entry - and not by a re-runnable red.
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
  { id: 'M13', file: DIALOG, from: 'className="mt-4 self-start text-[12px]! font-medium! hover:underline"', to: 'className="mt-4 self-start text-[12px] font-medium hover:underline"', oracle: 'guard', expect: 'is discarded by styles.css' },
  { id: 'M14', file: DIALOG, from: '          </div>\n        </div>\n      </section>', to: '          </div>\n          <div className="mt-5 text-sm font-semibold">推荐的第一次使用顺序</div>\n          <div className="mt-4 grid grid-cols-5 gap-2">{[\'连接 GitHub\', \'上传 1 张图\'].map((t, i) => <div key={t} className="rounded-xl px-3 py-3 text-[12px]! font-medium!">{i + 1}.{t}</div>)}</div>\n        </div>\n      </section>', oracle: 'guard', expect: 'the duplicated five-chip ordering block stays deleted' },
  { id: 'M15', file: DIALOG, from: 'text-[var(--text-secondary)]">先完成第一次真实云端上传', to: 'text-[var(--text-muted)]">先完成第一次真实云端上传', oracle: 'guard', expect: 'the dialog avoids the muted grey measured at' },
  { id: 'M16', file: DIALOG, from: ' [font-variant-numeric:tabular-nums]', to: '', oracle: 'guard', expect: 'the STEP ordinals are tabular' },
  // The geometry tier's own red proof, using the shape this repo really shipped: 534cc15 added
  // overflow-wrap so a 64-character hashed filename stops running out of the 440px card. Take it
  // away and the layout sweep must see the text cut - the document-level number will not.
  // M17's oracle had to be re-pointed this round, and the reason is recorded rather than smoothed
  // over: SELF-CLIP used to catch this shape only because it did not require the element to clip, so
  // it reported "4px of cut ink" on boxes that cut nothing (void reading #13). Narrowing it blinded
  // M17 completely - with the mutation applied, no criterion fired. TEXT-ESCAPE is the criterion that
  // describes what actually happens to an unbreakable 64-character hash in a 440px card: nothing is
  // cut, the glyphs paint past the edge. Verified red-on-mutation and green-on-pristine.
  { id: 'M17', file: 'apps/desktop/src/components/ConfirmDialog.tsx', from: 'mt-2 break-words text-xs', to: 'mt-2 text-xs', oracle: 'layout', expect: 'text run(s) wider than their own box with nothing clipping' },
  // Two boundaries now guard the same property, and each needs its own mutation: deleting the
  // apply-side guard is observable in the browser, deleting the load-side one is not (apply still
  // catches it), so only a static assertion can tell the second layer was removed. Proving one
  // red does not prove the other is load-bearing.
  { id: 'M18', file: THEME, from: 'if (isThemeKey(preferences.theme)) {', to: 'if (true) {', oracle: 'settings', expect: 'unknown theme written straight into the DOM' },
  { id: 'M19', file: THEME, from: 'theme: isThemeKey(parsed.theme) ? parsed.theme : DEFAULT_THEME_PREFERENCES.theme,', to: 'theme: parsed.theme,', oracle: 'guard', expect: 'the load boundary rejects an unknown stored theme key' },
  // The probe module is only safe to extract because it stays inert. Smuggle logic in and the
  // assertion that says so must fire - otherwise "it is just data" is a claim with nothing behind it.
  { id: 'M20', file: PROBES, from: 'export const HELPERS = `', to: 'export function smuggledLogic() { return 1 }\nexport const HELPERS = `', oracle: 'guard', expect: 'the probe module exports no logic of its own' },
  // The per-element staleness guard, both of its silent-death shapes, asserted through `gate-unit` so
  // no browser is in the loop and the case table is the one the sweep re-runs before quoting a zero.
  // M26 is the disarmed comparison (a loop bound that never runs: every element then "did not move");
  // M27 is the subtler one, where a missing or malformed box returns 0 instead of null, which turns an
  // element React unmounted - the strongest stale reading there is - into a pass.
  // M25 stays unused on purpose: it was drafted against the exit-code latch and withdrawn, because
  // after that fix no path asks for a second verdict, so the mutation could not change what the
  // oracle sees. Renumbering it here would make the old note point at a different test.
  {
    id: 'M26', file: HARNESS, oracle: 'gate-unit', expect: 'rectMoved planted 470px shift -> 0 (expected 470)',
    from: '  let worst = 0\n  for (let i = 0; i < 4; i++) {', to: '  let worst = 0\n  for (let i = 0; i < 0; i++) {',
  },
  {
    id: 'M27', file: HARNESS, oracle: 'gate-unit', expect: 'rectMoved live box missing (element unmounted) -> 0 (expected null)',
    from: '|| live.length !== 4) return null', to: '|| live.length !== 4) return 0',
  },
  // The projection's line-ending normaliser, disarmed. Without it the doc side of the comparison
  // arrives with \r on a CRLF working copy (and a leading empty line after a BEGIN marker), and the
  // gate reports every row as differing while the table matches byte for byte - the failure that
  // actually happened to the sibling guard on 2026-10-01. Two fixtures must go red here: the CRLF one
  // and the leading-blank one, which is why both were written.
  {
    id: 'M28', file: HARNESS, oracle: 'gate-unit', expect: 'doc-table: doc written with CRLF still equals the run',
    from: "const stripCountCol = (text) => normBlock(text).split('\\n')", to: "const stripCountCol = (text) => String(text).split('\\n')",
  },
  {
    // The dialog verdict was written today, so the question is not "does it find app bugs" but
    // "would it still say so if it stopped finding them". This disarms the reporting half of the
    // predicate - counts keep ticking, nothing is ever pushed - and the mode's own fixtures are what
    // notice, seven of them, before the app is judged at all.
    id: 'M29', file: HARNESS, oracle: 'confirm-gate', expect: 'confirm: Escape leaving the dialog open is caught',
    from: '  const need = (label, ok, got) => { checked += 1; if (!ok) failures.push(`${label} - got ${got}`) }',
    to: '  const need = (label, ok, got) => { checked += 1 }',
  },
  {
    // The lock reconciliation prints its offender list before returning; if the return is neutered
    // the gate still NAMES the stale member and exits 0 - a report dressed as a guard. This is the
    // only witness that the exit code, not the prose, carries the alarm.
    id: 'M30', file: 'scripts/check_release_version.py', oracle: 'release-version', expect: 'LOCK_CHECK_POISONED',
    from: '        print("  Fix: run `cargo update --workspace` where cargo exists, or revert the bump.", file=sys.stderr)\n        return 1',
    to: '        print("  Fix: run `cargo update --workspace` where cargo exists, or revert the bump.", file=sys.stderr)\n        return 0',
  },
  {
    // M30's twin: same gate, other branch. M30 proves the tripwire path; this one neuters the
    // stale-member return and poisons PAST the tripwire onto a corrupted lock - the run must
    // still alarm. A cosmetic reconciliation (prints offenders, returns 0) would pass "named"
    // alone; only the exit code carries it, which is what this mutation polices.
    id: 'M31', file: 'scripts/check_release_version.py', oracle: 'release-version-stale', expect: 'Cargo.lock workspace members are out of sync',
    removesGuard: true,
    from: '        print("  Fix: run `cargo update --workspace` where cargo exists, or revert the bump.", file=sys.stderr)\n        return 1',
    to: '        print("  Fix: run `cargo update --workspace` where cargo exists, or revert the bump.", file=sys.stderr)\n        return 0',
  },
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
  // Same rule for the two contrast oracles: one route each, because the fixtures that have to
  // notice (dead exemption, gradient disagreement) fire on the first combination anyway.
  const port = (base) => String(base + (process.pid % 50))
  const CMD = {
    'gate-unit': [process.execPath, [`${REPO}/${HARNESS}`, 'gate-unit']],
    layout: [process.execPath, [`${REPO}/${HARNESS}`, 'layout', '--tier', '640', '--routes', 'confirm-longname', '--port', port(9500)]],
    settings: [process.execPath, [`${REPO}/${HARNESS}`, 'settings-guard', '--port', port(9600)]],
    surfaces: [process.execPath, [`${REPO}/${HARNESS}`, 'theme-surfaces', '--routes', '设置', '--port', port(9700)]],
    contrast: [process.execPath, [`${REPO}/${HARNESS}`, 'contrast-tier', '--routes', '设置', '--port', port(9800)]],
    // No browser at all: the guard being tested is a startup refusal, and the verdict is the exit
    // code plus its message, not anything the run could measure.
    'bogus-mode': [process.execPath, [`${REPO}/${HARNESS}`, 'definitely-not-a-mode', 'gate-unit']],
    'latched-exit': [process.execPath, [`${REPO}/${HARNESS}`, 'contrast-tier', '--routes', '设置', '--deadline', '1', '--port', port(9900)]],
    // The dialog verdict's own oracle: `confirm` runs its fixtures before judging the app, so a
    // disarmed predicate is caught without needing the app to misbehave first.
    'confirm-gate': [process.execPath, [`${REPO}/${HARNESS}`, 'confirm', '--port', port(10000)]],
    'release-version': [python.exe, [...python.pre, 'scripts/check_release_version.py', '--poison-lock-check']],
  }
  const cmd = CMD[oracle] || [python.exe, [...python.pre, 'scripts/check_user_flow.py']]
  if (oracle === 'release-version-stale') {
    // M31's stage: poison past the tripwire and corrupt one member entry for exactly this run.
    // Cargo.lock is restored in finally even when python throws; a leftover 1.4.4 in the lock
    // would be the loudest false alarm there is.
    const f = `${REPO}/Cargo.lock`
    const original = readFileSync(f)
    const text = original.toString('utf8')
    const i = text.indexOf('name = "application"')
    const j = text.indexOf('version = "1.4.5"', i)
    if (i < 0 || j < 0 || j - i > 60) {
      return { status: null, spawnError: 'M31 lock anchor stale: cannot find application@1.4.5', output: '', marker: 'never-matches' }
    }
    writeFileSync(f, text.slice(0, j) + 'version = "1.4.4"' + text.slice(j + 'version = "1.4.5"'.length))
    try {
      const r2 = spawnSync(python.exe, [...python.pre, 'scripts/check_release_version.py', '--poison-lock-check', '--lock-reconciliation-unsafe-return-zero'], { cwd: REPO, encoding: 'utf8' })
      return { status: r2.status, spawnError: r2.error ? String(r2.error).slice(0, 120) : null, output: `${r2.stdout || ''}${r2.stderr || ''}`, marker: 'Cargo.lock workspace members' }
    } finally {
      writeFileSync(f, original)
    }
  }
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, encoding: 'utf8', timeout: oracle === 'gate-unit' || oracle === 'bogus-mode' ? 120_000 : 420_000 })
  const marker = { 'gate-unit': 'gate unit check', layout: 'LAYOUT_GATE', settings: 'SETTINGS_GATE', surfaces: 'SURFACE_GATE', contrast: 'CONTRAST_GATE', 'bogus-mode': 'HARNESS FAULT', 'latched-exit': 'HarnessFinishing', 'confirm-gate': 'VERDICT_SELFTEST', 'release-version': 'LOCK_CHECK_POISONED' }[oracle] || 'USERFLOW_CHECKS'
  if (oracle === 'bogus-mode') {
    // This oracle's whole job is to notice that the startup refusal was disarmed: with the guard in
    // place the run stops before touching a browser and exits 2 naming the mode.
    return { status: r.status, spawnError: r.error ? String(r.error).slice(0, 120) : null, output: `${r.stdout || ''}${r.stderr || ''}`, marker: 'is not declared' }
  }
  return { status: r.status, spawnError: r.error ? String(r.error).slice(0, 120) : null, output: `${r.stdout || ''}${r.stderr || ''}`, marker }
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
    // The baseline has to be taken BEFORE the mutation is written. It was not, first time: both runs
    // saw the same disarmed file, so the guard-removal case compared the mutant against itself and
    // reported "pristine run exited 0" about a file that was never pristine.
    const before = m.removesGuard ? runOracle(m.oracle) : null
    writeFileSync(path, mutated)
    // For a guard-removal mutation the baseline run is the other half of the proof: if the guard does
    // not alarm on the pristine file either, then "the mutated run went quiet" proves nothing about
    // the line that was deleted.
    const run = runOracle(m.oracle)
    const oracleRan = run.output.includes(run.marker)
    const baselineRan = before ? before.output.includes(before.marker) : true
    const baselineAlarmed = before ? (baselineRan && before.status !== 0 && before.output.includes(m.expect)) : true
    // "The oracle ran" is a diagnostic, not a gate: a fixture that catches its mutation stops the run
    // with a fault before any gate line prints, so requiring the gate line would call M22's cleanest
    // possible catch a non-run. What makes a mutation caught is the oracle going red AND naming the
    // property the mutation broke.
    const named = run.output.includes(m.expect)
    results.push({
      id: m.id, file: m.file, oracle: m.oracle, applied: true, spawnError: run.spawnError, oracleRan,
      removesGuard: !!m.removesGuard, baselineAlarmed,
      guardAlarmed: m.removesGuard ? baselineAlarmed && !named && run.status === 0 : (run.status !== 0 && run.status !== null && named),
      namedExpectedFailure: m.removesGuard ? baselineAlarmed : named,
      observedExit: run.status,
      baselineExit: before ? before.status : null,
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
  // A guard-removal case reads inverted on purpose: exit 0 there is the pass, so it has to be
  // labelled or the next person will "fix" the one line that looks wrong.
  const verdict = r.note ? `(${r.note})`
    : r.removesGuard ? `-> guard-removal: pristine run exited ${r.baselineExit} naming the guard, mutated run exited ${r.observedExit} and named nothing (baseline alarmed: ${r.baselineAlarmed})`
    : `-> oracle ran: ${r.oracleRan}, exit ${r.observedExit}, named expected failure: ${r.namedExpectedFailure}${r.spawnError ? `, spawnError: ${r.spawnError}` : ''}`
  console.log(`${head} ${verdict}${r.evidence && r.evidence.length ? `\n      ${r.evidence.join('\n      ')}` : ''}`)
}
// Machine-readable tally for verify:all. Same schema as the harness modes' GATE_JSON line: checked
// is what was actually attempted, so "0 attempted" can never be read as "0 failed".
console.log(`GATE_JSON ${JSON.stringify({ gate: 'mutations', checked: selected.length, failed: bad.length, ok: bad.length === 0 && unrestored.length === 0, unrestored: unrestored.length })}`)
console.log(`guard mutations: ${results.length - bad.length}/${selected.length} alarms reproduced | interpreter: ${python.exe} ${python.pre.join(' ')} | tree restored: ${unrestored.length === 0 ? 'clean' : `DIRTY ${unrestored.join(', ')}`}`)
if (bad.length) console.error('Some oracle stayed silent while its property was broken. That is a harness fault, not a passing test.')
process.exit(bad.length || unrestored.length ? 2 : 0)
