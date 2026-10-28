import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const { QueryClient } = require('@tanstack/react-query')
const root = fileURLToPath(new URL('../', import.meta.url))
const srcRoot = resolve(root, 'apps/desktop/src')
const keysPath = resolve(srcRoot, 'features/assets/queryKeys.ts')
const expected = {
  'components/CloudIndexSyncBanner.tsx': ['invalidate:root'],
  'components/StorageBrowserDialog.tsx': ['invalidate:root', 'invalidate:publishRecent'],
  'components/UploadDialog.tsx': ['invalidate:root'],
  'pages/AssetsPage.tsx': ['query:list', 'invalidate:root', 'invalidate:root'],
  'pages/GalleryPage.tsx': ['invalidate:root', 'invalidate:publishRecent', 'invalidate:root', 'invalidate:publishRecent'],
  'pages/PublishPage.tsx': ['query:publishRecent'],
  'pages/TasksPage.tsx': ['invalidate:root'],
}
let assetQueryKeys
if (existsSync(keysPath)) {
  const module = { exports: {} }
  const output = ts.transpileModule(readFileSync(keysPath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function('exports', 'module', output)(module.exports, module)
  assetQueryKeys = module.exports.assetQueryKeys
}
let checks = 0, failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`ASSET_KEYS PASS ${label}`) }
  catch (error) { failed++; console.error(`ASSET_KEYS FAIL ${label}: ${error.message}`) }
}
await check('shared keys retain root, separate limits and publish-recent', () => {
  assert.ok(assetQueryKeys, 'shared asset keys are not implemented yet')
  assert.deepEqual(assetQueryKeys.root, ['assets'])
  for (const limit of [200, 400, 10000]) assert.deepEqual(assetQueryKeys.list(limit), ['assets', limit])
  assert.deepEqual(assetQueryKeys.publishRecent, ['assets', 'publish-recent'])
})

