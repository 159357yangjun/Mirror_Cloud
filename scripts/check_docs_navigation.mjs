// Run only in isolated Linux CI against this build's loopback-only static server.
// No user browser, browser profile, cloud account, or external automation dependency is used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, stat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, sep, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

if (!process.env.CI || process.platform !== 'linux') throw new Error('Run this browser check in Linux CI, not a user desktop session.')
const dist = resolve('website/dist')
const out = resolve('qa-docs-navigation')
await mkdir(out, { recursive: true })
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (!pathname.startsWith('/Mirror_Cloud/')) throw new Error('outside project base')
    let file = resolve(dist, pathname.slice('/Mirror_Cloud/'.length))
    if (file !== dist && !file.startsWith(dist + sep)) throw new Error('outside build')
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch { res.writeHead(404); res.end('Not found') }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}/Mirror_Cloud/`
const profile = await mkdtemp(join(tmpdir(), 'mirror-docs-navigation-'))
let chrome, ws
let checked = 0
const observations = []
const contrast = []
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
try {
  let executable
  for (const candidate of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { executable = execFileSync('which', [candidate], { encoding: 'utf8' }).trim(); break } catch {}
  }
  assert.ok(executable, 'the CI image must provide an existing Chromium browser')
  chrome = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((done, fail) => {
    let stderr = ''
    const timer = setTimeout(() => fail(new Error('Chromium did not expose DevTools')), 15000)
    chrome.once('error', (error) => { clearTimeout(timer); fail(error) })
    chrome.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Chromium exited early: ${code}`)) })
    chrome.stderr.on('data', (data) => {
      stderr += data.toString()
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); done(match[1]) }
    })
  })
  const address = new URL(endpoint)
  const targets = await fetch(`http://127.0.0.1:${address.port}/json/list`).then((r) => r.json())
  const page = targets.find((target) => target.type === 'page' && target.url === 'about:blank')
  assert.ok(page, 'only the fresh CI page is selected')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, fail) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', fail, { once: true }) })
  let serial = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    message.error ? request.fail(new Error(message.error.message)) : request.done(message.result)
  })
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { done, fail, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (fn) => {
    const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (fn) => {
    for (let attempt = 0; attempt < 60; attempt++) { if (await evaluate(fn)) return; await pause(100) }
    throw new Error(`Condition did not become true: ${fn.toString()}`)
  }
  const check = (condition, label) => { checked++; assert.ok(condition, label); observations.push(label) }
  const click = async (selector, index = 0) => {
    const result = await send('Runtime.evaluate', { expression: `(() => { const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if(!el) throw new Error('missing click target'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`Missing click target: ${selector}`)
    const point = result.result.value
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(out, name), Buffer.from(data, 'base64'))
  }
  const clickOutsideMenu = async () => {
    const result = await send('Runtime.evaluate', { expression: `(() => {
      const x = 2, y = document.querySelector('.guide-site-header').getBoundingClientRect().bottom + 12;
      const target = document.elementFromPoint(x, y);
      if (!target || y >= innerHeight || document.querySelector('.guide-navigation').contains(target)) throw new Error('outside click point is covered');
      return { x, y };
    })()`, returnByValue: true })
    if (result.exceptionDetails) throw new Error('No verified point outside the menu')
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...result.result.value })
  }
  const size = async (width, height) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(100) }
  const checkContrast = async (theme) => {
    const ratios = await evaluate(() => {
      const rgb = (value) => value.match(/[\d.]+/g).map(Number)
      const luminance = (channels) => channels.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
      const panel = rgb(getComputedStyle(document.querySelector('.guide-main')).backgroundColor)
      // The least favorable wallpaper pixel: black behind the light panel, white behind dark.
      const backdrop = document.documentElement.dataset.theme === 'dark' ? 255 : 0
      const alpha = panel[3] ?? 1
      const background = luminance(panel.slice(0, 3).map((v) => v * alpha + backdrop * (1 - alpha)))
      return ['.sl-markdown-content', '.provider-links a'].map((selector) => {
        const foreground = luminance(rgb(getComputedStyle(document.querySelector(selector)).color).slice(0, 3))
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      })
    })
    contrast.push({ theme, body: ratios[0], link: ratios[1] })
    check(ratios.every((ratio) => ratio >= 4.5), `${theme} body and links meet 4.5:1 contrast over the least favorable wallpaper pixel`)
  }
  await send('Page.enable')
  await size(1280, 800)
  await send('Page.navigate', { url: base + 'guides/gitee/' })
  await waitFor(() => document.querySelector('[data-guide-navigation]')?.parentElement.classList.contains('header') && document.fonts.status === 'loaded')
  await evaluate(() => { const select=document.querySelector('starlight-theme-select select'); select.value='light'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await send('DOM.enable')
  await send('CSS.enable')
  const { root } = await send('DOM.getDocument')
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' })
  const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId })
  check(fonts.some((font) => font.glyphCount > 0 && font.familyName.includes('Noto Sans CJK')), 'Chinese heading renders with real CJK glyphs')
  await checkContrast('light')
  check(await evaluate(() => document.documentElement.lang === 'zh-CN'), 'Chinese root locale preserves the project route')
  check(await evaluate(() => document.querySelector('.guide-navigation').children.length === 4), 'four top-level choices')
  check(await evaluate(() => document.querySelectorAll('.guide-navigation details[open]').length === 0), 'category menus start collapsed')
  check(await evaluate(() => document.querySelector('.guide-site-header').getBoundingClientRect().height < 90), 'desktop header uses one compact row')
  check(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop has no horizontal overflow')
  check(await evaluate(() => {
    const columns = [...document.querySelector('.setup-field-details').children].map((column) => column.querySelector('dt').getBoundingClientRect());
    return columns.length === 2 && Math.abs(columns[0].top - columns[1].top) <= 1;
  }), 'desktop field source and fill labels align on the same row')
  await shot('desktop-closed.png')
  await click('.guide-navigation summary', 0)
  await waitFor(() => document.querySelector('.guide-navigation details').open)
  check(await evaluate(() => document.querySelectorAll('.guide-navigation details[open] a').length === 7), 'one choice exposes seven provider pages')
  await shot('desktop-provider-menu.png')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  check(await evaluate(() => !document.querySelector('.guide-navigation details[open]') && document.activeElement.tagName === 'SUMMARY'), 'Escape closes the menu and returns focus')
  await click('.guide-navigation summary', 0)
  await click('.guide-navigation summary', 1)
  check(await evaluate(() => document.querySelectorAll('.guide-navigation details[open]').length === 1 && document.querySelectorAll('.guide-navigation details')[1].open), 'opening another category closes the first')
  await clickOutsideMenu()
  check(await evaluate(() => !document.querySelector('.guide-navigation details[open]')), 'clicking content closes the category')
  await click('.guide-navigation summary', 0)
  await click('.guide-navigation a[href$="/guides/oss/"]')
  await waitFor(() => location.pathname.endsWith('/guides/oss/') && document.querySelector('.guide-navigation')?.parentElement.classList.contains('header'))
  check(await evaluate(() => document.querySelector('.guide-navigation a[aria-current="page"]').href.endsWith('/guides/oss/')), 'selection reaches and highlights its corresponding page')
  check(await evaluate(() => !document.querySelector('.guide-outline details').open), 'page outline is initially compact')
  await click('.guide-outline summary')
  check(await evaluate(() => document.querySelector('.guide-outline details').open), 'page steps expand on request')
  await click('.guide-outline summary')
  for (const width of [390, 320]) {
    await size(width, 844)
    check(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px page does not overflow`)
    check(await evaluate(() => document.querySelector('.guide-site-header').getBoundingClientRect().height < 140), `${width}px header stays within two rows`)
    for (const index of [0, 1]) {
      await click('.guide-navigation summary', index)
      check(await evaluate(() => { const r=document.querySelector('.guide-navigation details[open] .guide-navigation-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }), `${width}px category ${index + 1} stays inside the viewport`)
    }
    await clickOutsideMenu()
  }
  await size(390, 844)
  await evaluate(() => { const select=document.querySelector('starlight-theme-select select'); select.value='dark'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  check(await evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.querySelector('.guide-wallpaper')).backgroundImage.includes('user-wallpaper')), 'dark mode keeps the authorized full-page JPG')
  await checkContrast('dark')
  await shot('mobile-dark.png')
  await click('.guide-navigation summary', 0)
  await shot('mobile-provider-menu.png')
  await size(1280, 800)
  await send('Page.navigate', { url: base })
  await waitFor(() => document.querySelector('.provider-directory') && document.fonts.status === 'loaded')
  check(await evaluate(() => document.querySelectorAll('.provider-directory').length === 1 && !document.querySelector('.provider-directory').open), 'homepage presents one collapsed storage selector')
  check(await evaluate(() => document.querySelectorAll('.provider-directory a').length === 7), 'homepage selector retains all seven providers')
  check(await evaluate(() => [...document.querySelectorAll('.provider-directory a')].every((link) => /^\/Mirror_Cloud\/guides\/[a-z0-9]+\/$/.test(link.pathname))), 'homepage guide links retain the project base')
  check(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop homepage does not overflow')
  check(await evaluate(() => {
    const expected = ['use/publish', 'use/typora', 'use/multicloud', 'use/local-api', 'use/appearance', 'use/security', 'recipes/choose'];
    const links = [...document.querySelectorAll('.guide-resources a')];
    return links.length === expected.length && links.every((link, i) => link.pathname === `/Mirror_Cloud/${expected[i]}/` && link.getBoundingClientRect().height >= 44);
  }), 'seven whole-row resource links preserve their destination and touch size')
  await evaluate(() => document.querySelector('.provider-directory summary').focus())
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
  await waitFor(() => document.querySelector('.provider-directory').open)
  check(await evaluate(() => document.activeElement === document.querySelector('.provider-directory summary')), 'Space opens the native storage selector without losing focus')
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await waitFor(() => !document.querySelector('.provider-directory').open)
  check(await evaluate(() => document.activeElement === document.querySelector('.provider-directory summary')), 'Enter closes the native storage selector without losing focus')
  await evaluate(() => document.querySelector('.guide-resources a').focus())
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  check(await evaluate(() => document.activeElement === document.querySelectorAll('.guide-resources a')[1] && getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'resource links follow DOM keyboard order with a visible focus outline')
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  check(await evaluate(() => [...document.querySelectorAll('.provider-directory summary, .guide-resources a, .guide-navigation summary')].every((el) => getComputedStyle(el).transitionDuration.split(',').every((value) => parseFloat(value) === 0))), 'reduced motion disables the added interaction transitions')
  await send('Emulation.setEmulatedMedia', { features: [] })
  await evaluate(() => { document.activeElement.blur(); scrollTo(0, 0) })
  await shot('home-desktop.png')
  await evaluate(() => { const select = document.querySelector('starlight-theme-select select'); select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await shot('home-desktop-light.png')
  await evaluate(() => document.querySelector('.guide-resources').scrollIntoView())
  await shot('home-resources-light.png')
  await evaluate(() => scrollTo(0, 0))
  await click('.provider-directory summary')
  check(await evaluate(() => document.querySelector('.provider-directory').open), 'homepage storage selector opens on request')
  for (const width of [390, 320]) {
    await size(width, 844)
    check(await evaluate(() => {
      const heading = document.querySelector('.hero h1').getBoundingClientRect();
      const section = document.querySelector('.sl-markdown-content h2').getBoundingClientRect();
      return Math.abs(heading.left - section.left) <= 1;
    }), `${width}px homepage title and content share a left alignment`)
    check(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px homepage and its open selector do not overflow`)
  }
  await size(390, 844)
  check(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile homepage and its open selector do not overflow')
  await shot('home-mobile.png')
  await click('.provider-directory a[href$="/guides/gitee/"]')
  await waitFor(() => location.pathname.endsWith('/guides/gitee/') && document.querySelector('.configuration-fields'))
  check(await evaluate(() => document.querySelectorAll('[data-field-label]').length === 7), 'homepage choice reaches the complete Gitee field guide')
  await size(1280, 800)
  await evaluate(() => document.querySelector('.configuration-fields').scrollIntoView())
  await shot('desktop-fields.png')
  await writeFile(join(out, 'report.json'), JSON.stringify({ checked, failed: 0, observations, contrast }, null, 2))
  console.log(`DOCS_NAVIGATION checked=${checked} failed=0`)
} catch (error) {
  await writeFile(join(out, 'report.json'), JSON.stringify({ checked, failed: 1, observations, contrast, error: String(error) }, null, 2))
  throw error
} finally {
  ws?.close()
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((done) => chrome.once('exit', done))
    chrome.kill('SIGTERM'); await Promise.race([exited, pause(3000)])
    if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGKILL'); await exited }
  }
  await new Promise((done) => server.close(done))
  // Chromium children can finish profile writes just after the parent exits.
  // Keep cleanup mandatory, with bounded retries for ENOTEMPTY/EBUSY races.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
