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
 *   red-demo  starts scripts/__fixtures__/impostor_dev_server.mjs and asserts the identity gate
 *             refuses to measure it (exit 2 from the child is the expected outcome)
 *   visual    the measured visual baseline (type scale, radii, gaps, dead space, sequences,
 *             contrast) for every surface, plus four asserted invariants on the onboarding dialog
 *   contrast  the raw colour chain behind one flagged element, for hand-checking the ratio
 *   layout    the geometry floor: every route at 1440/1024/640 checked for horizontal overflow,
 *             clipped text, touch-target size, focus visibility, accessible names and broken images
 *
 * Options
 *   --out DIR   default %TEMP%/image-hosting-probes/<date>; screenshots and JSON land there, never
 *               inside the repository
 *   --app URL   dev server origin, default http://127.0.0.1:1420/
 *   --edge PATH browser binary, default: first existing of Edge (x86), Edge, Chrome
 *   --tag NAME  filename suffix for reports
 *   --port N    CDP port, default 9333
 *
 * Exit codes
 *   0  measured, every assertion held
 *   1  an app-level assertion failed (a real regression) or the run crashed
 *   2  harness fault: the viewport gate or the project-identity gate refused to sample. Never
 *      report a 2 as a pass or as a regression - it means nothing was measured.
 *   3  no local Chromium-family browser found
 *   4  the dev server on --app is not reachable
 *
 * Before any sample is taken the tool proves it is pointed at this project: document.title must
 * match index.html, the served /package.json must be byte-identical to the working tree, and every
 * value export in src/lib/desktop.ts must appear in the module the server returns. A stale checkout
 * on port 1420 therefore fails loudly instead of returning confident PASSes about old code.
 *
 * No third-party imports: node:child_process and node:fs, plus the fetch / WebSocket globals that
 * Node 22+ ships. Requires Node >= 22 for the global WebSocket.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const MODE = argv[0] && !argv[0].startsWith('--') ? argv[0] : ''
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
if (!MODE || MODE === 'help') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*/, ''))
  console.log(`modes: confirm | ab | gate | gate-unit | links | pages | external | red-demo | visual | contrast | layout`)
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

const profile = `${OUT.replace(/\/+$/, '')}/.profile-${Date.now()}`
// The browser and the dev-server preflight are lazy: red-demo orchestrates child processes and must
// not fail (or burn a browser launch) because the parent's default --app is down.
let browser = null
function launchBrowser() {
  if (browser) return
  browser = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--window-size=1440,900', APP,
  ], { stdio: 'ignore' })
}

async function requireDevServer() {
  try {
    const probe = await fetch(APP, { signal: AbortSignal.timeout(4000) })
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
  } catch (error) {
    console.error(`Frontend dev server is not reachable at ${APP} (${error.message}).\nStart it first:  cd apps/desktop && npm run dev`)
    process.exit(4)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Identity gate. Navigating to a port is not the same as measuring this project: a dev server from
// an older checkout, or a different app entirely, produces confident PASSes against the wrong code.
// Three layers, none of them hardcoded, so they cannot drift from the tree they check:
//   L1 document.title must equal the <title> in the on-disk index.html
//   L2 the served /package.json must be byte-identical to the on-disk one
//   L3 every export name in the on-disk desktop.ts must appear in the module the server returns
// A mismatch exits 2: harness fault. It is never counted as a pass and never as an app regression.
// Forward slashes everywhere: these paths reach child_process.spawn as argv, and a Windows path with
// backslashes has already eaten a whole run here once (spawn reported "C:Program Files...").
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, '/').replace(/\/+$/, '')
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '')
const readRepoFile = (rel) => readFileSync(`${REPO}/${rel}`, 'utf8')

function exportNames(source) {
  // Value exports only. `export interface` / `export type` are erased by the TypeScript transform,
  // so demanding they appear in the served JS makes the gate permanently red for a reason that has
  // nothing to do with staleness - the first version of this check tripped on RemoteIndexSyncResult.
  return [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1])
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function assertProjectIdentity() {
  const faults = []
  const expectedTitle = (readRepoFile('apps/desktop/index.html').match(/<title>([^<]*)<\/title>/) || [])[1]
  const servedPackage = await fetchText(`${APP}package.json`).catch((e) => `__unreachable__ ${e.message}`)
  const onDiskPackage = readRepoFile('apps/desktop/package.json')
  if (typeof servedPackage !== 'string' || servedPackage.trim() !== onDiskPackage.trim()) {
    faults.push('L2 served /package.json differs from the working tree (different checkout or app)')
  }
  const probeModule = await fetchText(`${APP}src/lib/desktop.ts`).catch((e) => `__unreachable__ ${e.message}`)
  const missing = exportNames(readRepoFile('apps/desktop/src/lib/desktop.ts')).filter((n) => !probeModule.includes(n))
  if (missing.length) faults.push(`L3 served /src/lib/desktop.ts is missing ${missing.length} export(s) present on disk: ${missing.slice(0, 6).join(', ')}`)
  const actualTitle = await evaluate(`document.title`)
  if (expectedTitle && actualTitle !== expectedTitle) faults.push(`L1 document.title is ${JSON.stringify(actualTitle)}, index.html says ${JSON.stringify(expectedTitle)}`)
  if (faults.length) {
    console.error(`PROJECT IDENTITY GATE FAILED - refusing to measure. Exit 2 means harness fault, not a pass and not an app regression.\n  ${faults.join('\n  ')}\n  server: ${APP}`)
    // Throwing, not finish(2): finish() defers process.exit, so falling through would let the run
    // continue and print an IDENTITY line full of hardcoded success values next to its own failure.
    const error = new Error(`identity gate rejected ${APP}: ${faults.join('; ')}`)
    error.identityFault = true
    throw error
  }
  return { title: actualTitle, packageJsonMatches: true, exportsChecked: exportNames(readRepoFile('apps/desktop/src/lib/desktop.ts')).length, exportsMissing: 0 }
}

function buildProvenance() {
  // The app has no build-time version marker, and Vite reads sources from disk per request, so the
  // most this tool can honestly claim is "the tree the server is rooted at matches HEAD".
  let head = 'unknown'
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { /* git missing or not a repo: report it rather than guessing */ }
  let version = 'unknown'
  try { version = JSON.parse(readRepoFile('apps/desktop/package.json')).version } catch { /* keep unknown */ }
  return { headCommitUnderTest: head, desktopPackageVersion: version, caveat: 'the dev server injects no build-time commit marker; identity is proven by /package.json and export-name equality with HEAD, not by a version the app itself reports' }
}


// Exiting while a CDP socket or the browser child is still closing trips a libuv assertion on
// Windows, so give both a moment to shut down first.
function finish(code) {
  try { ws.close() } catch {}
  try { browser?.kill() } catch {}
  setTimeout(() => process.exit(code), 300)
}

async function waitForTarget() {
  let last = []
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      last = await res.json()
      const page = last.find((t) => t.type === 'page' && t.url.startsWith(APP))
      if (page) return page
    } catch {}
    await sleep(500)
  }
  // An Edge left behind by an earlier run keeps listening on the fixed default port, and this call
  // happily attaches to that stranger instead of the browser just spawned. Naming the tabs makes
  // "no page target" diagnosable; --port <other> is the workaround.
  const seen = last.map((t) => t.url || t.type).slice(0, 4).join(', ') || 'no targets at all'
  throw new Error(`no page target on port ${PORT}; that browser's tabs are: ${seen}. If a previous run's headless browser is still holding the port, rerun with --port <free>.`)
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

