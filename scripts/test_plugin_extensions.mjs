import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = fileURLToPath(new URL('..', import.meta.url))

function compile(relative, overrides = {}, cache = new Map()) {
  const path = resolve(root, relative)
  if (cache.has(path)) return cache.get(path)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  cache.set(path, module.exports)
  const loader = (id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) return compile(resolve(dirname(path), id) + '.ts', overrides, cache)
    return require(id)
  }
  new Function('require', 'module', 'exports', code)(loader, module, module.exports)
  return module.exports
}

const plugin = {
  id: 'example.test', name: 'Local template', version: '1.0.0', description: 'Example',
  apiVersion: 1, schemaVersion: 1, enabled: true, installed: true, kind: 'template',
  config: { template: '{url}' }, permissions: ['read_asset'], grantedPermissions: ['read_asset'],
  supportedHooks: ['after_upload'], enabledHooks: ['after_upload'], source: 'local',
  configSchema: {
    template: { type: 'string', title: 'Template', required: true },
    endpoint: { type: 'url', title: 'Endpoint' },
    enabled: { type: 'boolean', title: 'Enabled' },
    quality: { type: 'integer', title: 'Quality', minimum: 1, maximum: 100 },
    format: { type: 'enum', title: 'Format', enum: ['png', 'webp'] },
  },
}
const configModule = compile('apps/desktop/src/features/plugins/config.ts')

test('config preserves declared defaults and legitimate old AI overrides, excludes unsupported secrets', () => {
  const value = configModule.initialPluginConfig({ ...plugin, kind: 'aiprompt',
    config: { baseUrl: 'https://example.com/v1', model: 'local', apiKey: 'secret-fixture' },
    configSchema: { template: { type: 'string', default: '{name}' } } })
  assert.deepEqual({ ...value }, { template: '{name}', baseUrl: 'https://example.com/v1', model: 'local' })
  assert.equal(Object.getPrototypeOf(value), null)
})

test('field validation handles required values, bounds, boolean types, enums and endpoint policy', () => {
  const errors = (value) => configModule.pluginConfigErrors(plugin, value)
  assert.equal(Object.keys(errors({ template: 'x', enabled: false, quality: 1, format: 'webp', endpoint: 'http://127.0.0.1:9000' })).length, 0)
  for (const value of [{ template: '' }, { template: 'x', quality: 101 }, { template: 'x', quality: 1.5 },
    { template: 'x', enabled: 'false' }, { template: 'x', format: 'gif' },
    { template: 'x', endpoint: 'http://192.168.1.1/' }, { template: 'x', endpoint: 'https://user:password@example.com' }]) {
    assert(Object.keys(errors(value)).length > 0)
  }
})

test('schema form renders labelled real controls without a JSON editor or stored secret values', () => {
  const { PluginSchemaForm } = compile('apps/desktop/src/features/plugins/PluginSchemaForm.tsx')
  const html = renderToStaticMarkup(React.createElement(PluginSchemaForm, {
    plugin: { ...plugin, config: { ...plugin.config, apiKey: 'secret-fixture' } },
    busy: false, onSave() {},
  }))
  assert.match(html, /type="checkbox"/)
  assert.match(html, /type="number"/)
  assert.match(html, /<select/)
  assert.match(html, /<label/)
  assert(!html.includes('secret-fixture'))
  assert(!html.includes('插件配置 JSON'))
  assert.match(html, /保存配置/)
})

test('import preview escapes untrusted metadata and does not display raw config or grant permissions', () => {
  const { PluginImportDialog } = compile('apps/desktop/src/features/plugins/PluginImportDialog.tsx')
  const html = renderToStaticMarkup(React.createElement(PluginImportDialog, {
    preview: { importId: 'opaque', plugin: { ...plugin, name: '<img src=x>', config: { secret: 'secret-fixture' } } },
    busy: false, onCancel() {}, onInstall() {},
  }))
  assert.match(html, /role="dialog"/)
  assert.match(html, /&lt;img/)
  assert(!html.includes('<img'))
  assert(!html.includes('secret-fixture'))
  assert.match(html, /安装并保持关闭/)
})

test('new IPC wrappers pass only path or opaque preview ID and refuse browser execution', async () => {
  const calls = []
  const runtime = { isTauriRuntime: () => true, invoke: async (...args) => { calls.push(args); return {} } }
  const api = compile('apps/desktop/src/features/plugins/api.ts', { '../../platform/desktop/runtime': runtime })
  await api.previewLocalPlugin('C:/fixtures/plugin.json')
  await api.installLocalPlugin('opaque')
  assert.deepEqual(calls, [['preview_local_plugin', { path: 'C:/fixtures/plugin.json' }], ['install_local_plugin', { importId: 'opaque' }]])
  runtime.isTauriRuntime = () => false
  await assert.rejects(api.previewLocalPlugin('file'))
  await assert.rejects(api.installLocalPlugin('opaque'))
  assert.equal(calls.length, 2)
})
