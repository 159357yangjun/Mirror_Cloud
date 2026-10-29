import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const code = ts.transpileModule(readFileSync(new URL('../apps/desktop/src/lib/videoWallpaper.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', code)(module, module.exports)
const { validateVideoFile, prepareVideoWallpaper, MAX_VIDEO_BYTES } = module.exports
let checks = 0
for (const file of [{ name: 'video.mp4', type: 'video/mp4', size: 30_249_196 }, { name: 'VIDEO.MP4', type: '', size: MAX_VIDEO_BYTES }]) {
  assert.doesNotThrow(() => validateVideoFile(file)); checks++
}
for (const file of [{ name: 'x.mp4', type: 'video/mp4', size: 0 }, { name: 'x.mp4', type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 }, { name: 'x.mp4', type: 'text/html', size: 100 }, { name: 'x.webm', type: 'video/webm', size: 100 }, { name: 'x', type: '', size: 100 }]) {
  assert.throws(() => validateVideoFile(file)); checks++
  // Invalid inputs must fail before any browser decoder, blob URL or storage is touched.
  await assert.rejects(() => prepareVideoWallpaper(file)); checks++
}
// Simulate metadata followed by a decoder error: metadata alone must never authorize replacement.
const valid = new Blob(['test-frame-events'], { type: 'video/mp4' })
Object.defineProperty(valid, 'name', { value: 'test.mp4' })
let revoked = 0, detached = 0
const decoder = { videoWidth: 1920, videoHeight: 1080, duration: 20, removeAttribute() { detached++ }, load() {}, set src(_) { queueMicrotask(() => { this.onloadedmetadata?.(); queueMicrotask(() => this.onerror?.()) }) } }
const boundary = { exports: {} }
new Function('module', 'exports', 'window', 'document', 'URL', code)(boundary, boundary.exports,
  { setTimeout, clearTimeout }, { createElement: () => decoder }, { createObjectURL: () => 'blob:test-only', revokeObjectURL: () => { revoked++ } })
await assert.rejects(() => boundary.exports.prepareVideoWallpaper(valid), /无法解码/); checks++
assert.equal(revoked, 1); assert.equal(detached, 1); checks++
console.log(`VIDEO_WALLPAPER_GATE checks=${checks} failed=0 (boundaries and decoder event order; real MP4 decoding/persistence use the browser)`)
