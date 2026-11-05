import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
function compile(source, bindings = {}) {
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  new Function('require', 'module', 'exports', ...Object.keys(bindings), output)(
    (name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => icon })
      throw new Error(`Unexpected runtime dependency: ${name}`)
    }, module, module.exports, ...Object.values(bindings),
  )
  return module.exports
}

// Execute actual help button closures and the shell's actual navigation callback.
// JSX is represented as data; no browser, native UI, network or account is used.
const { HelpCenterDialog } = compile(read('../apps/desktop/src/components/HelpCenterDialog.tsx'))
const shell = ts.createSourceFile('AppShell.tsx', read('../apps/desktop/src/components/AppShell.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let navigation
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(shell) === 'HelpCenterDialog') {
    navigation = node.attributes.properties.find((property) => property.name?.getText(shell) === 'onNavigate').initializer.expression
  }
  ts.forEachChild(node, visit)
}
visit(shell)
assert(navigation, 'shell must connect the help dialog')

function setup(previous = 'background') {
  const state = { page: 'settings', section: previous, calls: [] }
  const mainRef = { current: { scrollTop: 640 } }
  const setPage = (page) => { state.page = page; state.calls.push('page') }
  const useAppStore = { getState: () => ({ setSettingsSection: (section) => {
    state.section = section; state.calls.push('section')
  } }) }
  const { navigate } = compile('export const navigate = ' + navigation.getText(shell), { setPage, useAppStore, mainRef })
  const root = HelpCenterDialog({ onNavigate: navigate,
    onClose: () => state.calls.push('close'), openExternalUrl: () => assert.fail('internal navigation must not open a URL'),
  })
  const cards = []
  function collect(node) {
    if (!node || typeof node !== 'object') return
    if (node.type?.name === 'GuideCard') cards.push(node.props)
    for (const child of [node.props?.children].flat(Infinity)) collect(child)
  }
  collect(root)
  return { state, mainRef, click: (title) => {
    const card = cards.find((card) => card.title === title)
    assert(card, `missing help destination: ${title}`)
    card.onClick()
  } }
}

for (const [title, section] of [
  ['将镜云连接到 Typora', 'integration'],
  ['复制链接与私有分享', 'output'],
  ['按需开启进阶功能', 'output'],
  ['连接本机 API', 'security'],
  ['检查正式版本更新', 'about'],
]) {
  test(`${title} selects ${section} before navigating, independent of prior settings`, () => {
    for (const previous of ['output', 'security', 'about', 'background']) {
      const { state, mainRef, click } = setup(previous)
      click(title)
      assert.equal(state.page, 'settings')
      assert.equal(state.section, section)
      assert.equal(mainRef.current.scrollTop, 0, 'help navigation starts at the heading even on the same page/category')
      assert.deepEqual(state.calls, ['section', 'page', 'close'])
    }
  })
}

test('non-settings help navigation closes the dialog without changing a remembered settings category', () => {
  const { state, click } = setup('security')
  click('连接一个云端存储')
  assert.equal(state.page, 'storages')
  assert.equal(state.section, 'security')
  assert.deepEqual(state.calls, ['page', 'close'])
})
