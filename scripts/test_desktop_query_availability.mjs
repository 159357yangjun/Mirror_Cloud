import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const { QueryClient, QueryObserver } = require('@tanstack/react-query')
const api = ts.createSourceFile('desktop.ts', readFileSync(new URL('../apps/desktop/src/lib/desktop.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
// Discover direct IPC functions without a browser fallback, so a new consumer or
// native-only read cannot escape this check just because it was not in a name list.
const names = api.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name &&
  /\binvoke\s*\(/.test(node.getText(api)) && !/\bisTauriRuntime\s*\(/.test(node.getText(api))).map((node) => node.name.text)
const nativeRead = new RegExp(`\\b(?:${names.join('|')})\\b`)
const queries = []
function scan(directory) {
 for (const entry of readdirSync(directory, { withFileTypes: true })) {
  const file = join(directory, entry.name)
  if (entry.isDirectory()) { scan(file); continue }
  if (!/\.tsx?$/.test(file)) continue
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useQuery') {
      const options = node.arguments[0]
      if (options && nativeRead.test(options.getText(source))) queries.push({ file, source: options.getText(source) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
 }
}
scan(fileURLToPath(new URL('../apps/desktop/src/', import.meta.url)))
assert.equal(queries.length, 10, 'all current native-only read observers must be exercised')
let checks = 0, failed = 0
for (const query of queries) for (const [native, selection] of (query.source.includes('selectedStagedBatch') || query.source.includes('Boolean(storageId)'))
  ? [[false, 'offline-stage'], [true, 'offline-stage'], [true, null]]
  : [[false, null], [true, null]]) {
  checks++
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let observer, unsubscribe
  try {
    let calls = 0
    const module = { exports: {} }
    const code = ts.transpileModule(`export const options = (${query.source})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const storage = { id: 'offline-storage' }
    new Function('desktopAvailable', 'selectedStagedBatch', 'storageId', 'storage', 'path', 'queryKey', ...names, 'module', 'exports', code)(
      native, selection, query.source.includes('Boolean(storageId)') ? selection : storage.id,
      storage, 'photos', ['offline-browser', storage.id],
      ...names.map(() => async () => { calls++; return [] }), module, module.exports,
    )
    const options = module.exports.options
    observer = new QueryObserver(client, options)
    unsubscribe = observer.subscribe(() => {})
    await new Promise((done) => setTimeout(done, 20))
    const needsSelection = query.source.includes('selectedStagedBatch') || query.source.includes('Boolean(storageId)')
    const shouldFetch = native && (!needsSelection || selection !== null)
    assert.equal(calls, shouldFetch ? 1 : 0, 'mounting must fetch only with a native bridge and any required selection')
    assert.equal(observer.getCurrentResult().isLoading, false, 'browser preview must not stay loading')
    await client.invalidateQueries({ queryKey: options.queryKey })
    assert.equal(calls, shouldFetch ? 2 : 0, 'invalidation must retain the same availability boundary')
    console.log(`DESKTOP_QUERY PASS ${query.file} ${JSON.stringify(options.queryKey)} native=${native}`)
  } catch (error) {
    failed++
    console.error(`DESKTOP_QUERY FAIL ${query.file} native=${native}: ${error.message}`)
  } finally {
    unsubscribe?.()
    observer?.destroy()
    client.clear()
  }
}
console.log(`DESKTOP_QUERY checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
