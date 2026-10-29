import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('typescript')
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const code = ts.transpileModule(readFileSync(new URL('../apps/desktop/src/lib/theme.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup(saved, localImage = null, quota = false) {
  const values = new Map(), root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } }
  const module = { exports: {} }
  const storage = new Map([['image-hosting-platform.appearance-v1', saved === undefined ? null : JSON.stringify(saved)], ['image-hosting-platform.wallpaper-v1', localImage]])
  new Function('module', 'exports', 'window', 'document', code)(module, module.exports, { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (quota) throw Error('quota'); storage.set(key, value) }, removeItem: (key) => storage.delete(key) } }, { documentElement: root })
  return { ...module.exports, values, root, storage }
}
let failed = 0, checks = 0
function check(name, fn) { checks++; try { fn(); console.log(`ANIME_THEME PASS ${name}`) } catch (e) { failed++; console.error(`ANIME_THEME FAIL ${name}: ${e.message}`) } }
check('first run selects sakura and the packaged sky', () => { const t = setup(); const p = t.loadThemePreferences(); assert.equal(p.theme, 'sakura'); assert.equal(p.wallpaper, 'preset:day'); t.applyThemePreferences(p); assert.match(t.values.get('--wallpaper'), /\/art\/sky-day\.png/); })
check('saved themes and an explicit empty wallpaper remain unchanged', () => { const t = setup({ theme: 'midnight', wallpaper: '' }); const p = t.loadThemePreferences(); assert.equal(p.theme, 'midnight'); assert.equal(p.wallpaper, ''); t.applyThemePreferences(p); assert.equal(t.values.get('--wallpaper'), 'none'); })
check('all packaged presets resolve to the controlled art directory', () => { const t = setup(); assert.equal(t.WALLPAPER_PRESETS.length, 3); for (const p of t.WALLPAPER_PRESETS) { t.applyThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, wallpaper: p.value }); assert.match(t.values.get('--wallpaper'), /^url\("\/art\/sky-(day|sunset|night)\.png"\)$/); } })
check('custom HTTPS wallpaper is preserved', () => { const t = setup({ wallpaper: 'https://example.com/image.jpg?x=1' }); t.applyThemePreferences(t.loadThemePreferences()); assert.equal(t.values.get('--wallpaper'), 'url("https://example.com/image.jpg?x=1")'); })
check('unknown presets and local/script paths never enter CSS', () => { const t = setup(); for (const wallpaper of ['preset:../secret', '/art/other.png', 'file:///private', 'javascript:alert(1)', 'data:image/png;base64,123']) { t.applyThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, wallpaper }); assert.equal(t.values.get('--wallpaper'), 'none'); assert.equal(t.root.dataset.wallpaper, undefined); } })
check('existing partial saved preferences do not acquire a new wallpaper', () => { const t = setup({ theme: 'mist', accent: '#123456' }); const p = t.loadThemePreferences(); assert.equal(p.theme, 'mist'); assert.equal(p.accent, '#123456'); assert.equal(p.wallpaper, ''); })
check('local wallpaper resolves only through the isolated local record', () => { const jpeg = 'data:image/jpeg;base64,/9j/AAAA'; const t = setup(undefined, jpeg); assert.equal(t.safeWallpaperUrl('local:wallpaper'), jpeg); assert.equal(t.safeWallpaperUrl(jpeg), null); })
check('corrupt, oversized or missing local wallpaper falls back without throwing', () => { for (const image of [null, 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,invalid!', 'data:image/jpeg;base64,' + 'A'.repeat(1_200_001)]) assert.equal(setup(undefined, image).safeWallpaperUrl('local:wallpaper'), null); })
check('failed local storage preserves the previous wallpaper', () => { const t = setup(undefined, 'data:image/jpeg;base64,/9j/AAAA', true); assert.throws(() => t.storeLocalWallpaper('data:image/jpeg;base64,/9j/BBBB')); assert.equal(t.safeWallpaperUrl('local:wallpaper'), 'data:image/jpeg;base64,/9j/AAAA'); })
check('clear removes only the personal image', () => { const t = setup({ theme: 'midnight' }, 'data:image/jpeg;base64,/9j/AAAA'); t.clearLocalWallpaper(); assert.equal(t.safeWallpaperUrl('local:wallpaper'), null); assert.equal(t.loadThemePreferences().theme, 'midnight'); })
check('old preferences gain default background strength without replacing their wallpaper or glass', () => { const t = setup({ theme: 'mist', wallpaper: 'preset:night', glass: 72 }); const p = t.loadThemePreferences(); assert.equal(p.wallpaperStrength, 100); assert.equal(p.glass, 72); assert.equal(p.wallpaper, 'preset:night'); })
check('background strength and panel opacity write independent CSS values', () => { const t = setup(); for (const wallpaperStrength of [0, 37, 100]) { t.applyThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, wallpaperStrength, glass: 60 }); assert.equal(t.values.get('--wallpaper-strength'), `${wallpaperStrength}%`); assert.equal(t.values.get('--glass-strength'), '60%'); } })
check('appearance strengths persist and reload independently', () => { const t = setup(); t.persistThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, wallpaperStrength: 23, glass: 81 }); const p = t.loadThemePreferences(); assert.equal(p.wallpaperStrength, 23); assert.equal(p.glass, 81); assert.equal(p.wallpaper, 'preset:day'); })
check('out of range strength clamps, invalid runtime values fall back without invalid CSS', () => { const t = setup(); for (const [wallpaperStrength, expected] of [[-1, 0], [150, 100], [NaN, 100], [Infinity, 100], [undefined, 100]]) { t.applyThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, wallpaperStrength }); assert.equal(t.values.get('--wallpaper-strength'), `${expected}%`); } t.applyThemePreferences({ ...t.DEFAULT_THEME_PREFERENCES, glass: NaN, blur: Infinity }); assert.equal(t.values.get('--glass-strength'), '88%'); assert.equal(t.values.get('--backdrop-blur'), '18px'); })
function panelRanges(value, onChange) {
  const react = requireDesktop('react')
  const code = ts.transpileModule(readFileSync(new URL('../apps/desktop/src/components/ThemePanel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  const dep = (name) => name === 'react' ? { ...react, useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {} } : name === '../lib/theme' ? setup() : name === '../lib/wallpaperImport' ? {} : requireDesktop(name)
  new Function('require', 'module', 'exports', code)(dep, module, module.exports)
  const inputs = []
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === 'input' && node.props.type === 'range') inputs.push(node.props); walk(node.props?.children) }
  walk(module.exports.ThemePanel({ value, onChange, onClose() {} }))
  return Object.fromEntries(inputs.map((p) => [p['aria-label'], p]))
}
check('real panel sliders expose independent values and callbacks in the correct direction', () => { const t = setup(); const value = { ...t.DEFAULT_THEME_PREFERENCES, wallpaperStrength: 36, glass: 74 }; let next; const ranges = panelRanges(value, (v) => { next = v; return true }); assert.equal(ranges['背景图片强度'].value, 36); assert.equal(ranges['面板透明度'].value, 26); ranges['面板透明度'].onChange({ target: { value: '55' } }); assert.equal(next.glass, 45); assert.equal(next.wallpaperStrength, 36); ranges['背景图片强度'].onChange({ target: { value: '0' } }); assert.equal(next.wallpaperStrength, 0); assert.equal(next.glass, 74); })
check('missing wallpaper disables only image strength, leaving panel transparency available', () => { const ranges = panelRanges({ ...setup().DEFAULT_THEME_PREFERENCES, wallpaper: '' }, () => true); assert.equal(ranges['背景图片强度'].disabled, true); assert.notEqual(ranges['面板透明度'].disabled, true); })
console.log(`ANIME_THEME_GATE checks=${checks} failed=${failed}`)
if (failed) process.exitCode = 1
