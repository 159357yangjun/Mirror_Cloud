import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const { QueryClient, QueryObserver } = require('@tanstack/react-query')
const names = ['listPlugins', 'listMarketplacePlugins', 'listPluginExecutionLogs', 'getAiSettings', 'getSystemDiagnostics']
const nativeRead = new RegExp(`\\b(?:${names.join('|')})\\b`)
const queries = []
for (const file of readdirSync(new URL('../apps/desktop/src/pages/', import.meta.url)).filter((file) => file.endsWith('.tsx'))) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../apps/desktop/src/pages/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useQuery') {
      const options = node.arguments[0]
      if (options && nativeRead.test(options.getText(source))) queries.push({ file, source: options.getText(source) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
assert.equal(queries.length, 6, 'all current native-only read observers must be exercised')
let checks = 0, failed = 0
for (const query of queries) for (const native of [false, true]) {
  checks++
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let observer, unsubscribe
  try {
    let calls = 0
    const module = { exports: {} }
    const code = ts.transpileModule(`export const options = (${query.source})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    new Function('desktopAvailable', ...names, 'module', 'exports', code)(native, ...names.map(() => async () => { calls++; return [] }), module, module.exports)
    const options = module.exports.options
    observer = new QueryObserver(client, options)
    unsubscribe = observer.subscribe(() => {})
    await new Promise((done) => setTimeout(done, 20))
    assert.equal(calls, native ? 1 : 0, 'mounting must fetch only with a native bridge')
    assert.equal(observer.getCurrentResult().isLoading, false, 'browser preview must not stay loading')
    await client.invalidateQueries({ queryKey: options.queryKey })
    assert.equal(calls, native ? 2 : 0, 'invalidation must retain the same availability boundary')
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
