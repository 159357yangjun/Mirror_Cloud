/**
 * Live Windows Edge UI acceptance for the real R2 setup component.
 * Start Vite (apps/desktop: npm run dev -- --host 127.0.0.1), then run this script on Windows.
 * Every Tauri invoke in /r2-wizard-qa.html is an in-memory rejecting stub; no Cloudflare network.
 * Evidence never includes credentials, error raw payloads, or input values.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const ORIGIN = 'http://127.0.0.1:1420'
const PATH = '/r2-wizard-qa.html'
const OUT = process.argv.find(x => x.startsWith('--out='))?.split('=').slice(1).join('=') || join(tmpdir(), 'r2-wizard-qa')
const BROWSER = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(x => x && existsSync(x))
if (!BROWSER) throw new Error('R2 HARNESS FAIL: Windows Edge/Chrome binary is missing')
mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'r2-ui-browser-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = await new Promise((resolve,reject) => {
  const server = createServer()
  server.once('error',reject)
  server.listen(0,'127.0.0.1',() => { const p=server.address().port;server.close(()=>resolve(p)) })
})
const browser = spawn(BROWSER, [
  '--headless=new', '--disable-extensions', '--disable-sync', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
let ws = null, seq = 0, checks = 0, pending = new Map(), suite = [], snapshots = []
function verdict(label, value) { assert.ok(value, label); checks++; console.log('R2_BROWSER PASS ' + label) }
async function waitFor(check, label, limit=15000) {
  const until = Date.now() + limit
  let last
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; last = result } catch (e) { last = String(e) }
    await sleep(140)
  }
  throw new Error(`timed out waiting for ${label}: ${String(last).slice(0,200)}`)
}
function send(method,params={}) {
  const id = ++seq
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 18000)
    pending.set(id, {resolve: x => {clearTimeout(timer);resolve(x)},reject: e=>{clearTimeout(timer);reject(e)}})
    ws.send(JSON.stringify({id,method,params}))
  })
}
async function evaluate(code) {
  const v = await send('Runtime.evaluate', {expression:code, returnByValue:true, awaitPromise:true, userGesture:true})
  if (v.exceptionDetails) throw new Error('browser JS exception (details withheld)')
  return v.result.value
}
async function clickButton(prefix, scope='section[aria-labelledby="r2-dialog-title"]') {
  const box = await evaluate(`(function(){
    const root=document.querySelector(${JSON.stringify(scope)});if(!root)return null;
    const el=[...root.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(prefix)}));
    if(!el||el.disabled)return null;
    el.scrollIntoView({block:'center',inline:'nearest'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}
  })()`)
  assert.ok(box && box.w > 0 && box.h > 0, 'visible enabled button '+prefix)
  await send('Input.dispatchMouseEvent', {type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1})
  await sleep(150)
}
async function typeIn(label,value) {
  const found=await evaluate(`(function(){
    const dialog=document.querySelector('section[aria-labelledby="r2-dialog-title"]');
    const item=[...dialog.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));
    if(!item)return false;const e=item.querySelector('input');if(!e)return false;
    e.scrollIntoView({block:'center'});e.focus();e.select();return true;
  })()`)
  assert.ok(found,'field exists: '+label)
  await send('Input.insertText',{text:value})
  await sleep(160)
}
async function pressEscape() {
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await sleep(220)
}
async function stage() {
  return evaluate(`document.querySelector('section[aria-labelledby="r2-dialog-title"] [aria-current="step"]')?.textContent?.trim() || null`)
}
async function shot(name) {
  const v=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const file=join(OUT,name+'.png')
  writeFileSync(file,Buffer.from(v.data,'base64'))
  snapshots.push(name+'.png')
}
async function runCase({width,height,dpr}) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false})
  await send('Page.navigate',{url:ORIGIN+PATH})
  await waitFor(async()=>evaluate('document.title==="Mirror Cloud R2 Wizard QA" && !!document.getElementById("r2-qa-open")'),'real QA fixture')
  await sleep(400)
  const state=await evaluate('({title:document.title,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,tauri:!!window.__TAURI_INTERNALS__})')
  verdict('fixture identity / Windows viewport / DPR '+width+'@'+dpr,state.width===width&&state.height===height&&Math.abs(state.dpr-dpr)<0.01&&state.tauri)
  const openBox=await evaluate(`(function(){const r=document.getElementById('r2-qa-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...openBox,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...openBox,button:'left',clickCount:1})
  await waitFor(async()=>Boolean(await stage()),'R2 modal mounted')
  verdict('R2 dialog has accessible name and modal semantics',await evaluate(`(function(){const el=document.querySelector('section[aria-labelledby="r2-dialog-title"]');return el?.getAttribute('role')==='dialog' && el.getAttribute('aria-modal')==='true' && !!document.querySelector('#r2-dialog-title')})()`))
  verdict('initial invalid fields block advance',await evaluate(`(function(){const root=document.querySelector('section[aria-labelledby="r2-dialog-title"]');return [...root.querySelectorAll('button')].some(b=>b.textContent.includes('继续：发布用途')&&b.disabled)})()`))
  verdict('unsubmitted setup performs no remote call',await evaluate('window.__R2_QA_INVOKES.length===0'))
  await typeIn('Bucket（存储桶名）','my-images')
  await typeIn('Account ID','0123456789abcdef0123456789abcdef')
  verdict('default Endpoint preview derived from Account ID',await evaluate(`document.querySelector('section[aria-labelledby="r2-dialog-title"]').textContent.includes('0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com')`))
  await clickButton('继续：发布用途')
  verdict('step 2 is selected',String(await stage()).includes('发布用途'))
  verdict('public mode requires a URL',await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('继续：API 密钥')&&b.disabled)`))
  await typeIn('公开访问地址','https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com')
  verdict('S3 API endpoint rejected as public URL',await evaluate(`(function(){const el=[...document.querySelectorAll('label')].find(e=>e.textContent.startsWith('公开访问地址'));return el?.querySelector('input')?.getAttribute('aria-invalid')==='true'})()`))
  await typeIn('公开访问地址','https://img.example.com')
  await clickButton('私有存储目标')
  verdict('private mode drops public URL and explicitly warns about anonymity',await evaluate(`(function(){const e=document.querySelector('section[aria-labelledby="r2-dialog-title"]');return ![...e.querySelectorAll('label')].some(x=>x.textContent.startsWith('公开访问地址')) && e.textContent.includes('连接成功不等于已验证私有')})()`))
  await clickButton('继续：API 密钥')
  verdict('keys are required and masked',await evaluate(`(function(){const d=document.querySelector('section[aria-labelledby="r2-dialog-title"]');const a=[...d.querySelectorAll('input[type="password"]')];return a.length===2&&[...d.querySelectorAll('button')].some(b=>b.textContent.includes('继续：检查与保存')&&b.disabled)})()`))
  await typeIn('Access Key ID','FAKE-ACCESS-KEY-FOR-QA')
  await typeIn('Secret Access Key','FAKE-SECRET-KEY-FOR-QA')
  await clickButton('继续：检查与保存')
  verdict('step 4 review visible',String(await stage()).includes('检查与保存'))
  verdict('review does not echo secrets',await evaluate(`(function(){const d=document.querySelector('section[aria-labelledby="r2-dialog-title"]');return !d.textContent.includes('FAKE-ACCESS-KEY-FOR-QA')&&!d.textContent.includes('FAKE-SECRET-KEY-FOR-QA')})()`))
  await shot(`r2-step4-${width}-dpr${dpr}`)
  await clickButton('授权测试并保存')
  await waitFor(async()=>evaluate(`!!document.querySelector('section[aria-labelledby="confirm-dialog-title"]')`),'write consent dialog')
  verdict('write consent precisely describes write/stat/delete and risk',await evaluate(`(function(){const d=document.querySelector('section[aria-labelledby="confirm-dialog-title"]');return d.textContent.includes('写入')&&d.textContent.includes('元数据')&&d.textContent.includes('删除')&&d.textContent.includes('可能留下')})()`))
  verdict('consent starts focused on cancel',await evaluate(`(function(){const d=document.querySelector('section[aria-labelledby="confirm-dialog-title"]');return document.activeElement?.textContent?.trim()==='取消'&&d.contains(document.activeElement)})()`))
  await pressEscape()
  verdict('Escape denies write and keeps editable wizard',await evaluate(`!document.querySelector('section[aria-labelledby="confirm-dialog-title"]') && !!document.querySelector('section[aria-labelledby="r2-dialog-title"]') && window.__R2_QA_INVOKES.length===0`))
  await clickButton('授权测试并保存')
  await waitFor(async()=>evaluate(`!!document.querySelector('section[aria-labelledby="confirm-dialog-title"]')`),'second confirm')
  await clickButton('取消','section[aria-labelledby="confirm-dialog-title"]')
  verdict('Cancel denies write without any call',await evaluate('window.__R2_QA_INVOKES.length===0'))
  await clickButton('授权测试并保存')
  await waitFor(async()=>evaluate(`!!document.querySelector('section[aria-labelledby="confirm-dialog-title"]')`),'third confirm')
  await clickButton('授权临时写入测试','section[aria-labelledby="confirm-dialog-title"]')
  await waitFor(async()=>evaluate('window.__R2_QA_INVOKES.length===1'),'local invoke recorded')
  await waitFor(async()=>evaluate(`(document.body.innerText||'').includes('访问受到拒绝')`),'safe classified error displayed')
  verdict('only local refusing bridge was called',await evaluate(`window.__R2_QA_INVOKES.length===1 && window.__R2_QA_INVOKES[0]==='create_s3_storage'`))
  verdict('no raw secret leaks into dialog or global toast',await evaluate(`(function(){const text=document.body.innerText;return !text.includes('QA-SECRET-DO-NOT-RENDER-7b83')&&!text.includes('X-Amz-Signature')&&!text.includes('AccessDenied simulated token=')})()`))
  verdict('diagnosis includes recovery path',await evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('返回相关配置步骤'))`))
  await shot(`r2-safe-diagnosis-${width}-dpr${dpr}`)
  await clickButton('返回相关配置步骤')
  verdict('after failure, keys remain masked in editable step',await evaluate(`(function(){const d=document.querySelector('section[aria-labelledby="r2-dialog-title"]');return !!d && d.querySelectorAll('input[type="password"]').length===2 && d.textContent.includes('API 密钥')})()`))
  await pressEscape()
  verdict('Escape closes wizard without retry',await evaluate(`!document.querySelector('section[aria-labelledby="r2-dialog-title"]') && window.__R2_QA_INVOKES.length===1`))
  verdict('focus returns to opener',await evaluate(`document.activeElement?.id === 'r2-qa-open'`))
  const overflow=await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
  verdict('no document-wide horizontal overflow',overflow<=1)
  suite.push({width,height,dpr,checks,remoteAttempt:'blocked by simulated local bridge',overflow})
  console.log(`R2_WIZARD_CASE width=${width} height=${height} dpr=${dpr} pass=1`)
}
try {
  const response=await fetch(ORIGIN+PATH,{signal:AbortSignal.timeout(8000)})
  if(!response.ok)throw new Error('Vite fixture not served')
  let target=null
  await waitFor(async()=>{
    const r=await fetch(`http://127.0.0.1:${port}/json/list`)
    if(!r.ok)return false
    const tabs=await r.json()
    target=tabs.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)
    return target
  },'private Edge CDP endpoint',12000)
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  ws.addEventListener('message',(evt)=>{
    const m=JSON.parse(String(evt.data))
    if(!m.id)return
    const q=pending.get(m.id);if(!q)return
    pending.delete(m.id)
    m.error?q.reject(new Error(m.error.message)):q.resolve(m.result)
  })
  await send('Page.enable');await send('Runtime.enable')
  for (const view of [{width:1366,height:768,dpr:1},{width:640,height:480,dpr:1.5}]) await runCase(view)
  writeFileSync(join(OUT,'r2-wizard-acceptance.json'),JSON.stringify({kind:'windows-edge-cdp-not-native-tauri',cloudWrites:0,checks,results:suite,snapshots},null,2))
  console.log(`R2_WIZARD_BROWSER_GATE scenarios=${suite.length} checks=${checks} failed=0 cloud_writes=0`)
} catch(e) {
  try {if(ws)await shot('r2-wizard-failed')}catch{}
  console.error('R2_WIZARD_BROWSER_GATE FAILED: '+e.message)
  process.exitCode=1
} finally {
  if(ws) ws.close()
  browser.kill()
  await sleep(250)
  try{rmSync(profile,{recursive:true,force:true,maxRetries:3})}catch{}
}
