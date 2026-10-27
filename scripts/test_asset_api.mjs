import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
const desktopPath = resolve(root, 'apps/desktop/src/lib/desktop.ts')
const apiPath = resolve(root, 'apps/desktop/src/features/assets/api.ts')
const toastPath = resolve(root, 'apps/desktop/src/store/useToastStore.ts')

// Load complete real product modules, including the compatibility entry's actual imports.
// Only the native core, browser/Vite environment and unrelated toast boundary are substituted.
function setup(mode = 'native') {
  const calls = [], loaded = new Map()
  const result = [{
    id: 'asset-1', name: 'photo.png', sizeBytes: 256, mimeType: 'image/png', width: 8, height: 8,
    publicUrl: '', status: 'online', createdAt: '2026-01-01T00:00:00Z',
    deployments: [{ storage: 'Private', storageId: 'storage-1', remotePath: 'photo.png',
      providerKey: 'r2', accessMode: 'private_requested', role: 'primary', ok: true,
      error: null, confirmationLevel: 0, errorKind: null }],
    pluginOutputs: [{ pluginId: 'plugin-1', pluginName: 'Caption', pluginKind: 'ai', text: 'caption', data: { preserved: true } }],
  }]
  const state = { coreLoads: 0, reject: false, reason: undefined, loadFailure: undefined }
  const browserWindow = mode === 'native' ? { __TAURI_INTERNALS__: {} } : mode === 'no-window' ? undefined : {}
  const taskIds = { repair_asset: 'synthetic-repair-task', delete_asset: 'synthetic-delete-task' }
  const core = { invoke: async (command, args) => {
    calls.push({ command, args })
    assert.ok(['list_assets', 'repair_asset', 'delete_asset'].includes(command), `unexpected asset command: ${command}`)
    if (state.reject) throw state.reason
    return command === 'list_assets' ? result : taskIds[command]
  } }
  function load(path) {
    if (loaded.has(path)) return loaded.get(path).exports
    const code = readFileSync(path, 'utf8')
    const output = ts.transpileModule(code, {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      transformers: { before: [(context) => {
        const visit = (node) => {
          // desktop.ts reads Vite's import.meta.env at module initialization.
          if (ts.isPropertyAccessExpression(node) && node.name.text === 'env' &&
              ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
            return ts.factory.createObjectLiteralExpression()
          }
          return ts.visitEachChild(node, visit, context)
        }
        return (node) => ts.visitNode(node, visit)
      }] },
    }).outputText
    const module = { exports: {} }
    loaded.set(path, module)
    const resolveModule = (specifier) => {
      if (specifier === '@tauri-apps/api/core') {
        state.coreLoads++
        if (state.loadFailure !== undefined) throw state.loadFailure
        return core
      }
      assert.ok(specifier.startsWith('.'), `unexpected external dependency: ${specifier}`)
      const target = resolve(dirname(path), specifier) + '.ts'
      if (target === toastPath) return { notifyError: () => { throw new Error('asset API must not notify or replace its error') } }
      return load(target)
    }
    new Function('require', 'module', 'exports', 'window', output)(resolveModule, module, module.exports, browserWindow)
    return module.exports
  }
  return { load, loaded, calls, result, state }
}

let checks = 0, failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`ASSET_API PASS ${label}`) }
  catch (error) { failed++; console.error(`ASSET_API FAIL ${label}: ${error.message}`) }
}

await check('legacy listAssets remains a named async function export', () => {
  const source = ts.createSourceFile(desktopPath, readFileSync(desktopPath, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'listAssets')
  assert.ok(declaration)
  assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.ExportKeyword))
  assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.AsyncKeyword))
  assert.equal(typeof setup().load(desktopPath).listAssets, 'function')
})
await check('asset domain module exists', () => assert.ok(existsSync(apiPath), 'asset domain module is missing'))
await check('compatibility entry delegates through its real asset module import', async () => {
  assert.ok(existsSync(apiPath), 'asset domain module is missing')
  const ctx = setup()
  const legacy = ctx.load(desktopPath)
  assert.ok(ctx.loaded.has(apiPath), 'desktop entry did not import the actual asset domain')
  const api = ctx.load(apiPath), original = api.listAssets
  const delegated = []
  api.listAssets = async (limit) => { delegated.push(limit); return ctx.result }
  try {
    assert.strictEqual(await legacy.listAssets(6), ctx.result)
    assert.deepEqual(delegated, [6])
    assert.deepEqual(ctx.calls, [])
  } finally { api.listAssets = original }
})