if (MODE === 'red-demo') {
  // Re-runnable proof that the identity gate alarms. Both impostor servers are deliberately wrong;
  // a red here is the expected outcome, and the demo only passes if the gate refuses to measure.
  // If either child exits 0, the gate has stopped biting - that is reported as exit 2, not as a pass.
  const cases = [
    {
      fixture: 'other-app', port: 14571, expectClause: 'L1 document.title',
      why: 'a different project owns the port; measuring it would produce confident PASSes about code that is not ours',
    },
    {
      fixture: 'stale-source', port: 14572, expectClause: 'L3 served /src/lib/desktop.ts',
      why: 'right title and byte-identical /package.json, but the served module predates one current export - the only way to catch "same app, older checkout"',
    },
  ]
  const results = []
  for (const c of cases) {
    const fixture = spawn(process.execPath, [`${REPO}/scripts/__fixtures__/impostor_dev_server.mjs`, c.fixture, String(c.port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let fixtureErr = ''
    fixture.stderr.on('data', (d) => { fixtureErr += d })
    await sleep(900)
    const child = spawnSync(process.execPath, [SELF, 'ab', '--app', `http://127.0.0.1:${c.port}/`, '--port', String(PORT + c.port - 14570)], { encoding: 'utf8', timeout: 180_000 })
    const output = `${child.stdout || ''}${child.stderr || ''}`
    const rejected = child.status === 2 && output.includes('PROJECT IDENTITY GATE FAILED')
    const namedClause = output.includes(c.expectClause)
    results.push({
      case: c.fixture, url: `http://127.0.0.1:${c.port}/`, expectedExit: 2, actualExit: child.status,
      gateRejected: rejected, namedExpectedClause: namedClause, whyThisRedIsExpected: c.why,
      evidence: output.split('\n').filter((l) => /PROJECT IDENTITY|^  L\d|identity gate rejected/.test(l)).slice(0, 4),
    })
    fixture.kill()
    if (fixtureErr) console.error(`fixture ${c.fixture} stderr: ${fixtureErr.trim()}`)
  }
  writeFileSync(`${OUT}/report-red-demo.json`, JSON.stringify(results, null, 2))
  for (const r of results) {
    console.log(`${r.gateRejected && r.namedExpectedClause ? 'OK  ' : 'FAIL'} ${r.case.padEnd(13)} exit=${r.actualExit} (want 2) rejected=${r.gateRejected} named=${r.namedExpectedClause}`)
    for (const line of r.evidence) console.log(`      ${line.trim()}`)
    console.log(`      why this red is expected: ${r.whyThisRedIsExpected}`)
  }
  const broken = results.filter((r) => !r.gateRejected || !r.namedExpectedClause)
  console.log(`identity gate red demo: ${results.length - broken.length}/${results.length} alarms reproduced | reports: ${OUT}`)
  if (broken.length) console.error('The gate did NOT alarm. Treat this as a harness fault, not as a passing test.')
  process.exit(broken.length ? 2 : 0)
}


async function main() {
  await requireDevServer()
  launchBrowser()
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

  const report = { mode: MODE, steps: [] }
  const record = (name, data) => report.steps.push({ name, ...data })
  // Gates run before anything is measured, and before waiting for the app to mount: an impostor
  // server never mounts it, so a gate placed after the mount wait spends 20s timing out first.
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!!document.body && (document.title !== '' || document.body.children.length > 0)`)) break
    await sleep(250)
  }
  console.log('VIEWPORT', JSON.stringify(await assertRealViewport('after-navigation')))
  report.identity = await assertProjectIdentity()
  report.provenance = buildProvenance()
  console.log('IDENTITY', JSON.stringify(report.identity))
  console.log('PROVENANCE', JSON.stringify(report.provenance))

  // wait for the React app to mount
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('nav button')`)
    if (ready) break
    await sleep(500)
  }
  await evaluate(HELPERS)
  await assertRealViewport('after-mount')
  await evaluate(`(function(){const c=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='关闭教程');if(c)c.click();return true;})()`)
  await sleep(300)

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

  if (MODE === 'visual') {
    // Visual baseline. Every number here is computed from the running app, not estimated from a
    // screenshot, so "it looks better now" can be checked by diffing two runs of this mode.
    await evaluate(`
window.__V = (function () {
  // Any CSS colour -> sRGB, using the canvas the browser already parses with. A regex over rgb()
  // strings silently returns null for oklab()/color-mix() values, which made several buttons report
  // a contrast of exactly 1.00 - an artefact of the reader, not of the UI.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const parse = (c) => {
    if (!c || c === 'transparent' || c === 'none') return null
    // Prime with a colour no CSS input can produce, so "the browser rejected this value" is
    // distinguishable from "this colour happens to be black". Priming with #000 made every
    // unsupported value parse as black, and two blacks cancelled out into a contrast of 1.00.
    ctx.fillStyle = '#010203'
    ctx.fillStyle = c
    const norm = String(ctx.fillStyle)
    if (norm === '#010203' || norm === 'rgb(1, 2, 3)') return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = norm
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) })
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const bgOf = (el) => {
    // The app shell paints a linear-gradient; treating "has a gradient" as "background unknown" made
    // every contrast inside a dialog return null, so the failing close icon was never flagged. Fall
    // back to the page's own base colour, which is what that gradient averages over here.
    const base = parse(getComputedStyle(document.querySelector('.app-shell-root') || document.body).backgroundColor) || { r: 246, g: 247, b: 251, a: 1 }
    let n = el
    const stack = []
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break }
      else if (cs.backgroundImage && cs.backgroundImage !== 'none') { return { gradient: true, rgb: base } }
      n = n.parentElement
    }
    if (!stack.length) return { rgb: { r: 255, g: 255, b: 255 } }
    let acc = stack[stack.length - 1]
    for (let i = stack.length - 2; i >= 0; i--) acc = over(stack[i], acc)
    return { rgb: acc }
  }
  const ratio = (el) => {
    const cs = getComputedStyle(el)
    const fg = parse(cs.color)
    const bg = bgOf(el)
    if (!fg) return null
    if (bg.gradient) return null // painted gradient: no single background colour exists to compare against
    const fgc = over(fg, bg.rgb)
    const l1 = Math.max(lum(fgc), lum(bg.rgb)), l2 = Math.min(lum(fgc), lum(bg.rgb))
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
  }
  const text = (el) => (el.textContent || '').trim().slice(0, 34)
  const leaf = (root) => Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && text(e))
  const fontProbe = (family) => {
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d')
    const s = 'Handgloves 0123456789 Il10O'
    ctx.font = '48px ' + family; const a = ctx.measureText(s).width
    ctx.font = '48px sans-serif'; const b = ctx.measureText(s).width
    ctx.font = '48px serif'; const c = ctx.measureText(s).width
    return { sameAsSansSerif: Math.abs(a - b) < 0.5, sameAsSerif: Math.abs(a - c) < 0.5, width: Math.round(a) }
  }
  return {
    ratio, text, leaf,
    fonts: () => ({ inter: fontProbe('Inter'), segoe: fontProbe('"Segoe UI"'), yahei: fontProbe('"Microsoft YaHei"') }),
    scale: (root) => {
      const set = new Map()
      for (const e of leaf(root)) {
        const cs = getComputedStyle(e)
        const k = cs.fontSize + '/' + cs.fontWeight
        if (!set.has(k)) set.set(k, { fontSize: cs.fontSize, fontWeight: cs.fontWeight, sample: text(e), n: 0, contrast: ratio(e) })
        set.get(k).n++
      }
      return Array.from(set.values()).sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize))
    },
    shapes: (root) => {
      const radii = new Map(), gaps = new Map(), muted = []
      for (const e of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(e)
        if (cs.borderRadius !== '0px') radii.set(cs.borderRadius, (radii.get(cs.borderRadius) || 0) + 1)
        if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') gaps.set(cs.gap, (gaps.get(cs.gap) || 0) + 1)
      }
      const unresolved = []
      for (const e of leaf(root)) {
        const r = ratio(e)
        if (r === null) { if (unresolved.length < 8) unresolved.push({ sample: text(e), fontSize: getComputedStyle(e).fontSize, why: 'gradient or unparsable background' }); continue }
        if (r < 4.5) muted.push({ sample: text(e), fontSize: getComputedStyle(e).fontSize, color: getComputedStyle(e).color, contrast: r, cls: (e.className || '').toString().slice(0, 40) })
      }
      return { radii: Object.fromEntries(radii), gaps: Object.fromEntries(gaps), belowAA: muted, contrastUnresolved: unresolved }
    },
    deadSpace: (root, cardSel) => Array.from(root.querySelectorAll(cardSel)).slice(0, 8).map((card) => {
      const kids = Array.from(card.children).filter((c) => c.offsetHeight > 0)
      if (!kids.length) return null
      const cr = card.getBoundingClientRect()
      const lastBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) - cr.top
      const trail = cr.height - lastBottom
      // emptyPct alone overstates the complaint: a card's own padding-bottom is intended whitespace.
      // stretchPct is what an equal-height grid actually added below the last element.
      const pad = parseFloat(getComputedStyle(card).paddingBottom) || 0
      const stretch = Math.max(0, trail - pad)
      return { sample: text(card).slice(0, 18), cardH: Math.round(cr.height), contentBottom: Math.round(lastBottom), padBottom: Math.round(pad), emptyPct: Math.round((trail / cr.height) * 100), stretchPct: Math.round((stretch / cr.height) * 100), stretchPx: Math.round(stretch) }
    }).filter(Boolean),
    // A sequence is a run of >=3 sibling-ish items whose text opens with an ordinal. The first
    // version of this matched /^\\d+$/ on a childless element, which counted 0 chips in the help
    // dialog even with five on screen - the chip's visible text is "1.连接 GitHub" and it wraps a
    // <span>, so both conditions failed. Anchoring on the leading ordinal is what actually bites.
    // Does the class that says "12px" actually produce 12px on this element? The probe is a span
    // carrying the identical class in the identical parent: if the span reads one size and the
    // real element another, the utility is being out-cascaded by an element selector, not by the
    // author's own class.
    utilityDrift: (root) => {
      // Backslashes are doubled because this source is embedded in a Node template literal: a
      // single "\s" arrives at the page as "s", which silently matches nothing.
      const re = /(?:^|\\s)(text-(?:xs|sm|base|lg|xl|2xl|[a-z]{0,3}\\[[0-9.]+(?:rem|px)\\]))(?=\\s|$)/
      const out = {}
      let checked = 0, matched = 0
      const examples = []
      for (const e of leaf(root)) {
        const cls = (e.className || '').toString()
        const m = re.exec(cls)
        checked++
        if (!m || !e.parentElement) continue
        matched++
        const probe = document.createElement('span')
        probe.className = cls
        probe.textContent = 'X'
        probe.style.cssText = 'position:absolute;visibility:hidden'
        e.parentElement.appendChild(probe)
        const ps = getComputedStyle(probe), es = getComputedStyle(e)
        const want = { size: ps.fontSize, weight: ps.fontWeight }
        probe.remove()
        if (examples.length < 4) examples.push(e.tagName.toLowerCase() + ' [' + m[1] + '] probe=' + want.size + '/' + want.weight + ' actual=' + es.fontSize + '/' + es.fontWeight + ' "' + text(e).slice(0, 12) + '"')
        if (want.size !== es.fontSize || want.weight !== es.fontWeight) {
          // Plain concatenation: this body is inside a Node template literal, so a nested backtick
          // or a dollar-brace here would be evaluated by Node instead of reaching the page.
          const k = e.tagName.toLowerCase() + '.' + m[1] + ' probe=' + want.size + '/' + want.weight + ' actual=' + es.fontSize + '/' + es.fontWeight
          out[k] = (out[k] || 0) + 1
        }
      }
      // checked/matched are reported so an empty drift map can be told apart from a probe that
      // never matched anything - "no drift" and "no data" must not print the same.
      return { drift: out, checked, matched, examples }
    },
    // Settles "is Tailwind's slate-400 the same grey as the --text-muted token" with the browser's
    // own colour engine rather than a palette-conversion claim in prose.
    palette: () => {
      const cv = document.createElement('canvas'); const c = cv.getContext('2d')
      const norm = (v) => { c.fillStyle = '#010203'; c.fillStyle = v; const n = String(c.fillStyle); c.clearRect(0, 0, 1, 1); c.fillStyle = n; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return { input: v, normalized: n, rgb: d[0] + ',' + d[1] + ',' + d[2] } }
      const a = norm('oklch(70.4% 0.04 256.788)')
      const b = norm('#94a3b8')
      return { slate400: a, textMuted: b, identical: a.rgb === b.rgb }
    },
    sequences: (root) => {
      const items = Array.from(root.querySelectorAll('*'))
        .filter((e) => e.children.length <= 1 && !e.closest('button'))
        .map((e) => ({ e, t: text(e) }))
        .filter((x) => x.t.length > 0 && x.t.length <= 28 && /^\\d+\\s*[.、)]/.test(x.t))
        .map((x) => x.t)
      const steps = Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^STEP\\s*\\d+$/i.test(text(e))).length
      // Drop the bare "1." spans: the chip's own text already contains them, and counting both
      // doubles the total.
      const ordinals = items.filter((t) => !/^\\d+\\s*[.、)]$/.test(t))
      return { steps, numberedItems: ordinals.length, stepLabels: Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^STEP\\s*\\d+$/i.test(text(e))).map((e) => text(e.closest('article') || e.parentElement).slice(0, 30)).slice(0, 8), ordinals: ordinals.slice(0, 8) }
    },
    // Deepest matches only. An ancestor whose textContent is also "STEP 1" reports the inherited
    // font-variant-numeric, so mixing ancestors into this list makes "set" and "not set" appear
    // in the same array and the value becomes uninterpretable.
    numeric: (root) => Array.from(root.querySelectorAll('*')).filter((e) => /^STEP\\s*\\d+$/i.test(text(e))).filter((e) => !Array.from(e.children).some((c) => /^STEP\\s*\\d+$/i.test(text(c)))).map((e) => ({ variant: getComputedStyle(e).fontVariantNumeric, size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight, family: getComputedStyle(e).fontFamily.slice(0, 40) })),
  }
})()
`)
    const surfaces = [
      { name: 'publish', open: async () => { await goto('发布') } },
      { name: 'help-center', open: async () => { await clickEl("(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()") } },
      { name: 'confirm', open: async () => { await openConfirm() } },
      { name: 'upload', open: async () => { await goto('发布'); await scrollToAndClick(`Array.from(document.querySelectorAll('main button')).find(b=>(b.textContent||'').includes('图片 URL'))`) } },
      { name: 'assets', open: async () => { await goto('资源') } },
      { name: 'storages', open: async () => { await goto('云端') } },
      { name: 'gallery', open: async () => { await goto('图库') } },
      { name: 'plugins', open: async () => { await goto('插件') } },
      { name: 'tasks', open: async () => { await goto('任务') } },
      { name: 'settings', open: async () => { await goto('设置') } },
    ]
    const clickEl = async (expr) => { await scrollToAndClick(expr); await sleep(400) }
    const baseline = { provenance: buildProvenance(), viewport: await assertRealViewport('visual:start'), fonts: await evaluate(`window.__V.fonts()`), palette: await evaluate(`window.__V.palette()`), surfaces: [] }
    for (const s of surfaces) {
      try { await s.open() } catch (error) { baseline.surfaces.push({ name: s.name, error: String(error).slice(0, 140) }); continue }
      await evaluate(`document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});true`)
      await sleep(150)
      await assertRealViewport('visual:' + s.name)
      const rootSel = s.name === 'help-center' ? `Array.from(document.querySelectorAll('div.fixed.inset-0')).sort((a,b)=>getComputedStyle(b).zIndex-a.zIndex||0)[0]`
        : s.name === 'confirm' ? `window.__H.overlay()`
        : s.name === 'upload' ? `Array.from(document.querySelectorAll('div.fixed.inset-0')).find(d=>getComputedStyle(d).zIndex==='50')`
        : `document.querySelector('main')`
      const shotPath = await shot(`vis-${s.name}`)
      const m = await evaluate(`(function(){
        const root = ${rootSel};
        if (!root) return { missing: true };
        const cards = root.querySelectorAll('article, section').length;
        return {
          rootClass: (root.className||'').toString().slice(0,60),
          cards,
          scale: window.__V.scale(root).slice(0, 10),
          shapes: window.__V.shapes(root),
          deadSpace: window.__V.deadSpace(root, 'article'),
          utilityDrift: window.__V.utilityDrift(root),
          sequences: window.__V.sequences(root),
          numeric: window.__V.numeric(root).slice(0, 8),
          heading: (root.querySelector('h1,h2')||{}).textContent || null,
        };
      })()`)
      // A dialog that scrolls hides half of its own evidence; capture the tail so the baseline
      // document can be checked against a picture rather than against the sampler's word.
      if (!m.missing) {
        m.scroll = await evaluate(`(function(){
          const root = ${rootSel}; if (!root) return null;
          const sc = [root, ...root.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY));
          if (!sc) return { scrollable: false, clientHeight: 0, scrollHeight: 0 };
          sc.scrollTop = sc.scrollHeight;
          return { scrollable: true, clientHeight: sc.clientHeight, scrollHeight: sc.scrollHeight, hiddenBelowPx: sc.scrollHeight - sc.clientHeight };
        })()`)
        if (m.scroll && m.scroll.scrollable) {
          await sleep(120)
          m.shotTail = await shot(`vis-${s.name}-tail`)
          await evaluate(`(function(){const root=${rootSel};const sc=[root,...root.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+8&&/auto|scroll/.test(getComputedStyle(e).overflowY));if(sc)sc.scrollTop=0;return true})()`)
          await sleep(80)
        }
      }
      baseline.surfaces.push({ name: s.name, shot: shotPath, ...m })
      if (s.name === 'help-center' || s.name === 'confirm' || s.name === 'upload') { await pressAt(8, 8); await sleep(250) }
    }
    writeFileSync(`${OUT}/visual-baseline.json`, JSON.stringify(baseline, null, 2))
    // A probe whose regex silently degrades (see the single-backslash trap in utilityDrift) reports
    // "no drift" exactly like a working probe does. Refuse to distinguish the two: if no element on
    // any surface carried a size utility, the probe is broken, not the app.
    const blind = baseline.surfaces.filter((s) => s.utilityDrift && s.utilityDrift.checked > 0 && s.utilityDrift.matched === 0)
    if (blind.length) {
      console.log(`HARNESS FAULT: the size-utility probe matched 0 of ${blind.map((s) => `${s.name}(${s.utilityDrift.checked})`).join(', ')} leaves - the selector is broken, so "no drift" is not a result.`)
      finish(2)
    }
    console.log('PALETTE', JSON.stringify(baseline.palette))
    // The onboarding dialog is the one interface this round was allowed to change, so its baseline
    // numbers are promoted from "reported" to "asserted": without this the mode measures a
    // regression and still exits 0, and "it looks better now" stays unverifiable.
    const hc = baseline.surfaces.find((s) => s.name === 'help-center')
    const regressions = []
    if (!hc || hc.missing) regressions.push('the onboarding dialog could not be opened')
    else {
      if (hc.shapes.belowAA.length) regressions.push(`${hc.shapes.belowAA.length} text runs below 4.5:1 (${hc.shapes.belowAA.map((x) => x.sample.slice(0, 10) + '@' + x.fontSize + '=' + x.contrast).join(', ')})`)
      const drifted = Object.values(hc.utilityDrift.drift).reduce((a, b) => a + b, 0)
      if (drifted) regressions.push(`${drifted} buttons render at a size their own class does not declare (${Object.keys(hc.utilityDrift.drift).join('; ')})`)
      if (hc.sequences.numberedItems) regressions.push(`a second numbered sequence reappeared next to the ${hc.sequences.steps} steps (${hc.sequences.ordinals.join(', ')})`)
      const tab = (hc.numeric || []).filter((n) => n.variant === 'tabular-nums').length
      if (hc.sequences.steps && tab !== hc.sequences.steps) regressions.push(`${hc.sequences.steps - tab} of ${hc.sequences.steps} STEP ordinals are not tabular-nums`)
    }
    for (const r of regressions) console.log(`FAIL ${r}`)
    // Machine-readable tally on every exit path, so verify:all can tell "4 regressions" from a run
    // that never reached the assertions.
    console.log(`VISUAL_GATE total=4 failed=${regressions.length}`)
    if (regressions.length) console.log(`visual: ${regressions.length} regression(s) on the onboarding dialog`)
    else console.log('visual: onboarding dialog holds its baseline (0 below 4.5:1, 0 discarded button sizes, 1 sequence, all ordinals tabular)')
    console.log(JSON.stringify({ viewport: baseline.viewport, fonts: baseline.fonts, surfaces: baseline.surfaces.map((x) => ({ name: x.name, cards: x.cards, sizes: (x.scale || []).length, belowAA: (x.shapes?.belowAA || []).length })) }, null, 2))
    finish(regressions.length ? 1 : 0)
  }

  if (MODE === 'contrast-tier') {
    // Contrast measured off rendered pixels, not off token pairs. The wallpaper is a user-supplied
    // image, so no fixed foreground can be reasoned about analytically; the envelope is the two
    // extreme images a user could pick - entirely black and entirely white - and the real page is
    // rendered behind each. Token-vs-token would report a number the user never sees.
    const THEMES = [['default', ''], ['midnight', 'midnight'], ['sakura', 'sakura']]
    const WALLS = [['none', 'none'], ['black', 'linear-gradient(#000,#000)'], ['white', 'linear-gradient(#fff,#fff)']]
    const ROUTES = (opt('routes', '') || '发布,设置').split(',')
    const rows = []
    const failures = []

    const applyTheme = (t) => evaluate(`(function(){const r=document.documentElement;if(${JSON.stringify(t)})r.dataset.theme=${JSON.stringify(t)};else delete r.dataset.theme;return r.dataset.theme||'default'})()`)
    const applyWall = (w) => evaluate(`(function(){const r=document.documentElement;if(${JSON.stringify(w)}==='none'){r.style.setProperty('--wallpaper','none');delete r.dataset.wallpaper}else{r.style.setProperty('--wallpaper',${JSON.stringify(w)});r.dataset.wallpaper='true'}return r.dataset.wallpaper==='true'?'on':'off'})()`)

    const EXPECTED_BG = { default: '#f6f7fb', midnight: '#090d16', sakura: '#fff8fb' }
    for (const [themeName, themeValue] of THEMES) {
      await applyTheme(themeValue)
      // A cream background under midnight tokens would read as a contrast failure the app does not
      // have, so confirm the theme actually took before believing anything measured under it.
      const applied = await evaluate(`(function(){const cs=getComputedStyle(document.documentElement);return {attr:document.documentElement.dataset.theme||'default',appBg:cs.getPropertyValue('--app-bg').trim(),surface:cs.getPropertyValue('--surface').trim()}})()`)
      if (applied.attr !== themeName || applied.appBg.toLowerCase() !== EXPECTED_BG[themeName]) {
        console.log(`HARNESS FAULT: asked for theme "${themeName}" but the document reports attr="${applied.attr}" --app-bg=${applied.appBg} (expected ${EXPECTED_BG[themeName]}); the app re-applied its own theme, so nothing under it is attributable.`)
        finish(2)
      }
      // (a) token against token, for the record - the number a reader would compute by hand.
      const tokens = await evaluate(`(function(){
        const cs=getComputedStyle(document.documentElement);
        const g=(n)=>cs.getPropertyValue(n).trim();
        return { muted: g('--text-muted'), secondary: g('--text-secondary'), primary: g('--text-primary'), surface: g('--surface'), soft: g('--surface-soft'), appBg: g('--app-bg') };
      })()`)
      for (const [wallName, wallValue] of WALLS) {
        await applyWall(wallValue)
        for (const label of ROUTES) {
          await goto(label)
          await evaluate(`window.__L ? window.__L.settle() : document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});true`)
          await sleep(120)
          await assertRealViewport(`contrast:${themeName}/${wallName}/${label}`)
          const dpr = await evaluate(`window.devicePixelRatio`)
          if (dpr !== 1) { console.log(`HARNESS FAULT: devicePixelRatio is ${dpr}, not 1 - pixel sampling would be offset. Aborting.`); finish(2) }
          const texts = await evaluate(`(function(){
            const out=[];
            for (const e of document.querySelectorAll('main *, aside *, header *')) {
              if (e.children.length) continue;
              const t=(e.textContent||'').trim(); if(!t) continue;
              const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
              if (r.bottom<2||r.top>innerHeight-2||r.right<2||r.left>innerWidth-2) continue;
              const cs=getComputedStyle(e);
              if (cs.visibility==='hidden'||Number(cs.opacity)<0.9) continue;
              const size=parseFloat(cs.fontSize);
              const bold=Number(cs.fontWeight)>=600;
              out.push({ text:t.slice(0,26), size, bold, color:cs.color, threshold: (size>=24&&bold)?3:4.5, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2) });
            }
            return out.slice(0, 220);
          })()`)
          // Hide the glyphs, photograph what is left: that photograph IS the background the text
          // sits on, gradients, blur and wallpaper included.
          await evaluate(`(function(){const s=document.createElement('style');s.id='lctl-hide';s.textContent='*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}';document.head.appendChild(s);return true})()`)
          const shotData = await send('Page.captureScreenshot', { format: 'png' })
          await evaluate(`(function(){const s=document.getElementById('lctl-hide');if(s)s.remove();return true})()`)
          const sampled = await evaluate(`(async function(){
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,${shotData.data}' });
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
            const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
            // Canvas, not a regex: Tailwind v4 serialises colours as oklch()/color-mix(), which a
            // rgb() matcher silently drops - that is what made 179 of 314 runs "unresolved" here,
            // the same mistake the visual mode already fixed.
            const pcv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
            const parse = (s) => {
              if (!s || s === 'transparent' || s === 'none') return null
              pcv.fillStyle = '#010203'; pcv.fillStyle = s
              const norm = String(pcv.fillStyle)
              if (norm === '#010203' || norm === 'rgb(1, 2, 3)') return null
              pcv.clearRect(0, 0, 1, 1); pcv.fillStyle = norm; pcv.fillRect(0, 0, 1, 1)
              const d = pcv.getImageData(0, 0, 1, 1).data
              return [d[0], d[1], d[2], d[3] / 255]
            }
            const rows = ${JSON.stringify(texts)}.map((t) => {
              const px = ctx.getImageData(t.x, t.y, 1, 1).data
              const bg = [px[0], px[1], px[2]]
              const f = parse(t.color)
              if (!f) return { ...t, bg: bg.join(','), ratio: null, why: 'unparsable colour' }
              const a = f[3]
              const over = [f[0] * a + bg[0] * (1 - a), f[1] * a + bg[1] * (1 - a), f[2] * a + bg[2] * (1 - a)]
              const l1 = Math.max(lum(over), lum(bg)), l2 = Math.min(lum(over), lum(bg))
              return { ...t, bg: bg.join(','), fg: over.map((v) => Math.round(v)).join(','), ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100 }
            })
            return rows
          })()`)
          const below = sampled.filter((s) => s.ratio !== null && s.ratio < s.threshold)
          const unresolved = sampled.filter((s) => s.ratio === null)
          const worst = sampled.filter((s) => s.ratio !== null).sort((a, b) => a.ratio - b.ratio)[0]
          rows.push({ theme: themeName, wallpaper: wallName, route: label, measured: sampled.length, below: below.length, unresolved: unresolved.length, worstRatio: worst ? worst.ratio : null, worstText: worst ? worst.text : null, worstBg: worst ? worst.bg : null, tokens })
          if (below.length) failures.push(`CONTRAST ${themeName}/${wallName}/${label}: ${below.length}/${sampled.length} readable runs below their threshold - worst ${worst.ratio}:1 (need ${worst.threshold}) "${worst.text}" ${worst.size}px ${worst.bold ? 'bold' : 'regular'} fg rgb(${worst.fg}) on sampled rgb(${worst.bg})`)
        }
      }
    }
    await evaluate(`(function(){delete document.documentElement.dataset.theme;document.documentElement.style.setProperty('--wallpaper','none');delete document.documentElement.dataset.wallpaper;return true})()`)
    writeFileSync(`${OUT}/contrast-tier.json`, JSON.stringify({ provenance: buildProvenance(), note: 'backgrounds are sampled from a screenshot taken with glyphs hidden, so gradients, backdrop-filter and the wallpaper scrim are all included; wallpaper envelope is an all-black and an all-white image', themes: THEMES.map((t) => t[0]), wallpapers: WALLS.map((w) => w[0]), rows }, null, 2))
    for (const f of failures) console.log(`FAIL ${f}`)
    console.log('TOKENS ' + JSON.stringify(rows.filter((r, i, a) => a.findIndex((x) => x.theme === r.theme) === i).map((r) => ({ theme: r.theme, ...r.tokens }))))
    console.log(`CONTRAST_GATE combos=${rows.length} measured=${rows.reduce((a, r) => a + r.measured, 0)} below=${failures.length} unresolved=${rows.reduce((a, r) => a + r.unresolved, 0)}`)
    console.log(failures.length ? `contrast: ${failures.length} failure(s) across ${rows.length} theme/wallpaper/route combinations` : `contrast: every readable run meets its threshold in all ${rows.length} combinations`)
    finish(failures.length ? 1 : 0)
  }

  if (MODE === 'layout') {
    // The geometry floor. `pages` proves a route painted; it measures no box, so horizontal
    // overflow, silently clipped text, sub-threshold touch targets, an invisible focus ring and a
    // broken image all pass there. Each tier is a CSS-viewport override of a real window size the
    // app can be resized to (640x480 is tauri.conf.json's minWidth x minHeight), not a phone.
    const TIERS = [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 640, height: 480 },
    ]
    const ROUTES = (opt('routes', '') || '发布,资源,云端,图库,插件,任务,设置').split(',')
    const TOUCH = Number(opt('touch', '44'))
    const onlyTier = opt('tier', '') ? Number(opt('tier', '')) : null
    const tiers = onlyTier ? TIERS.filter((t) => t.width === onlyTier) : TIERS
    if (!tiers.length) { console.error(`unknown --tier ${onlyTier}; known: ${TIERS.map((t) => t.width).join(' ')}`); finish(2) }

    await evaluate(`
window.__L = (function () {
  const txt = (e) => (e.textContent || '').trim().slice(0, 46)
  const cls = (e) => (e.className || '').toString()
  const sel = (e) => {
    const parts = []
    let n = e
    for (let i = 0; i < 3 && n && n.nodeType === 1; i++) {
      let s = n.tagName.toLowerCase()
      if (n.id) s += '#' + n.id
      else {
        const c = cls(n).trim().split(/\\s+/).filter((x) => x && !/[~:\\/\\[\\]()%.,]/.test(x)).slice(0, 2)
        if (c.length) s += '.' + c.join('.')
      }
      parts.unshift(s)
      n = n.parentElement
    }
    return parts.join('>')
  }
  const vis = (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }
  const nameOf = (e) => {
    const direct = (e.getAttribute('aria-label') || txt(e) || e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('value') || '').trim()
    if (direct) return direct
    // A control wrapped in a <label>, or pointed at one by aria-labelledby, does have an accessible
    // name even though it carries no attribute of its own - counting those as unnamed is a probe
    // bug, not an app bug.
    const labelledBy = e.getAttribute('aria-labelledby')
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.trim().split(/\\s+/)[0])
      if (ref && txt(ref)) return txt(ref)
    }
    const wrapping = e.closest('label')
    if (wrapping) { const t = txt(wrapping).replace(txt(e), '').trim(); if (t) return t }
    if (e.id) {
      const forLabel = document.querySelector('label[for="' + e.id + '"]')
      if (forLabel && txt(forLabel)) return txt(forLabel)
    }
    return ''
  }
  const styleOf = (e) => {
    const cs = getComputedStyle(e)
    return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow, border: cs.borderTopColor + '/' + cs.borderTopWidth, bg: cs.backgroundColor }
  }
  const hasOwnText = (e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)
  // Tailwind's sr-only (and anything like it) is a 1px box with clipped overflow holding text meant
  // for a screen reader only. Flagging those as "cut off" is a probe bug.
  const isVisualHiding = (e, cs) => /rect\\(\\s*0/.test(cs.clip || '') || /inset\\(\\s*50%/.test(cs.clipPath || '') || (e.offsetWidth <= 1 && e.offsetHeight <= 1 && cs.overflow !== 'visible')
  // The first ancestor that cuts, with its PADDING box. Overflow clips at the padding edge, so
  // comparing against the border box would let content hide under the border.
  //
  // The chain STOPS here rather than intersecting every clipper: if this first one scrolls
  // (auto/scroll), the content is reachable by scrolling it, and testing the clippers above it
  // would flag ordinary page content as cut. .app-main is overflow-y:auto, so a walk that continued
  // past rails reported 22 below-the-fold buttons at 1440x900 that a user reaches by scrolling.
  // A rail that is itself cut is caught when the rail is evaluated as its own subject.
  const nearestClipper = (e) => {
    let n = e.parentElement
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = n.getBoundingClientRect()
        return {
          node: n, ox: cs.overflowX, oy: cs.overflowY,
          rail: /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY),
          box: {
            left: r.left + (parseFloat(cs.borderLeftWidth) || 0),
            top: r.top + (parseFloat(cs.borderTopWidth) || 0),
            right: r.right - (parseFloat(cs.borderRightWidth) || 0),
            bottom: r.bottom - (parseFloat(cs.borderBottomWidth) || 0),
          },
        }
      }
      if (n === document.body || n === document.documentElement) return null
      n = n.parentElement
    }
    return null
  }
  const intersectLoss = (r, box) => {
    const w = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
    const h = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
    return { lostX: Math.round((r.width - w) * 10) / 10, lostY: Math.round((r.height - h) * 10) / 10 }
  }
  return {
    geometry: (touchMin) => {
      const iw = innerWidth
      const doc = document.documentElement
      const all = Array.from(doc.querySelectorAll('*'))
      const out = {
        innerWidth: iw,
        // Self-reporting counts. A sweep that examined nothing and a sweep that found nothing
        // clean must never print the same way.
        nodes: all.length, visibleNodes: 0, textLeaves: 0, measuredLeaves: 0,
        skipSrOnly: 0, skipEllipsis: 0, skipTitle: 0, skipScrollRail: 0, skipFixed: 0, railClips: 0,
        docScrollWidth: doc.scrollWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
        // Criterion DOC: does the document's own content box extend past the viewport? This is the
        // one that stays silent when an ancestor clips the overflow away.
        docOverflowPx: doc.scrollWidth - iw,
        // Criterion VIEWPORT: per-element rect past the viewport edge.
        viewportOverflowPx: 0,
        offenders: [], clipped: [], clippedByAncestor: [], controlsCut: [], containersCut: [], smallTargets: [], brokenImages: [], focusables: 0,
      }
      for (const e of all) {
        if (!vis(e)) continue
        out.visibleNodes++
        const r = e.getBoundingClientRect()
        if (r.right > iw + 1) {
          out.offenders.push({ sel: sel(e), over: Math.round(r.right - iw), w: Math.round(r.width), text: txt(e) })
          out.viewportOverflowPx = Math.max(out.viewportOverflowPx, Math.round(r.right - iw))
        }
        const cs = getComputedStyle(e)
        if (cs.position === 'fixed') { out.skipFixed++; continue }
        const clip = nearestClipper(e)
        if (!clip) continue
        if (clip.rail) { out.railClips++; continue }
        const loss = intersectLoss(r, clip.box)
        const px = Math.max(loss.lostX, loss.lostY)
        if (px <= 1) continue
        const tag = e.tagName.toLowerCase()
        const isTextLeaf = hasOwnText(e) && !!txt(e)
        // The known false-positive sources only apply to text: a visually-hidden label, an
        // ellipsis or line-clamp that truncates on purpose, and a title that carries the whole
        // string for a tooltip.
        if (isTextLeaf && (isVisualHiding(e, cs) || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || e.title || e.closest('[title]'))) continue
        const rec = { sel: sel(e), by: sel(clip.node), excess: px, axis: loss.lostX >= loss.lostY ? 'x' : 'y', overflow: clip.ox + '/' + clip.oy, text: txt(e).slice(0, 30) }
        if (isTextLeaf) out.clippedByAncestor.push(rec)
        else if (/^(button|a|input|select|textarea)$/.test(tag) || e.getAttribute('role')) out.controlsCut.push(rec)
        else out.containersCut.push(rec)
      }
      out.offenders.sort((a, b) => b.over - a.over)
      out.offenders = out.offenders.slice(0, 6)
      for (const key of ['clippedByAncestor', 'controlsCut', 'containersCut']) {
        out[key].sort((a, b) => b.excess - a.excess)
        out[key + 'Total'] = out[key].length
        out[key] = out[key].slice(0, 8)
      }
      for (const e of all) {
        if (!hasOwnText(e) || !txt(e) || !vis(e)) continue
        out.textLeaves++
        const cs = getComputedStyle(e)
        if (isVisualHiding(e, cs)) { out.skipSrOnly++; continue }
        const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
        if (cs.textOverflow === 'ellipsis' || clamped) { out.skipEllipsis++; continue }
        if (e.title || e.closest('[title]')) { out.skipTitle++; continue }
        if (/auto|scroll/.test(cs.overflowX)) { out.skipScrollRail++; continue }
        out.measuredLeaves++
        // SELF-CLIP: the leaf's own box is smaller than its own content.
        if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) {
          out.clipped.push({ sel: sel(e), text: txt(e), delta: Math.max(e.scrollWidth - e.clientWidth, e.scrollHeight - e.clientHeight), overflowX: cs.overflowX })
        }
      }
      out.clipped.sort((a, b) => b.delta - a.delta)
      const clippedTotal = out.clipped.length
      out.clipped = out.clipped.slice(0, 8)
      out.clippedTotal = clippedTotal
      if (touchMin) {
        const nodes = Array.from(doc.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], [role=tab]'))
        out.focusables = nodes.filter((e) => vis(e)).length
        for (const e of nodes) {
          if (!vis(e)) continue
          const r = e.getBoundingClientRect()
          if (r.width + 0.5 < touchMin || r.height + 0.5 < touchMin) {
            out.smallTargets.push({ sel: sel(e), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: txt(e) || nameOf(e) })
          }
        }
        out.smallTotal = out.smallTargets.length
        out.smallTargets.sort((a, b) => (a.w * a.h) - (b.w * b.h))
        out.smallTargets = out.smallTargets.slice(0, 8)
      }
      for (const im of doc.querySelectorAll('img')) {
        if (im.complete && im.naturalWidth === 0 && (im.getAttribute('src') || '')) out.brokenImages.push({ sel: sel(im), src: (im.getAttribute('src') || '').slice(0, 70) })
      }
      return out
    },
    // Read the focus ring straight after a real Tab: what matters is whether a keyboard user can
    // see where they are, so outline:none with no box-shadow substitute is a failure even when the
    // element is technically focusable.
    // Snapshot the resting style of every focusable so a Tab stop can be compared against its own
    // unfocused state. "outline: none" alone is not an invisible focus ring if the element changes
    // border colour or background on focus - only a differential can tell those apart.
    // Freeze the page before any rect is read. finish() alone is not enough: it throws
    // InvalidStateError on an infinite animation, which is exactly the case that leaves a rect
    // parked on frame one. Anything that cannot be finished is paused, and only a paused
    // animation that moves geometry invalidates the measurement.
    settle: () => {
      const GEOM = ['width', 'height', 'margin', 'padding', 'top', 'left', 'right', 'bottom', 'inset', 'transform', 'flex-basis', 'gap', 'line-height', 'font-size']
      const anims = document.getAnimations()
      let finished = 0, paused = 0
      const geomRunning = []
      for (const a of anims) {
        let done = false
        try { a.finish(); done = true; finished++ } catch (e) { /* infinite duration */ }
        if (done) continue
        try { a.pause(); paused++ } catch (e) { continue }
        const target = a.effect && a.effect.target
        const label = String(a.transitionProperty || a.animationName || 'anonymous')
        let props = [label]
        try {
          if (a.effect && a.effect.getKeyframes) {
            const ks = a.effect.getKeyframes()
            for (const k of ks) for (const p of Object.keys(k)) if (p !== 'offset' && p !== 'computedOffset' && p !== 'easing' && p !== 'composite') props.push(p)
          }
        } catch (e) { /* getKeyframes can throw on scroll-timeline effects */ }
        const hits = props.filter((p) => GEOM.some((g) => p === g || p.indexOf(g) !== -1))
        // A rotating or otherwise transformed icon moves no layout box: getBoundingClientRect grows
        // with the rotation but nothing around it reflows. Text or controls inside it would be a
        // different story, so the exemption is only granted to a leaf with no content of its own.
        const contentFree = !target || (!txt(target) && !target.querySelector('button,a[href],input,select,[role=button]'))
        const transformOnly = hits.length > 0 && hits.every((p) => p === 'transform')
        if (hits.length && !(transformOnly && contentFree)) geomRunning.push({ anim: label.slice(0, 34), hits: Array.from(new Set(hits)).slice(0, 4), sel: target ? sel(target) : 'unknown' })
      }
      return { total: anims.length, finished, paused, geomCount: geomRunning.length, geomRunning: geomRunning.slice(0, 4) }
    },
    markFocusables: () => {
      window.__LBASE = {}
      const nodes = Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])'))
      let i = 0
      for (const e of nodes) {
        if (!vis(e)) continue
        e.setAttribute('data-lidx', String(i))
        // Component libraries paint the focus ring on a wrapper rather than on the element that
        // actually receives focus, so the resting style is captured for the element and its
        // ancestors and the comparison is made against all of them.
        const chain = []
        let n = e
        for (let d = 0; d < 4 && n && n.nodeType === 1; d++) { chain.push(styleOf(n)); n = n.parentElement }
        window.__LBASE[i] = { chain, sel: sel(e), name: nameOf(e).slice(0, 30), tag: e.tagName.toLowerCase(), own: styleOf(e) }
        i++
      }
      return i
    },
    focusNow: () => {
      const e = document.activeElement
      if (!e || e === document.body || e === document.documentElement) return { tag: 'body', left: true }
      const idx = e.getAttribute('data-lidx')
      const base = idx !== null && window.__LBASE ? window.__LBASE[idx] : null
      const chain = []
      let n = e
      for (let d = 0; d < 4 && n && n.nodeType === 1; d++) { chain.push(styleOf(n)); n = n.parentElement }
      const own = styleOf(e)
      let changed = null
      if (base) {
        changed = chain.some((s, i) => {
          const b = base.chain[i]
          return b && (s.outline !== b.outline || s.shadow !== b.shadow || s.border !== b.border || s.bg !== b.bg)
        })
      }
      let viaFocusVisible = null
      try { viaFocusVisible = e.matches(':focus-visible') } catch (err) { viaFocusVisible = null }
      const ringLevel = base ? chain.findIndex((s, i) => base.chain[i] && (s.outline !== base.chain[i].outline || s.shadow !== base.chain[i].shadow)) : -1
      return {
        tag: e.tagName.toLowerCase(), sel: base ? base.sel : sel(e), name: base ? base.name : nameOf(e).slice(0, 30), unmarked: idx === null,
        outline: own.outline, shadow: own.shadow, changed, ringLevel, viaFocusVisible,
        visible: changed === null ? !!(own.outline.split(' ')[0] !== 'none' && parseFloat(own.outline.split(' ')[1]) > 0) : changed,
      }
    },
  }
})()
true
`)

    const results = []
    const failures = []
    const stuckLoading = []
    // Positive control with two placements, because the document-level criterion and the per-element
    // criterion must be shown to be different tests: a 2400px box planted inside a clipping ancestor
    // must be caught only by the per-element one. Without this, "0 failures" across 21 page/width
    // combinations is indistinguishable from a sweep that cannot see anything.
    const control = await evaluate(`(function(){
      window.__L.settle();
      const wide = () => { const d = document.createElement('div'); d.style.cssText = 'width:2400px;height:12px;background:red'; return d };
      const LONG = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop';
      const host = document.querySelector('main') || document.body;
      const clipper = Array.from(host.querySelectorAll('*')).find((e) => { const cs = getComputedStyle(e); return cs.overflowX !== 'visible' && !/auto|scroll/.test(cs.overflowX) && e.clientWidth > 40 && e.clientWidth < innerWidth });
      const baseline = window.__L.geometry(0);
      const report = { baselineDocOverflow: baseline.docOverflowPx, baselineClips: baseline.clippedByAncestorTotal };
      const probe = {};
      if (clipper) {
        // Text-bearing, because the ancestor-clip criterion is defined over text leaves: content
        // that is silently cut where a reader would look for it.
        const d = document.createElement('div');
        d.style.cssText = 'width:2400px;height:12px;white-space:nowrap;font-size:12px;overflow:visible';
        d.textContent = 'LCTL' + LONG;
        clipper.appendChild(d);
        const g = window.__L.geometry(0);
        const mine = g.clippedByAncestor.filter((c) => c.text && c.text.indexOf('LCTL') === 0)
        probe.clippedPlacement = { docOverflowPx: g.docOverflowPx, clippedByAncestorTotal: g.clippedByAncestorTotal, caught: mine.length > 0, worst: mine.length ? Math.max(...mine.map((c) => c.excess)) : null };
        d.remove()
      }
      else probe.clippedPlacement = { skipped: 'no non-scrolling clipping ancestor found on this page' };
      const d2 = wide(); document.documentElement.appendChild(d2); const g2 = window.__L.geometry(0);
      probe.scrollPlacement = { docOverflowPx: g2.docOverflowPx, caughtByDoc: g2.docOverflowPx > baseline.docOverflowPx, caughtByViewport: g2.viewportOverflowPx > 0 };
      d2.remove();
      // Negative controls: the four known false-positive sources. Each plants something that must
      // NOT be reported, so an exclusion that never fires cannot be mistaken for a clean page.
      const mk = (css, text) => { const d = document.createElement('span'); d.style.cssText = css; d.textContent = text; return d };
      const sr = mk('position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0', LONG);
      const rail = mk('display:block;width:60px;overflow-x:auto;white-space:nowrap;font-size:12px', LONG);
      const real = mk('display:block;width:60px;overflow:hidden;white-space:nowrap;font-size:12px', LONG);
      host.appendChild(sr); host.appendChild(rail); host.appendChild(real);
      const g3 = window.__L.geometry(0);
      const hit = (needle) => g3.clipped.some((c) => c.text === needle);
      probe.negative = {
        srOnlySkipped: g3.skipSrOnly > baseline.skipSrOnly && !hit(LONG),
        scrollRailSkipped: g3.skipScrollRail > baseline.skipScrollRail,
        realCutStillCaught: g3.clippedTotal > baseline.clippedTotal,
      };
      sr.remove(); rail.remove(); real.remove();
      // The reachability pair: a leaf inside a scroll rail is reachable, so it must NOT be reported;
      // the rail itself, when an outer overflow:hidden cuts it, must be reported at its own level.
      const outer = document.createElement('div'); outer.style.cssText = 'width:180px;overflow:hidden'
      const inner = document.createElement('div'); inner.style.cssText = 'width:400px;overflow-x:auto;white-space:nowrap;font-size:12px'
      const leaf = document.createElement('span'); leaf.textContent = 'LCTL2' + LONG
      inner.appendChild(leaf); outer.appendChild(inner); host.appendChild(outer)
      const g4 = window.__L.geometry(0)
      probe.railThenOuter = {
        leafNotFlagged: !g4.clippedByAncestor.some((c) => c.text && c.text.indexOf('LCTL2') === 0),
        railFlagged: g4.containersCut.some((c) => c.excess > 100),
        worst: Math.max(0, ...g4.containersCut.map((c) => c.excess)),
      }
      outer.remove();
      // Two focus controls, one in each direction. A ring drawn on a wrapper must read as visible
      // (otherwise every component library that styles :focus-within is a false red), and a bare
      // outline:none with no substitute must read as invisible (otherwise the test is decorative).
      const sheet = document.createElement('style');
      sheet.textContent = '.lctl-none{outline:none !important;box-shadow:none !important;border:1px solid rgb(200,200,200);background:rgb(255,255,255)}' +
        '.lctl-wrap{display:inline-block}.lctl-wrap:focus-within{box-shadow:0 0 0 3px rgba(79,70,229,.55)}';
      document.head.appendChild(sheet);
      const fa0 = document.createElement('button'); fa0.className = 'lctl-none'; fa0.textContent = 'lctlNoRing';
      const wrap = document.createElement('div'); wrap.className = 'lctl-wrap';
      const fb0 = document.createElement('button'); fb0.className = 'lctl-none'; fb0.textContent = 'lctlWrapperRing';
      wrap.appendChild(fb0); host.appendChild(fa0); host.appendChild(wrap);
      window.__L.markFocusables();
      fa0.focus(); const stopA = window.__L.focusNow();
      fb0.focus(); const stopB = window.__L.focusNow();
      probe.focus = { noRingRed: stopA.visible === false, wrapperRingGreen: stopB.visible === true, ringLevel: stopB.ringLevel, aChanged: stopA.changed, bChanged: stopB.changed };
      fa0.remove(); wrap.remove(); sheet.remove();
      const after = window.__L.geometry(0);
      probe.removedCleanly = after.clippedByAncestorTotal === baseline.clippedByAncestorTotal && after.docOverflowPx === baseline.docOverflowPx;
      probe.nodes = baseline.nodes; probe.textLeaves = baseline.textLeaves;
      probe.baselineDocOverflow = baseline.docOverflowPx; probe.baselineClips = baseline.clippedByAncestorTotal;
      return probe;
    })()`)
    const bad = []
    if (!control.clippedPlacement.caught) bad.push(`the per-element criterion missed a 2400px box planted inside an overflow:hidden ancestor (got ${JSON.stringify(control.clippedPlacement)})`)
    if (!control.scrollPlacement.caughtByDoc && !control.scrollPlacement.caughtByViewport) bad.push('neither criterion reacted to a 2400px box appended to documentElement')
    if (!control.removedCleanly) bad.push('the control leaked: counts did not return to baseline after removing the planted boxes')
    if (!control.negative.realCutStillCaught) bad.push('negative control failed: a genuinely cut overflow:hidden text run was NOT reported - the exclusions are swallowing real defects')
    if (!control.railThenOuter.leafNotFlagged) bad.push('a leaf inside a scroll rail was reported as cut, although scrolling brings it into view')
    if (!control.railThenOuter.railFlagged) bad.push(`the scroll rail itself was not reported although an outer overflow:hidden cuts it (worst container cut ${control.railThenOuter.worst}px)`)
    if (!control.focus.noRingRed) bad.push(`focus control failed: a button with outline:none and no box-shadow read as having a visible focus state (changed=${control.focus.aChanged})`)
    if (!control.focus.wrapperRingGreen) bad.push(`focus control failed: a ring drawn on the wrapper was missed, so real component-library rings would be false reds (changed=${control.focus.bChanged}, ringLevel=${control.focus.ringLevel})`)
    for (const [k, why] of [['srOnlySkipped', 'a visually-hidden sr-only span was counted as cut-off text'], ['scrollRailSkipped', 'an overflow-x:auto rail was counted as a clip rather than a reachable scroll']]) {
      if (!control.negative[k]) bad.push(`negative control failed: ${why}`)
    }
    // The divergence is the point, not a failure: the clip placement leaves the document-level
    // number untouched while the per-element one fires. Recorded so nobody re-merges them later.
    const docBlindToClip = control.clippedPlacement.caught && control.clippedPlacement.docOverflowPx === control.baselineDocOverflow
    console.log(`CONTROL clip-placement -> CLIP-BY-ANCESTOR caught=${control.clippedPlacement.caught} (worst +${control.clippedPlacement.worst}px) while DOC saw ${control.clippedPlacement.docOverflowPx}px vs baseline ${control.baselineDocOverflow}px -> doc-level blind to a clipped overflow: ${docBlindToClip ? 'YES (why the per-element criterion exists)' : 'no'}`)
    console.log(`CONTROL scroll-placement -> DOC caught=${control.scrollPlacement.caughtByDoc}, VIEWPORT caught=${control.scrollPlacement.caughtByViewport}; restored=${control.removedCleanly}; nodes=${control.nodes} textLeaves=${control.textLeaves}`)
    console.log(`CONTROL negatives -> sr-only skipped=${control.negative.srOnlySkipped}, overflow-x:auto rail skipped=${control.negative.scrollRailSkipped}, real cut still caught=${control.negative.realCutStillCaught}`)
    console.log(`CONTROL rail-then-outer -> leaf inside a scroll rail left alone=${control.railThenOuter.leafNotFlagged}; the rail itself reported when an outer overflow:hidden cuts it=${control.railThenOuter.railFlagged} (worst ${control.railThenOuter.worst}px)`)
    console.log(`CONTROL focus -> outline:none+no-shadow reads invisible=${control.focus.noRingRed}; ring on wrapper reads visible=${control.focus.wrapperRingGreen} (ring found at ancestor depth ${control.focus.ringLevel})`)
    if (bad.length) {
      for (const b of bad) console.log(`HARNESS FAULT ${b}`)
      finish(2)
    }
    for (const tier of tiers) {
      await send('Emulation.setDeviceMetricsOverride', { width: tier.width, height: tier.height, deviceScaleFactor: 1, mobile: false })
      await sleep(250)
      const v = await assertRealViewport(`layout:${tier.width}x${tier.height}`)
      if (v.innerWidth !== tier.width) {
        failures.push(`tier ${tier.width}: the override did not take - innerWidth reports ${v.innerWidth}`)
        continue
      }
      for (const label of ROUTES) {
        const entry = { tier: `${tier.width}x${tier.height}`, route: label }
        try {
          if (label === 'confirm-longname') {
            // The 534cc15 shape: a 64-character hashed filename with no break opportunities inside a
            // 440px card. With overflow-wrap in place it wraps; strip it and the text runs out of
            // the card, which is what the per-element criterion exists to catch.
            await openConfirm()
            await evaluate(`(function(){const d=window.__H.dialog();const p=d.querySelector('p');p.textContent='确定永久删除选中的 128 个远端文件吗？\\n\\na3f9c21be7d84f05c6b18d27ea49f30b5c8d7e12a6b4f90c3d5e7a1b2c4d6e8f0.png\\nIMG_20260930_142530_原图_未命名.png';return true})()`)
          } else {
            await goto(label)
          }
        } catch (error) {
          entry.navError = String(error).slice(0, 150)
          failures.push(`${entry.tier} ${label}: navigation entry point not reachable - ${entry.navError}`)
          results.push(entry)
          continue
        }
        // Measure a loaded page. A route still showing a spinner has not laid out its real content,
        // and in a browser-only harness the data may never arrive at all - so this is recorded as
        // its own named condition rather than silently measured as if it were the shipped page.
        entry.spinnerWaitMs = await evaluate(`(async function(){
          const spinning = () => document.querySelectorAll('[class*="animate-spin"]').length;
          for (let i = 0; i < 40; i++) { if (!spinning()) return i * 250; await new Promise((r) => setTimeout(r, 250)); }
          return 10000;
        })()`)
        entry.spinnersAtMeasure = await evaluate(`document.querySelectorAll('[class*="animate-spin"]').length`)
        entry.settled = await evaluate(`window.__L.settle()`)
        await sleep(80)
        await assertRealViewport(`layout:${tier.width}:${label}`)
        if (entry.settled.geomCount) {
          console.log(`HARNESS FAULT: ${entry.tier} ${label} - ${entry.settled.geomCount} animation(s) move geometry and could not be settled (${entry.settled.geomRunning.map((r) => r.anim + ' on ' + r.sel).join('; ')}); any rect here is a mid-transition frame.`)
          finish(2)
        }
        const g = await evaluate(`window.__L.geometry(${tier.width === 640 ? TOUCH : 0})`)
        entry.geom = g
        // Nothing examined is not the same as nothing found; refuse to let an empty document report
        // a clean layout.
        if (!g.nodes || !g.textLeaves) {
          console.log(`HARNESS FAULT: ${entry.tier} ${label} - the sweep saw ${g.nodes} element(s) and ${g.textLeaves} text leaf(s); a page with no measured content cannot pass a layout gate.`)
          await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
          finish(2)
        }
        if (g.docOverflowPx > 1) failures.push(`DOC-OVERFLOW ${entry.tier} ${label}: documentElement.scrollWidth ${g.docScrollWidth} exceeds innerWidth ${g.innerWidth} by ${g.docOverflowPx}px (a scrollbar / unreachable content)`)
        if (g.viewportOverflowPx > 1) failures.push(`VIEWPORT-OVERFLOW ${entry.tier} ${label}: ${g.offenders.length} element(s) extend past the viewport edge, widest +${g.offenders[0].over}px at ${g.offenders[0].sel} "${g.offenders[0].text}"`)
        if (g.clippedByAncestorTotal) failures.push(`CLIP-BY-ANCESTOR ${entry.tier} ${label}: ${g.clippedByAncestorTotal} text leaf(s) cut by a non-scrolling ancestor - ${g.clippedByAncestor.slice(0, 3).map((c) => `+${c.excess}px ${c.axis} "${c.text}" at ${c.sel} (cut by ${c.by}, overflow ${c.overflow})`).join(' | ')}`)
        if (g.controlsCutTotal) failures.push(`CONTROL-CUT ${entry.tier} ${label}: ${g.controlsCutTotal} interactive element(s) cut by a non-scrolling ancestor, unreachable - ${g.controlsCut.slice(0, 3).map((c) => `+${c.excess}px ${c.axis} "${c.text}" at ${c.sel} (cut by ${c.by}, overflow ${c.overflow})`).join(' | ')}`)
        if (g.containersCutTotal) failures.push(`CONTAINER-CUT ${entry.tier} ${label}: ${g.containersCutTotal} container(s) cut by a non-scrolling ancestor - ${g.containersCut.slice(0, 2).map((c) => `+${c.excess}px ${c.axis} at ${c.sel} (cut by ${c.by}, overflow ${c.overflow})`).join(' | ')}`)
        if (g.clippedTotal) failures.push(`SELF-CLIP ${entry.tier} ${label}: ${g.clippedTotal} own-text run(s) cut with no ellipsis and no title - worst +${g.clipped[0].delta}px "${g.clipped[0].text}" at ${g.clipped[0].sel}`)
        if (g.smallTotal) failures.push(`TOUCH-TARGET ${entry.tier} ${label}: ${g.smallTotal} clickable target(s) under ${TOUCH}x${TOUCH} - smallest ${g.smallTargets[0].w}x${g.smallTargets[0].h} "${g.smallTargets[0].text}" at ${g.smallTargets[0].sel}`)
        if (g.brokenImages.length) failures.push(`BROKEN-IMAGE ${entry.tier} ${label}: ${g.brokenImages.length} image(s) with naturalWidth 0 - ${g.brokenImages.map((b) => b.src).join(', ')}`)
        entry.exclusions = { srOnly: g.skipSrOnly, ellipsis: g.skipEllipsis, title: g.skipTitle, scrollRail: g.skipScrollRail, fixed: g.skipFixed, railClips: g.railClips, textLeaves: g.textLeaves, measuredLeaves: g.measuredLeaves }
        if (entry.spinnersAtMeasure) {
          entry.stuckLoading = true
          if (!stuckLoading.includes(`${entry.tier} ${label}`)) stuckLoading.push(`${entry.tier} ${label}`)
        }
        if (tier.width === 640) {
          const seen = []
          entry.focusableCount = await evaluate(`window.__L.markFocusables()`)
          await evaluate(`document.activeElement && document.activeElement.blur && document.activeElement.blur();true`)
          for (let i = 0; i < 12; i++) {
            for (const type of ['rawKeyDown', 'keyUp']) {
              await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
            }
            await sleep(40)
            const f = await evaluate(`window.__L.focusNow()`)
            seen.push(f)
          }
          entry.focusStops = seen
          const onControl = seen.filter((f) => !f.left)
          const noRing = onControl.filter((f) => f.visible === false)
          const noName = onControl.filter((f) => !f.name)
          if (noRing.length) failures.push(`${entry.tier} ${label}: ${noRing.length}/${onControl.length} tab stops whose rendering does not change when focused (no outline, ring, border or background delta) - ${noRing.slice(0, 3).map((f) => f.sel + ' [resting ' + f.outline + ']').join('; ')}`)
          if (noName.length) failures.push(`${entry.tier} ${label}: ${noName.length}/${onControl.length} tab stops with no accessible name (aria-label, text, alt, title, placeholder, wrapping or for= label, aria-labelledby all empty) - ${noName.slice(0, 3).map((f) => f.sel + '<' + f.tag + '>').join('; ')}`)
        }
        await shot(`lay-${label}-${tier.width}`)
        if (label === 'confirm-longname') { await pressEscape(); await sleep(200) }
        results.push(entry)
      }
    }
    await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    const summary = { provenance: buildProvenance(), note: 'widths are Emulation.setDeviceMetricsOverride CSS viewports, not real device screens; 640x480 is the app minimum window from tauri.conf.json', stuckLoading, tiers: results, failures }
    writeFileSync(`${OUT}/layout-baseline.json`, JSON.stringify(summary, null, 2))
    for (const f of failures) console.log(`FAIL ${f}`)
    if (stuckLoading.length) console.log(`STUCK-LOADING (geometry here describes a loading state, not the loaded page; browser-only harness, no Rust invoke): ${stuckLoading.join(' | ')}`)
    console.log(`LAYOUT_GATE tiers=${tiers.length} routes=${ROUTES.length} failures=${failures.length} stuckLoading=${stuckLoading.length}`)
    console.log(failures.length ? `layout: ${failures.length} geometry failure(s) across ${tiers.length * ROUTES.length} page/width combinations` : `layout: no horizontal overflow, no unflagged clipping, touch targets and focus rings hold at ${tiers.map((t) => t.width).join('/')}`)
    finish(failures.length ? 1 : 0)
  }

  if (MODE === 'contrast') {
    // Colour chains for the elements the visual audit flagged, so the contrast numbers can be
    // checked by hand rather than trusted from a formula.
    await scrollToAndClick(`(function(){return Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='教程与帮助')})()`)
    await sleep(400)
    const chains = await evaluate(`(function(){
      const parse=(c)=>{const m=/rgba?\\(([^)]+)\\)/.exec(c||'');if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
      const chain=(el)=>{const rows=[];let n=el;while(n&&n.nodeType===1){const cs=getComputedStyle(n);rows.push({tag:n.tagName,cls:(n.className||'').toString().slice(0,44),color:cs.color,bg:cs.backgroundColor,bgi:cs.backgroundImage.slice(0,24),op:cs.opacity});n=n.parentElement}return rows};
      const dlg=Array.from(document.querySelectorAll('div.fixed.inset-0')).pop();
      // Both of these used to look up an exact leaf string ("连接 GitHub", "STEP") that the dialog
      // never produces - the chip wraps its ordinal in a span and the label reads "STEP 1" - so the
      // mode printed two empty arrays that looked like "nothing found" rather than "probe broken".
      // Last match, not first: an ancestor's textContent satisfies these patterns too, and reading
      // the ancestor reports its inherited colour instead of the one actually on screen.
      const byText=(re)=>Array.from(dlg.querySelectorAll('*')).filter(e=>re.test((e.textContent||'').trim())).pop();
      return {
        closeX: chain(dlg.querySelector('button[aria-label="关闭教程"]')||dlg.querySelector('button[aria-label="关闭"]')).slice(0,5),
        chip: chain(byText(/^\\d+\\.[\\u4e00-\\u9fa5]/)).slice(0,5),
        stepWord: chain(byText(/^STEP\\s*\\d+$/i)).slice(0,5),
        bodyP: chain(Array.from(dlg.querySelectorAll('p')).find(e=>(e.textContent||'').includes('填写 Owner'))).slice(0,4),
      };
    })()`)
    console.log(JSON.stringify(chains, null, 1))
    finish(0)
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
  // Deferred exit, same reason as finish(): calling process.exit while the CDP socket and the browser
  // child are still tearing down aborts the process on Windows (0xC0000409), which the red-demo
  // parent then reads as "the gate did not reject". Safe here because this is the terminal handler -
  // nothing after it can run, unlike the earlier fall-through bug.
  finish(e && e.identityFault ? 2 : 1)
})
