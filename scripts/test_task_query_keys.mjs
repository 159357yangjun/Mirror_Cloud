import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const { QueryClient } = require('@tanstack/react-query')
const root = fileURLToPath(new URL('../', import.meta.url))
const srcRoot = resolve(root, 'apps/desktop/src')
const keysPath = resolve(srcRoot, 'features/tasks/queryKeys.ts')
const expected = {
  'pages/TasksPage.tsx': ['query:list', 'invalidate:root', 'invalidate:root', 'patch:list', 'invalidate:root'],
  'pages/PublishPage.tsx': ['query:publishRecent'],
  'pages/AssetsPage.tsx': ['invalidate:root', 'invalidate:root', 'invalidate:root', 'invalidate:root'],
  'pages/GalleryPage.tsx': ['invalidate:root', 'invalidate:root', 'invalidate:root'],
  'components/UploadDialog.tsx': ['query:root', 'patch:root', 'invalidate:root', 'invalidate:root', 'invalidate:root'],
}
const source = (path) => readFileSync(resolve(root, path), 'utf8')
function compile(code, options = {}) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, ...options }).outputText
}
function load(code) {
  const module = { exports: {} }
  new Function('exports', 'module', compile(code))(module.exports, module)
  return module.exports
}
const taskQueryKeys = existsSync(keysPath) ? load(readFileSync(keysPath, 'utf8')).taskQueryKeys : undefined
const assetKeysPath = resolve(srcRoot, 'features/assets/queryKeys.ts')
const assetQueryKeys = existsSync(assetKeysPath) ? load(readFileSync(assetKeysPath, 'utf8')).assetQueryKeys : undefined
const manageDesktopSubscription = load(source('apps/desktop/src/platform/desktop/subscription.ts')).manageDesktopSubscription
let checks = 0, failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`TASK_KEYS PASS ${label}`) }
  catch (error) { failed++; console.error(`TASK_KEYS FAIL ${label}: ${error.message}`) }
}

await check('shared keys preserve root, each limit and publish-recent', () => {
  assert.ok(taskQueryKeys, 'shared task keys not extracted yet')
  assert.deepEqual(taskQueryKeys.root, ['tasks'])
  for (const n of [100, 200, 10000]) assert.deepEqual(taskQueryKeys.list(n), ['tasks', n])
  assert.deepEqual(taskQueryKeys.publishRecent, ['tasks', 'publish-recent'])
})

