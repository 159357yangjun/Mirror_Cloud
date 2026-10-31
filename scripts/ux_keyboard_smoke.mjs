// Main-only Windows Edge CDP keyboard and DPR acceptance; no Tauri backend or cloud access.
// DPR is CDP-emulated, not Windows system DPI / native Tauri G3.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const out = process.argv[2] || join(tmpdir(), 'mirror-cloud-ux-keyboard')
mkdirSync(out, { recursive: true })
const edge = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync)
if (!edge) throw new Error('No Edge/Chrome binary found; the keyboard gate was NOT run')
const origin = 'http://127.0.0.1:1420/'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function port() {
  const srv = createServer()
  await new Promise((resolve, reject) => { srv.on('error', reject); srv.listen(0, '127.0.0.1', resolve) })
  const p = srv.address().port
  await new Promise((resolve) => srv.close(resolve))
  return p
}
const p = await port()
const profile = mkdtempSync(join(tmpdir(), 'mirror-ux-cdp-'))
let browser
let socket
let nextId = 1
const pending = new Map()
const results = []
const check = (name, ok, found) => {
  results.push({ name, passed: Boolean(ok), observed: found })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ': ' + JSON.stringify(found))
}
function call(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJS(source) {
  const response = await call('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true, userGesture: true })
  if (response.exceptionDetails) throw new Error('Page evaluation failed: ' + JSON.stringify(response.exceptionDetails).slice(0, 500))
  return response.result.value
}
async function waitFor(expr, label, retries = 50) {
  for (let i = 0; i < retries; i++) {
    if (await evalJS(expr)) return
    await sleep(150)
  }
  throw new Error(label + ': timed out')
}
async function pressTab(shift = false) {
  const params = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }
  await call('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  await sleep(100)
}
async function pressEscape() {
  const params = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
  await call('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
  await call('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  await sleep(150)
}
try {
  browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + p,
    '--user-data-dir=' + profile, '--window-size=1280,800', origin,
  ], { stdio: 'ignore', windowsHide: true })
  let page
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + p + '/json/list')
      const pages = await response.json()
      page = pages.find((t) => t.type === 'page' && t.url.startsWith(origin))
      if (page) break
    } catch {}
    await sleep(250)
  }
  if (!page) throw new Error('No project page in spawned Edge; cannot attest keyboard behavior')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (!pending.has(msg.id)) return
    const item = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) item.reject(new Error(msg.error.message))
    else item.resolve(msg.result)
  }
  await call('Runtime.enable')
  await waitFor("document.querySelectorAll('nav button').length > 0", 'App mount')
  await evalJS("(()=>{const b=document.querySelector('button[aria-label=\"关闭教程\"]');if(b)b.click();window.__keyboardEvents=[];window.addEventListener('keydown',e=>window.__keyboardEvents.push({key:e.key,trusted:e.isTrusted,shift:e.shiftKey}));return true})()")
  await sleep(170)

  // Upload: keyboard may only reach live controls inside the dialog; Escape
  // cancels only when closeDialog's original pending-task guard allows it.
  const opened = await evalJS("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').includes('快速发布'));if(!b)return false;b.focus();b.click();return true})()")
  check('upload trigger is reachable', opened, opened)
  await waitFor("Boolean(document.querySelector('section[role=\"dialog\"][aria-labelledby=\"upload-dialog-title\"]'))", 'Upload dialog open')
  const uploadSnapshot = "()=>{const d=document.querySelector('section[role=\"dialog\"][aria-labelledby=\"upload-dialog-title\"]');const list=Array.from(d.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])')).filter(x=>x.getClientRects().length>0);return {present:!!d,initialInside:d.contains(document.activeElement),isContainer:document.activeElement===d,count:list.length,first:list[0]?.textContent?.trim()||list[0]?.getAttribute('aria-label'),last:list.at(-1)?.textContent?.trim(),activeIndex:list.indexOf(document.activeElement)}}"
  const initialUpload = await evalJS('(' + uploadSnapshot + ')()')
  check('upload starts focused inside dialog', initialUpload.initialInside && initialUpload.isContainer, initialUpload)
  await pressTab(false)
  const uploadTab = await evalJS('(' + uploadSnapshot + ')()')
  check('upload initial Tab selects first control', uploadTab.activeIndex === 0, uploadTab)
  await pressTab(true)
  const uploadShiftTab = await evalJS('(' + uploadSnapshot + ')()')
  check('upload Shift+Tab wraps to last control', uploadShiftTab.activeIndex === uploadShiftTab.count - 1, uploadShiftTab)
  await pressTab(false)
  const uploadWrap = await evalJS('(' + uploadSnapshot + ')()')
  check('upload Tab wraps back to first control', uploadWrap.activeIndex === 0, uploadWrap)
  await pressEscape()
  const uploadClose = await evalJS("(()=>({dialogGone:!document.querySelector('section[role=\"dialog\"][aria-labelledby=\"upload-dialog-title\"]'),restored:(document.activeElement?.textContent||'').includes('快速发布')}))()")
  check('upload Escape closes and restores triggering focus', uploadClose.dialogGone && uploadClose.restored, uploadClose)

  // Confirmation: no destructive action is executed. Escape must cancel.
  const settingOpened = await evalJS("(()=>{const b=Array.from(document.querySelectorAll('nav button')).find(x=>(x.textContent||'').trim()==='设置');if(!b)return false;b.click();return true})()")
  check('settings tab is reachable', settingOpened, settingOpened)
  await waitFor("Array.from(document.querySelectorAll('main button')).some(b=>(b.textContent||'').includes('重置 Token'))", 'Settings reset button')
  const confirmOpened = await evalJS("(()=>{const b=Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').includes('重置 Token'));if(!b||b.disabled)return false;b.focus();b.click();return true})()")
  check('confirmation trigger is reachable', confirmOpened, confirmOpened)
  await waitFor("Boolean(document.querySelector('section[role=\"dialog\"][aria-labelledby=\"confirm-dialog-title\"]'))", 'Confirmation dialog open')
  const confirmSnapshot = "()=>{const d=document.querySelector('section[role=\"dialog\"][aria-labelledby=\"confirm-dialog-title\"]');const controls=Array.from(d.querySelectorAll('button:not([disabled])')).filter(b=>b.getClientRects().length>0);return {present:!!d,count:controls.length,activeIndex:controls.indexOf(document.activeElement),activeText:document.activeElement?.textContent?.trim(),labels:controls.map(b=>b.textContent?.trim()||b.getAttribute('aria-label'))}}"
  const initialConfirm = await evalJS('(' + confirmSnapshot + ')()')
  check('confirmation begins on Cancel, not destructive Confirm', initialConfirm.count === 3 && initialConfirm.activeIndex === 1 && initialConfirm.activeText === '取消', initialConfirm)
  await pressTab(false)
  const confirmNext = await evalJS('(' + confirmSnapshot + ')()')
  check('confirmation first Tab enters final button', confirmNext.activeIndex === 2, confirmNext)
  await pressTab(false)
  const confirmWrap = await evalJS('(' + confirmSnapshot + ')()')
  check('confirmation last Tab wraps to close button', confirmWrap.activeIndex === 0, confirmWrap)
  await pressTab(true)
  const confirmReverse = await evalJS('(' + confirmSnapshot + ')()')
  check('confirmation Shift+Tab wraps to last button', confirmReverse.activeIndex === 2, confirmReverse)
  await pressEscape()
  const confirmCancel = await evalJS("(()=>({gone:!document.querySelector('section[role=\"dialog\"][aria-labelledby=\"confirm-dialog-title\"]'),restored:(document.activeElement?.textContent||'').includes('重置 Token')}))()")
  check('confirmation Escape cancels and restores previous focus', confirmCancel.gone && confirmCancel.restored, confirmCancel)
  const trusted = await evalJS("window.__keyboardEvents.filter(e=>['Tab','Escape'].includes(e.key))")
  check('CDP key events were trusted browser inputs', trusted.length >= 7 && trusted.every((e)=>e.trusted), trusted)

  // Device-scale emulation (not a real Windows OS DPI test). The effective DPR
  // must be observed, never inferred from a successful CDP command response.
  for (const scale of [1.25, 1.5]) {
    for (const size of [[640,480], [1024,768]]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width: size[0], height: size[1], deviceScaleFactor: scale, mobile: false,
      })
      await waitFor('window.innerWidth === ' + size[0] + ' && Math.abs(window.devicePixelRatio - ' + scale + ') < .02', 'DPR override ' + scale)
      const pages = ['发布','资源','云端','图库','插件','任务','设置']
      for (const label of pages) {
        const activated = await evalJS("(()=>{const b=Array.from(document.querySelectorAll('nav button')).find(x=>(x.getAttribute('title')||'')===" + JSON.stringify(label) + ");if(!b)return false;b.click();return true})()")
        if (!activated) { check('DPR '+scale+' '+label+' navigation', false, 'navigation button absent'); continue }
        await sleep(150)
        const geom = await evalJS("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,body:document.documentElement.scrollWidth,nav:document.querySelector('nav[aria-label=\"主要页面\"]')?.getBoundingClientRect().width})")
        check('DPR ' + scale + ' ' + size.join('x') + ' ' + label,
          geom.width === size[0] && geom.height === size[1] &&
          Math.abs(geom.dpr - scale) < .02 && geom.body <= geom.width + 1 && geom.nav > 0, geom)
      }
    }
  }
  await call('Emulation.clearDeviceMetricsOverride')

  // Use the same image the user explicitly authorized for the public website.
  // It already exists in this checkout; private local MP4s are never uploaded.
  // Exercise the real file input and import pipeline, not localStorage or CSS injection.
  const wallpaperFile = fileURLToPath(new URL('../website/src/assets/art/user-wallpaper.jpg', import.meta.url))
  if (!existsSync(wallpaperFile)) throw new Error('The authorized wallpaper is missing from the checkout')
  const skinPoint = await evalJS(`(() => {
    const button = document.querySelector('button[aria-label^="打开皮肤设置"]');
    if (!button || !button.closest('aside.app-sidebar')) throw new Error('Missing sidebar appearance control');
    const main = document.querySelector('#mirror-main');
    const mainOffset = main.scrollTop;
    button.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'instant' });
    if (main.scrollTop !== mainOffset) throw new Error('Revealing appearance control changed work-area scrolling');
    const box = button.getBoundingClientRect();
    if (box.top < 0 || box.bottom > innerHeight || box.width <= 0 || box.height <= 0) throw new Error('Appearance control is outside the viewport');
    return { x:box.left + box.width / 2, y:box.top + box.height / 2 };
  })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await call('Input.dispatchMouseEvent', { type, button:'left', clickCount:1, ...skinPoint })
  }
  await waitFor(`Boolean(document.querySelector('input[aria-label="导入本机壁纸"]'))`, 'Appearance file input')
  await call('DOM.enable')
  const { root:wallpaperDocument } = await call('DOM.getDocument')
  const { nodeId:wallpaperInput } = await call('DOM.querySelector', { nodeId:wallpaperDocument.nodeId, selector:'input[aria-label="导入本机壁纸"]' })
  if (!wallpaperInput) throw new Error('The appearance file input has no CDP node')
  await call('DOM.setFileInputFiles', { nodeId:wallpaperInput, files:[wallpaperFile] })
  await waitFor(`(() => {
    const input = document.querySelector('input[aria-label="导入本机壁纸"]');
    return input && !input.disabled && document.documentElement.dataset.wallpaper === 'true' && getComputedStyle(document.documentElement).getPropertyValue('--wallpaper').includes('data:image/jpeg;base64,');
  })()`, 'Real JPG wallpaper import')
  const importedWallpaper = await evalJS(`(() => {
    const input = document.querySelector('input[aria-label="导入本机壁纸"]');
    const panel = input.closest('aside');
    return { finished:!input.disabled, active:document.documentElement.dataset.wallpaper === 'true', jpeg:getComputedStyle(document.querySelector('.app-shell-root')).backgroundImage.includes('data:image/jpeg;base64,'), error:panel.querySelector('[role="alert"]')?.textContent?.trim() || null };
  })()`)
  check('authorized JPG imports through the real appearance file input', importedWallpaper.finished && importedWallpaper.active && importedWallpaper.jpeg && importedWallpaper.error === null, importedWallpaper)

  // Operate the preset and sliders through trusted browser input. The test may
  // reveal controls inside the appearance scroller, but never moves main or
  // injects saved appearance values / CSS to manufacture the glass result.
  const clickAppearanceControl = async (selector) => {
    const point = await evalJS(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control || control.disabled) throw new Error('Missing or disabled appearance control');
      const main = document.querySelector('#mirror-main');
      const mainOffset = main.scrollTop;
      control.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'instant' });
      if (main.scrollTop !== mainOffset) throw new Error('Revealing appearance control moved the work area');
      const box = control.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight || box.width <= 0 || box.height <= 0) throw new Error('Appearance control is outside the viewport');
      const point = { x:box.left + box.width / 2, y:box.top + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== control && !control.contains(hit)) throw new Error('Appearance control is covered');
      return point;
    })()`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await call('Input.dispatchMouseEvent', { type, button:'left', clickCount:1, ...point })
    }
  }
  const appearanceState = async () => evalJS(`(() => {
    const style = getComputedStyle(document.documentElement);
    return { theme:document.documentElement.dataset.theme,
      glass:parseFloat(style.getPropertyValue('--glass-strength')),
      blur:parseFloat(style.getPropertyValue('--backdrop-blur')),
      wallpaperStrength:parseFloat(style.getPropertyValue('--wallpaper-strength')),
      activeControl:document.activeElement?.getAttribute('aria-label'),
      trustedEnd:window.__keyboardEvents.filter((event) => event.key === 'End').at(-1)?.trusted === true,
      trustedHome:window.__keyboardEvents.filter((event) => event.key === 'Home').at(-1)?.trusted === true,
      jpeg:getComputedStyle(document.querySelector('.app-shell-root')).backgroundImage.includes('data:image/jpeg;base64,') };
  })()`)
  const appearanceBeforePreset = await appearanceState()
  await clickAppearanceControl('button[aria-label="应用通透磨砂"]')
  await waitFor(`document.documentElement.dataset.theme === 'midnight' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-strength')) === 18 && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur')) === 10`, 'Translucent glass preset')
  const presetAppearance = await appearanceState()
  check('glass preset uses midnight with 82 percent transparency and 10px blur',
    presetAppearance.theme === 'midnight' && presetAppearance.glass === 18 && presetAppearance.blur === 10 && presetAppearance.jpeg && presetAppearance.wallpaperStrength === appearanceBeforePreset.wallpaperStrength,
    presetAppearance)

  // A highly translucent dark preset must not leave dark-on-wallpaper text
  // when the user returns to a light theme. Keep the imported image selected.
  await clickAppearanceControl('button[title="清爽浅色，适合长时间管理图片"]')
  await waitFor(`!document.documentElement.dataset.theme && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-strength')) === 88`, 'Readable light theme after glass preset')
  const lightAppearance = await appearanceState()
  check('switching translucent midnight to mist restores a readable light surface without losing the wallpaper',
    lightAppearance.theme === undefined && lightAppearance.glass === 88 && lightAppearance.jpeg && lightAppearance.wallpaperStrength === appearanceBeforePreset.wallpaperStrength, lightAppearance)
  await clickAppearanceControl('button[aria-label="应用通透磨砂"]')
  await waitFor(`document.documentElement.dataset.theme === 'midnight' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-strength')) === 18 && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur')) === 10`, 'Restore glass preset after light theme')

  await clickAppearanceControl('input[aria-label="面板透明度"]')
  for (const type of ['rawKeyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', { type, key:'End', code:'End', windowsVirtualKeyCode:35, nativeVirtualKeyCode:35 })
  }
  await waitFor(`document.querySelector('input[aria-label="面板透明度"]')?.value === '90' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-strength')) === 10`, 'Maximum panel transparency')
  const maximumTransparency = await appearanceState()
  check('panel transparency accepts 90 percent through a trusted End key', maximumTransparency.glass === 10 && maximumTransparency.jpeg && maximumTransparency.activeControl === '面板透明度' && maximumTransparency.trustedEnd, maximumTransparency)

  await clickAppearanceControl('input[aria-label="毛玻璃模糊"]')
  for (const type of ['rawKeyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', { type, key:'Home', code:'Home', windowsVirtualKeyCode:36, nativeVirtualKeyCode:36 })
  }
  await waitFor(`document.querySelector('input[aria-label="毛玻璃模糊"]')?.value === '0' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur')) === 0`, 'Clear glass background')
  const clearGlass = await appearanceState()
  check('background blur reaches zero through a trusted Home key', clearGlass.blur === 0 && clearGlass.glass === 10 && clearGlass.jpeg && clearGlass.activeControl === '毛玻璃模糊' && clearGlass.trustedHome, clearGlass)

  await clickAppearanceControl('button[aria-label="应用通透磨砂"]')
  await waitFor(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-strength')) === 18 && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur')) === 10`, 'Restore glass preset after slider input')
  const restoredAppearance = await appearanceState()
  check('glass preset restores both sliders while retaining the imported wallpaper', restoredAppearance.theme === 'midnight' && restoredAppearance.glass === 18 && restoredAppearance.blur === 10 && restoredAppearance.jpeg && restoredAppearance.wallpaperStrength === appearanceBeforePreset.wallpaperStrength, restoredAppearance)
  const closeSkinPoint = await evalJS(`(() => {
    const button = document.querySelector('button[aria-label="关闭皮肤设置"]');
    if (!button) throw new Error('Missing appearance close control');
    const box = button.getBoundingClientRect();
    return { x:box.left + box.width / 2, y:box.top + box.height / 2 };
  })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await call('Input.dispatchMouseEvent', { type, button:'left', clickCount:1, ...closeSkinPoint })
  }
  await waitFor(`!document.querySelector('input[aria-label="导入本机壁纸"]')`, 'Appearance closes after import')
  const closedWallpaper = await evalJS(`({ panelClosed:!document.querySelector('button[aria-label="关闭皮肤设置"]'), jpeg:getComputedStyle(document.querySelector('.app-shell-root')).backgroundImage.includes('data:image/jpeg;base64,') })`)
  check('imported wallpaper remains rendered after closing appearance', closedWallpaper.panelClosed && closedWallpaper.jpeg, closedWallpaper)

  // Navigation must restore the work area's entry position. A generic clipping
  // sweep excuses content inside scroll rails as reachable; it cannot prove a
  // newly opened page actually starts with its heading visible.
  const navigateWorkspace = async (label) => {
    const point = await evalJS(`(() => {
      const button = [...document.querySelectorAll('nav[aria-label="主要页面"] button')].find((el) => el.title === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing workspace navigation');
      const rail = button.closest('aside.app-sidebar');
      if (!rail) throw new Error('Workspace navigation is not inside the sidebar rail');
      const main = document.querySelector('#mirror-main');
      const mainOffset = main.scrollTop;
      // The minimum-height rail can scroll. Reveal its button without moving
      // either the source work area or the destination page under test.
      button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      if (main.scrollTop !== mainOffset) throw new Error('Revealing sidebar navigation changed the work-area scroll offset');
      const box = button.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight || box.width <= 0 || box.height <= 0) throw new Error('Workspace navigation is outside the viewport');
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await call('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point })
    }
    await waitFor(`document.querySelector('.page-header h1')?.textContent?.trim() === ${JSON.stringify(label)}`, label + ' page heading')
    await sleep(150)
  }
  await call('Page.enable')
  for (const [width, height] of [[640, 480], [1024, 768], [1440, 900], [1920, 1080]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await waitFor(`innerWidth === ${width} && innerHeight === ${height}`, 'Workspace viewport ' + width)
    await navigateWorkspace('设置')
    // Only the page being LEFT is scrolled. Never scroll the destination to
    // manufacture a passing header position.
    const leftPage = await evalJS(`(() => {
      const main = document.querySelector('#mirror-main');
      const maximum = main.scrollHeight - main.clientHeight;
      main.scrollTo({ top: Math.min(300, maximum), behavior: 'instant' });
      return { maximum, scrollTop: main.scrollTop };
    })()`)
    check('workspace ' + width + ' source settings really scrolls', leftPage.maximum > 0 && leftPage.scrollTop > 0, leftPage)
    await navigateWorkspace('发布')
    const workspace = await evalJS(`(() => {
      const main = document.querySelector('#mirror-main');
      const layout = main.querySelector('.page-layout');
      const header = main.querySelector('.page-header');
      const title = header?.querySelector('h1');
      const rect = (el) => { const r = el.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      const area = rect(main);
      const alphaCanvas = document.createElement('canvas');
      alphaCanvas.width = alphaCanvas.height = 1;
      const context = alphaCanvas.getContext('2d', { willReadFrequently: true });
      const alpha = (color) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3] / 255; };
      const candidates = new Set([main, main.querySelector('.app-page-surface'), layout, ...main.querySelectorAll('*')].filter(Boolean));
      const backgrounds = [];
      for (const el of candidates) {
        const style = getComputedStyle(el);
        if (el !== main && el !== layout && !el.classList.contains('app-page-surface') && style.position !== 'fixed') continue;
        const box = rect(el);
        const intersection = Math.max(0, Math.min(box.right, area.right) - Math.max(box.left, area.left)) * Math.max(0, Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top));
        const coverage = intersection / (area.width * area.height);
        const opacity = alpha(style.backgroundColor) * Number(style.opacity);
        if (coverage >= .8 && opacity > .5) backgrounds.push({ className:el.className, position:style.position, coverage, opacity, background:style.backgroundColor });
      }
      const shell = document.querySelector('.app-shell-root');
      const paintedWallpaper = getComputedStyle(shell).backgroundImage;
      const imageStart = paintedWallpaper.indexOf('data:image/jpeg;base64,');
      const wallpaperSummary = imageStart < 0 ? paintedWallpaper : paintedWallpaper.slice(0, imageStart) + 'data:image/jpeg;base64,[omitted])';
      const readingPanel = main.querySelector('.publish-drop-copy');
      const panelStyle = readingPanel && getComputedStyle(readingPanel);
      const glassPanel = panelStyle && { blur:panelStyle.backdropFilter || panelStyle.webkitBackdropFilter, opacity:alpha(panelStyle.backgroundColor), textFilter:getComputedStyle(readingPanel.querySelector('h2')).filter };
      const layoutAncestors = [main, main.querySelector('.app-page-surface'), layout].filter(Boolean).map((el) => {
        const style = getComputedStyle(el);
        return { className:el.className, filter:style.filter, backdropFilter:style.backdropFilter || style.webkitBackdropFilter, transform:style.transform };
      });
      return { scrollTop:main.scrollTop, main:area, layout:layout && rect(layout), header:header && rect(header), title:title && rect(title), rootWallpaper:document.documentElement.dataset.wallpaper, wallpaper:wallpaperSummary, localWallpaper:paintedWallpaper.includes('data:image/jpeg;base64,'), largeReadingBackgrounds:backgrounds, glassPanel, layoutAncestors, viewport:{ width:innerWidth, height:innerHeight } };
    })()`)
    check('workspace ' + width + ' page change resets main scroll', workspace.scrollTop === 0, workspace)
    check('workspace ' + width + ' publish heading starts fully visible',
      workspace.title && workspace.title.height > 0 && workspace.title.top >= workspace.main.top && workspace.title.bottom <= workspace.main.bottom,
      { main:workspace.main, title:workspace.title })
    check('workspace ' + width + ' page frame and header stay inside the work area',
      workspace.layout && workspace.header && workspace.layout.top >= workspace.main.top &&
      workspace.layout.left >= workspace.main.left - 1 && workspace.layout.right <= workspace.main.right + 1 &&
      workspace.header.left >= workspace.layout.left - 1 && workspace.header.right <= workspace.layout.right + 1 &&
      workspace.header.top >= workspace.main.top && workspace.header.bottom <= workspace.main.bottom,
      { main:workspace.main, layout:workspace.layout, header:workspace.header })
    check('workspace ' + width + ' wallpaper has no large stacked reading backdrop',
      workspace.rootWallpaper === 'true' && workspace.wallpaper.includes('url(') && workspace.localWallpaper && workspace.largeReadingBackgrounds.length === 0,
      { wallpaper:workspace.wallpaper, largeReadingBackgrounds:workspace.largeReadingBackgrounds })
    check('workspace ' + width + ' reading panel transmits the wallpaper through background-only blur',
      workspace.glassPanel && workspace.glassPanel.blur === 'blur(10px)' && workspace.glassPanel.opacity > 0 && workspace.glassPanel.opacity < .35 && workspace.glassPanel.textFilter === 'none', workspace.glassPanel)
    check('workspace ' + width + ' layout ancestors do not create filter or transform containing blocks',
      workspace.layoutAncestors.length === 3 && workspace.layoutAncestors.every((ancestor) => ancestor.filter === 'none' && ancestor.backdropFilter === 'none' && ancestor.transform === 'none'), workspace.layoutAncestors)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(out, 'ux-workspace-' + width + '.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await call('Emulation.clearDeviceMetricsOverride')
} catch (error) {
  check('browser test executed without harness failure', false, String(error.stack || error))
} finally {
  try { socket?.close() } catch {}
  try { browser?.kill() } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
  writeFileSync(join(out, 'ux-keyboard-report.json'), JSON.stringify({ checks: results.length, failed: results.filter(r=>!r.passed).length, results }, null, 2))
  const failed = results.filter(r=>!r.passed)
  console.log('UX_KEYBOARD_GATE checks=' + results.length + ' failed=' + failed.length)
  if (failed.length) process.exitCode = 1
}
