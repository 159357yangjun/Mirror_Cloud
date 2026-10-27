import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const icons = require('lucide-react')
const path = 'apps/desktop/src/pages/SettingsPage.tsx'
const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'SystemDiagnosticsPanel')
const page = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'SettingsPage')
let inlineSection, pageCall
function walk(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'section' && node.getText(ast).includes('diagnostics.warnings')) inlineSection = node
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SystemDiagnosticsPanel') pageCall = node
  ts.forEachChild(node, walk)
}
walk(ast)

function compile(code, values = {}) {
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(values), output)(require, module, module.exports, ...Object.values(values))
  return module.exports
}

let checks = 0
let failed = 0
async function check(label, fn) {
  checks++
  try { await fn(); console.log(`SETTINGS_DIAGNOSTICS PASS ${label}`) }
  catch (error) { failed++; console.error(`SETTINGS_DIAGNOSTICS FAIL ${label}: ${error.message}`) }
}

await check('diagnostics has a separate presentational component', () => assert.ok(component, 'component is not extracted yet'))
await check('Settings page renders the panel', () => assert.ok(pageCall && page && page.getText(ast).includes(pageCall.getText(ast)), 'page has not wired the panel yet'))
await check('page retains diagnostics query and no refetch on window focus', () => {
  const matches = []
  function findQuery(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useQuery' &&
      node.arguments[0]?.getText(ast).match(/queryKey:\s*\['system-diagnostics'\]/)) matches.push(node)
    ts.forEachChild(node, findQuery)
  }
  findQuery(page)
  assert.equal(matches.length, 1)
  const options = matches[0].arguments[0].getText(ast)
  assert.match(options, /queryFn:\s*getSystemDiagnostics/)
  assert.match(options, /refetchOnWindowFocus:\s*false/)
})

const bindings = { Shield: icons.Shield, LoaderCircle: icons.LoaderCircle, RefreshCw: icons.RefreshCw }
let Panel
if (component) {
  Panel = compile(component.getText(ast) + '\nmodule.exports = SystemDiagnosticsPanel', bindings)
} else if (inlineSection) {
  Panel = compile(`function SystemDiagnosticsPanel({ diagnostics, diagnosticsError, diagnosticsChecking, refreshDiagnostics }) { return (${inlineSection.getText(ast)}) }\nmodule.exports = SystemDiagnosticsPanel`, bindings)
}
assert.ok(Panel, 'the actual diagnostics JSX was not found')

function view(props) {
  if (!pageCall) return React.createElement(Panel, props)
  const names = ['diagnostics', 'diagnosticsError', 'diagnosticsChecking', 'refreshDiagnostics']
  const factory = compile(`function make(${names.join(', ')}) { return (${pageCall.getText(ast)}) }\nmodule.exports = make`, { SystemDiagnosticsPanel: Panel })
  return factory(...names.map((name) => props[name]))
}
const healthy = {
  status: 'healthy', appVersion: '1.2.3', defaultWorkflow: '图床方案', localApiRunning: true,
  enabledStorageCount: 2, storageCount: 3, enabledPluginCount: 1, pluginCount: 4,
  activeTaskCount: 5, failedTaskCount: 6, warnings: [],
}
const base = { diagnostics: undefined, diagnosticsError: null, diagnosticsChecking: false, refreshDiagnostics: () => {} }
const markup = (props) => renderToStaticMarkup(view({ ...base, ...props }))

await check('pending state shows placeholders and original loading caption', () => {
  const html = markup({})
  assert.match(html, /系统诊断/)
  assert.match(html, /正在检查核心状态…/)
  assert.match(html, /默认上传链：.*—/)
})
await check('healthy state renders exact counts, version, workflow and running API', () => {
  const html = markup({ diagnostics: healthy })
  for (const text of ['核心状态正常', '2/3 启用', '1/4 启用', '5 运行 · 6 失败', '运行中', '1.2.3', '图床方案']) assert.ok(html.includes(text), text)
})
await check('attention state renders warnings, absent workflow and stopped API', () => {
  const html = markup({ diagnostics: { ...healthy, status: 'attention', defaultWorkflow: null, localApiRunning: false, warnings: ['检查存储', '检查插件'] } })
  for (const text of ['有项目需要处理', '未配置', '未运行', '检查存储', '检查插件']) assert.ok(html.includes(text), text)
})
await check('read error overrides the status and strips Error prefix', () => {
  const html = markup({ diagnostics: { ...healthy, warnings: ['不得显示警告'] }, diagnosticsError: new Error('读取异常') })
  assert.ok(html.includes('系统诊断读取失败') && html.includes('读取异常'))
  assert.ok(!html.includes('Error:') && !html.includes('核心状态正常') && !html.includes('不得显示警告'))
})
await check('fetching state displays the progress icon', () => {
  assert.match(markup({ diagnosticsChecking: true }), /lucide-loader-circle/)
  assert.match(markup({ diagnosticsChecking: false }), /lucide-refresh-cw/)
})
await check('the actual refresh button calls the supplied callback once', () => {
  let called = 0
  const element = view({ ...base, refreshDiagnostics: () => { called++; return Promise.resolve() } })
  const root = element.type(element.props)
  function findButton(node) {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(findButton).find(Boolean) || null
    if (node.type === 'button') return node
    return findButton(node.props?.children)
  }
  const button = findButton(root)
  assert.ok(button)
  button.props.onClick()
  assert.equal(called, 1)
})

console.log(`SETTINGS_DIAGNOSTICS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
