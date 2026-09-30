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
 *
 * It reports. It does not assert, because there is no policy to assert against yet - that is the
 * open question, not a fact this file gets to decide.
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

const perTheme = shown.filter((r) => r.n >= 2)
const once = shown.filter((r) => r.n === 1)
console.log(`TOKEN_CENSUS scanned=${rows.length} shown=${shown.length} per_theme=${perTheme.length} declared_once=${once.length}${family ? ` family=${familyArg}` : ''}`)
console.log(`\ndefined in >=2 theme blocks (${perTheme.length}):`)
for (const r of perTheme.sort((a, b) => b.n - a.n || a.tok.localeCompare(b.tok))) console.log(`  ${r.tok}  ${r.n}/3  ${r.blocks.join(' ')}`)
console.log(`\ndefined in exactly 1 theme block (${once.length}):`)
for (const r of once.sort((a, b) => a.blocks[0].localeCompare(b.blocks[0]) || a.tok.localeCompare(b.tok))) console.log(`  ${r.tok}  only in ${r.blocks[0]}`)
const absent = ['--danger', '--danger-solid', '--accent', '--accent-solid'].filter((t) => !owners.has(t))
if (absent.length) console.log(`\nNOT FOUND in any theme block: ${absent.join(' ')}`)
