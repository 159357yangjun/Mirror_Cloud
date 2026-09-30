#!/usr/bin/env node
/**
 * Prints the fingerprint table rows straight from `git show HEAD:<path>`, so the row set in
 * CHANGELOG.md is generated rather than remembered.
 *
 * This file is deliberately NOT named verify_*.mjs: check_user_flow.py requires a table row for
 * every scripts/verify_*.mjs, and a generator that measures the table it writes would then have to
 * write a row containing its own size - which changes the size. Reading HEAD blobs (not the working
 * copy) is what keeps a row from referring to bytes that only exist after the row is committed.
 *
 * usage:  node scripts/fingerprint_rows.mjs          rows for every measured file
 *         node scripts/fingerprint_rows.mjs --paste  the same, ready to drop into the table body
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\/$/, '')
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer' })

function measuredFiles() {
  const listed = readdirSync(`${ROOT}/scripts`)
  const verify = listed.filter((p) => /^verify_.*\.mjs$/.test(p)).map((p) => `scripts/${p}`)
  const fixtures = (readdirSync(`${ROOT}/scripts/__fixtures__`) || []).filter((p) => p.endsWith('.mjs')).map((p) => `scripts/__fixtures__/${p}`)
  return [...verify, ...fixtures, 'scripts/check_user_flow.py'].sort()
}

const kb = (n) => n.toLocaleString('en-US')

for (const rel of measuredFiles()) {
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
  const lines = data.toString('utf8').split('\n').length - 1
  const sha = createHash('sha256').update(data).digest('hex')
  console.log(`| \`${rel}\` | ${lines} | ${kb(data.length)} | \`${sha}\` |`)
}