for (const [name, path] of [['legacy', desktopPath], ['api', apiPath]]) {
  if (name === 'api' && !existsSync(apiPath)) continue
  for (const mode of ['browser', 'no-window']) {
    await check(`${name} ${mode} returns fresh empty arrays without loading native IPC`, async () => {
      const ctx = setup(mode), entry = ctx.load(path)
      const first = await entry.listAssets()
      const second = await entry.listAssets(6)
      assert.deepEqual(first, [])
      assert.deepEqual(second, [])
      assert.notStrictEqual(first, second)
      assert.deepEqual(ctx.calls, [])
      assert.equal(ctx.state.coreLoads, 0)
    })
  }
  for (const [args, limit] of [[[], 200], [[undefined], 200], [[6], 6], [[200], 200], [[0], 0], [[10000], 10000]]) {
    const argumentLabel = args.length === 0 ? 'omitted' : args[0] === undefined ? 'undefined' : String(args[0])
    await check(`${name} native limit ${argumentLabel} preserves payload and full result identity`, async () => {
      const ctx = setup(), entry = ctx.load(path)
      assert.strictEqual(await entry.listAssets(...args), ctx.result)
      assert.deepEqual(ctx.calls, [{ command: 'list_assets', args: { limit } }])
      assert.equal(ctx.state.coreLoads, 1)
    })
  }
  for (const reason of [new Error('synthetic asset read failure'), 'synthetic native string failure']) {
    await check(`${name} preserves ${typeof reason === 'string' ? 'string' : 'Error'} rejection unchanged`, async () => {
      const ctx = setup(), entry = ctx.load(path)
      ctx.state.reject = true
      ctx.state.reason = reason
      await assert.rejects(entry.listAssets(6), (error) => error === reason)
      assert.deepEqual(ctx.calls, [{ command: 'list_assets', args: { limit: 6 } }])
    })
  }
  await check(`${name} propagates native module loading failure without issuing a command`, async () => {
    const ctx = setup(), entry = ctx.load(path)
    const reason = new Error('synthetic native core loading failure')
    ctx.state.loadFailure = reason
    await assert.rejects(entry.listAssets(), (error) => error === reason)
    assert.equal(ctx.state.coreLoads, 1)
    assert.deepEqual(ctx.calls, [])
  })
}

for (const [method, command, returnedTaskId] of [
  ['repairAsset', 'repair_asset', 'synthetic-repair-task'],
  ['deleteAsset', 'delete_asset', 'synthetic-delete-task'],
]) {
  await check(`legacy ${method} remains a named async function export`, () => {
    const source = ts.createSourceFile(desktopPath, readFileSync(desktopPath, 'utf8'), ts.ScriptTarget.Latest, true)
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === method)
    assert.ok(declaration)
    assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.ExportKeyword))
    assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.AsyncKeyword))
    assert.equal(typeof setup().load(desktopPath)[method], 'function')
  })
  await check(`asset domain exports executable ${method}`, () => {
    assert.equal(typeof setup().load(apiPath)[method], 'function', `asset domain has no ${method}`)
  })
  await check(`legacy ${method} delegates through its real domain module import`, async () => {
    const ctx = setup(), legacy = ctx.load(desktopPath), api = ctx.load(apiPath)
    assert.equal(typeof api[method], 'function', `asset domain has no ${method}`)
    assert.ok(ctx.loaded.has(apiPath))
    const original = api[method], delegated = []
    api[method] = async (assetId) => { delegated.push(assetId); return returnedTaskId }
    try {
      assert.strictEqual(await legacy[method]('asset-1'), returnedTaskId)
      assert.deepEqual(delegated, ['asset-1'])
      assert.deepEqual(ctx.calls, [])
    } finally { api[method] = original }
  })
  for (const [name, path] of [['legacy', desktopPath], ['api', apiPath]]) {
    for (const mode of ['native', 'browser', 'no-window']) {
      await check(`${name} ${mode} ${method} preserves command, task ID and both failure forms`, async () => {
        const ctx = setup(mode), entry = ctx.load(path)
        assert.equal(typeof entry[method], 'function', `${name} has no ${method}`)
        const assetId = 'asset-1'
        assert.strictEqual(await entry[method](assetId), returnedTaskId)
        assert.deepEqual(ctx.calls, [{ command, args: { assetId } }])
        assert.equal(ctx.state.coreLoads, 1)
        for (const reason of [new Error('synthetic asset command failure'), 'synthetic command string failure']) {
          ctx.state.reject = true
          ctx.state.reason = reason
          const before = ctx.calls.length
          await assert.rejects(entry[method](assetId), (error) => error === reason)
          assert.equal(ctx.calls.length, before + 1, 'a failure must not trigger retries or other commands')
          assert.deepEqual(ctx.calls.at(-1), { command, args: { assetId } })
        }
      })
    }
    await check(`${name} ${method} propagates module-loading failure without issuing a command`, async () => {
      const ctx = setup(), entry = ctx.load(path)
      assert.equal(typeof entry[method], 'function', `${name} has no ${method}`)
      const reason = new Error('synthetic native core loading failure')
      ctx.state.loadFailure = reason
      await assert.rejects(entry[method]('asset-1'), (error) => error === reason)
      assert.equal(ctx.state.coreLoads, 1)
      assert.deepEqual(ctx.calls, [])
    })
  }
}
console.log(`ASSET_API_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
