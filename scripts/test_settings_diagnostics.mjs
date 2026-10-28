import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const icons = require('lucide-react')
const path = 'apps/desktop/src/pages/SettingsPage.tsx'
const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const panelPath = 'apps/desktop/src/features/settings/SystemDiagnosticsPanel.tsx'
const panelUrl = new URL('../' + panelPath, import.meta.url)
const panelSource = existsSync(panelUrl) ? readFileSync(panelUrl, 'utf8') : ''
const panelAst = ts.createSourceFile(panelPath, panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const componentAst = panelSource ? panelAst : ast
const component = componentAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'SystemDiagnosticsPanel')
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
await check('page imports the named panel from its real settings module', () => {
  const imports = ast.statements.filter((node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '../features/settings/SystemDiagnosticsPanel')
  assert.equal(imports.length, 1)
  const bindings = imports[0].importClause?.namedBindings
  assert.ok(bindings && ts.isNamedImports(bindings))
  assert.ok(bindings.elements.some((node) => node.name.text === 'SystemDiagnosticsPanel' && !node.propertyName))
  assert.ok(!ast.statements.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'SystemDiagnosticsPanel'))
})
await check('settings module exports the actual panel and owns no query or IPC', () => {
  assert.ok(panelSource && componentAst === panelAst, 'independent panel module is missing')
  assert.ok(component.modifiers?.some((node) => node.kind === ts.SyntaxKind.ExportKeyword))
  assert.ok(!/\b(?:useQuery|useMutation|invoke|getSystemDiagnostics)\s*\(/.test(panelSource))
})
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
  // Execute the complete new module, including its actual icon imports. The old component is
  // retained only as the pre-implementation red control for the nine existing behavior checks.
  Panel = panelSource ? compile(panelSource).SystemDiagnosticsPanel
    : compile(component.getText(ast) + '\nmodule.exports = SystemDiagnosticsPanel', bindings)
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

// Evaluate the real measurement functions with an in-memory filesystem boundary. Nothing writes
// the panel or the baseline; the negative control must be visible in the actual Settings face.
const inventoryPath = 'scripts/theme_face_inventory.mjs'
const inventoryUrl = new URL('../' + inventoryPath, import.meta.url)
function inventory(script, overrides = new Map()) {
  const code = script.split('const argv = process.argv.slice(2)')[0]
    .replace(/^#!.*\r?\n/, '').replace(/^import .*$/gm, '').replace(/export function/g, 'function')
    .replaceAll('import.meta.url', JSON.stringify(inventoryUrl.href))
  return new Function('readFileSync', code + '; return { measure, table }')((file, encoding) => {
    const match = [...overrides].find(([rel]) => String(file).replaceAll('\\', '/').endsWith('/' + rel))
    if (!match) return readFileSync(file, encoding)
    if (match[1] === null) throw new Error('planted missing panel')
    return match[1]
  })
}
const currentInventorySource = readFileSync(inventoryUrl, 'utf8')
const currentInventory = inventory(currentInventorySource)
// Recompose today's real declarations, rather than freezing a historical commit, style count or
// documented mismatch. Future intentional styling, faces and baseline repairs remain possible.
const presentation = panelAst.statements.filter((node) => node.name && ['SystemDiagnosticsPanelProps', 'SystemDiagnosticsPanel'].includes(node.name.text))
  .map((node) => node.getText(panelAst).replace(/^export /, '')).join('\n\n')
const recomposedPage = source.replace(/^import \{ SystemDiagnosticsPanel \} from '[^']+'\r?\n/m, '')
  .replace('export function SettingsPage()', `${presentation}\n\nexport function SettingsPage()`)
const singleSourceInventory = currentInventorySource.replace(/^(\s*\['页面 · 设置', '[^']+'), \[[^\n]+\](\],)$/m, '$1$2')
const recomposedInventory = inventory(singleSourceInventory, new Map([[path, recomposedPage]]))
await check('all theme faces retain every counter and row shape after source recomposition', () => {
  assert.ok(presentation && singleSourceInventory !== currentInventorySource, 'single-source comparison was not constructed')
  assert.deepEqual(currentInventory.measure(), recomposedInventory.measure())
  assert.equal(currentInventory.table(), recomposedInventory.table())
})
await check('split and single-source theme tables report identical documented differences', () => {
  const doc = readFileSync(new URL('../docs/VISUAL_BASELINE.md', import.meta.url), 'utf8')
  const documented = doc.split('<!-- THEME_FACE_TABLE:BEGIN -->')[1].split('<!-- THEME_FACE_TABLE:END -->')[0].trim().split(/\r?\n/)
  const differences = (table) => table.split('\n').flatMap((line, index) => line === documented[index] ? [] : [{ index, doc: documented[index], code: line }])
  assert.deepEqual(differences(currentInventory.table()), differences(recomposedInventory.table()))
})
await check('a changed class in the independent panel changes the real Settings census', () => {
  const planted = panelSource.replace('className="', 'className="bg-[#123456] ')
  assert.notEqual(planted, panelSource, 'independent panel class control is missing')
  const changed = inventory(currentInventorySource, new Map([[panelPath, planted]]))
  const original = currentInventory.measure().find((row) => row.label === '页面 · 设置')
  const altered = changed.measure().find((row) => row.label === '页面 · 设置')
  assert.deepEqual(altered, { ...original, literal: original.literal + 1 })
  assert.notEqual(changed.table(), currentInventory.table())
})
await check('a missing independent panel fails theme measurement instead of disappearing', () => {
  assert.throws(() => inventory(currentInventorySource, new Map([[panelPath, null]])).measure(), /not readable/)
})
await check('the existing user-flow predicate reads the real page and panel sources', () => {
  const guard = readFileSync(new URL('../scripts/check_user_flow.py', import.meta.url), 'utf8')
  const label = ", 'Settings exposes actionable runtime diagnostics')"
  const end = guard.indexOf(label)
  assert.ok(end >= 0, 'original assertion label is missing')
  const begin = guard.lastIndexOf('\nrequire(', end) + '\nrequire('.length
  const expression = guard.slice(begin, end)
  const cases = [
    { settings_page: source, settings_panel: panelSource },
    { settings_page: source.replaceAll('getSystemDiagnostics', 'removedApi'), settings_panel: panelSource },
    { settings_page: source, settings_panel: panelSource.replaceAll('系统诊断', 'removedCaption') },
    { settings_page: source, settings_panel: panelSource.replaceAll('diagnostics.warnings', 'removedWarnings') },
  ]
  // This guard uses only string membership joined by `and`. Evaluate precisely that restricted
  // grammar in Node; a changed grammar fails explicitly instead of adding Python to unit tests.
  assert.match(expression, /^'[^']+' in settings_(?:page|panel)(?: and '[^']+' in settings_(?:page|panel))*$/)
  assert.match(guard, /settings_panel = text\('apps\/desktop\/src\/features\/settings\/SystemDiagnosticsPanel\.tsx'\)/)
  const javascript = expression.replace(/'([^']+)' in (settings_page|settings_panel)/g,
    (_, needle, owner) => `${owner}.includes(${JSON.stringify(needle)})`).replaceAll(' and ', ' && ')
  const evaluate = new Function('settings_page', 'settings_panel', `return ${javascript}`)
  const verdicts = cases.map(({ settings_page, settings_panel }) => evaluate(settings_page, settings_panel))
  assert.deepEqual(verdicts, [true, false, false, false])
})

console.log(`SETTINGS_DIAGNOSTICS_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
