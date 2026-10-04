#!/usr/bin/env node
/**
 * Recomputes the fingerprint table in CHANGELOG.md from the working copy, so the row set is
 * generated rather than remembered.
 *
 * This file is deliberately NOT named verify_*.mjs and is not a verify_all stage: check_user_flow.py
 * requires a table row for every measured file, and a generator that measured the table it writes
 * would then have to write a row containing its own size - which changes the size.
 *
 * usage:  node scripts/fingerprint_rows.mjs            rows for every measured file
 *         node scripts/fingerprint_rows.mjs --paste    the same, ready to drop into the table body
 *         node scripts/fingerprint_rows.mjs --patch    rewrite cells 2-4 of each existing row in
 *                                                      CHANGELOG.md, leaving the prose columns alone
 *
 * --patch exists because the table drifted again while it was still hand-edited: an Edit aimed at a
 * row failed to match, and the stale numbers stayed in place unnoticed until the next run of the
 * checker. Numbers-only is deliberate - adding a row for a new file stays a human act, because the
 * two prose columns carry the baseline reading that file has to reproduce, and a generator that
 * filled them would be printing a measurement it never took. When a row is missing --patch refuses
 * rather than inventing one.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\/$/, '')

function measuredFiles() {
  const listed = readdirSync(`${ROOT}/scripts`)
  const verify = listed.filter((p) => /^verify_.*\.mjs$/.test(p)).map((p) => `scripts/${p}`)
  const fixtures = (readdirSync(`${ROOT}/scripts/__fixtures__`) || []).filter((p) => p.endsWith('.mjs')).map((p) => `scripts/__fixtures__/${p}`)
  // Membership follows "is a stage", not "starts with verify_". The name-prefix rule alone let a gate
  // escape the table by being named something else - theme_face_inventory.mjs is wired into
  // verify_all.mjs and was fingerprinted by nobody until this line existed. Keep in sync with the
  // same derivation in check_user_flow.py; the table==disk assertion catches the two disagreeing.
  const aggregate = readFileSync(`${ROOT}/scripts/verify_all.mjs`).toString('utf8')
  // Both script families: the .mjs-only rule let a Python stage escape the table simply by being
  // written in Python, which is exactly how scripts/project_state.py first slipped out.
  const staged = [...aggregate.matchAll(/'scripts\/([A-Za-z0-9_-]+\.(?:mjs|py))'/g)].map((m) => `scripts/${m[1]}`)
  // A gate's signed baseline is a gate input: rewriting it changes what "drift" means while every
  // line of code stays put. Matched by shape so a second baseline cannot join invisibly.
  const baselines = listed.filter((p) => /\.baseline\.json$/.test(p)).map((p) => `scripts/${p}`)
  return [...new Set([...verify, ...fixtures, ...staged, ...baselines, 'scripts/check_user_flow.py'])].sort()
}

const kb = (n) => n.toLocaleString('en-US')

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function computeRows() {
  return measuredFiles().map((rel) => {
    // Read the working copy and normalise CRLF to LF. core.autocrlf=true checks the tree out with
    // CRLF while the commit stores LF, so the normalised worktree bytes are byte-identical to the
    // blob this file is about to become - which is the only way a row can be written in the SAME
    // commit it describes. Reading HEAD instead would force a second commit and leave the first one
    // with a red assertion in history.
    const normalised = readFileSync(`${ROOT}/${rel}`).toString('utf8').replace(/\r\n/g, '\n')
    const data = Buffer.from(normalised, 'utf8')
    // Same unit as check_user_flow.py's fingerprint(): the NUMBER OF NEWLINES, not the number of
    // split parts. A file ending in "\n" differs by one between the two, and every row this script
    // wrote would then have been red against the very assertion it feeds.
    return { rel, lines: data.toString('utf8').split('\n').length - 1, bytes: data.length, sha: createHash('sha256').update(data).digest('hex') }
  })
}

const rows = computeRows()

if (!process.argv.includes('--patch')) {
  for (const r of rows) console.log(`| \`${r.rel}\` | ${r.lines} | ${kb(r.bytes)} | \`${r.sha}\` |`)
  process.exit(0)
}

const path = `${ROOT}/CHANGELOG.md`
const text = readFileSync(path, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lines = text.split(/\r?\n/)
const updated = []
const missing = []
for (const r of rows) {
  const head = new RegExp(`^\\|\\s*\`${esc(r.rel)}\`[^|]*\\|`)
  const idx = lines.findIndex((l) => head.test(l))
  if (idx === -1) {
    missing.push(r.rel)
    continue
  }
  // Cell-wise rewrite. Safe under the same assumption check_user_flow.py's row regex already makes:
  // no ASCII pipe inside a cell. If that ever breaks, the row stops matching there and the
  // table==disk assertion goes red rather than the patch silently rewriting the wrong cells.
  const cells = lines[idx].split('|')
  if (cells.length < 5 || !cells[1].includes(r.rel)) {
    console.error(`PATCH REFUSED ${r.rel}: row has ${cells.length - 2} cells, expected the fingerprint table's shape`)
    process.exit(2)
  }
  const next = [cells[0], cells[1], ` ${r.lines} `, ` ${kb(r.bytes)} `, ` \`${r.sha}\` `, ...cells.slice(5)].join('|')
  if (next !== lines[idx]) {
    updated.push(`${r.rel}: ${lines[idx].split('|').slice(2, 5).join('|').trim()} -> ${r.lines}L/${kb(r.bytes)}B/${r.sha.slice(0, 8)}`)
    lines[idx] = next
  }
}
if (missing.length) {
  // Refuse rather than append: the two prose columns state which baseline this file reproduces, and
  // an authored row that says nothing is the false-completeness shape this table was built to avoid.
  console.error(`PATCH REFUSED, no row to patch for: ${missing.join(', ')} - write the row (with its prose columns) first`)
  process.exit(2)
}
writeFileSync(path, lines.join(eol), 'utf8')
console.log(updated.length ? `FINGERPRINT_PATCH updated=${updated.length}` : `FINGERPRINT_PATCH updated=0`)
for (const u of updated) console.log(`  ${u}`)
console.log(`FINGERPRINT_PATCH rows=${rows.length} unchanged=${rows.length - updated.length}`)

