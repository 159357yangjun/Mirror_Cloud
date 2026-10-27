import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const helperUrl = new URL('../apps/desktop/src/platform/desktop/subscription.ts', import.meta.url)
let manage
if (existsSync(helperUrl)) {
  const source = readFileSync(helperUrl, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', output)(module.exports, module)
  manage = module.exports.manageDesktopSubscription
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Execute the actual effect bodies. Only the native event dependency is replaced;
// subscriptions, promise ordering and effect cleanup remain product code. This is
// an effect-body test, not a claim of full React/WebView integration coverage.
function eventEffect(path, eventName, runtime = true) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const effects = []
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const callback = node.arguments[0]
      if (callback?.getText(ast).includes(eventName)) effects.push(callback)
    }
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.equal(effects.length, 1, `expected one product effect for ${eventName} in ${path}`)
  const output = ts.transpileModule(`const effect = ${effects[0].getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [(context) => {
      const visit = (node) => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          assert.equal(node.arguments[0].text, '@tauri-apps/api/event')
          return ts.factory.createCallExpression(ts.factory.createIdentifier('loadEvents'), undefined, [])
        }
        return ts.visitEachChild(node, visit, context)
      }
      return (node) => ts.visitNode(node, visit)
    }] },
  }).outputText
  const moduleGate = deferred()
  const listenerGate = deferred()
  const observed = { loads: 0, registrations: 0, releases: 0, errors: [], invalidations: [] }
  const module = { listen: (name, handler) => {
    observed.registrations++
    observed.name = name
    observed.handler = handler
    return listenerGate.promise
  } }
  const dependencies = {
    loadEvents: () => { observed.loads++; return moduleGate.promise },
    isTauriRuntime: () => runtime,
    manageDesktopSubscription: manage,
    queryClient: {
      setQueryData: () => {},
      invalidateQueries: (value) => { observed.invalidations.push(value); return Promise.resolve() },
    },
    taskLimit: 100,
    taskIds: ['task-1'],
    uploadOpen: true,
    TERMINAL_STATUSES: new Set(['completed', 'failed', 'cancelled']),
    getOutputPreferences: async () => ({ autoCopyAfterPublish: false }),
    formatPublishedAsset: () => '',
    copyText: async () => {},
    notifyError: (message) => observed.errors.push(message),
  }
  const effect = new Function(...Object.keys(dependencies), `${output}\nreturn effect;`)(...Object.values(dependencies))
  return {
    effect, observed,
    resolveModule: () => moduleGate.resolve(module),
    resolveListener: () => listenerGate.resolve(() => { observed.releases++ }),
  }
}

const sites = [
  ['App', 'apps/desktop/src/App.tsx', 'asset://published'],
  ['Tasks', 'apps/desktop/src/pages/TasksPage.tsx', 'task://updated'],
  ['Upload', 'apps/desktop/src/components/UploadDialog.tsx', 'task://updated'],
]
let checks = 0
const failures = []
async function check(name, run) {
  checks++
  try { await run(); console.log(`DESKTOP_SUBSCRIPTION PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`DESKTOP_SUBSCRIPTION FAIL ${name}: ${error.message}`) }
}

for (const [name, path, eventName] of sites) {
  await check(`${name}: unmount before registration resolves releases the late listener`, async () => {
    const fixture = eventEffect(path, eventName)
    const dispose = fixture.effect()
    assert.equal(typeof dispose, 'function')
    dispose()
    fixture.resolveModule()
    await settle()
    assert.equal(fixture.observed.registrations, 1, 'must exercise a real registration')
    fixture.resolveListener()
    await settle()
    assert.equal(fixture.observed.releases, 1, 'late listener was leaked')
  })
  await check(`${name}: mounted subscription registers and is released exactly once`, async () => {
    const fixture = eventEffect(path, eventName)
    const dispose = fixture.effect()
    fixture.resolveModule()
    await settle()
    assert.equal(fixture.observed.name, eventName)
    fixture.resolveListener()
    await settle()
    assert.equal(fixture.observed.releases, 0, 'live listener must stay active')
    dispose()
    dispose()
    assert.equal(fixture.observed.releases, 1)
  })
  await check(`${name}: browser runtime never loads native events`, async () => {
    const fixture = eventEffect(path, eventName, false)
    const dispose = fixture.effect()
    await settle()
    assert.equal(fixture.observed.loads, 0)
    assert.equal(dispose, undefined)
  })
}

await check('StrictMode-style re-mount keeps only the current subscription', async () => {
  assert.equal(typeof manage, 'function', 'shared subscription lifecycle is not implemented')
  const first = deferred()
  let oldReleases = 0, currentReleases = 0
  const oldDispose = manage(() => first.promise)
  oldDispose()
  const currentDispose = manage(() => Promise.resolve(() => { currentReleases++ }))
  first.resolve(() => { oldReleases++ })
  await settle()
  assert.equal(oldReleases, 1)
  assert.equal(currentReleases, 0)
  currentDispose()
  assert.equal(currentReleases, 1)
})

for (const mode of ['sync', 'async']) {
  await check(`${mode} subscribe failure reaches the explicit error owner once`, async () => {
    assert.equal(typeof manage, 'function', 'shared subscription lifecycle is not implemented')
    const reason = new Error('test-only registration failure')
    const errors = []
    const dispose = manage(() => {
      if (mode === 'sync') throw reason
      return Promise.reject(reason)
    }, (error) => errors.push(error))
    await settle()
    assert.deepEqual(errors, [reason])
    dispose()
  })
}

await check('a subscription rejected after disposal does not report to an unmounted owner', async () => {
  assert.equal(typeof manage, 'function', 'shared subscription lifecycle is not implemented')
  const pending = deferred()
  const errors = []
  const dispose = manage(() => pending.promise, (error) => errors.push(error))
  dispose()
  pending.reject(new Error('test-only late failure'))
  await settle()
  assert.deepEqual(errors, [])
})

console.log(`DESKTOP_SUBSCRIPTION_GATE checks=${checks} failed=${failures.length}`)
if (failures.length) process.exitCode = 1
