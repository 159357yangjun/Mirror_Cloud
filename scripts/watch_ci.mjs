#!/usr/bin/env node
/**
 * Watch one GitHub Actions run to its terminal state, and refuse to pretend otherwise.
 *
 * It exists because two watchers in this repo's release chain failed in the same direction: they
 * looked healthy while reading nothing. `release-stage2.sh` polled every 31s, exhausted the
 * unauthenticated REST quota (60/hr per IP), and printed `NORUN` for 31 minutes - which was then
 * reported to a human as "the bundle is still in progress" when the run had already failed. This
 * file's own predecessor printed `http=200` and a quota on every line while failing to parse the
 * payload 20 times in a row, because curl wrote an MSYS `/tmp` path and node read a Windows
 * `C:\tmp` path. Transport was proven; parsing was dead; the exit code was 0.
 *
 * So the rules here are:
 *   - every line carries the fields THIS pass actually parsed (status, conclusion, updated_at),
 *     not just an HTTP code - a line that cannot show them is a fault, and faults stop the run;
 *   - the raw payload is written to --dir and read back through the same parser, so a write/read
 *     path disagreement fails loudly instead of polling 20 times against nothing;
 *   - a non-200 is blindness, never absence: exit 2, do not continue;
 *   - the budget cannot be switched off. --polls defaults to 20 and refuses 0 / negative / NaN /
 *     Infinity, because "run forever" is how a broken monitor becomes permanent.
 *
 * usage:  node scripts/watch_ci.mjs --run 36863157166 [--dir OUT] [--polls 20] [--interval 75]
 *         node scripts/watch_ci.mjs --selftest        # fixtures, both directions, no network
 *
 * Exit codes: 0 completed/success; 1 completed but the conclusion is not success (the run's verdict,
 *             printed verbatim); 2 harness fault (blind transport or unparsable payload);
 *             3 budget exhausted without a terminal state.
 *
 * node:fs and node:path only; no third-party dependency, no token, no proxy.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = '159357yangjun'
const REPO = 'image-hosting-platform'
const DEFAULTS = { polls: 20, interval: 75 }

function argvOpt(name, fallback) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

function clock() {
  return new Date().toTimeString().slice(0, 8)
}

// The single place that turns a payload into a reading. Anything it cannot account for is a fault:
// a missing field, a non-JSON body, an HTML error page from an intermediary, a 200 that is a redirect.
// `conclusion` is null while a run is still going, and that is legitimate - demanding a string there
// is what made the first draft of this file exit on its first in-progress poll, i.e. unable to watch.
function parseReading(raw) {
  let r
  try {
    r = JSON.parse(raw)
  } catch (e) {
    throw new Error(`payload is not JSON (${e.message}); first 60 bytes: ${JSON.stringify(String(raw).slice(0, 60))}`)
  }
  for (const f of ['status', 'updated_at']) {
    if (typeof r[f] !== 'string' || !r[f].length) throw new Error(`payload has no usable "${f}" field (got ${JSON.stringify(r[f])})`)
  }
  const terminal = r.status === 'completed'
  if (terminal && (typeof r.conclusion !== 'string' || !r.conclusion.length)) {
    throw new Error(`status=completed but conclusion is ${JSON.stringify(r.conclusion)} - a finished run always carries its verdict`)
  }
  if (!terminal && r.conclusion != null && typeof r.conclusion !== 'string') {
    throw new Error(`conclusion is neither null nor a string while running (got ${JSON.stringify(r.conclusion)})`)
  }
  return { status: r.status, conclusion: terminal ? r.conclusion : '-', updated: r.updated_at, terminal }
}

// The budget is a guard, not a preference: it must survive every way of turning it off.
function pollBudget(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error(`--polls must be a finite count in 1..500, got ${JSON.stringify(raw)} - the budget cannot be switched off`)
  return Math.floor(n)
}

export function selftest() {
  const cases = []
  const push = (name, fn) => {
    let got = 'ok'
    try {
      const r = fn()
      if (r !== true) got = `returned ${JSON.stringify(r)}`
    } catch (e) {
      got = `threw: ${e.message}`
    }
    cases.push({ name, got })
  }
  push('a completed/success payload parses to both fields', () => {
    const r = parseReading('{"status":"completed","conclusion":"success","updated_at":"2026-10-01T12:42:38Z"}')
    return r.status === 'completed' && r.conclusion === 'success' && r.terminal === true
  })
  push('an in_progress payload is NOT terminal', () => {
    const r = parseReading('{"status":"in_progress","conclusion":null,"updated_at":"x"}')
    return r.terminal === false
  })
  push('a payload without conclusion is a fault, not a blank', () => {
    try { parseReading('{"status":"completed","updated_at":"x"}'); return 'no fault raised' } catch { return true }
  })
  push('an HTML error page behind a 200 is a fault', () => {
    try { parseReading('<html>502 Bad Gateway</html>'); return 'no fault raised' } catch { return true }
  })
  push('polls=0 is refused (the budget cannot be switched off)', () => {
    try { pollBudget('0'); return 'no fault raised' } catch { return true }
  })
  push('polls=Infinity is refused', () => {
    try { pollBudget('Infinity'); return 'no fault raised' } catch { return true }
  })
  push('the default budget is on and finite', () => pollBudget(undefined ?? String(DEFAULTS.polls)) === DEFAULTS.polls)
  const bad = cases.filter((c) => c.got !== 'ok')
  for (const c of cases) console.log(`  ${c.got === 'ok' ? 'ok  ' : 'FAIL'} ${c.name}${c.got === 'ok' ? '' : ': ' + c.got}`)
  console.log(`WATCH_CI_SELFTEST cases=${cases.length} failed=${bad.length}`)
  return bad.length ? 2 : 0
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
  return { http: res.status, body: await res.text() }
}

async function quotaRemaining() {
  // The root endpoint, not /repos/{o}/{r}/rate_limit - the latter 404s, and the previous version of
  // this line printed "?" twenty times while looking like a working gauge.
  const { http, body } = await fetchJson('https://api.github.com/rate_limit')
  if (http !== 200) return `?http${http}`
  try {
    return String(JSON.parse(body).resources.core.remaining)
  } catch {
    return '?unparsable'
  }
}

// No process.exit() anywhere: on Windows it aborts with a libuv assertion (exit 127) when a fetch
// handle is still closing, which is what the first version of this file did on both negative
// fixtures - right message, wrong contract. The exit code IS the contract here, so main() returns
// it and the event loop drains on its own.
async function main() {
  if (hasFlag('selftest')) return selftest()

  const run = argvOpt('run', '')
  if (!/^\d+$/.test(run)) { console.log(`HARNESS FAULT: --run wants a numeric run id, got ${JSON.stringify(run)}`); return 2 }
  let polls
  try {
    polls = pollBudget(argvOpt('polls', String(DEFAULTS.polls)))
  } catch (e) {
    console.log(`HARNESS FAULT: ${e.message}`); return 2
  }
  const interval = Number(argvOpt('interval', String(DEFAULTS.interval)))
  if (!Number.isFinite(interval) || interval < 30) { console.log(`HARNESS FAULT: --interval must be >= 30s (unauthenticated REST is 60 calls/hr/IP), got ${JSON.stringify(argvOpt('interval', ''))}`); return 2 }
  const dir = argvOpt('dir', join(process.env.TEMP || '/tmp', 'image-hosting-probes', new Date().toISOString().slice(0, 10)))
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${run}`

  for (let pass = 1; pass <= polls; pass += 1) {
    const { http, body } = await fetchJson(url)
    if (http !== 200) {
      console.log(`POLL pass=${pass} ${clock()} http=${http} run=${run} :: BLIND - a non-200 is not "the run disappeared"; stopping rather than polling on.`)
      return 2
    }
    let file
    let reading
    try {
      mkdirSync(dir, { recursive: true })
      file = join(dir, `watch_ci_${run}_pass${pass}.json`)
      writeFileSync(file, body)
      // Read it back and parse THAT, so the line below is only as good as the archived artifact.
      reading = parseReading(readFileSync(file, 'utf8'))
    } catch (e) {
      console.log(`POLL pass=${pass} ${clock()} http=${http} run=${run} :: HARNESS FAULT - ${e.message}; the transport worked and the reading did not, which is exactly the shape that produced a false "in progress" before. Stopping.`)
      return 2
    }
    console.log(`POLL pass=${pass} ${clock()} http=${http} quota_remaining=${await quotaRemaining()} run=${run} status=${reading.status} conclusion=${reading.conclusion} updated=${reading.updated} archived=${file}`)
    if (reading.terminal) {
      console.log(`TERMINAL pass=${pass} ${clock()} run=${run} ${reading.status}/${reading.conclusion} updated=${reading.updated}`)
      return reading.conclusion === 'success' ? 0 : 1
    }
    if (pass < polls) await new Promise((r) => setTimeout(r, interval * 1000))
  }
  console.log(`BUDGET_EXHAUSTED polls=${polls} without a terminal state at ${clock()} - this is NOT a pass and NOT a failure of the run; re-run it.`)
  return 3
}

main().then((code) => { process.exitCode = code }, (e) => { console.log(`HARNESS FAULT: ${e.stack || e.message}`); process.exitCode = 2 })
