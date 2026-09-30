#!/usr/bin/env node
/**
 * Which semantic tokens are defined per theme, and which exist exactly once?
 *
 * This exists because "is the danger colour supposed to follow the theme?" cannot be answered from
 * one token's value - it can only be answered against the family it belongs to. Counting the family
 * by hand is what went wrong before: `--danger-solid` looks like a global token until you notice its
 * declaration sits inside the midnight block, so it is the midnight *override*, not the default.
 *
 * usage:  node scripts/theme_token_census.mjs            grouped listing
 *         node scripts/theme_token_census.mjs --family=accent,success,warning,danger
 *         node scripts/theme_token_census.mjs --verify   assert the policy below, exit 1 on breach
 *
 * THE POLICY (--verify enforces exactly this, and only this):
 *   Within one semantic colour family, the declaration style must be consistent: if ANY member of
 *   the family is declared per-theme (in >=2 theme blocks), then EVERY member of that family must
 *   be. A family where every member is declared once is coherent - it means that role is a
 *   theme-invariant constant, which is a legitimate choice.
 *
 *   What this policy does NOT cover, stated because the finding that prompted it is not covered:
 *   two families may each be internally consistent and still paint the SAME colour in two themes.
 *   That is what actually happened to --danger (global) and --danger-solid (midnight-only): the
 *   light themes' danger fill and midnight's are the same hex, and theme-surfaces - which judges
 *   rendered pixels, not declarations - is the gate that can see it. A static census cannot.
 *   So --verify bites the declaration drift and stays silent about colour collisions by design.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const src = readFileSync(`${ROOT}apps/desktop/src/styles.css`, 'utf8').replace(/\r\n/g, '\n')

const THEME = new Set([':root', ':root[data-theme="midnight"]', ':root[data-theme="sakura"]'])
const owners = new Map()

// Walk the file by brace depth and record, for each custom property declared at depth 1, which
// top-level selector it was declared under. Comments are skipped so a token named in prose is not
// counted as a declaration; only the three theme blocks are collected, so a token defined inside
// @media or a class rule is reported as "not in a theme block" rather than silently folded in.
let depth = 0
const stack = []
let pending = ''
for (let i = 0; i < src.length; i++) {
  const ch = src[i]
  if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i === -1) break; continue }
  if (ch === '{') { stack.push(pending.trim().split('\n').pop().trim()); depth++; pending = ''; continue }
  if (ch === '}') { stack.pop(); depth--; pending = ''; continue }
  if (ch === '\n') {
    if (depth === 1 && THEME.has(stack[0])) {
      const d = pending.trim().match(/^(--[a-z0-9-]+)\s*:/)
      if (d) {
        if (!owners.has(d[1])) owners.set(d[1], new Set())
        owners.get(d[1]).add(stack[0])
      }
    }
    pending = ''
    continue
  }
  pending += ch
}

const rows = [...owners.entries()].map(([tok, set]) => ({ tok, blocks: [...set], n: set.size }))
const familyArg = (process.argv.find((a) => a.startsWith('--family=')) || '').slice(9)
const family = familyArg ? familyArg.split(',').map((s) => `--${s.trim().replace(/^-+/, '')}`) : null
const shown = family ? rows.filter((r) => family.includes(r.tok) || family.some((f) => r.tok.startsWith(`${f}-`))) : rows

const quiet = process.argv.includes('--verify') || process.argv.includes('--selftest')
const perTheme = shown.filter((r) => r.n >= 2)
const once = shown.filter((r) => r.n === 1)
if (!quiet) {
  console.log(`TOKEN_CENSUS scanned=${rows.length} shown=${shown.length} per_theme=${perTheme.length} declared_once=${once.length}${family ? ` family=${familyArg}` : ''}`)
  console.log(`\ndefined in >=2 theme blocks (${perTheme.length}):`)
  for (const r of perTheme.sort((a, b) => b.n - a.n || a.tok.localeCompare(b.tok))) console.log(`  ${r.tok}  ${r.n}/3  ${r.blocks.join(' ')}`)
  console.log(`\ndefined in exactly 1 theme block (${once.length}):`)
  for (const r of once.sort((a, b) => a.blocks[0].localeCompare(b.blocks[0]) || a.tok.localeCompare(b.tok))) console.log(`  ${r.tok}  only in ${r.blocks[0]}`)
}
const absent = ['--danger', '--danger-solid', '--accent', '--accent-solid'].filter((t) => !owners.has(t))
if (absent.length) console.log(`\nNOT FOUND in any theme block: ${absent.join(' ')}`)

// ---------- the policy, as a function over (token -> block count) so it can be fed a fabricated
// census as well as the real one. A rule that has only ever been run against the tree it was
// written from is not known to bite.

const familyOf = (tok) => tok.replace(/^--/, '').split(/-/)[0]
const PALETTE = new Set(['color'])   // --color-* rungs are the palette itself, not a semantic role

function policyBreaches(rows) {
  const fams = new Map()
  for (const r of rows) {
    const f = familyOf(r.tok)
    if (PALETTE.has(f)) continue
    if (!fams.has(f)) fams.set(f, [])
    fams.get(f).push(r)
  }
  const out = []
  for (const [f, members] of fams) {
    const split = members.filter((m) => m.n >= 2)
    if (!split.length) continue                       // whole family global-only: coherent
    const mixed = members.filter((m) => m.n === 1)
    if (mixed.length) out.push({ family: f, perTheme: split.map((m) => m.tok), onceOnly: mixed.map((m) => `${m.tok} (declared in ${mixed.find((x) => x.tok === m.tok).blocks[0]})`) })
  }
  return out.sort((a, b) => a.family.localeCompare(b.family))
}

function selftestCases() {
  const row = (tok, n) => ({ tok, n, blocks: Array.from({ length: n }, (_, i) => [':root', ':root[data-theme="midnight"]', ':root[data-theme="sakura"]'][i]) })
  const cases = []
  const push = (name, got, want) => cases.push({ name, got, want, ok: got === want })
  // Fixture 1 - the shape the policy exists to refuse: one member per-theme, one member once.
  push('a mixed family is reported', policyBreaches([row('--accent', 3), row('--accent-solid', 1)]).length, 1)
  // Fixture 2 - the compliant projection of the SAME tokens: a family that is uniformly global is
  // a legitimate choice, so the rule must stay quiet about it. Without this case, "report anything
  // that is not declared three times" would pass fixture 1 too.
  push('a uniformly global family is NOT reported', policyBreaches([row('--danger', 1), row('--danger-solid', 1)]).length, 0)
  push('a uniformly per-theme family is NOT reported', policyBreaches([row('--surface', 3), row('--surface-soft', 3)]).length, 0)
  push('a single-member family is NOT reported', policyBreaches([row('--wallpaper', 1)]).length, 0)
  push('palette rungs are out of scope', policyBreaches([row('--color-slate-400', 3), row('--color-slate-50', 1)]).length, 0)
  return cases
}

const printSelftest = () => {
  const cases = selftestCases()
  const bad = cases.filter((c) => !c.ok)
  console.log(`TOKEN_POLICY_SELFTEST cases=${cases.length} failed=${bad.length}`)
  for (const c of cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: got=${c.got} expect=${c.want}`)
  return bad
}

if (process.argv.includes('--selftest')) {
  const bad = printSelftest()
  if (bad.length) { console.log('the policy check cannot tell a breach from compliance, so its verdict on the real file means nothing.'); process.exit(2) }
  process.exit(0)
}

if (process.argv.includes('--verify')) {
  // The instrument proves itself before it is allowed to report on the tree, same order as every
  // other gate in this repo: a check that has only ever been run against the file it was written
  // from is not known to bite.
  const bad = printSelftest()
  if (bad.length) {
    console.log('TOKEN_POLICY SELFTEST-FAILED: the census cannot distinguish a breach from compliance; its count of the real file is not evidence.')
    process.exit(2)
  }
  const breaches = policyBreaches(rows)
  console.log(`TOKEN_POLICY families=${new Set(rows.filter((r) => !PALETTE.has(familyOf(r.tok))).map((r) => familyOf(r.tok))).size} breaches=${breaches.length}`)
  for (const b of breaches) console.log(`  BREACH ${b.family}: per-theme ${b.perTheme.join(',')} but declared once ${b.onceOnly.join(',')} - a family either follows the theme throughout or is a constant throughout.`)
  process.exit(breaches.length ? 1 : 0)
}

