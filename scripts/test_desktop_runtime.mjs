import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const code = ts.transpileModule(readFileSync(new URL('../apps/desktop/src/platform/desktop/runtime.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function setup(window) {
  const imports = []
  const module = { exports: {} }
  new Function('require', 'window', 'module', 'exports', code)((name) => {
    imports.push(name)
    assert.equal(name, '@tauri-apps/api/core')
    return { invoke: (...args) => window.__TAURI_INTERNALS__.invoke(...args) }
  }, window, module, module.exports)
  return { ...module.exports, imports }
}
let checks = 0, failed = 0
async function check(label, run) {
  checks++
  try { await run(); console.log(`DESKTOP_RUNTIME PASS ${label}`) }
  catch (error) { failed++; console.error(`DESKTOP_RUNTIME FAIL ${label}: ${error.message}`) }
}
for (const [label, window] of [
  ['no window', undefined], ['no bridge', {}],
  ['undefined marker', { __TAURI_INTERNALS__: undefined }],
  ['null marker', { __TAURI_INTERNALS__: null }],
  ['partial bridge', { __TAURI_INTERNALS__: {} }],
  ['non-callable invoke', { __TAURI_INTERNALS__: { invoke: 'unavailable' } }],
]) {
  await check(`${label} stays in browser mode`, () => {
    const api = setup(window)
    assert.equal(api.isTauriRuntime(), false)
    assert.deepEqual(api.imports, [])
  })
}
await check('a callable native bridge is recognized without loading the SDK', () => {
  const api = setup({ __TAURI_INTERNALS__: { invoke() {} } })
  assert.equal(api.isTauriRuntime(), true)
  assert.deepEqual(api.imports, [])
})
await check('native invocation preserves command, arguments, result and rejection', async () => {
  const calls = [], result = {}, failure = new Error('native request refused')
  let reject = false
  const api = setup({ __TAURI_INTERNALS__: { async invoke(...args) {
    calls.push(args)
    if (reject) throw failure
    return result
  } } })
  const input = { path: 'photos/test.png' }
  assert.strictEqual(await api.invoke('read_object', input), result)
  assert.deepEqual(calls, [['read_object', input]])
  reject = true
  await assert.rejects(api.invoke('read_object', input), (error) => error === failure)
})
const desktop = ts.createSourceFile('desktop.ts', readFileSync(new URL('../apps/desktop/src/lib/desktop.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const reads = ['getBootstrapSnapshot', 'listStorages', 'listStorageGroups', 'getDefaultPublishTarget']
const readCode = ts.transpileModule(desktop.statements.filter((node) => ts.isFunctionDeclaration(node) && reads.includes(node.name?.text)).map((node) => node.getText(desktop)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
for (const bridge of [undefined, null, {}]) {
  await check(`storage reads keep browser fallbacks with a ${bridge === undefined ? 'missing' : bridge === null ? 'null' : 'partial'} bridge`, async () => {
    const runtime = setup({ __TAURI_INTERNALS__: bridge }), module = { exports: {} }, bootstrap = {}
    let calls = 0
    new Function('isTauriRuntime', 'invoke', 'mockBootstrap', 'module', 'exports', readCode)(runtime.isTauriRuntime, () => { calls++; throw new Error('browser reads must not call native IPC') }, bootstrap, module, module.exports)
    assert.deepEqual(Object.keys(module.exports).sort(), [...reads].sort())
    assert.strictEqual(await module.exports.getBootstrapSnapshot(), bootstrap)
    assert.deepEqual(await module.exports.listStorages(), [])
    assert.deepEqual(await module.exports.listStorageGroups(), [])
    assert.equal(await module.exports.getDefaultPublishTarget(), null)
    assert.equal(calls, 0)
  })
}
console.log(`DESKTOP_RUNTIME checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
