import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const root = fileURLToPath(new URL('../website/src/data/', import.meta.url))
const cache = new Map()
function load(path) {
  path = resolve(path)
  assert.ok(path.startsWith(root), 'guide imports stay in the data directory')
  if (cache.has(path)) return cache.get(path)
  const module = { exports: {} }
  cache.set(path, module.exports)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name.startsWith('./'), 'guide data has no runtime package dependencies')
    return load(resolve(dirname(path), name + '.ts'))
  }, module, module.exports)
  return module.exports
}
const { providerGuides } = load(resolve(root, 'providerGuides.ts'))
assert.deepEqual(Object.keys(providerGuides), ['github', 'gitee', 'r2', 'oss', 'cos', 's3', 'webdav'])
let fields = 0
for (const guide of Object.values(providerGuides)) {
  assert.ok(guide.title && guide.prepare)
  assert.ok(guide.links.length && guide.fields.length)
  assert.equal(new Set(guide.fields.map((field) => field.label)).size, guide.fields.length)
  for (const link of guide.links) {
    assert.ok(link.label.trim())
    assert.equal(new URL(link.href).protocol, 'https:')
  }
  for (const field of guide.fields) {
    for (const key of ['label', 'requirement', 'source', 'path', 'fill', 'example', 'mistake']) {
      assert.equal(typeof field[key], 'string')
      assert.ok(field[key].trim(), `${guide.title}: missing ${key}`)
    }
    if (field.href) assert.equal(new URL(field.href).protocol, 'https:')
    fields++
  }
}
assert.equal(fields, 52, 'all desktop configuration fields keep their instructions')
console.log(`PROVIDER_GUIDES providers=7 fields=${fields} failed=0 canonicalSha256=${createHash('sha256').update(JSON.stringify(providerGuides)).digest('hex')}`)
