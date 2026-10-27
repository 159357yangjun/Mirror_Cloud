import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const repo = new URL('../', import.meta.url)
const desktopPath = 'apps/desktop/src/lib/desktop.ts'
const apiPath = 'apps/desktop/src/features/workflows/api.ts'
const runtimePath = 'apps/desktop/src/platform/desktop/runtime.ts'
const names = ['listRecipes', 'listWorkflows', 'createWorkflowFromRecipe', 'createCustomWorkflow', 'setDefaultWorkflow', 'deleteWorkflow']
const source = (path) => readFileSync(new URL(path, repo), 'utf8')
const hasFile = (path) => existsSync(new URL(path, repo))

// Compile actual product code; replace only native IPC and browser globals.
function evaluate(code, options = {}) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', 'invoke', 'isTauriRuntime', 'mockRecipes', 'workflowApi', output)(
    options.require ?? (() => { throw new Error('Unexpected dependency') }), module, module.exports,
    options.window, options.invoke, options.isTauriRuntime, options.mockRecipes, options.workflowApi,
  )
  return module.exports
}

const mockRecipes = evaluate(source('apps/desktop/src/data/mock.ts')).mockRecipes
const desktopSource = source(desktopPath)
const ast = ts.createSourceFile(desktopPath, desktopSource, ts.ScriptTarget.Latest, true)
const declarations = names.map((name) => ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name))
let checks = 0
let failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`WORKFLOW_API PASS ${label}`) }
  catch (error) { failed++; console.error(`WORKFLOW_API FAIL ${label}: ${error.message}`) }
}

await check('legacy entry keeps named function exports for the browser identity gate', () => {
  assert.equal(declarations.filter(Boolean).length, names.length)
  for (const name of names) assert.match(desktopSource, new RegExp(`export\\s+async\\s+function\\s+${name}\\b`))
})
await check('workflow domain module exists', () => assert.ok(hasFile(apiPath), 'workflow domain module is missing'))
await check('desktop runtime module exists', () => assert.ok(hasFile(runtimePath), 'desktop runtime module is missing'))

function setup(native) {
  const calls = []
  const result = { marker: 'unchanged result' }
  const rejection = new Error('native failure')
  let reject = false
  const ipc = async (command, args) => {
    calls.push({ command, args })
    if (reject) throw rejection
    return result
  }
  const window = native ? { __TAURI_INTERNALS__: {} } : {}
  let api
  if (hasFile(apiPath) && hasFile(runtimePath)) {
    const runtime = evaluate(source(runtimePath), { window, require: (name) => {
      if (name === '@tauri-apps/api/core') return { invoke: ipc }
      throw new Error(`Unexpected dependency ${name}`)
    } })
    api = evaluate(source(apiPath), { require: (name) => {
      if (name.endsWith('/data/mock')) return { mockRecipes }
      if (name.endsWith('/platform/desktop/runtime')) return runtime
      throw new Error(`Unexpected dependency ${name}`)
    } })
  }
  const legacy = evaluate(declarations.filter(Boolean).map((node) => node.getText(ast)).join('\n') +
    `\nmodule.exports = { ${names.join(', ')} }`, {
    window, mockRecipes, invoke: ipc, isTauriRuntime: () => native, workflowApi: api,
  })
  return { api, legacy, calls, result, rejection, setReject: (value) => { reject = value } }
}

for (const entry of ['legacy', 'api']) {
  if (entry === 'api' && (!hasFile(apiPath) || !hasFile(runtimePath))) continue
  await check(`${entry} browser lists use original fallback without IPC`, async () => {
    const ctx = setup(false)
    assert.strictEqual(await ctx[entry].listRecipes(), mockRecipes)
    assert.deepEqual(await ctx[entry].listWorkflows(), [])
    assert.deepEqual(ctx.calls, [])
  })
  const cases = [
    ['listRecipes', [], 'list_recipes', undefined],
    ['listWorkflows', [], 'list_workflows', undefined],
    ['createWorkflowFromRecipe', [{ recipeKey: 'docs', targetId: 'storage-1' }], 'create_workflow_from_recipe', { input: { recipeKey: 'docs', targetId: 'storage-1' } }],
    ['createCustomWorkflow', [{ name: 'custom', quality: 82 }], 'create_custom_workflow', { input: { name: 'custom', quality: 82 } }],
    ['setDefaultWorkflow', ['wf-1'], 'set_default_workflow', { workflowId: 'wf-1' }],
    ['deleteWorkflow', ['wf-2'], 'delete_workflow', { workflowId: 'wf-2' }],
  ]
  for (const [name, args, command, payload] of cases) {
    await check(`${entry} ${name} preserves IPC contract, result and error`, async () => {
      const ctx = setup(true)
      assert.strictEqual(await ctx[entry][name](...args), ctx.result)
      assert.deepEqual(ctx.calls, [{ command, args: payload }])
      ctx.setReject(true)
      await assert.rejects(ctx[entry][name](...args), (error) => error === ctx.rejection)
      assert.deepEqual(ctx.calls[1], { command, args: payload })
    })
  }
}
console.log(`WORKFLOW_API_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
