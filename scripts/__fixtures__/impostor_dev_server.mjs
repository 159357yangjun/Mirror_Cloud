/**
 * An impostor dev server, for proving the identity gate in
 * `scripts/verify_dialog_interactions.mjs` really alarms.
 *
 * This exists because a red demonstration nobody can re-run is not evidence. Both modes below are
 * deliberately *wrong* servers: the gate must reject each with exit code 2. Run them through
 * `npm run verify:dialog red-demo`, which starts this file, points the gate at it, and asserts the
 * rejection. Started by hand it just sits on a port serving fake content.
 *
 * Modes and the mismatch each one simulates
 *   other-app     A completely different project owns the port. Title and /package.json both
 *                 differ from this checkout, so the gate must report L1 + L2. This is the shape of
 *                 the real incident this guards against: a regression suite hardcoded to a port that
 *                 another project's dev server had been holding for weeks, which reported every page
 *                 as broken and still exited 0.
 *   stale-source  Same project, same title, byte-identical /package.json - but the module it serves
 *                 predates one export that exists on disk today. Only L3 can catch this, which is
 *                 why L3 exists: L2 alone passes, so "the port is serving our app" is not the same
 *                 claim as "the port is serving our current code".
 *
 * node:http only; no third-party dependency.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/+$/, '')
const mode = process.argv[2]
const port = Number(process.argv[3] || '1431')
const dropArgIndex = process.argv.indexOf('--drop')
const dropExport = dropArgIndex === -1 ? 'openExternalUrlOrReport' : process.argv[dropArgIndex + 1]

if (mode !== 'other-app' && mode !== 'stale-source') {
  console.error('usage: node scripts/__fixtures__/impostor_dev_server.mjs <other-app|stale-source> [port] [--drop EXPORT]')
  process.exit(64)
}

const realPackage = readFileSync(`${REPO}/apps/desktop/package.json`, 'utf8')
const realModule = readFileSync(`${REPO}/apps/desktop/src/lib/desktop.ts`, 'utf8')

// Served as-is by the real dev server too: Vite passes /package.json through untouched, so an
// impostor has to fake it, and faking it is exactly what L2 exists to catch.
const servedPackage = mode === 'other-app'
  ? `${JSON.stringify({ name: 'some-other-app', private: true, version: '9.9.9' }, null, 2)}\n`
  : realPackage

const servedTitle = mode === 'other-app' ? 'Some Other App' : '镜云 | Mirror Cloud'

// Only the declaration is removed, so the served text stays valid-looking; the export name simply
// stops existing, which is what a checkout from before that commit would serve.
const staleDeclaration = new RegExp(`\\n?// [^\\n]*\\nexport function ${dropExport}\\([\\s\\S]*?\\n\\}`)
const servedModule = mode === 'stale-source'
  ? realModule.replace(staleDeclaration, '\n')
  : realModule

if (mode === 'stale-source' && servedModule.includes(dropExport)) {
  console.error(`stale-source fixture failed to drop "${dropExport}"; the red demo would be a false green.`)
  process.exit(65)
}

createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/package.json')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(servedPackage)
    return
  }
  if (url.startsWith('/src/lib/desktop.ts')) {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(servedModule)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${servedTitle}</title></head><body><div id="root"></div></body></html>`)
}).listen(port, '127.0.0.1', () => {
  console.log(`impostor dev server (${mode}) listening on http://127.0.0.1:${port}/`)
})
