import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const { QueryClient, MutationCache, MutationObserver } = require('@tanstack/react-query')
function source(path) {
  return ts.createSourceFile(path, readFileSync(new URL('../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function find(root, predicate) {
  const matches = []
  function walk(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, walk) }
  walk(root)
  assert.equal(matches.length, 1, 'expected one real product declaration')
  return matches[0]
}
function evaluate(expression, bindings = {}) {
  const output = ts.transpileModule(`const result = (${expression}); module.exports = result`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', ...Object.keys(bindings), output)(module, module.exports, ...Object.values(bindings))
  return module.exports
}
const main = source('apps/desktop/src/main.tsx')
const cache = find(main, (node) => ts.isNewExpression(node) && node.expression.getText(main) === 'MutationCache')
const globalOnError = cache.arguments[0].properties.find((p) => p.name.getText(main) === 'onError').initializer.getText(main)
const page = source('apps/desktop/src/pages/StoragesPage.tsx')
const mutation = find(page, (node) => ts.isVariableDeclaration(node) && node.name.getText(page) === 'removeStorageMutation')
const action = find(page, (node) => ts.isVariableDeclaration(node) && node.name.getText(page) === 'removeStorage')
const keySource = source('apps/desktop/src/features/workflows/queryKeys.ts')
const keys = find(keySource, (node) => ts.isVariableDeclaration(node) && node.name.getText(keySource) === 'workflowQueryKeys')
const workflowQueryKeys = evaluate(keys.initializer.getText(keySource))

// The real mutation/cache classes execute product callbacks. The destructive API
// is always a synthetic function; this suite cannot invoke Tauri or cloud storage.
function setup({ accepted = true, failure, globalOnly = false, blockFailure = false } = {}) {
  const observed = { confirmations: [], deleted: [], messages: [], invalidated: [] }
  const notifyError = (message) => observed.messages.push(message)
  const client = new QueryClient({ mutationCache: new MutationCache({ onError: evaluate(globalOnError, { notifyError }) }) })
  const invalidate = client.invalidateQueries.bind(client)
  client.invalidateQueries = (options) => { observed.invalidated.push(options.queryKey); return invalidate(options) }
  let releaseDelete
  const deleteGate = blockFailure ? new Promise((resolve) => { releaseDelete = resolve }) : null
  const deleteStorage = async (id) => {
    observed.deleted.push(id)
    if (deleteGate) await deleteGate
    if (failure !== undefined) throw failure
  }
  const options = globalOnly ? { mutationFn: deleteStorage } : evaluate(mutation.initializer.arguments[0].getText(page), {
    notifyError, deleteStorage, queryClient: client, workflowQueryKeys,
  })
  const observer = new MutationObserver(client, options)
  let unsubscribe = observer.subscribe(() => {})
  let pending
  const mutate = (id, callbacks) => { pending = observer.mutate(id, callbacks); pending.catch(() => {}) }
  const removeStorage = evaluate(action.initializer.getText(page), {
    notifyError, removeStorageMutation: { mutate },
    confirmAction: async (request) => { observed.confirmations.push(request); return accepted },
  })
  return {
    client, observed, removeStorage,
    mutate: (id) => mutate(id),
    settle: async () => { try { await pending } catch { /* checked through actual callbacks below */ } },
    releaseDelete: () => releaseDelete?.(),
    unmount: () => { unsubscribe(); unsubscribe = () => {} },
    dispose: () => { unsubscribe(); client.clear() },
  }
}
let checks = 0, failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`STORAGE_DELETE_ERRORS PASS ${label}`) }
  catch (error) { failed++; console.error(`STORAGE_DELETE_ERRORS FAIL ${label}: ${error.message}`) }
}

await check('declined confirmation performs no deletion, invalidation or error report', async () => {
  const f = setup({ accepted: false })
  try {
    await f.removeStorage('synthetic-storage', 'Synthetic name')
    assert.equal(f.observed.confirmations.length, 1)
    assert.equal(f.observed.confirmations[0].title, '删除存储连接')
    assert.equal(f.observed.confirmations[0].confirmLabel, '删除连接')
    assert.ok(f.observed.confirmations[0].detail.includes('Synthetic name'))
    assert.deepEqual(f.observed.deleted, [])
    assert.deepEqual(f.observed.messages, [])
    assert.deepEqual(f.observed.invalidated, [])
  } finally { f.dispose() }
})
await check('successful confirmed deletion retains ID and ordered success invalidations', async () => {
  const f = setup()
  try {
    for (const key of [['storages'], ['storage-groups'], ['workflows'], ['tasks']]) f.client.setQueryData(key, 'cached')
    await f.removeStorage('synthetic-storage', 'Synthetic name')
    await f.settle()
    assert.deepEqual(f.observed.deleted, ['synthetic-storage'])
    assert.deepEqual(f.observed.invalidated, [['storages'], ['storage-groups'], ['workflows']])
    for (const key of [['storages'], ['storage-groups'], ['workflows']]) assert.equal(f.client.getQueryState(key).isInvalidated, true)
    assert.equal(f.client.getQueryState(['tasks']).isInvalidated, false)
    assert.deepEqual(f.observed.messages, [])
  } finally { f.dispose() }
})
for (const reason of [new Error('synthetic deletion rejected'), 'synthetic deletion rejected']) {
  await check(`${typeof reason === 'string' ? 'string' : 'Error'} failure reports the existing message once`, async () => {
    const f = setup({ failure: reason })
    try {
      await f.removeStorage('synthetic-storage', 'Synthetic name')
      await f.settle()
      assert.deepEqual(f.observed.deleted, ['synthetic-storage'])
      assert.deepEqual(f.observed.messages, [`操作失败：${String(reason)}`])
      assert.deepEqual(f.observed.invalidated, [])
    } finally { f.dispose() }
  })
}
await check('deletion failure still reports once after the observer is removed', async () => {
  const reason = new Error('synthetic unmounted deletion rejected')
  const f = setup({ failure: reason, blockFailure: true })
  try {
    await f.removeStorage('synthetic-storage', 'Synthetic name')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(f.observed.messages, [])
    assert.deepEqual(f.observed.deleted, ['synthetic-storage'])
    f.unmount()
    f.releaseDelete()
    await f.settle()
    assert.deepEqual(f.observed.messages, [`操作失败：${String(reason)}`])
  } finally { f.dispose() }
})
await check('an unowned mutation failure still uses the real global fallback once', async () => {
  const reason = new Error('synthetic fallback failure')
  const f = setup({ failure: reason, globalOnly: true })
  try {
    f.mutate('synthetic-storage')
    await f.settle()
    assert.deepEqual(f.observed.messages, [`操作失败：${String(reason)}`])
  } finally { f.dispose() }
})
console.log(`STORAGE_DELETE_ERRORS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