function classify(expression) {
  if (/^\[\s*['"]assets['"]\s*\]$/.test(expression) || expression === 'assetQueryKeys.root') return 'root'
  if (/^\[\s*['"]assets['"]\s*,\s*assetLimit\s*\]$/.test(expression) || expression === 'assetQueryKeys.list(assetLimit)') return 'list'
  if (/^\[\s*['"]assets['"]\s*,\s*['"]publish-recent['"]\s*\]$/.test(expression) || expression === 'assetQueryKeys.publishRecent') return 'publishRecent'
}
const sites = []
function scan(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name)
    if (item.isDirectory()) { scan(file); continue }
    if (!/\.tsx?$/.test(file) || file === keysPath) continue
    const rel = file.slice(srcRoot.length + 1).replaceAll('\\', '/')
    const ast = ts.createSourceFile(rel, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function walk(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'queryKey' && ts.isCallExpression(node.parent.parent)) {
        const expression = node.initializer.getText(ast), key = classify(expression)
        if (key) {
          const options = node.parent, call = options.parent, method = call.expression.getText(ast)
          const kind = method === 'useQuery' ? 'query' : method === 'queryClient.invalidateQueries' ? 'invalidate' : `unexpected:${method}`
          sites.push({ rel, ast, node, expression, key, options, call, kind })
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
  }
}
scan(srcRoot)
await check('all 13 asset query and invalidation sites retain their consumers', () => {
  assert.equal(sites.length, 13)
  const actual = {}
  for (const site of sites) (actual[site.rel] ??= []).push(`${site.kind}:${site.key}`)
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  for (const [file, entries] of Object.entries(expected)) assert.deepEqual(actual[file], entries, file)
})
await check('each real consumer uses the actual shared module', () => {
  for (const site of sites) {
    assert.equal(site.expression, site.key === 'list' ? 'assetQueryKeys.list(assetLimit)' : `assetQueryKeys.${site.key}`, site.rel)
    const imports = site.ast.statements.filter((node) => ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some((item) => item.name.text === 'assetQueryKeys'))
    assert.equal(imports.length, 1, `${site.rel}: import`)
    assert.equal(resolve(dirname(resolve(srcRoot, site.rel)), imports[0].moduleSpecifier.text) + '.ts', keysPath)
  }
})
const cacheKeys = [['assets'], ['assets', 200], ['assets', 400], ['assets', 'publish-recent'], ['assets', 'publish-recent', 'child'], ['tasks'], ['unrelated']]
const cacheData = [{ id: 'cached-asset' }]
function seed(client) {
  for (const key of cacheKeys) client.setQueryData(key, cacheData)
}
function assertInvalidated(client, kind) {
  for (const key of cacheKeys) {
    const expectedState = kind === 'root' ? key[0] === 'assets' : key[0] === 'assets' && key[1] === 'publish-recent'
    assert.equal(client.getQueryState(key).isInvalidated, expectedState, JSON.stringify(key))
    assert.deepEqual(client.getQueryData(key), cacheData, 'invalidation must not delete or replace data')
  }
}
for (const site of sites) {
  await check(`${site.rel} ${site.kind}:${site.key} retains original values and options`, async () => {
    const names = site.options.properties.map((item) => item.name?.getText(site.ast))
    if (site.kind === 'invalidate') {
      assert.deepEqual(names, ['queryKey'])
      return
    }
    const requested = []
    const options = new Function('useQuery', 'assetQueryKeys', 'assetLimit', 'listAssets', `return (${site.call.getText(site.ast)})`)(
      (options) => options, assetQueryKeys, 400, (limit) => { requested.push(limit); return Promise.resolve([]) },
    )
    await options.queryFn()
    if (site.key === 'list') {
      assert.deepEqual(names, ['queryKey', 'queryFn', 'refetchInterval'])
      assert.deepEqual(options.queryKey, ['assets', 400])
      assert.equal(options.refetchInterval, 2500)
      assert.deepEqual(requested, [400])
    } else {
      assert.deepEqual(names, ['queryKey', 'queryFn'])
      assert.deepEqual(options.queryKey, ['assets', 'publish-recent'])
      assert.deepEqual(requested, [6])
    }
  })
  if (site.kind === 'invalidate') await check(`${site.rel} actual ${site.key} call preserves precise cache scope`, async () => {
    const client = new QueryClient()
    try {
      seed(client)
      await new Function('queryClient', 'assetQueryKeys', `return (${site.call.getText(site.ast)})`)(client, assetQueryKeys)
      assertInvalidated(client, site.key)
    } finally { client.clear() }
  })
}

// Execute only the real refresh expressions, never the surrounding remote mutation functions.
const pairs = new Map()
for (const site of sites.filter((item) => item.kind === 'invalidate')) {
  let parent = site.call.parent
  while (parent && !(ts.isCallExpression(parent) && parent.expression.getText(site.ast) === 'Promise.all')) parent = parent.parent
  if (parent) pairs.set(`${site.rel}:${parent.pos}`, { rel: site.rel, ast: site.ast, call: parent })
}
await check('Gallery and StorageBrowser retain their three explicit refresh groups', () => {
  const actual = {}
  for (const pair of pairs.values()) actual[pair.rel] = (actual[pair.rel] ?? 0) + 1
  assert.deepEqual(actual, { 'components/StorageBrowserDialog.tsx': 1, 'pages/GalleryPage.tsx': 2 })
})
for (const pair of pairs.values()) {
  await check(`${pair.rel} refresh group ${pair.call.pos} executes refetch then both original invalidations`, async () => {
    const client = new QueryClient(), trace = []
    const realInvalidate = client.invalidateQueries.bind(client)
    client.invalidateQueries = (options) => { trace.push(options.queryKey); return realInvalidate(options) }
    const refetch = () => { trace.push('refetch'); return Promise.resolve() }
    try {
      seed(client)
      await new Function('queryClient', 'assetQueryKeys', 'refetch', `return (${pair.call.getText(pair.ast)})`)(client, assetQueryKeys, refetch)
      assert.deepEqual(trace, ['refetch', ['assets'], ['assets', 'publish-recent']])
      assertInvalidated(client, 'root')
    } finally { client.clear() }
  })
}
console.log(`ASSET_KEYS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
