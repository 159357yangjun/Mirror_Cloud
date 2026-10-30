import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

// Use the installed compiler to execute real TypeScript functions without adding a test runtime.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const ts = require('typescript')
const sharedPath = 'apps/desktop/src/features/cloud-browser/entryUtils.ts'
const consumers = [
  { path: 'apps/desktop/src/pages/GalleryPage.tsx', component: 'GalleryPage', sizeAtMiB: '1.0 MB' },
  { path: 'apps/desktop/src/components/StorageBrowserDialog.tsx', component: 'StorageBrowserDialog', sizeAtMiB: '1024 KB' },
]

function sourceFile(path) {
  return ts.createSourceFile(path, readFileSync(new URL('../' + path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
}

function evaluate(source, fileName, requireModule = () => { throw new Error('Unexpected runtime import') }) {
  const { outputText } = ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  runInNewContext(outputText, { module, exports: module.exports, require: requireModule }, { filename: fileName })
  return module.exports
}

function localFunction(source, name) {
  return source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
}

function entryHelpers(source) {
  const names = ['parentPath', 'isImage']
  const declarations = names.map((name) => localFunction(source, name))
  if (declarations.every(Boolean)) {
    return evaluate(declarations.map((node) => node.getText(source)).join('\n') + '\nmodule.exports = { parentPath, isImage }', source.fileName)
  }
  return evaluate(sourceFile(sharedPath).text, sharedPath)
}

let checks = 0
const failures = []
function check(label, run) {
  checks++
  try {
    run()
  } catch (error) {
    failures.push(`${label}: ${error.message.split('\n')[0]}`)
  }
}

const paths = [
  ['', ''],
  ['/', ''],
  ['////', ''],
  ['photo.png', ''],
  ['/photo.png/', ''],
  ['images/photo.png', 'images'],
  ['//album///nested//photo.webp///', 'album/nested'],
  ['相册/旅行/照片.png', '相册/旅行'],
  ['album\\photo.png', ''],
]
const entry = (name, extra = {}) => ({ name, path: name, isDir: false, ...extra })
const images = [
  ...['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].map((extension) => [entry(`PHOTO.${extension.toUpperCase()}`), true]),
  [entry('folder.png', { isDir: true, publicUrl: 'https://example.test/image.png' }), false],
  [entry('photo.png', { publicUrl: undefined }), true],
  [entry('photo.jpg', { publicUrl: null }), true],
  [entry('photo.webp', { publicUrl: '' }), true],
  [entry('download', { publicUrl: 'https://example.test/PHOTO.PNG?download=1' }), true],
  [entry('notes.txt', { publicUrl: 'https://example.test/notes?preview=photo.png' }), false],
  [entry('notes.txt', { publicUrl: 'https://example.test/photo.png#preview' }), false],
  [entry('photo.png.backup'), false],
  [entry('icon.svg'), false],
  [entry('README'), false],
  [entry(''), false],
]

for (const consumer of consumers) {
  const source = sourceFile(consumer.path)
  const helpers = entryHelpers(source)
  for (const [path, expected] of paths) {
    check(`${consumer.component} parent path ${JSON.stringify(path)}`, () => assert.equal(helpers.parentPath(path), expected))
  }
  for (const [value, expected] of images) {
    check(`${consumer.component} image classification ${JSON.stringify(value)}`, () => assert.equal(helpers.isImage(value), expected))
  }
  check(`${consumer.component} retains its existing 1 MiB label`, () => {
    const declaration = localFunction(source, 'sizeLabel')
    assert.ok(declaration, 'sizeLabel stays local in this batch')
    const { sizeLabel } = evaluate(declaration.getText(source) + '\nmodule.exports = { sizeLabel }', consumer.path)
    assert.equal(sizeLabel(1024 * 1024), consumer.sizeAtMiB)
  })
}

check('shared module exports executable parentPath and isImage', () => {
  assert.ok(existsSync(new URL('../' + sharedPath, import.meta.url)), 'shared entryUtils.ts has not been created')
  const helpers = evaluate(sourceFile(sharedPath).text, sharedPath)
  assert.equal(typeof helpers.parentPath, 'function')
  assert.equal(typeof helpers.isImage, 'function')
})

// Execute each complete TSX component with a minimal hook/JSX host. Only the platform and render
// environment are substituted: utility spies delegate to the real functions characterised above.
// Calling the rendered back button proves the import is used by a real navigation callback.
function renderConsumer(consumer) {
  const calls = { paths: [], images: [], state: [] }
  const source = sourceFile(consumer.path)
  const helpers = entryHelpers(source)
  const storage = { id: 'storage-test', name: 'Test', providerKey: 'r2', category: 'object', detail: '' }
  const entries = [entry('photo.PNG'), entry('notes.txt'), entry('folder.png', { isDir: true })]
  const gallery = consumer.component === 'GalleryPage'
  const stateOverrides = gallery ? { 0: storage.id, 1: 'photos/2026', 3: 'list' } : { 0: 'photos/2026', 2: 'list' }
  let stateIndex = 0
  const element = (type, props) => ({ type, props: props ?? {} })
  const dependencies = {
    react: {
      useState(initial) {
        const index = stateIndex++
        const value = Object.hasOwn(stateOverrides, index) ? stateOverrides[index] : typeof initial === 'function' ? initial() : initial
        return [value, (next) => calls.state.push({ index, value: typeof next === 'function' ? next(value) : next })]
      },
      useMemo: (run) => run(),
      useEffect() {},
    },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    '@tanstack/react-query': {
      useQuery: ({ queryKey }) => ({ data: queryKey[0] === 'storages' ? [storage] : entries, refetch() {} }),
      useQueryClient: () => ({}),
    },
    '../components/PageHeader': { PageHeader: 'PageHeader' },
    '../components/PageLayout': { PageLayout: 'PageLayout' },
    '../components/GalleryMediaCard': { GalleryMediaCard: 'GalleryMediaCard' },
    '../lib/desktop': {},
    '../features/tasks/queryKeys': evaluate(sourceFile('apps/desktop/src/features/tasks/queryKeys.ts').text, 'apps/desktop/src/features/tasks/queryKeys.ts'),
    '../features/assets/queryKeys': existsSync(new URL('../apps/desktop/src/features/assets/queryKeys.ts', import.meta.url))
      ? evaluate(sourceFile('apps/desktop/src/features/assets/queryKeys.ts').text, 'apps/desktop/src/features/assets/queryKeys.ts')
      : {},
    '../store/useToastStore': {},
    '../store/useConfirmStore': {},
    '../lib/useCloudImagePreview': {
      isPrivateS3Storage: () => false,
      canPreviewCloudImage: () => true,
      useCloudImagePreview: () => ({ preview: null, closePreview() {} }),
    },
    '../features/cloud-browser/entryUtils': {
      parentPath(path) { calls.paths.push(path); return helpers.parentPath(path) },
      isImage(value) { calls.images.push(value); return helpers.isImage(value) },
    },
  }
  const module = evaluate(source.text, consumer.path, (specifier) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected component dependency: ${specifier}`)
    return dependencies[specifier]
  })
  return { tree: module[consumer.component]({ storage, onClose() {} }), calls, entries }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}

for (const consumer of consumers) {
  check(`${consumer.component} renders entries through shared isImage`, () => {
    const { calls, entries } = renderConsumer(consumer)
    for (const value of entries) {
      assert.ok(calls.images.includes(value), `${consumer.component} must execute imported isImage for ${value.name}`)
    }
  })
  check(`${consumer.component} navigates through shared parentPath`, () => {
    const { tree, calls } = renderConsumer(consumer)
    const buttons = nodes(tree).filter((node) => node.type === 'button' && nodes(node.props.children).some((child) => child.type === 'ChevronLeft'))
    assert.equal(buttons.length, 1, 'exactly one back button must be rendered')
    assert.equal(buttons[0].props.disabled, false)
    buttons[0].props.onClick()
    assert.deepEqual(calls.paths, ['photos/2026'], 'the back button must execute imported parentPath')
    assert.ok(calls.state.some((change) => change.value === 'photos'), 'navigation receives the real parent path')
  })
}

for (const failure of failures) console.error('CLOUD_BROWSER_UTILS FAIL ' + failure)
console.log(`CLOUD_BROWSER_UTILS checks=${checks} failed=${failures.length}`)
if (failures.length) process.exitCode = 1
