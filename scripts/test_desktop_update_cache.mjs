import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const api = ts.createSourceFile('desktop.ts', readFileSync(new URL('../apps/desktop/src/lib/desktop.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const reader = api.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getUpdateStatus')
assert(reader)

function compile(text, bindings) {
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function(...Object.keys(bindings), 'module', 'exports', code)(...Object.values(bindings), module, module.exports)
  return module.exports
}

const result = (currentVersion, latestVersion, updateAvailable) => ({ currentVersion, latestVersion, updateAvailable, releaseNotes: '', setupUrl: '', setupBytes: 1, publishedAt: '' })
const status = (value, fresh = true) => ({ checkedAt: '2026-11-04T08:00:00Z', fresh, result: value })

function read(cached, native = true) {
  let calls = 0
  const { getUpdateStatus } = compile(reader.getText(api), {
    __APP_VERSION__: '1.4.13', isTauriRuntime: () => native,
    invoke: async (command) => { assert.equal(command, 'get_update_status'); calls++; return cached },
  })
  return { getUpdateStatus, calls: () => calls }
}

test('upgraded application with a fresh old-version cache withholds the misleading payload', async () => {
  const cached = status(result('1.4.12', '1.4.13', true))
  const original = structuredClone(cached)
  const reader = read(cached)
  assert.deepEqual(await reader.getUpdateStatus(), { checkedAt: cached.checkedAt, fresh: false, result: null })
  assert.equal(reader.calls(), 1)
  assert.deepEqual(cached, original, 'reading must not rewrite the persisted record')
})

test('current-version cached answers remain usable without a network check', async () => {
  for (const answer of [result('1.4.13', '1.4.14', true), result('1.4.13', '1.4.13', false)]) {
    const cached = status(answer)
    assert.deepEqual(await read(cached).getUpdateStatus(), cached)
  }
})

test('expired, missing and browser-only answers cannot seed an update card', async () => {
  for (const cached of [status(null), status(result('1.4.13', '1.4.14', true), false)]) {
    assert.deepEqual(await read(cached).getUpdateStatus(), { checkedAt: cached.checkedAt, fresh: false, result: null })
  }
  const browser = read(null, false)
  assert.deepEqual(await browser.getUpdateStatus(), { checkedAt: null, fresh: false, result: null })
  assert.equal(browser.calls(), 0)
})

const settings = ts.createSourceFile('SettingsPage.tsx', readFileSync(new URL('../apps/desktop/src/pages/SettingsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(settings) === 'checkUpdateMutation') {
    callback = node.initializer.arguments[0].properties.find((property) => property.name?.getText(settings) === 'onSuccess').initializer
  }
  ts.forEachChild(node, visit)
}
visit(settings)
assert(callback)

test('manual checks update the sidebar and clear a previously announced release when current', () => {
  let badge = '1.4.13', shown, downloaded = {}, feedback
  const { onSuccess } = compile('export const onSuccess = ' + callback.getText(settings), {
    setUpdateCheck: (value) => { shown = value }, setUpdateDownloaded: (value) => { downloaded = value },
    setManualUpdateFeedback: (value) => { feedback = value },
    useAppStore: { getState: () => ({ setUpdateAvailableVersion: (value) => { badge = value } }) },
  })
  const current = result('1.4.13', '1.4.13', false)
  onSuccess(current)
  assert.equal(badge, null)
  assert.deepEqual(shown, current)
  assert.equal(downloaded, null)
  assert.match(feedback, /暂无比 v1\.4\.13 更新/)
  onSuccess(result('1.4.13', '1.4.14', true))
  assert.equal(badge, '1.4.14')
})
