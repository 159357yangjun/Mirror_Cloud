import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
const desktopPath = resolve(root, 'apps/desktop/src/lib/desktop.ts')
const clipboardPath = resolve(root, 'apps/desktop/src/platform/desktop/clipboard.ts')
const toastPath = resolve(root, 'apps/desktop/src/store/useToastStore.ts')
const syntheticText = 'fixture' + '-only'

// Use complete product modules with real relative imports. All clipboard access
// goes through in-memory fakes; inputs are neither logged nor persisted.
function setup(mode = 'native', missingClipboard = false) {
  const loaded = new Map(), calls = []
  const state = { pluginLoads: 0, reason: undefined, loadFailure: undefined, gate: undefined }
  const window = mode === 'native' ? { __TAURI_INTERNALS__: {} } : mode === 'browser' ? {} : undefined
  const write = (channel) => async (text) => {
    calls.push({ channel, text })
    if (state.gate) await state.gate
    if (state.reason !== undefined) throw state.reason
    return 'ignored fake return value'
  }
  const navigator = missingClipboard ? {} : { clipboard: { writeText: write('browser') } }
  const plugin = { writeText: write('native') }
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
      if (specifier === '@tauri-apps/plugin-clipboard-manager') {
        state.pluginLoads++
        if (state.loadFailure !== undefined) throw state.loadFailure
        return plugin
      }
      assert.ok(specifier.startsWith('.'), `unexpected external dependency ${specifier}`)
      const target = resolve(dirname(path), specifier) + '.ts'
      if (target === toastPath) return { notifyError: () => { throw new Error('copyText must not report a toast') } }
      return load(target)
    }
    new Function('require', 'module', 'exports', 'window', 'navigator', output)(resolveModule, module, module.exports, window, navigator)
    return module.exports
  }
  return { load, loaded, calls, state }
}

let checks = 0, failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`DESKTOP_CLIPBOARD PASS ${label}`) }
  catch (error) { failed++; console.error(`DESKTOP_CLIPBOARD FAIL ${label}: ${error.message}`) }
}
await check('platform clipboard module exists', () => assert.ok(existsSync(clipboardPath), 'clipboard module is missing'))
await check('desktop retains named async copyText export', () => {
  const ast = ts.createSourceFile(desktopPath, readFileSync(desktopPath, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'copyText')
  assert.ok(declaration)
  assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.ExportKeyword))
  assert.ok(declaration.modifiers.some((node) => node.kind === ts.SyntaxKind.AsyncKeyword))
  assert.equal(typeof setup().load(desktopPath).copyText, 'function')
})
await check('desktop delegates through its actual platform module import', async () => {
  assert.ok(existsSync(clipboardPath), 'clipboard module is missing')
  const ctx = setup(), legacy = ctx.load(desktopPath), platform = ctx.load(clipboardPath)
  assert.ok(ctx.loaded.has(clipboardPath))
  assert.equal(typeof platform.copyText, 'function')
  const original = platform.copyText, observed = []
  platform.copyText = async (text) => { observed.push(text) }
  try {
    assert.equal(await legacy.copyText(syntheticText), undefined)
    assert.equal(observed.length, 1)
    assert.ok(observed[0] === syntheticText, 'delegation must preserve text')
    assert.equal(ctx.calls.length, 0)
  } finally { platform.copyText = original }
})

for (const [name, path] of [['legacy', desktopPath], ['platform', clipboardPath]]) {
  if (name === 'platform' && !existsSync(clipboardPath)) continue
  for (const mode of ['native', 'browser', 'no-window']) {
    await check(`${name} ${mode} selects the original channel and passes text unchanged`, async () => {
      const ctx = setup(mode), entry = ctx.load(path)
      assert.equal(await entry.copyText(syntheticText), undefined)
      assert.equal(ctx.calls.length, 1)
      assert.equal(ctx.calls[0].channel, mode === 'native' ? 'native' : 'browser')
      assert.ok(ctx.calls[0].text === syntheticText, 'write must preserve input')
      assert.equal(ctx.state.pluginLoads, mode === 'native' ? 1 : 0)
    })
    await check(`${name} ${mode} waits for clipboard completion`, async () => {
      const ctx = setup(mode), entry = ctx.load(path)
      let release, settled = false
      ctx.state.gate = new Promise((resolve) => { release = resolve })
      const pending = entry.copyText(syntheticText).then(() => { settled = true })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(ctx.calls.length, 1)
      assert.equal(settled, false)
      release()
      await pending
      assert.equal(settled, true)
    })
    for (const reason of [new Error('synthetic write failure'), 'synthetic write rejection']) await check(`${name} ${mode} preserves ${typeof reason === 'string' ? 'string' : 'Error'} rejection`, async () => {
      const ctx = setup(mode), entry = ctx.load(path)
      ctx.state.reason = reason
      await assert.rejects(entry.copyText(syntheticText), (error) => error === reason)
      assert.equal(ctx.calls.length, 1)
    })
  }
  await check(`${name} unavailable browser clipboard rejects without native fallback`, async () => {
    const ctx = setup('browser', true), entry = ctx.load(path)
    await assert.rejects(entry.copyText(syntheticText), TypeError)
    assert.equal(ctx.state.pluginLoads, 0)
    assert.equal(ctx.calls.length, 0)
  })
  await check(`${name} native module loading failure propagates without fallback`, async () => {
    const ctx = setup(), entry = ctx.load(path), reason = new Error('synthetic plugin load failure')
    ctx.state.loadFailure = reason
    await assert.rejects(entry.copyText(syntheticText), (error) => error === reason)
    assert.equal(ctx.state.pluginLoads, 1)
    assert.equal(ctx.calls.length, 0)
  })
}
console.log(`DESKTOP_CLIPBOARD_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
