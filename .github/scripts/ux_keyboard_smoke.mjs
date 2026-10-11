// Test-only Windows Edge CDP gate. No Tauri backend, credentials or cloud access.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
