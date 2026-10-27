import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const repo = new URL('../', import.meta.url)
const desktopPath = 'apps/desktop/src/lib/desktop.ts'
const apiPath = 'apps/desktop/src/features/tasks/api.ts'
const runtimePath = 'apps/desktop/src/platform/desktop/runtime.ts'
const names = ['listTasks', 'cancelTask', 'retryTask']
const source = (path) => readFileSync(new URL(path, repo), 'utf8')
const hasFile = (path) => existsSync(new URL(path, repo))

// Evaluate product code while substituting only the native IPC boundary and browser globals.
function evaluate(code, options = {}) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', 'invoke', 'isTauriRuntime', 'taskApi', output)(
    options.require ?? (() => { throw new Error('Unexpected dependency') }), module, module.exports,
    options.window, options.invoke, options.isTauriRuntime, options.taskApi,
  )
  return module.exports
}

const desktopSource = source(desktopPath)
const ast = ts.createSourceFile(desktopPath, desktopSource, ts.ScriptTarget.Latest, true)
const declarations = names.map((name) => ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name))
let checks = 0
let failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`TASK_API PASS ${label}`) }
  catch (error) { failed++; console.error(`TASK_API FAIL ${label}: ${error.message}`) }
}

await check('legacy named function exports remain visible to the browser identity gate', () => {
  assert.equal(declarations.filter(Boolean).length, names.length)
  for (const name of names) assert.match(desktopSource, new RegExp(`export\\s+async\\s+function\\s+${name}\\b`))
})
await check('task domain module exists', () => assert.ok(hasFile(apiPath), 'task domain module is missing'))

function setup(native) {
  const calls = []
  const result = [{ id: 'task-1', kind: 'upload', title: 'Example', detail: '', status: 'queued', progress: 0,
    attempt: 0, maxAttempts: 2, canCancel: true, canRetry: false, createdAt: '2026-01-01T00:00:00Z' }]
  const rejection = new Error('synthetic native failure')
  let reject = false
  const ipc = async (command, args) => {
    calls.push({ command, args })
    if (reject) throw rejection
    if (command === 'list_tasks') return result
    if (command === 'retry_task') return 'new-task-1'
    if (command === 'cancel_task') return undefined
    throw new Error(`Unexpected command ${command}`)
  }
  const window = native ? { __TAURI_INTERNALS__: {} } : {}
  let api
  if (hasFile(apiPath)) {
    const runtime = evaluate(source(runtimePath), { window, require: (name) => {
      if (name === '@tauri-apps/api/core') return { invoke: ipc }
      throw new Error(`Unexpected dependency ${name}`)
    } })
    api = evaluate(source(apiPath), { require: (name) => {
      if (name.endsWith('/platform/desktop/runtime')) return runtime
      throw new Error(`Unexpected dependency ${name}`)
    } })
  }
  const legacy = evaluate(declarations.filter(Boolean).map((node) => node.getText(ast)).join('\n') +
    `\nmodule.exports = { ${names.join(', ')} }`, {
    invoke: ipc, isTauriRuntime: () => native, taskApi: api,
  })
  return { api, legacy, calls, result, rejection, setReject: (value) => { reject = value } }
}

for (const entry of ['legacy', 'api']) {
  if (entry === 'api' && !hasFile(apiPath)) continue
  await check(`${entry} browser list returns an empty array without IPC`, async () => {
    const ctx = setup(false)
    assert.deepEqual(await ctx[entry].listTasks(), [])
    assert.deepEqual(await ctx[entry].listTasks(6), [])
    assert.deepEqual(ctx.calls, [])
  })
  for (const [args, limit] of [[[], 100], [[undefined], 100], [[6], 6], [[0], 0], [[10000], 10000]]) {
    await check(`${entry} native list passes limit ${limit} unchanged`, async () => {
      const ctx = setup(true)
      assert.strictEqual(await ctx[entry].listTasks(...args), ctx.result)
      assert.deepEqual(ctx.calls, [{ command: 'list_tasks', args: { limit } }])
      ctx.setReject(true)
      await assert.rejects(ctx[entry].listTasks(...args), (error) => error === ctx.rejection)
    })
  }
  for (const native of [true, false]) {
    for (const [name, command, result] of [['cancelTask', 'cancel_task', undefined], ['retryTask', 'retry_task', 'new-task-1']]) {
      await check(`${entry} ${native ? 'native' : 'browser'} ${name} passes task ID and propagates errors`, async () => {
        const ctx = setup(native)
        assert.strictEqual(await ctx[entry][name]('task-1'), result)
        assert.deepEqual(ctx.calls, [{ command, args: { taskId: 'task-1' } }])
        ctx.setReject(true)
        await assert.rejects(ctx[entry][name]('task-1'), (error) => error === ctx.rejection)
      })
    }
  }
}
console.log(`TASK_API_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