const sites = []
function classify(expr) {
  if (/^\[\s*['"]tasks['"]\s*\]$/.test(expr) || expr === 'taskQueryKeys.root') return 'root'
  if (/^\[\s*['"]tasks['"]\s*,\s*taskLimit\s*\]$/.test(expr) || expr === 'taskQueryKeys.list(taskLimit)') return 'list'
  if (/^\[\s*['"]tasks['"]\s*,\s*['"]publish-recent['"]\s*\]$/.test(expr) || expr === 'taskQueryKeys.publishRecent') return 'publishRecent'
}
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) { scan(file); continue }
    if (!/\.tsx?$/.test(file) || file === keysPath) continue
    const rel = file.slice(srcRoot.length + 1).replaceAll('\\', '/')
    const text = readFileSync(file, 'utf8')
    const ast = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function add(node, exprNode, kind, call) {
      const expr = exprNode.getText(ast), key = classify(expr)
      if (key) sites.push({ rel, ast, node, expr, key, call, kind })
    }
    function walk(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'queryKey' && ts.isCallExpression(node.parent.parent)) {
        const call = node.parent.parent, method = call.expression.getText(ast)
        add(node, node.initializer, method === 'useQuery' ? 'query' : method === 'queryClient.invalidateQueries' ? 'invalidate' : `unexpected:${method}`, call)
      }
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'queryClient.setQueryData' && node.arguments.length) add(node, node.arguments[0], 'patch', node)
      ts.forEachChild(node, walk)
    }
    walk(ast)
  }
}
scan(srcRoot)
await check('all 18 task read, patch and invalidation sites remain accounted for', () => {
  const actual = {}
  for (const site of sites) (actual[site.rel] ??= []).push(`${site.kind}:${site.key}`)
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  for (const [file, entries] of Object.entries(expected)) assert.deepEqual(actual[file], entries, file)
})
await check('all sites except the three guarded Gallery calls use the shared module', () => {
  for (const site of sites) {
    const wanted = site.key === 'list' ? 'taskQueryKeys.list(taskLimit)' : `taskQueryKeys.${site.key}`
    if (site.rel === 'pages/GalleryPage.tsx') { assert.equal(site.expr, "['tasks']"); continue }
    assert.equal(site.expr, wanted, site.rel)
    const imports = site.ast.statements.filter((node) => ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some((e) => e.name.text === 'taskQueryKeys'))
    assert.equal(imports.length, 1, `${site.rel}: import`)
    assert.equal(resolve(dirname(resolve(srcRoot, site.rel)), imports[0].moduleSpecifier.text) + '.ts', keysPath)
  }
})
function keyAt(site, limit = 100) { return new Function('taskQueryKeys', 'taskLimit', `return (${site.expr})`)(taskQueryKeys, limit) }
for (const site of sites) {
  await check(`${site.rel} ${site.kind}:${site.key} preserves exact key and options`, () => {
    const wanted = site.key === 'root' ? ['tasks'] : site.key === 'list' ? ['tasks', 100] : ['tasks', 'publish-recent']
    assert.deepEqual(keyAt(site), wanted)
    if (site.key === 'list') assert.deepEqual(keyAt(site, 200), ['tasks', 200])
    if (site.kind === 'invalidate') assert.deepEqual(site.node.parent.properties.map((p) => p.name?.getText(site.ast)), ['queryKey'])
    if (site.kind === 'query') {
      const options = site.node.parent
      const val = (name) => options.properties.find((p) => p.name?.getText(site.ast) === name)?.initializer.getText(site.ast)
      if (site.rel.endsWith('TasksPage.tsx')) { assert.equal(val('queryFn'), '() => listTasks(taskLimit)'); assert.equal(val('refetchInterval'), '1500') }
      if (site.rel.endsWith('PublishPage.tsx')) { assert.equal(val('queryFn'), '() => listTasks(6)'); assert.equal(val('refetchInterval'), '1500') }
      if (site.rel.endsWith('UploadDialog.tsx')) {
        assert.equal(val('queryFn'), '() => listTasks(Math.min(10_000, Math.max(300, taskIds.length * 5)))')
        assert.equal(val('enabled'), 'uploadOpen && taskIds.length > 0')
        assert.equal(val('refetchInterval'), 'taskIds.length > 0 ? 2000 : false')
      }
    }
  })
  if (site.kind === 'invalidate') await check(`${site.rel} root invalidates all task variants only`, async () => {
    const client = new QueryClient()
    for (const key of [['tasks'], ['tasks', 100], ['tasks', 200], ['tasks', 'publish-recent'], ['assets']]) client.setQueryData(key, 'value')
    await client.invalidateQueries({ queryKey: keyAt(site) })
    for (const key of [['tasks'], ['tasks', 100], ['tasks', 200], ['tasks', 'publish-recent']]) assert.equal(client.getQueryState(key).isInvalidated, true)
    assert.equal(client.getQueryState(['assets']).isInvalidated, false)
    client.clear()
  })
}

async function effectFixture(path, limit = 100) {
  const text = source(path), ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const effects = []
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('task://updated')) effects.push(node.arguments[0])
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.equal(effects.length, 1)
  const output = compile(`const effect = ${effects[0].getText(ast)}`, { transformers: { before: [(context) => {
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return ts.factory.createCallExpression(ts.factory.createIdentifier('loadEvents'), undefined, [])
      return ts.visitEachChild(node, visit, context)
    }
    return (node) => ts.visitNode(node, visit)
  }] } })
  const client = new QueryClient(), invalidated = []
  const realInvalidate = client.invalidateQueries.bind(client)
  client.invalidateQueries = (options) => { invalidated.push(options.queryKey); return realInvalidate(options) }
  let handler
  const dependencies = {
    taskQueryKeys, assetQueryKeys, queryClient: client, taskLimit: limit, taskIds: ['task-1'], uploadOpen: true,
    TERMINAL_STATUSES: new Set(['completed', 'failed', 'cancelled']), isTauriRuntime: () => true,
    manageDesktopSubscription, notifyError: () => { throw new Error('unexpected subscription failure') },
    loadEvents: async () => ({ listen: async (_name, callback) => { handler = callback; return () => {} } }),
  }
  const effect = new Function(...Object.keys(dependencies), `${output}\nreturn effect`)(...Object.values(dependencies))
  const dispose = effect()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(typeof handler, 'function', 'actual event handler must register')
  return { client, invalidated, handler, dispose }
}
const originalRows = [{ id: 'task-1', status: 'queued', progress: 0, error: 'earlier warning' }, { id: 'task-2', status: 'queued', progress: 0, error: null }]
function seed(client) {
  for (const key of [['tasks'], ['tasks', 100], ['tasks', 200], ['tasks', 'publish-recent']]) client.setQueryData(key, originalRows.map((row) => ({ ...row })))
  client.setQueryData(['assets'], ['asset'])
}
await check('TasksPage progress patches only the selected limit without invalidation', async () => {
  const f = await effectFixture('apps/desktop/src/pages/TasksPage.tsx')
  seed(f.client)
  f.handler({ payload: { id: 'task-1', status: 'running', progress: 47, error: null } })
  assert.deepEqual(f.client.getQueryData(['tasks', 100])[0], { ...originalRows[0], status: 'running', progress: 47 })
  for (const key of [['tasks'], ['tasks', 200], ['tasks', 'publish-recent']]) assert.deepEqual(f.client.getQueryData(key), originalRows)
  assert.deepEqual(f.invalidated, [])
  f.dispose(); f.client.clear()
})
await check('TasksPage terminal event patches its limit then invalidates tasks and assets', async () => {
  const f = await effectFixture('apps/desktop/src/pages/TasksPage.tsx')
  seed(f.client)
  f.handler({ payload: { id: 'task-1', status: 'failed', progress: 80, error: 'failure' } })
  assert.equal(f.client.getQueryData(['tasks', 100])[0].error, 'failure')
  assert.deepEqual(f.invalidated, [['tasks'], ['assets']])
  for (const key of [['tasks'], ['tasks', 100], ['tasks', 200], ['tasks', 'publish-recent'], ['assets']]) assert.equal(f.client.getQueryState(key).isInvalidated, true)
  f.dispose(); f.client.clear()
})
await check('UploadDialog patches only the root for tracked tasks and ignores other events', async () => {
  const f = await effectFixture('apps/desktop/src/components/UploadDialog.tsx')
  seed(f.client)
  f.handler({ payload: { id: 'task-2', status: 'running', progress: 30 } })
  assert.deepEqual(f.client.getQueryData(['tasks']), originalRows)
  f.handler({ payload: { id: 'task-1', status: 'completed', progress: 100 } })
  assert.deepEqual(f.client.getQueryData(['tasks'])[0], { ...originalRows[0], status: 'completed', progress: 100 })
  for (const key of [['tasks', 100], ['tasks', 200], ['tasks', 'publish-recent']]) assert.deepEqual(f.client.getQueryData(key), originalRows)
  assert.deepEqual(f.invalidated, [])
  f.dispose(); f.client.clear()
})
await check('event patch does not create a cache entry when the list is absent', async () => {
  for (const path of ['apps/desktop/src/pages/TasksPage.tsx', 'apps/desktop/src/components/UploadDialog.tsx']) {
    const f = await effectFixture(path)
    f.handler({ payload: { id: 'task-1', status: 'running', progress: 1 } })
    assert.equal(f.client.getQueryCache().getAll().length, 0)
    f.dispose(); f.client.clear()
  }
})
console.log(`TASK_KEYS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
