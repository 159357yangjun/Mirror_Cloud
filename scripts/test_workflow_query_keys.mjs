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
const keysPath = resolve(srcRoot, 'features/workflows/queryKeys.ts')
const expected = {
  'pages/WorkflowsPage.tsx': ['query:recipes', 'query:workflows', 'invalidate:workflows', 'invalidate:workflows'],
  'pages/PublishPage.tsx': ['invalidate:workflows'],
  'pages/StoragesPage.tsx': ['invalidate:workflows', 'invalidate:workflows'],
  'pages/SettingsPage.tsx': ['invalidate:workflows'],
  'components/StorageSetupDialog.tsx': ['invalidate:workflows'],
  'components/UploadDialog.tsx': ['query:workflows'],
  'components/WorkflowSetupDialog.tsx': ['invalidate:workflows'],
}

let checks = 0
let failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`WORKFLOW_KEYS PASS ${label}`) }
  catch (error) { failed++; console.error(`WORKFLOW_KEYS FAIL ${label}: ${error.message}`) }
}

let shared
if (existsSync(keysPath)) {
  const output = ts.transpileModule(readFileSync(keysPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', output)(module.exports, module)
  shared = module.exports.workflowQueryKeys
}
await check('shared workflow keys exist with the original values', () => {
  assert.ok(shared, 'shared query keys are not extracted yet')
  assert.deepEqual(shared.workflows, ['workflows'])
  assert.deepEqual(shared.recipes, ['recipes'])
})

const sites = []
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) { scan(file); continue }
    if (!/\.tsx?$/.test(file) || file === keysPath) continue
    const rel = file.slice(srcRoot.length + 1).replaceAll('\\', '/')
    const text = readFileSync(file, 'utf8')
    const ast = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function walk(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'queryKey') {
        const expr = node.initializer.getText(ast)
        let key
        if (/^\[\s*['"]workflows['"]\s*\]$/.test(expr) || expr === 'workflowQueryKeys.workflows') key = 'workflows'
        if (/^\[\s*['"]recipes['"]\s*\]$/.test(expr) || expr === 'workflowQueryKeys.recipes') key = 'recipes'
        if (key) {
          const options = node.parent
          const call = options.parent
          const method = ts.isCallExpression(call) ? call.expression.getText(ast) : ''
          const kind = method === 'useQuery' ? 'query' : method === 'queryClient.invalidateQueries' ? 'invalidate' : `unexpected:${method}`
          sites.push({ rel, text, ast, node, expr, key, options, call, kind })
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
  }
}
scan(srcRoot)

await check('every query and invalidation site is enumerated in its original consumer', () => {
  const actual = {}
  for (const site of sites) (actual[site.rel] ??= []).push(`${site.kind}:${site.key}`)
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  for (const [file, entries] of Object.entries(expected)) assert.deepEqual(actual[file], entries, file)
})
await check('all consumers use the shared key module', () => {
  for (const site of sites) {
    assert.equal(site.expr, `workflowQueryKeys.${site.key}`, site.rel)
    const imports = site.ast.statements.filter((node) => ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some((e) => e.name.text === 'workflowQueryKeys'))
    assert.equal(imports.length, 1, `${site.rel}: shared import`)
    assert.equal(resolve(dirname(resolve(srcRoot, site.rel)), imports[0].moduleSpecifier.text) + '.ts', keysPath)
  }
})

for (const site of sites) {
  const label = `${site.rel} ${site.kind}:${site.key}`
  await check(`${label} preserves key and query options`, () => {
    const actualKey = new Function('workflowQueryKeys', `return (${site.expr})`)(shared)
    assert.deepEqual(actualKey, [site.key])
    assert.equal(site.call.arguments.length, 1, label)
    const options = site.options.properties.map((p) => p.name?.getText(site.ast))
    if (site.kind === 'invalidate') {
      assert.deepEqual(options, ['queryKey'], label)
      let owner = site.node.parent
      while (owner && !ts.isFunctionDeclaration(owner) && !(ts.isPropertyAssignment(owner) && owner.name.getText(site.ast) === 'onSuccess')) owner = owner.parent
      assert.ok(owner && (owner.name?.getText(site.ast) === 'onSuccess' || owner.name?.getText(site.ast) === 'restoreOneWorkflow'), `${label}: original success/restore path`)
    } else {
      assert.deepEqual(options, site.rel.endsWith('UploadDialog.tsx') ? ['queryKey', 'queryFn', 'enabled'] : ['queryKey', 'queryFn'])
      const queryFn = site.options.properties.find((p) => p.name?.getText(site.ast) === 'queryFn').initializer.getText(site.ast)
      assert.equal(queryFn, site.key === 'recipes' ? 'listRecipes' : 'listWorkflows')
      if (site.rel.endsWith('UploadDialog.tsx')) assert.equal(site.options.properties.find((p) => p.name?.getText(site.ast) === 'enabled').initializer.getText(site.ast), 'uploadOpen')
    }
  })
  if (site.kind === 'invalidate') {
    await check(`${label} invalidates workflow prefix and preserves unrelated caches`, async () => {
      const client = new QueryClient()
      for (const key of [['workflows'], ['workflows', 'child'], ['recipes'], ['tasks']]) client.setQueryData(key, 'cached')
      const queryKey = new Function('workflowQueryKeys', `return (${site.expr})`)(shared)
      await client.invalidateQueries({ queryKey })
      assert.equal(client.getQueryState(['workflows']).isInvalidated, true)
      assert.equal(client.getQueryState(['workflows', 'child']).isInvalidated, true)
      assert.equal(client.getQueryState(['recipes']).isInvalidated, false)
      assert.equal(client.getQueryState(['tasks']).isInvalidated, false)
      client.clear()
    })
  }
}
console.log(`WORKFLOW_KEYS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
