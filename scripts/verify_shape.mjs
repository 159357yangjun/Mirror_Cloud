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

function diff(baseline, now) {
  const problems = []
  const idSum = (setA, setB) => setA.filter((x) => !setB.includes(x)).length + setB.filter((x) => !setA.includes(x)).length
  const m0 = baseline.modes, m1 = now.modes
  const reach = idSum(m0.reachable, m1.reachable)
  const decl = idSum(m0.declared, m1.declared)
  problems.push({ check: 'mode-set symmetric difference (reachable)', value: reach, expect: 0 })
  problems.push({ check: 'mode-set symmetric difference (declared)', value: decl, expect: 0 })
  problems.push({ check: 'total lines across harness files', value: now.totals.lines, expect: baseline.totals.lines, exact: true })
  problems.push({ check: 'total bytes across harness files', value: now.totals.bytes, expect: baseline.totals.bytes, exact: true })
  problems.push({ check: 'modes reachable but not in the help list', value: m1.undeclared.length, expect: 0 })
  problems.push({ check: 'modes in the help list but not dispatchable', value: m1.undispatchable.length, expect: 0 })
  for (const [name] of FAMILIES) {
    problems.push({ check: `decision points: ${name}`, value: now.totals.families[name], expect: baseline.totals.families[name], exact: true })
  }
  return problems
}

const now = shape()
// The extraction is re-checkable, not just attested: verify_probes.mjs was cut out of the harness at
// 58be53f, and git history keeps the pre-split blob forever, so "nothing was rewritten on the way
// out" is a byte comparison rather than a claim. SPLIT_COMMIT is the commit that did the cut; if the
// history is ever rewritten this check fails loudly instead of silently skipping.
const SPLIT_COMMIT = '58be53f^'
export function extraction() {
  const src = existsSync(BASELINE) ? null : null
  const pre = gitShow(`${SPLIT_COMMIT}:scripts/verify_dialog_interactions.mjs`)
  const probes = existsSync(`${ROOT}scripts/verify_probes.mjs`) ? readFileSync(`${ROOT}scripts/verify_probes.mjs`, 'utf8') : ''
  const out = []
  for (const name of ['HELPERS', 'VISUAL_PROBE', 'LAYOUT_PROBE']) {
    const at = probes.indexOf(`export const ${name}`)
    if (at === -1) { out.push({ name, present: false, verbatim: false, bytes: 0 }); continue }
    const s = probes.indexOf('`', at), e = probes.indexOf('`', s + 1)
    const body = probes.slice(s + 1, e)
    out.push({ name, present: true, bytes: Buffer.byteLength(body, 'utf8'), verbatim: pre !== null && pre.indexOf(body) !== -1 })
  }
  return { before: SPLIT_COMMIT, beforeAvailable: pre !== null, bodies: out }
}

const gitShow = (spec) => {
  try {
    return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch {
    return null
  }
}

const argv = process.argv.slice(2)
if (argv[0] === '--snapshot') {
  writeFileSync(BASELINE, fmt(now) + '\n')
  console.log(`SPLIT_SHAPE snapshot written: files=${now.totals.files} lines=${now.totals.lines} bytes=${now.totals.bytes} modes=${now.modes.reachable.length}`)
  process.exit(0)
}
if (argv[0] === '--verify') {
  if (!existsSync(BASELINE)) { console.log('SPLIT_SHAPE no baseline at scripts/verify_shape.baseline.json - run --snapshot first'); process.exit(1) }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const problems = diff(baseline, now)
  const ex = extraction()
  problems.push({ check: `pre-split source available at ${ex.before}`, value: ex.beforeAvailable ? 1 : 0, expect: 1 })
  for (const b of ex.bodies) problems.push({ check: `extracted body ${b.name} still byte-identical to the pre-split file`, value: b.verbatim ? 1 : 0, expect: 1 })
  const bad = problems.filter((p) => (p.exact ? p.value !== p.expect : p.value !== 0))
  console.log(`SPLIT_SHAPE ${bad.length ? 'DRIFT' : 'OK'} checked=${problems.length} failed=${bad.length}`)
  for (const p of problems) console.log(`  ${p.exact ? `${p.check}: ${p.value} (expect ${p.expect})` : `${p.check}: ${p.value}`}${p.value === (p.exact ? p.expect : 0) ? '' : '   <-- MISMATCH'}`)
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
