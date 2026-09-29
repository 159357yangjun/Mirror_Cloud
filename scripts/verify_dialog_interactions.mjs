/**
 * ConfirmDialog / external-link interaction harness.
 *
 * This is the measurement tool behind two fixes: 534cc15 (unbreakable filenames overflowing the
 * confirm card) and a561161 (external links failing silently). It drives a locally installed
 * Chromium-family browser headless over CDP, so React sees trusted input events - the only way to
 * observe what a backdrop `onMouseDown`, an Escape keypress or an initial focus really does.
 * It builds nothing, packages nothing, and needs no Rust toolchain.
 *
 *   1. start the frontend only:  cd apps/desktop && npm run dev
 *   2. run a mode:               node scripts/verify_dialog_interactions.mjs gate
 *
 * Modes
 *   confirm  the five dialog behaviours: initial focus, Escape, backdrop, long text, z-index
 *   ab       the same dialog with overflow-wrap toggled, for a paired before/after reading
 *   gate     self-test proving the viewport gate really rejects a hidden window (live browser)
 *   gate-unit gate predicate exercised against the recorded readings, incl. innerWidth 0 (no browser)
 *   links    what each docs entry point shows, for whatever VITE_DOCS_BASE_URL the server has
 *   pages    visit every route in a plain browser and report whether anything crashes
 *   external the red/green pair: discarding the open promise vs reporting it, plus the primitive's
 *            rejection behaviour for a malformed value and a non-http scheme
 *
 * Options
 *   --out DIR   default %TEMP%/image-hosting-probes/<date>; screenshots and JSON land there, never
 *               inside the repository
 *   --app URL   dev server origin, default http://127.0.0.1:1420/
 *   --edge PATH browser binary, default: first existing of Edge (x86), Edge, Chrome
 *   --tag NAME  filename suffix for reports
 *   --port N    CDP port, default 9333
 *
 * No third-party imports: node:child_process and node:fs, plus the fetch / WebSocket globals that
 * Node 22+ ships. Requires Node >= 22 for the global WebSocket.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const MODE = argv[0] && !argv[0].startsWith('--') ? argv[0] : ''
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
if (!MODE || MODE === 'help') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  console.log(`modes: confirm | ab | gate | gate-unit | links | pages | external`)
  process.exit(MODE === 'help' ? 0 : 2)
}

// Forward slashes only: a Windows path with backslashes reaching child_process.spawn through a
// shell has a habit of arriving as "C:Program Files (x86)MicrosoftEdge...".
const CANDIDATES = [
  opt('edge', ''),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)
const BROWSER = CANDIDATES.find((p) => existsSync(p))
if (!BROWSER) {
  console.error(`No local browser found. Tried:\n  ${CANDIDATES.join('\n  ')}\nPass --edge <path> to override.`)
  process.exit(3)
}

const PORT = Number(opt('port', '9333'))
const APP = opt('app', 'http://127.0.0.1:1420/')
const TAG = opt('tag', MODE)
const OUT = opt('out', `${(process.env.TEMP || '/tmp').replace(/\\/g, '/')}/image-hosting-probes/${new Date().toISOString().slice(0, 10)}`)
mkdirSync(OUT, { recursive: true })

if (MODE === 'gate-unit') {
  // No browser, no dev server: this exercises the gate predicate against readings that were really
  // observed on this machine, including the one that produced the bogus 186.796875px card width.
  //
  // Each rejection case breaks exactly ONE clause (everything else is healthy) and names the token
  // it expects back. A case that only asserts "was rejected" proves nothing: an earlier draft had
  // the zero-width case also carrying a zero clientWidth, so deleting the innerWidth clause from the
  // predicate still passed 5/5.
  const HEALTHY = { visibility: 'visible', innerWidth: 1406, innerHeight: 803, clientWidth: 1406, clientHeight: 803 }
  const cases = [
    { name: 'live headless viewport', reading: { ...HEALTHY }, expectReject: false, expectToken: null },
    { name: 'hidden, sizes healthy', reading: { ...HEALTHY, visibility: 'hidden' }, expectReject: true, expectToken: 'visibilityState=hidden' },
    { name: 'innerWidth 0, everything else healthy', reading: { ...HEALTHY, innerWidth: 0 }, expectReject: true, expectToken: 'innerWidth=0' },
    { name: 'innerHeight 0, everything else healthy', reading: { ...HEALTHY, innerHeight: 0 }, expectReject: true, expectToken: 'innerHeight=0' },
    { name: 'clientWidth 0, everything else healthy', reading: { ...HEALTHY, clientWidth: 0 }, expectReject: true, expectToken: 'client=0x803' },
    { name: 'recorded connector reading (hidden + 0x0)', reading: { visibility: 'hidden', innerWidth: 0, innerHeight: 0, clientWidth: 0, clientHeight: 0 }, expectReject: true, expectToken: 'visibilityState=hidden' },
  ]
  const results = cases.map((c) => {
    const verdict = gateVerdict(c.reading)
    const namedTheClause = c.expectReject === !verdict.ok && (!c.expectToken || verdict.problems.some((p) => p.startsWith(c.expectToken)))
    const extraClauses = c.expectToken ? verdict.problems.filter((p) => !p.startsWith(c.expectToken)) : []
    return { name: c.name, expectedReject: c.expectReject, gateRejected: !verdict.ok, problems: verdict.problems, correct: namedTheClause, unexpectedOtherClauses: extraClauses }
  })
  const failed = results.filter((r) => !r.correct)
  writeFileSync(`${OUT}/report-gate-unit.json`, JSON.stringify(results, null, 2))
  for (const r of results) console.log(`${r.correct ? 'OK  ' : 'FAIL'} ${r.name} -> ${r.gateRejected ? 'rejected: ' + r.problems.join('; ') : 'accepted'}`)
  console.log(`Viewport gate unit check: ${results.length - failed.length}/${results.length} correct | reports: ${OUT}`)
  process.exit(failed.length ? 1 : 0)
}

// The dev server is the only thing this tool needs from the project; refuse early with the exact
// command rather than reporting a mysterious "no page target" after a 30s timeout.
try {
  const probe = await fetch(APP, { signal: AbortSignal.timeout(4000) })
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
} catch (error) {
  console.error(`Frontend dev server is not reachable at ${APP} (${error.message}).\nStart it first:  cd apps/desktop && npm run dev`)
  process.exit(4)
}

const profile = `${OUT.replace(/\/+$/, '')}/.profile-${Date.now()}`
const browser = spawn(BROWSER, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
  '--window-size=1440,900', APP,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Exiting while a CDP socket or the browser child is still closing trips a libuv assertion on
// Windows, so give both a moment to shut down first.
function finish(code) {
  try { ws.close() } catch {}
  try { browser.kill() } catch {}
  setTimeout(() => process.exit(code), 300)
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith(APP))
      if (page) return page
    } catch {}
    await sleep(500)
  }
  throw new Error('no page target')
}

let idSeq = 0
const pending = new Map()
const events = []
const consoleErrors = []
let ws

function send(method, params = {}) {
  const id = ++idSeq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function on(method, params = {}) {
  ws.send(JSON.stringify({ method, params }))
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

// A hidden window or a 0x0 viewport silently changes the layout baseline itself: the same
// max-w-[440px] card measured 186.796875px there and 440px in a real viewport, so every geometry
// number taken without this check is an artefact, not a regression. Text and attribute readings
// survive it; widths, rects, hit-tests and screenshots do not.
//
// The decision is a pure function so the 0-width branch stays testable: this machine cannot make a
// live page report innerWidth 0 (setDeviceMetricsOverride ignores 0, and a minimized window keeps
// reporting its last real size), so the only honest way to prove that branch is to feed the
// predicate the readings that were actually observed - see the `gate-unit` mode.
function gateVerdict(reading) {
  const problems = []
  if (reading.visibility !== 'visible') problems.push(`visibilityState=${reading.visibility} (needs "visible")`)
  if (!(reading.innerWidth > 0)) problems.push(`innerWidth=${reading.innerWidth} (needs > 0)`)
  if (!(reading.innerHeight > 0)) problems.push(`innerHeight=${reading.innerHeight} (needs > 0)`)
  if (!(reading.clientWidth > 0) || !(reading.clientHeight > 0)) problems.push(`client=${reading.clientWidth}x${reading.clientHeight}`)
  return { ok: problems.length === 0, problems }
}

async function assertRealViewport(stage) {
  const v = await evaluate(`({ visibility: document.visibilityState, hidden: document.hidden, innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight, hasFocus: document.hasFocus(), dpr: devicePixelRatio })`)
  const verdict = gateVerdict(v)
  if (!verdict.ok) throw new Error(`VIEWPORT GATE FAILED at "${stage}": ${verdict.problems.join('; ')} | ${JSON.stringify(v)}`)
  return v
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const p = `${OUT}/${name}.png`
  writeFileSync(p, Buffer.from(r.data, 'base64'))
  return p
}

async function clickAt(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  }
  await sleep(120)
}

async function pressAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(80)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(80)
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(120)
}

const HELPERS = `
window.__H = {
  dialog() { return document.querySelector('[role=dialog][aria-modal="true"]'); },
  overlay() { const d = window.__H.dialog(); return d ? d.parentElement : null; },
  buttons() { const d = window.__H.dialog(); return d ? Array.from(d.querySelectorAll('button')) : []; },
  byText(sel, txt) { return Array.from(document.querySelectorAll(sel)).find(x => (x.textContent||'').trim() === txt); },
  box(el) { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 }; },
  state() {
    const d = window.__H.dialog();
    if (!d) return { present: false };
    const bs = window.__H.buttons();
    const p = d.querySelector('p');
    const sec = d;
    const o = window.__H.overlay();
    const cs = getComputedStyle(o);
    return {
      present: true,
      overlayZ: cs.zIndex, overlayPosition: cs.position,
      title: d.querySelector('h2') ? d.querySelector('h2').textContent : null,
      detail: p ? p.textContent : null,
      labels: bs.map(b => (b.textContent||'').trim() || b.getAttribute('aria-label')),
      activeText: (document.activeElement.textContent||'').trim() || document.activeElement.getAttribute('aria-label'),
      focusIsCancel: document.activeElement === bs[bs.length-2],
      focusIsConfirm: document.activeElement === bs[bs.length-1],
      focusIsClose: document.activeElement === bs[0],
      focusTag: document.activeElement.tagName,
      dialogBox: window.__H.box(sec),
      pOverflowX: p ? (p.scrollWidth - p.clientWidth) : null,
      pClientWidth: p ? p.clientWidth : null,
      pScrollWidth: p ? p.scrollWidth : null,
      pWhiteSpace: p ? getComputedStyle(p).whiteSpace : null,
      pWordBreak: p ? getComputedStyle(p).wordBreak : null,
      pLineCount: p ? Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) : null,
      sectionWidth: Math.round(sec.getBoundingClientRect().width),
      sectionMaxWidth: getComputedStyle(sec).maxWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewport: [window.innerWidth, window.innerHeight],
      actionError: (function(){ const e = window.__H.byText('main div', '错误'); return null; })(),
    };
  },
  stackingChain(sel) {
    let el = document.querySelector(sel); if (!el) return null;
    const chain = [];
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const creates = (cs.position !== 'static' && cs.zIndex !== 'auto') ||
        cs.transform !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none' ||
        cs.opacity !== '1' || cs.willChange.includes('transform') || cs.isolation === 'isolate' || cs.mixBlendMode !== 'normal';
      chain.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), z: cs.zIndex, pos: cs.position,
        transform: cs.transform !== 'none', filter: cs.filter !== 'none', backdrop: cs.backdropFilter !== 'none', opacity: cs.opacity, creates });
      el = el.parentElement;
    }
    return chain;
  },
};
true
`

async function main() {
  const page = await waitForTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
      if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails)
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        consoleErrors.push({ type: msg.params.type, text: msg.params.args.map((a) => a.description || a.value || a.type).join(' ') })
      }
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Target.setDiscoverTargets', { discover: true })

  // wait for the React app to mount
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('nav button')`)
    if (ready) break
    await sleep(500)
  }
  await evaluate(HELPERS)
  console.log('VIEWPORT', JSON.stringify(await assertRealViewport('after-mount')))
  await evaluate(`(function(){const c=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='关闭教程');if(c)c.click();return true;})()`)
  await sleep(300)

  const report = { mode: MODE, steps: [] }
  const record = (name, data) => report.steps.push({ name, ...data })

  // ---- go to Settings and open the confirm dialog with a trusted click ----
  const goto = async (label) => {
    await scrollToAndClick(`(function(){const b=window.__H.byText('nav button', ${JSON.stringify(label)});if(!b)throw new Error('nav not found: '+Array.from(document.querySelectorAll('nav button')).map(x=>(x.textContent||'').trim()).join(','));return b;})()`)
    await sleep(250)
  }
  // Scroll an element (located by a page-side expression) into view and click its centre with
  // trusted input; returns the box actually used so the report can show the hit coordinates.
  const scrollToAndClick = async (locatorExpr) => {
    // styles.css sets scroll-behavior:smooth, so an instant scroll + a short settle poll is
    // required before reading the rect a trusted click will use.
    const box = await evaluate(`(async function(){const el=${locatorExpr};if(!el)throw new Error('locator null');el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});for(let i=0;i<20;i++){const r=el.getBoundingClientRect();if(r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth)return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,inView:true,settledAfterMs:i*50};await new Promise(res=>setTimeout(res,50))}const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,inView:false};})()`)
    if (!box.inView) {
      const why = await evaluate(`(function(){const el=${locatorExpr};const chain=[];let n=el;while(n&&n.tagName){const cs=getComputedStyle(n);chain.push({tag:n.tagName,cls:(n.className||'').toString().slice(0,40),oy:cs.overflowY,sh:n.scrollHeight,ch:n.clientHeight,st:n.scrollTop});n=n.parentElement}const b2=el.getBoundingClientRect();el.scrollIntoView({block:'center'});return {before:b2.y,after:el.getBoundingClientRect().y,innerH:innerHeight,docOY:getComputedStyle(document.documentElement).overflowY,bodyOY:getComputedStyle(document.body).overflowY,scrollingElement:(document.scrollingElement||{}).tagName,chain:chain.slice(0,10)};})()`)
      throw new Error('element not in view after scroll: ' + JSON.stringify({ box, why }))
    }
    await clickAt(box.cx, box.cy)
    return box
  }

  const openConfirm = async () => {
    await goto('设置')
    consoleErrors.length = 0
    await scrollToAndClick(`window.__H.byText('main button', '重置 Token')`)
    await sleep(250)
    const diag = await evaluate(`(function(){const d=window.__H.dialog();if(d)return {present:true,vp:[innerWidth,innerHeight]};const b=window.__H.byText('main button','重置 Token');return {present:false,vp:[innerWidth,innerHeight],visibility:document.visibilityState,btnFound:!!b,btnDisabled:b?b.disabled:null,btnBox:b?window.__H.box(b):null,heading:document.querySelector('main h1')?document.querySelector('main h1').textContent:null};})()`)
    if (!diag.present) throw new Error('confirm dialog did not open: ' + JSON.stringify(diag))
    return diag
  }

  if (MODE === 'confirm') {
    // freeze entrance animations before sampling geometry
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await openConfirm()
    await assertRealViewport('1-initial-focus')
    const s1 = await evaluate(`window.__H.state()`)
    record('1-initial-focus', { state: s1 })
    record('1b-pre-open-actionError-absent', { note: 'actionError is page-local; see step 2 absence test' })
    await shot('01-opened')

    // ---- Escape ----
    await pressEscape()
    const s2 = await evaluate(`({ ...window.__H.state(), settingsError: (function(){ const t=Array.from(document.querySelectorAll('main *')).map(e=>e.textContent||''); return t.some(x=>x.includes('Token')&&x.includes('失败')); })(), unhandled: ${JSON.stringify([])} })`)
    const stillThere = await evaluate(`!!window.__H.dialog()`)
    const errBox = await evaluate(`Array.from(document.querySelectorAll('main div,p,span')).map(e=>(e.textContent||'').trim()).filter(x=>x.length<200&&/失败|错误|Token/.test(x)).slice(0,8)`)
    record('2-escape', { dialogPresentAfterEscape: stillThere, settingsErrorNodes: errBox, consoleErrors: consoleErrors.slice(0, 5) })

    // ---- reopen, backdrop mouse-down ----
    await openConfirm()
    const overlayBox = await evaluate(`window.__H.box(window.__H.overlay())`)
    const hitBefore = await evaluate(`(function(){const o=window.__H.overlay();const el=document.elementFromPoint(8,8);return {tag:el.tagName, isOverlay: el===o, containsDialog: !!(el&&el.contains(window.__H.dialog()))};})()`)
    await pressAt(8, Math.min(8, overlayBox.h - 1))
    await sleep(150)
    const afterBackdrop = await evaluate(`!!window.__H.dialog()`)
    record('3-backdrop-mousedown', { hitTestAtCorner: hitBefore, dialogPresentAfterBackdropPress: afterBackdrop })

    // ---- reopen, mousedown inside dialog body must NOT close ----
    await openConfirm()
    const titleBox = await evaluate(`window.__H.box(window.__H.dialog().querySelector('h2'))`)
    await pressAt(titleBox.cx, titleBox.cy)
    await sleep(150)
    const afterInside = await evaluate(`!!window.__H.dialog()`)
    record('3b-inside-mousedown-keeps-open', { dialogPresentAfterPressingTitle: afterInside })

    // ---- reopen, X (关闭) button ----
    await openConfirm()
    const xBox = await evaluate(`window.__H.box(window.__H.buttons()[0])`)
    await clickAt(xBox.cx, xBox.cy)
    await sleep(150)
    const afterX = await evaluate(`!!window.__H.dialog()`)
    record('3c-x-button', { dialogPresentAfterCloseButton: afterX })

    // ---- reopen, Enter / Space on focused Cancel ----
    await openConfirm()
    const enterTest = []
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(200)
    enterTest.push(await evaluate(`!!window.__H.dialog()`) ? 'still-open' : 'closed')
    record('4-enter-activates-focused-cancel', { result: enterTest[0] })

    // ---- long text: Chinese filename + batch delete copy ----
    await openConfirm()
    const LONG = await evaluate(`(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p');
      const name = '关于进一步加强校园跑打卡系统整改工作的通知final-2026-v3(1).png';
      p.textContent = '确定永久删除选中的 128 个远端文件吗？\\n\\n' +
        '2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本.png\\n' +
        'IMG_20260928_141530_副本(2)(3).HEIC.png\\n' +
        '这是一段没有任何空格可以断开的超长中文文件名aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png\\n' +
        'https://example.com/very/long/path/segment/that/keeps/going/and/going/without/any/breaks/image-final-version-2026.png\\n' +
        '对应的 Publisher Deployment 状态会同步更新。';
      d.querySelector('h2').textContent = '批量永久删除 · 2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本.png';
      d.querySelectorAll('button')[2].textContent = '永久删除 128 个文件（含超长确认按钮文案测试）';
      window.__H.dialog().parentElement.offsetHeight;
      return window.__H.state();
    })()`)
    await assertRealViewport('4-long-text-1440')
    await shot('05-long-text-1440')
    const overflowInfo = await evaluate(`(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p'); const sec = d;
      const r = sec.getBoundingClientRect(); const pr = p.getBoundingClientRect();
      const bs = window.__H.buttons(); const confirm = bs[bs.length-1]; const cr = confirm.getBoundingClientRect();
      return {
        viewport: [window.innerWidth, window.innerHeight],
        sectionRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
        pRect: { w: Math.round(pr.width), h: Math.round(pr.height) },
        pScrollWidth: p.scrollWidth, pClientWidth: p.clientWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        confirmBtnRect: { x: Math.round(cr.x), right: Math.round(cr.right), w: Math.round(cr.width), bottom: Math.round(cr.bottom) },
        confirmFullyVisible: cr.right <= window.innerWidth && cr.bottom <= window.innerHeight && cr.x >= 0 && cr.y >= 0,
        sectionFullyVisible: r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.x >= 0 && r.y >= 0,
        documentHasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        pWhiteSpace: getComputedStyle(p).whiteSpace,
        lineCountFromRect: (()=>{ const nodes = Array.from(p.getClientRects()); return new Set(nodes.map(n=>Math.round(n.y))).size; })(),
      };
    })()`)
    record('4-long-text-1440', { overflow: overflowInfo, longState: { present: LONG.present, sectionWidth: LONG.sectionWidth } })

    const measure = `(function(){
      if (document.visibilityState !== 'visible' || innerWidth <= 0 || innerHeight <= 0) throw new Error('VIEWPORT GATE FAILED inside sampler: ' + document.visibilityState + ' ' + innerWidth + 'x' + innerHeight);
      const d = window.__H.dialog(); const p = d.querySelector('p'); const o = window.__H.overlay();
      const r = d.getBoundingClientRect(); const bs = window.__H.buttons(); const confirm = bs[bs.length-1]; const cr = confirm.getBoundingClientRect();
      const cancel = bs[bs.length-2].getBoundingClientRect(); const or = o.getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        section: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        pScrollWidth: p.scrollWidth, pClientWidth: p.clientWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        confirm: { x: Math.round(cr.x), y: Math.round(cr.y), right: Math.round(cr.right), bottom: Math.round(cr.bottom) },
        cancel: { x: Math.round(cancel.x), right: Math.round(cancel.right), w: Math.round(cancel.width) },
        buttonsOnSameRow: Math.abs(cr.y - cancel.y) < 4,
        confirmFullyVisible: cr.right <= innerWidth && cr.left >= 0 && cr.bottom <= innerHeight && cr.top >= 0,
        sectionFullyVisible: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0,
        overlayOverflowY: getComputedStyle(o).overflowY, overlayScrollable: o.scrollHeight > o.clientHeight,
        overlayScrollDelta: o.scrollHeight - o.clientHeight,
        docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`

    // The real reachable floor: tauri.conf.json minWidth 640 / minHeight 480. 420 is below that
    // floor and is measured only as the CSS contract at a narrow width, labelled as such.
    for (const [w, h, label] of [[420, 720, 'below-app-minimum-420x720'], [640, 480, 'app-minimum-640x480']]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
      await sleep(250)
      await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
      const sample = await assertRealViewport(`5-${label}`)
      const value = await evaluate(measure)
      await shot(`06-long-text-${w}x${h}`)
      record(`5-long-text-${label}`, { gate: sample, measured: value })
      if (w === 640) {
        await evaluate(`(function(){
          const p = window.__H.dialog().querySelector('p');
          const names = Array.from({length: 14}, (_, i) => '2026年9月28日吉林农业大学第三教学楼侧面全景照片原图未压缩版本-' + (i+1) + '.png');
          p.textContent = '确定永久删除选中的 14 个远端文件吗？\\n\\n' + names.join('\\n') + '\\n\\n对应的 Publisher Deployment 状态会同步更新。';
          return true;
        })()`)
        await sleep(150)
        await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
        const tallGate = await assertRealViewport('5-app-minimum-tall')
        const tall = await evaluate(measure)
        await shot('07-many-names-640x480')
        record('5-long-text-app-minimum-14-lines', { gate: tallGate, measured: tall })
      }
    }
    await send('Emulation.clearDeviceMetricsOverride')
    await sleep(200)

    // ---- z-index / stacking ----
    await evaluate(`(function(){const d=window.__H.dialog();if(d)window.__H.buttons()[window.__H.buttons().length-2].click();return true;})()`)
    await sleep(150)
    const z = {}
    // confirm overlay
    await openConfirm()
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await assertRealViewport('6-confirm-stacking')
    z.confirm = await evaluate(`(function(){const o=window.__H.overlay();const cs=getComputedStyle(o);return {z:cs.zIndex,pos:cs.position,chain:window.__H.stackingChain('[role=dialog][aria-modal="true"]'),order:Array.from(o.parentElement.children).map(c=>c.tagName+'.'+(c.className||'').toString().split(' ').filter(x=>x.startsWith('z-')||x==='fixed').join('+')).slice(-6),siblingIndex:Array.from(o.parentElement.children).indexOf(o),siblingCount:o.parentElement.children.length};})()`)
    await shot('08-confirm-open')
    z.confirmAt95 = true

    // Toast layer while the confirm is open. Plugins/Tasks call `invoke` unconditionally, so in a
    // plain browser they always fail and always raise a toast; a direct DOM click is used because
    // the confirm overlay would swallow a real pointer event on the sidebar.
    z.toastTrigger = []
    for (const route of ['插件', '任务']) {
      const fired = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('nav button')).find(x=>(x.textContent||'').trim()===${JSON.stringify(route)});if(!b)return 'nav missing';b.click();return 'clicked';})()`)
      z.toastTrigger.push(`${route}:${fired}`)
      await sleep(800)
      if (await evaluate(`(function(){const t=document.querySelector('.pointer-events-none.fixed.bottom-4');return !!t && t.children.length > 0})()`)) break
    }
    await assertRealViewport('6-toast-hit-test')
    z.toast = await evaluate(`(function(){const t=document.querySelector('.pointer-events-none.fixed.bottom-4');if(!t||!t.children.length)return {present:false, containerExists:!!t};const cs=getComputedStyle(t);const r=t.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2, Math.min(r.y+r.height/2, window.innerHeight-1));const o=window.__H.overlay();return {present:true,z:cs.zIndex,toasts:Array.from(t.children).map(c=>(c.textContent||'').trim().slice(0,90)),hitTestAtToastCenter:{tag:el&&el.tagName,isToastOrChild:t.contains(el),isConfirmOrChild:!!(o&&o.contains(el))},pointerEvents:cs.pointerEvents,confirmStillOpen:!!o,veilOverToast:o?{backgroundColor:getComputedStyle(o).backgroundColor,backdropFilter:getComputedStyle(o).backdropFilter||getComputedStyle(o).webkitBackdropFilter}:null};})()`)
    if (!z.toast.present) throw new Error('toast co-occurrence not reproduced: ' + JSON.stringify(z.toast))
    await shot('10-toast-behind-confirm')
    z.confirmStillOpen = await evaluate(`!!window.__H.dialog()`)

    // the two layers that genuinely tie at z-[95]: prove which one wins by source order
    await assertRealViewport('6-tie-hit-test')
    z.tie = await evaluate(`(function(){
      const o = window.__H.overlay();
      const synth = document.createElement('div');
      synth.className = 'fixed inset-0 z-[95] grid place-items-center bg-slate-950/30';
      synth.innerHTML = '<section style="width:200px;height:80px;background:#fff" data-synth="1"></section>';
      document.querySelector('main').appendChild(synth);
      const r = synth.getBoundingClientRect();
      const hit = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
      const res = {
        synthZ: getComputedStyle(synth).zIndex,
        synthIsAncestorOfMain: document.querySelector('main').contains(synth),
        hitAtViewportCentre: hit ? (hit.tagName + '.' + (hit.className||'').toString().split(' ').slice(0,3).join('.')) : null,
        hitInsideConfirm: !!(o && o.contains(hit)),
        hitIsSynth: !!(hit && (hit === synth || synth.contains(hit))),
        confirmOrderVsSynth: (()=>{ const c = Array.from(document.querySelectorAll('div.fixed.inset-0')); return c.indexOf(o) - c.indexOf(synth); })(),
      };
      synth.remove();
      return res;
    })()`)

    // real co-occurrence: UploadDialog (z-50) under the confirm overlay
    await evaluate(`(function(){const bs=window.__H.buttons();bs[bs.length-2].click();return true;})()`)
    await sleep(120)
    await goto('发布')
    const urlBtn = await scrollToAndClick(`Array.from(document.querySelectorAll('main button')).find(b=>(b.textContent||'').includes('图片 URL'))`)
    await sleep(250)
    await assertRealViewport('6-upload-dialog')
    z.uploadAlone = await evaluate(`(function(){const u=Array.from(document.querySelectorAll('div.fixed.inset-0')).find(d=>getComputedStyle(d).zIndex==='50');if(!u)return {present:false};return {present:true,z:getComputedStyle(u).zIndex,chain:window.__H.stackingChain('div.fixed.inset-0'),sectionMaxWidth:getComputedStyle(u.querySelector('section')).maxWidth};})()`)
    record('6-z-index-and-stacking', z)
    await shot('09-upload-dialog')
  }

  if (MODE === 'pages') {
    // Does a missing Tauri runtime take the page down? Visit every route with trusted clicks.
    const sweep = []
    for (const label of ['发布', '资源', '云端', '图库', '插件', '任务', '设置']) {
      consoleErrors.length = 0
      let entry = { label }
      try {
        await goto(label)
      } catch (e) {
        entry.gotoError = String(e).slice(0, 160)
      }
      await sleep(900)
      entry.after = await evaluate(`(function(){
        const root = document.getElementById('root');
        return {
          heading: document.querySelector('main h1') ? document.querySelector('main h1').textContent : null,
          rootChildren: root ? root.children.length : -1,
          rootTextLen: root ? (root.textContent||'').trim().length : -1,
          sidebarAlive: !!document.querySelector('nav button'),
          toastTexts: Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim().slice(0,140)),
        };
      })()`)
      entry.consoleErrors = consoleErrors.slice(0, 4).map((e) => (e.text || e.exception?.description || JSON.stringify(e)).slice(0, 220))
      entry.unhandledRejections = consoleErrors.filter((e) => e.type === 'error' && /invoke|TAURI|__TAURI/i.test(e.text || '')).length
      await shot(`p-${label}`)
      sweep.push(entry)
    }
    record('8-browser-only-route-sweep', sweep)
  }

  if (MODE === 'ab') {
    // Paired before/after in ONE viewport with ONE injected text: the fix is a single CSS
    // property, so toggling it back reproduces the pre-fix computed style exactly. That is
    // stronger evidence than two runs (same content, same moment, no drift in the rest of the page).
    await openConfirm()
    await evaluate(`document.getAnimations().forEach(a=>{try{a.pause()}catch(e){}});true`)
    await assertRealViewport('ab:open')
    const inject = `(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p');
      p.textContent = '确定永久删除选中的 128 个远端文件吗？\\n\\n' +
        'a3f9c21be7d84f05c6b18d27ea49f30b5c8d7e12a6b4f90c3d5e7a1b2c4d6e8f0.png\\n' +
        'https://cdn.example.com/a/very/long/path/segment/that/keeps/going/without/any/breaks/final-version-2026.png\\n' +
        '对应的 Publisher Deployment 状态会同步更新。';
      return true;
    })()`
    const sample = `(function(){
      const d = window.__H.dialog(); const p = d.querySelector('p'); const sec = d;
      const cs = getComputedStyle(p); const sr = sec.getBoundingClientRect(); const pr = p.getBoundingClientRect();
      const cardRight = Math.round(sr.right);
      // how far the painted text reaches past the card's right border
      let maxRight = 0; for (const r of p.getClientRects()) maxRight = Math.max(maxRight, r.right);
      const ranges = [];
      const node = p.firstChild;
      if (node && node.nodeType === 3) {
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, node.length);
        for (const r of range.getClientRects()) maxRight = Math.max(maxRight, r.right);
      }
      return {
        viewport: [innerWidth, innerHeight],
        overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak, whiteSpace: cs.whiteSpace,
        pClientWidth: p.clientWidth, pScrollWidth: p.scrollWidth, pOverflowX: p.scrollWidth - p.clientWidth,
        cardRight, textReachesTo: Math.round(maxRight), paintedPastCardBy: Math.round(maxRight) - cardRight,
        cardWidth: Math.round(sr.width), cardHeight: Math.round(sr.height),
        docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ranges: ranges.length,
      };
    })()`
    const after = await evaluate(inject + `;${sample}`)
    await shot('ab-after-break-words')
    await evaluate(`(function(){const p=window.__H.dialog().querySelector('p');p.style.overflowWrap='normal';p.style.wordBreak='normal';window.__H.dialog().querySelector('h2').style.overflowWrap='normal';return true;})()`)
    await sleep(200)
    const beforeSample = await evaluate(sample)
    await shot('ab-before-break-words')
    record('ab-wrap-paired', { afterFix: after, beforeFix: beforeSample, deltaOverflowX: beforeSample.pOverflowX - after.pOverflowX })
    writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    finish(0)
  }

  if (MODE === 'links') {
    // What the user actually sees at each of the three docs call sites, for whatever
    // VITE_DOCS_BASE_URL the dev server was started with. Tag comes from argv[4].
    const woCount = () => events.filter((e) => e.method === 'Page.windowOpen').length
    const tcCount = () => events.filter((e) => e.method === 'Target.targetCreated').length
    const readToasts = `(function(){return Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim())})()`
    const out = { baseEnv: await evaluate(`(async function(){const m=await import('/src/lib/desktop.ts');return {docsBaseUrl: m.getDocsBaseUrl(), providerGuideUrl: m.getProviderGuideUrl('github'), localApiGuideUrl: m.getLocalApiGuideUrl()}})()`), sites: {} }

    const sample = async (key, wo, tc) => ({
      ...out.sites[key],
      afterClick: {
        newWindowOpenEvents: woCount() - wo,
        newTabs: tcCount() - tc,
        urlsOpened: events.filter((e) => e.method === 'Page.windowOpen').slice(wo).map((e) => e.params.url),
        toastTexts: await evaluate(readToasts),
        consoleErrors: consoleErrors.slice(0, 4).map((e) => (e.text || JSON.stringify(e)).slice(0, 160)),
      },
    })

    const locate = (expr) => evaluate(`(function(){const b=${expr};if(!b)return {found:false};return {found:true,label:(b.textContent||'').trim(),aria:b.getAttribute('aria-label'),title:b.getAttribute('title')};})()`)
    const clickEl = (expr) => scrollToAndClick(`(function(){const b=${expr};if(!b)throw new Error('locator null');return b;})()`)

    // A: HelpCenterDialog
    consoleErrors.length = 0
    let wo = woCount(); let tc = tcCount()
    await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()")
    await sleep(400)
    out.sites.A_helpCenterDialog = await locate("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()")
    if (out.sites.A_helpCenterDialog.found) {
      await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()")
      await sleep(1600)
      out.sites.A_helpCenterDialog = await sample('A_helpCenterDialog', wo, tc).then((r) => ({ ...out.sites.A_helpCenterDialog, ...r }))
    }
    await shot(`lA-${TAG}`)
    await clickEl("(function(){return document.querySelector('button[aria-label=\"关闭教程\"]')})()")
    await sleep(300)

    // B: SettingsPage
    consoleErrors.length = 0
    wo = woCount(); tc = tcCount()
    await goto('设置')
    await sleep(500)
    out.sites.B_settingsPage = await locate("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码')})()")
    if (out.sites.B_settingsPage.found) {
      await clickEl("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码')})()")
      await sleep(1600)
      out.sites.B_settingsPage = await sample('B_settingsPage', wo, tc).then((r) => ({ ...out.sites.B_settingsPage, ...r }))
    }
    await shot(`lB-${TAG}`)

    // C: StorageSetupDialog (guide panel is collapsed until 配置教程 is clicked)
    consoleErrors.length = 0
    wo = woCount(); tc = tcCount()
    await goto('云端')
    await sleep(500)
    await clickEl("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='添加存储')})()")
    await sleep(500)
    await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim().startsWith('GitHub'))})()")
    await sleep(600)
    await clickEl(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='配置教程')})()`)
    await sleep(500)
    out.sites.C_storageSetupDialog = await locate(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return top?Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档'):null})()`)
    out.sites.C_storageSetupDialog.panelCopy = await evaluate(`(function(){
      const top = Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();
      if (!top) return null;
      const el = Array.from(top.querySelectorAll('div,p')).find(x=>(x.textContent||'').includes('教程内置在应用里'));
      return el ? (el.textContent||'').trim() : null;
    })()`)
    if (out.sites.C_storageSetupDialog.found) {
      await clickEl(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档')})()`)
      await sleep(1600)
      out.sites.C_storageSetupDialog = await sample('C_storageSetupDialog', wo, tc).then((r) => ({ ...out.sites.C_storageSetupDialog, ...r }))
    }
    await shot(`lC-${TAG}`)

    out.openedTabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()))
      .filter((t) => t.type === 'page' && !t.url.startsWith(APP))
      .map((t) => ({ url: t.url.slice(0, 120), title: (t.title || '').slice(0, 70) }))
    record('links-under-this-base', out)
    writeFileSync(`${OUT}/report-links-${TAG}.json`, JSON.stringify(out, null, 2))
    console.log(JSON.stringify(out, null, 2))
    finish(0)
  }

  if (MODE === 'gate') {
    // The gate has to be demonstrated red under exactly the conditions that produced the bogus
    // 186.796875px card width, otherwise it is decoration.
    const attempts = []
    const tryIt = async (name, setup, expectFail) => {
      let outcome
      try {
        if (setup) await setup()
        const v = await assertRealViewport(name)
        outcome = { passed: true, viewport: v }
      } catch (e) {
        outcome = { passed: false, error: String(e.message).slice(0, 220) }
      }
      attempts.push({ name, expectedFail: expectFail, ...outcome, gateWorked: expectFail ? !outcome.passed : outcome.passed })
    }
    await tryIt('control', null, false)
    // Emulation.setVisibilityStateOverride does not exist in this Edge build, and
    // setDeviceMetricsOverride silently ignores width/height 0 - neither can reproduce the bad
    // reading, so neither is claimed as a demonstration. The minimized-window case below is real.
    let w = null
    try { w = await send('Browser.getWindowForTarget') } catch (e) { attempts.push({ name: 'window minimized', skipped: String(e.message).slice(0, 120) }) }
    if (w) {
      await send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'minimized' } })
      await sleep(700)
      await tryIt('window minimized', null, true)
      await send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'normal' } })
      await sleep(700)
      await tryIt('window restored', null, false)
    }
    record('gate-self-test', {
      attempts,
      notDemonstrable: [
        'innerWidth=0 could not be reproduced through CDP in headless (setDeviceMetricsOverride rejects/ignores 0); the branch is justified by the connector reading taken earlier this session: visibility=hidden, inner=[0,0], client=[0,0], screen=[0,0]',
        'Emulation.setVisibilityStateOverride is unavailable in this Edge build, so the visibility branch is exercised only through a genuinely minimized window',
      ],
    })
    const broken = attempts.filter((a) => a.gateWorked === false)
    const sawMinimizedReject = attempts.some((a) => a.name === 'window minimized' && a.passed === false && String(a.error).includes('VIEWPORT GATE FAILED'))
    if (!sawMinimizedReject) broken.push({ name: 'no real rejection observed' })
    writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ attempts, sawMinimizedReject, broken: broken.map((b) => b.name) }, null, 2))
    ws.close(); browser.kill()
    process.exit(broken.length ? 4 : 0)
  }

  if (MODE === 'external') {
    const woCount = () => events.filter((e) => e.method === 'Page.windowOpen').length
    const tcCount = () => events.filter((e) => e.method === 'Target.targetCreated').length
    const feedback = `(function(){return {
      toastTexts: Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim().slice(0,160)),
      inlineError: Array.from(document.querySelectorAll('main *')).map(e=>(e.childElementCount===0?(e.textContent||'').trim():'')).filter(t=>t&&/失败|错误|无法|不可用/.test(t)&&t.length<160).slice(0,4),
    };})()`

    const results = {}

    // ---- site A: HelpCenterDialog.tsx:32 "在线文档" ----
    consoleErrors.length = 0
    const aWo = woCount(); const aTc = tcCount()
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助');if(!b)throw new Error('help button missing');return b;})()")
    await sleep(400)
    results.A_helpCenter = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');if(!b)return {found:false};b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {found:true,label:(b.textContent||'').trim(),url:null};})()`)
    if (results.A_helpCenter.found) {
      const box = await scrollToAndClick("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');})()")
      results.A_helpCenter.clickedAt = [Math.round(box.cx), Math.round(box.cy)]
      await sleep(1500)
      results.A_helpCenter.afterClick = {
        windowOpenCalls: events.slice(events.length).length,
        newWindowOpenEvents: woCount() - aWo,
        newTabs: tcCount() - aTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(aWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
    }
    await shot('10-help-center-online-docs')
    // close the help overlay so the next site's trusted click is not swallowed by it
    await scrollToAndClick("(function(){const b=document.querySelector('button[aria-label=\"关闭教程\"]');if(!b)throw new Error('help close missing');return b;})()")
    await sleep(300)

    // ---- site B: SettingsPage.tsx:328 "完整调用教程与状态码" ----
    consoleErrors.length = 0
    const bWo = woCount(); const bTc = tcCount()
    await goto('设置')
    await sleep(500)
    results.B_settings = await evaluate(`(function(){const b=Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码');if(!b)return {found:false,texts:Array.from(document.querySelectorAll('main button')).map(x=>(x.textContent||'').trim()).filter(t=>t).slice(0,24)};return {found:true,label:(b.textContent||'').trim()};})()`)
    if (results.B_settings.found) {
      await scrollToAndClick("(function(){return Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='完整调用教程与状态码');})()")
      await sleep(1500)
      results.B_settings.afterClick = {
        newWindowOpenEvents: woCount() - bWo,
        newTabs: tcCount() - bTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(bWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
    }
    await shot('11-settings-local-api-link')

    // ---- site C: StorageSetupDialog.tsx:256 "在线文档" inside the provider setup panel ----
    consoleErrors.length = 0
    const cWo = woCount(); const cTc = tcCount()
    await goto('云端')
    await sleep(500)
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('main button')).find(x=>(x.textContent||'').trim()==='添加存储');if(!b)throw new Error('添加存储 missing');return b;})()")
    await sleep(500)
    results.C_openedProviderPicker = await evaluate(`(function(){return {cards: Array.from(document.querySelectorAll('button')).map(x=>(x.textContent||'').trim()).filter(t=>t.includes('开始配置')).length};})()`)
    await scrollToAndClick("(function(){const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim().startsWith('GitHub'));if(!b)throw new Error('GitHub card missing');return b;})()")
    await sleep(600)
    results.C_afterProviderCard = await evaluate(`(function(){
      const top = Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();
      return { overlay: !!top, heading: top ? (top.querySelector('h2,h3')||{}).textContent : null, hasGuideToggle: !!(top && Array.from(top.querySelectorAll('button')).some(x=>(x.textContent||'').trim()==='配置教程')) };
    })()`)
    if (results.C_afterProviderCard.hasGuideToggle) {
      await scrollToAndClick(`(function(){const top=Array.from(document.querySelectorAll('div.fixed.inset-0')).filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='配置教程');})()`)
      await sleep(500)
    }
    results.C_guide = await evaluate(`(function(){
      const overlays = Array.from(document.querySelectorAll('div.fixed.inset-0'));
      const top = overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();
      const b = top ? Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档') : null;
      return { setupOverlayFound: !!top, guideButtonFound: !!b, heading: top ? (top.querySelector('h2,h3')||{}).textContent : null };
    })()`)
    if (results.C_guide.guideButtonFound) {
      await scrollToAndClick(`(function(){const overlays=Array.from(document.querySelectorAll('div.fixed.inset-0'));const top=overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();return Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');})()`)
      await sleep(1500)
      results.C_guide.afterClick = {
        newWindowOpenEvents: woCount() - cWo,
        newTabs: tcCount() - cTc,
        urls: events.filter((e) => e.method === 'Page.windowOpen').slice(cWo).map((e) => e.params.url),
        consoleErrors: consoleErrors.slice(0, 6),
        ...(await evaluate(feedback)),
      }
      results.C_guide.hrefShape = await evaluate(`(function(){const overlays=Array.from(document.querySelectorAll('div.fixed.inset-0'));const top=overlays.filter(o=>getComputedStyle(o).zIndex==='70').pop();const b=Array.from(top.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='在线文档');const r=b.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)};})()`)
    }
    await shot('13-provider-guide')

    // ---- does the primitive actually reject? (before the fix nothing could observe this) ----
    consoleErrors.length = 0
    results.D_primitiveRejects = await evaluate(`(async function(){
      const m = await import('/src/lib/desktop.ts');
      const out = {};
      for (const [name, url] of [['malformed','not a url at all/guides/github/'], ['non-http scheme','ftp://example.com/docs'], ['unreachable but valid','https://definitely-not-a-real-docs-host.invalid/image-hosting-platform']]) {
        try { await m.openExternalUrl(url); out[name] = 'resolved'; }
        catch (e) { out[name] = 'rejected: ' + String(e).slice(0, 90); }
        await new Promise(r=>setTimeout(r,120));
      }
      return out;
    })()`)

    // ---- the exact before/after difference at the call site, on a quiet toast stack ----
    consoleErrors.length = 0
    results.E_voidVsWrapper = await evaluate(`(async function(){
      const m = await import('/src/lib/desktop.ts');
      const read = () => Array.from(document.querySelectorAll('.pointer-events-none.fixed.bottom-4 > *')).map(e=>(e.textContent||'').trim()).filter(t=>t.includes('打开链接失败'));
      const wait = (ms) => new Promise(r=>setTimeout(r,ms));
      let quiet = 0;
      while (read().length && quiet < 120) { await wait(250); quiet++; }
      const baseline = read().length;
      void m.openExternalUrl('not a url at all/guides/github/');
      await wait(900);
      const afterVoid = read().length;
      await wait(1200);
      while (read().length) { await wait(250); }
      m.openExternalUrlOrReport('not a url at all/guides/github/');
      await wait(900);
      const afterWrapper = read().length;
      return { baseline, toastsAfterVoidCall: afterVoid - baseline, toastsAfterWrapperCall: afterWrapper, sample: read()[0] || null };
    })()`)
    results.E_voidVsWrapper.pageErrorsDuringProbe = consoleErrors.slice(0, 4).map((e) => (e.text || e.exception?.description || JSON.stringify(e)).slice(0, 140))

    record('7-external-url-sites', results)
    report.tabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())).map((t) => ({ type: t.type, url: t.url.slice(0, 120), title: (t.title || '').slice(0, 60) }))
  }

  writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  finish(0)
}

main().catch((e) => {
  console.error('FAILED', e)
  try { browser.kill() } catch {}
  process.exit(1)
})
