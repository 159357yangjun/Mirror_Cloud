import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
const desktopPath = resolve(root, 'apps/desktop/src/lib/desktop.ts')
const dialogsPath = resolve(root, 'apps/desktop/src/platform/desktop/dialogs.ts')
const toastPath = resolve(root, 'apps/desktop/src/store/useToastStore.ts')
const expectedOpen = { multiple: true, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] }

// Execute the complete actual desktop module and its real relative imports. The
// plugin boundary is simulated so tests never open a native dialog.
function setup(mode = 'native') {
  const loaded = new Map(), calls = []
  const state = { loads: 0, result: null, reason: undefined, loadFailure: undefined }
  const window = mode === 'native' ? { __TAURI_INTERNALS__: {} } : mode === 'browser' ? {} : undefined
  const plugin = {}
  for (const name of ['open', 'save']) plugin[name] = async (options) => {
    calls.push({ name, options })
    if (state.reason !== undefined) throw state.reason
    return state.result
  }
  function load(path) {
    if (loaded.has(path)) return loaded.get(path).exports
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      transformers: { before: [(context) => {
        const visit = (node) => {
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
      if (specifier === '@tauri-apps/plugin-dialog') {
        state.loads++
        if (state.loadFailure !== undefined) throw state.loadFailure
        return plugin
      }
      assert.ok(specifier.startsWith('.'), `unexpected external dependency ${specifier}`)
      const target = resolve(dirname(path), specifier) + '.ts'
      if (target === toastPath) return { notifyError: () => { throw new Error('dialog selection must not report a toast') } }
      return load(target)
    }
    new Function('require', 'module', 'exports', 'window', output)(resolveModule, module, module.exports, window)
    return module.exports
  }
  return { load, loaded, state, calls }
}

let checks = 0, failed = 0
async function check(name, fn) {
  checks++
  try { await fn(); console.log(`DESKTOP_DIALOGS PASS ${name}`) }
  catch (error) { failed++; console.error(`DESKTOP_DIALOGS FAIL ${name}: ${error.message}`) }
}

await check('desktop platform dialog module exists', () => assert.ok(existsSync(dialogsPath), 'platform dialogs module is missing'))
for (const name of ['chooseImageFiles', 'chooseDownloadPath']) {
  await check(`legacy ${name} is a named async export`, () => {
    const ast = ts.createSourceFile(desktopPath, readFileSync(desktopPath, 'utf8'), ts.ScriptTarget.Latest, true)
    const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(declaration)
    assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.ExportKeyword))
    assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.AsyncKeyword))
    assert.equal(typeof setup().load(desktopPath)[name], 'function')
  })
  await check(`legacy ${name} delegates through its actual platform import`, async () => {
    assert.ok(existsSync(dialogsPath), 'platform dialogs module is missing')
    const ctx = setup(), legacy = ctx.load(desktopPath), dialogs = ctx.load(dialogsPath)
    assert.ok(ctx.loaded.has(dialogsPath))
    assert.equal(typeof dialogs[name], 'function')
    const original = dialogs[name], seen = [], marker = name === 'chooseImageFiles' ? ['synthetic'] : 'synthetic'
    dialogs[name] = async (...args) => { seen.push(args); return marker }
    try {
      const args = name === 'chooseImageFiles' ? [] : ['proposed.png']
      assert.strictEqual(await legacy[name](...args), marker)
      assert.deepEqual(seen, [args])
      assert.deepEqual(ctx.calls, [])
    } finally { dialogs[name] = original }
  })
}

for (const [entryName, path] of [['legacy', desktopPath], ['platform', dialogsPath]]) {
  if (entryName === 'platform' && !existsSync(dialogsPath)) continue
  for (const mode of ['browser', 'no-window']) await check(`${entryName} ${mode} has empty/cancel fallbacks and never loads plugin`, async () => {
    const ctx = setup(mode), entry = ctx.load(path)
    const first = await entry.chooseImageFiles(), second = await entry.chooseImageFiles()
    assert.deepEqual(first, [])
    assert.deepEqual(second, [])
    assert.notStrictEqual(first, second)
    assert.equal(await entry.chooseDownloadPath('proposed.png'), null)
    assert.equal(ctx.state.loads, 0)
    assert.deepEqual(ctx.calls, [])
  })
  for (const [label, value, expected] of [
    ['cancel', null, []], ['single file', 'a.png', ['a.png']], ['multiple files', ['a.png', 'b.webp'], ['a.png', 'b.webp']],
  ]) await check(`${entryName} native open ${label} retains options and result`, async () => {
    const ctx = setup(), entry = ctx.load(path)
    ctx.state.result = value
    const actual = await entry.chooseImageFiles()
    assert.deepEqual(actual, expected)
    if (Array.isArray(value)) assert.strictEqual(actual, value)
    assert.deepEqual(ctx.calls, [{ name: 'open', options: expectedOpen }])
    assert.equal(ctx.state.loads, 1)
  })
  for (const value of [null, 'D:\\sample path\\file.png']) await check(`${entryName} native save returns ${value === null ? 'cancel' : 'path'} unchanged`, async () => {
    const ctx = setup(), entry = ctx.load(path)
    ctx.state.result = value
    assert.strictEqual(await entry.chooseDownloadPath('proposed.png'), value)
    assert.deepEqual(ctx.calls, [{ name: 'save', options: { defaultPath: 'proposed.png' } }])
    assert.equal(ctx.state.loads, 1)
  })
  for (const name of ['chooseImageFiles', 'chooseDownloadPath']) {
    for (const reason of [new Error('synthetic plugin failure'), 'synthetic plugin rejection']) await check(`${entryName} ${name} preserves ${typeof reason === 'string' ? 'string' : 'Error'} rejection`, async () => {
      const ctx = setup(), entry = ctx.load(path)
      ctx.state.reason = reason
      await assert.rejects(entry[name]('proposed.png'), (error) => error === reason)
      assert.equal(ctx.calls.length, 1)
    })
    await check(`${entryName} ${name} propagates plugin load failure`, async () => {
      const ctx = setup(), entry = ctx.load(path), reason = new Error('synthetic plugin load failure')
      ctx.state.loadFailure = reason
      await assert.rejects(entry[name]('proposed.png'), (error) => error === reason)
      assert.equal(ctx.state.loads, 1)
      assert.deepEqual(ctx.calls, [])
    })
  }
}
console.log(`DESKTOP_DIALOGS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
