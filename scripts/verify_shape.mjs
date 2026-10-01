#!/usr/bin/env node
/**
 * Harness shape ledger - the instrument behind "prove the split lost nothing".
 *
 * Splitting a 152 KB harness into files by concern is not verified by the tests still passing:
 * a dropped `if` block, a mode nobody dispatches to any more, or a silently shorter assertion list
 * all pass. So the shape is snapshotted before the split and re-checked after it, and the check is
 * an identity in both directions, not a smell test.
 *
 * usage:
 *   node scripts/verify_shape.mjs              print the current shape
 *   node scripts/verify_shape.mjs --snapshot   write scripts/verify_shape.baseline.json
 *   node scripts/verify_shape.mjs --verify     compare reality with the baseline, exit 1 on drift
 *
 * What is compared:
 *   - the SET of mode names (reachable + orphan), symmetric difference in both directions
 *   - the sum of lines and the sum of reachable bytes across the harness files (relocating text
 *     between files leaves both unchanged; losing or duplicating text does not)
 *   - the count of decision points per family (a moved `failures.push(` is still counted, so the
 *     totals hold; a deleted one lowers them and the file that gained it raises nothing)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { MODES, DISPATCH_RE } from './verify_modes.mjs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const BASELINE = `${ROOT}scripts/verify_shape.baseline.json`

// Every scripts/verify_*.mjs is in scope, discovered rather than hand-listed: the point of the
// ledger is that splitting content INTO new files is invisible to a hand-maintained list. The same
// glob is what the CHANGELOG fingerprint table requires a row for, so a new file is registered in
// two independent places - bytes by this ledger, identity by the fingerprint row.
const FILES = readdirSync(`${ROOT}scripts`).filter((f) => /^verify_.*\.mjs$/.test(f)).map((f) => `scripts/${f}`)

const FAMILIES = [
  ['failures.push', /failures\.push\(/g],
  ['emitGate', /\bemitGate\(/g],
  ['harness-fault exit', /finish\(2\)/g],
  ['gate line', /console\.log\(`[A-Z]+_GATE/g],
  ['positive control', /\bCONTROL[- A-Z]*[A-Z]\b/g],
  ['throw', /throw new Error\(/g],
]

const count = (s, re) => (s.match(re) || []).length

export function shape() {
  const present = readdirSync(`${ROOT}scripts`)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `scripts/${f}`)
  const files = [...new Set([...FILES, ...present.filter((f) => /^scripts\/verify_(mode|harness)/.test(f))])]
  const perFile = files.map((rel) => {
    const ok = existsSync(`${ROOT}${rel}`)
    const src = ok ? readFileSync(`${ROOT}${rel}`, 'utf8') : ''
    return {
      file: rel,
      exists: ok,
      lines: ok ? src.split('\n').length : 0,
      bytes: ok ? Buffer.byteLength(src, 'utf8') : 0,
      families: Object.fromEntries(FAMILIES.map(([name, re]) => [name, count(src, re)])),
    }
  })
  const all = perFile.filter((f) => f.exists)
  // Declared = the imported list (one answer for the runner and this ledger). Reachable = the
  // dispatch statements that exist in the harness sources, matched by the anchored pattern in
  // verify_modes.mjs. Reading the list by import and the blocks by an anchored regex is what
  // replaces the earlier loose scan - that one counted prose, and reported a mode as duplicated
  // when it was only mentioned twice.
  const reachable = new Set()
  for (const f of all) {
    const src = readFileSync(`${ROOT}${f.file}`, 'utf8')
    for (const m of src.matchAll(DISPATCH_RE)) reachable.add(m[1])
  }
  const declared = new Set(MODES)
  return {
    files: perFile,
    totals: {
      files: all.length,
      lines: all.reduce((a, f) => a + f.lines, 0),
      bytes: all.reduce((a, f) => a + f.bytes, 0),
      families: Object.fromEntries(FAMILIES.map(([name]) => [name, all.reduce((a, f) => a + f.families[name], 0)])),
    },
    modes: {
      reachable: [...reachable].sort(),
      declared: [...declared].sort(),
      // A mode that can be dispatched to but is not listed is invisible to the person running the
      // harness, and one that is listed but unreachable is a lie in the help text.
      undeclared: [...reachable].filter((m) => !declared.has(m)).sort(),
      undispatchable: [...declared].filter((m) => m !== 'help' && !reachable.has(m)).sort(),
    },
  }
}

const fmt = (o) => JSON.stringify(o, null, 2)

// One comparison rule for every problem: `value !== expect` fails. The first version carried a
// second, optional `exact` flag and judged anything without it against zero - so the four extraction
// problems, which expect ONE, were compared against zero and a fully broken extraction (git show
// failing, all three bodies unmatched) printed no mismatch at all. An expectation written into the
// label but not into the comparison is a display, not a gate: it cannot redden anything. Dropping
// the flag makes that shape unrepresentable.
function problems(baseline, now, ex) {
  const out = []
  const push = (check, value, expect) => out.push({ check, value, expect })
  const idSum = (setA, setB) => setA.filter((x) => !setB.includes(x)).length + setB.filter((x) => !setA.includes(x)).length
  const m0 = baseline.modes, m1 = now.modes
  push('mode-set symmetric difference (reachable)', idSum(m0.reachable, m1.reachable), 0)
  push('mode-set symmetric difference (declared)', idSum(m0.declared, m1.declared), 0)
  push('total lines across harness files', now.totals.lines, baseline.totals.lines)
  push('total bytes across harness files', now.totals.bytes, baseline.totals.bytes)
  push('modes reachable but not in the help list', m1.undeclared.length, 0)
  push('modes in the help list but not dispatchable', m1.undispatchable.length, 0)
  for (const [name] of FAMILIES) push(`decision points: ${name}`, now.totals.families[name], baseline.totals.families[name])
  // Per-file rows used to be recorded and never compared: only totals and families were, so flipping
  // a digit in one file's line count changed nothing the gate read. That made the claim "this file
  // is a gate input, so it is fingerprinted" false for every field except the aggregate.
  const bFiles = new Map((baseline.files || []).map((f) => [f.file, f]))
  for (const f of now.files) {
    const e = bFiles.get(f.file)
    if (!e) { push(`baseline row exists for ${f.file}`, 'missing', 'present'); continue }
    push(`${f.file} lines`, f.lines, e.lines)
    push(`${f.file} bytes`, f.bytes, e.bytes)
    for (const [name] of FAMILIES) push(`${f.file} decision points: ${name}`, f.families[name], e.families[name])
  }
  for (const e of baseline.files || []) {
    if (!now.files.some((f) => f.file === e.file)) push(`baseline row ${e.file} is still in the census`, 'measured as gone', 'present')
  }
  push(`pre-split source available at ${ex.before}`, ex.beforeAvailable ? 1 : 0, 1)
  push(`post-split module available at ${ex.at}`, ex.probesAvailable ? 1 : 0, 1)
  for (const b of ex.bodies) push(`extracted body ${b.name} still byte-identical to the pre-split file`, b.verbatim ? 1 : 0, 1)
  return out
}

const isBad = (p) => p.value !== p.expect

// Two opposing fixtures, run before any verdict is printed: the ledger is only an instrument if a
// planted loss reddens it, and the shape that broke the first version was a check whose expectation
// lived in prose. Case 3 is that exact hole - it fabricates "extraction found nothing" and requires
// the four expect-1 problems to be counted, which is precisely what the old comparison could not do.
function selftest() {
  const now = shape()
  const copy = () => JSON.parse(JSON.stringify(now))
  const healthy = { beforeAvailable: true, probesAvailable: true, before: 'x', at: 'y', bodies: ['HELPERS', 'VISUAL_PROBE', 'LAYOUT_PROBE'].map((name) => ({ name, present: true, verbatim: true, bytes: 1 })) }
  const dead = { beforeAvailable: false, probesAvailable: false, before: 'x', at: 'y', bodies: ['HELPERS', 'VISUAL_PROBE', 'LAYOUT_PROBE'].map((name) => ({ name, present: true, verbatim: false, bytes: 0 })) }
  const cases = []
  const run = (name, wantBad, bl, ex) => {
    const list = problems(bl, now, ex)
    const bad = list.filter(isBad)
    cases.push({ name, bad: bad.length, want: wantBad, ok: bad.length === wantBad, names: bad.map((p) => p.check).slice(0, 4) })
  }
  run('identical baseline reports no drift', 0, copy(), healthy)
  run('one lost byte reports drift', 1, (() => { const b = copy(); b.totals.bytes -= 1; return b })(), healthy)
  // The case that was missing: a per-file row edited by one digit while every aggregate still agrees.
  // Before the per-file comparison existed this reported 0 problems - the file looked fingerprinted
  // and was not.
  run('one per-file row tampered, aggregates untouched', 1, (() => { const b = copy(); b.files[0].lines += 1; return b })(), healthy)
  run('one per-file family count tampered', 1, (() => { const b = copy(); const f = b.files.find((x) => x.families['gate line'] > 0) || b.files[0]; f.families['gate line'] = (f.families['gate line'] || 0) + 1; return b })(), healthy)
  run('a dead extraction reports every extraction problem', 5, copy(), dead)
  // The bug this case exists for: the bodies used to be read out of the working file, so a legitimate
  // later edit to a probe looked like the split had destroyed content. Each availability flag is now
  // its own problem, and a broken one reddens exactly the claim it invalidates.
  run('only the post-split blob unreadable', 1, copy(), { ...healthy, probesAvailable: false })
  run('both blobs readable but a body not verbatim', 1, copy(), { ...healthy, bodies: healthy.bodies.map((b, i) => (i === 1 ? { ...b, verbatim: false } : b)) })
  run('a mode removed from the dispatch reports the set difference', 1, (() => {
    const b = copy()
    b.modes.reachable = b.modes.reachable.filter((m) => m !== b.modes.reachable[0])
    return b
  })(), healthy)
  return cases
}

const now = shape()
// The extraction is re-checkable, not just attested: verify_probes.mjs was cut out of the harness at
// 58be53f, and git history keeps the pre-split blob forever, so "nothing was rewritten on the way
// out" is a byte comparison rather than a claim. SPLIT_COMMIT is the commit that did the cut; if the
// history is ever rewritten this check fails loudly instead of silently skipping.
//
// BOTH sides are read from git, not from the working copy. The first version read the bodies out of
// the file on disk, which made a permanent claim about the split ("the move was verbatim") answerable
// with "the probe has been edited since" - and it was: the per-axis clipper fix landed in
// verify_probes.mjs afterwards, and the ledger reported the split as having lost LAYOUT_PROBE. A
// history property must be checked against history; what the working copy did to the totals is the
// ledger's OTHER half.
const SPLIT_COMMIT = '58be53f'
const SPLIT_BEFORE = `${SPLIT_COMMIT}^`
export function extraction() {
  const pre = gitShow(`${SPLIT_BEFORE}:scripts/verify_dialog_interactions.mjs`)
  const probes = gitShow(`${SPLIT_COMMIT}:scripts/verify_probes.mjs`)
  const out = []
  for (const name of ['HELPERS', 'VISUAL_PROBE', 'LAYOUT_PROBE']) {
    const at = probes === null ? -1 : probes.indexOf(`export const ${name}`)
    if (at === -1) { out.push({ name, present: false, verbatim: false, bytes: 0 }); continue }
    const s = probes.indexOf('`', at), e = probes.indexOf('`', s + 1)
    const body = probes.slice(s + 1, e)
    out.push({ name, present: true, bytes: Buffer.byteLength(body, 'utf8'), verbatim: pre !== null && pre.indexOf(body) !== -1 })
  }
  return { before: SPLIT_BEFORE, at: SPLIT_COMMIT, beforeAvailable: pre !== null, probesAvailable: probes !== null, bodies: out }
}

const gitShow = (spec) => {
  try {
    return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch {
    return null
  }
}

const gitRev = (rev) => {
  try {
    return execFileSync('git', ['rev-parse', rev], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Same shape as the harness's parser: --k v and --k=v, and nothing is silently ignored - an option
// that is typed but not read is how a snapshot gets taken believing it carried a reason that was
// attached to the wrong flag.
function opt(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : (argv[i + 1] ?? null)
}

const argv = process.argv.slice(2)
if (argv[0] === '--snapshot') {
  // Signing a new baseline is a signature act, not a refresh: it erases the record of what the
  // previous one promised. So it refuses without a reason, and stores the reason next to the commit
  // it was taken at - which is what makes a later "why did this stop catching X" answerable.
  const reason = opt('reason')
  if (!reason) {
    console.error('SPLIT_SHAPE SNAPSHOT REFUSED: --snapshot overwrites the promise the old baseline made. Pass --reason "<what changed and why it is intended>".')
    process.exit(2)
  }
  const head = gitRev('HEAD')
  const payload = { _meta: { takenAt: new Date().toISOString().slice(0, 19), head: head || 'unknown', reason }, ...now }
  writeFileSync(BASELINE, fmt(payload) + '\n')
  console.log(`SPLIT_SHAPE snapshot written: files=${now.totals.files} lines=${now.totals.lines} bytes=${now.totals.bytes} modes=${now.modes.reachable.length} reason="${reason}"`)
  process.exit(0)
}
if (argv[0] === '--verify') {
  if (!existsSync(BASELINE)) { console.log('SPLIT_SHAPE no baseline at scripts/verify_shape.baseline.json - run --snapshot first'); process.exit(1) }
  // The instrument proves itself before it is allowed to report on the tree: a ledger that cannot
  // redden on a planted loss is a display, and its "OK" is worth nothing.
  const cases = selftest()
  const broken = cases.filter((c) => !c.ok)
  console.log(`SHAPE_SELFTEST cases=${cases.length} failed=${broken.length}`)
  for (const c of cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: bad=${c.bad} expect ${c.want}${c.names.length ? ` [${c.names.join('; ')}]` : ''}`)
  if (broken.length) {
    for (const c of broken) console.log(`  self-test "${c.name}" got bad=${c.bad}, expected ${c.want} - the ledger itself is wrong, so its verdict on the tree means nothing`)
    process.exit(2)
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const meta = baseline._meta
  console.log(`SPLIT_SHAPE_BASELINE takenAt=${meta?.takenAt ?? 'none'} head=${(meta?.head ?? 'unknown').slice(0, 8)} reason="${meta?.reason ?? 'this baseline predates provenance tracking'}"`)
  const ex = extraction()
  const list = problems(baseline, now, ex)
  const bad = list.filter(isBad)
  console.log(`SPLIT_SHAPE ${bad.length ? 'DRIFT' : 'OK'} checked=${list.length} failed=${bad.length}`)
  // A count without names is a verdict nobody can act on, so the offenders print on the failing path
  // (and only there - the green run stays two lines).
  for (const p of bad) console.log(`  MISMATCH ${p.check}: ${p.value} (expect ${p.expect})`)
  if (bad.length) {
    console.log('shape drifted; to accept a deliberate change re-run --snapshot AFTER the split is proven complete')
    process.exit(1)
  }
  const perFile = now.files.filter((f) => f.exists).map((f) => `${f.file}:${f.lines}L/${f.bytes}B`).join(' ')
  console.log(`  files: ${perFile}`)
  console.log(`  extraction: ${ex.bodies.map((b) => `${b.name}=${b.bytes}B`).join(' ')}`)
  process.exit(0)
}
if (argv[0] === '--report') {
  const one = (spec) => {
    const t = gitShow(spec)
    return t === null ? null : { lines: t.split('\n').length - 1, bytes: Buffer.byteLength(t, 'utf8'), src: t }
  }
  const ex = extraction()
  const before = one(`${ex.before}:scripts/verify_dialog_interactions.mjs`)
  const afterHarness = one('HEAD:scripts/verify_dialog_interactions.mjs')
  const afterProbes = one('HEAD:scripts/verify_probes.mjs')
  const setBefore = before ? new Set([...before.src.matchAll(DISPATCH_RE)].map((m) => m[1])) : new Set()
  const setAfter = new Set(MODES)
  const missA = [...setBefore].filter((x) => !setAfter.has(x))
  const missB = [...setAfter].filter((x) => !setBefore.has(x))
  console.log(`SPLIT_REPORT before(${ex.before}): file=verify_dialog_interactions.mjs lines=${before?.lines} bytes=${before?.bytes} modes=${setBefore.size}`)
  console.log(`SPLIT_REPORT after (HEAD)        : two files lines=${afterHarness && afterProbes ? afterHarness.lines + afterProbes.lines : '?'} bytes=${afterHarness && afterProbes ? afterHarness.bytes + afterProbes.bytes : '?'} modes=${setAfter.size}`)
  console.log(`SPLIT_REPORT symmetric difference (before\\after)=${missA.length}[${missA}] (after\\before)=${missB.length}[${missB}]`)
  console.log(`SPLIT_REPORT extraction bodies: ${ex.bodies.map((b) => `${b.name} ${b.bytes}B verbatim=${b.verbatim}`).join(' | ')}`)
  console.log(`SPLIT_REPORT ledger now: files=${now.totals.files} lines=${now.totals.lines} bytes=${now.totals.bytes} decisionPoints=${JSON.stringify(now.totals.families)}`)
  process.exit(0)
}
console.log(fmt(now))
