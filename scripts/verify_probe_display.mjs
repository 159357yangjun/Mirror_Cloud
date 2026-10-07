/**
 * Unit proof for the §18B failure-kind column (step three).
 *
 * Same reasoning as verify_confirmation_display.mjs: the mapping is a pure function over values, so
 * mounting SettingsPage (which needs Tauri IPC) would measure the harness. Four buckets in, four
 * distinct readings out.
 *
 * Two-sided on purpose: each kind is asserted present AND distinct from the others, an unknown kind
 * degrades to `rejected` rather than silence, and null renders nothing at all - because a probe that
 * succeeded must not wear a failure colour.
 */
import assert from 'node:assert/strict'

const MODULE = new URL('../apps/desktop/src/lib/probeDisplay.ts', import.meta.url)
const mod = await import(MODULE.href)
const { probeDisplay } = mod

const KINDS = ['network_timeout', 'auth_failed', 'rejected', 'unavailable']

let checks = 0
const failures = []
const ok = (name, fn) => {
  checks += 1
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message.split('\n')[0]}`)
  }
}

ok('all four kinds render a label, a hint, and a chip class', () => {
  for (const kind of KINDS) {
    const view = probeDisplay(kind)
    assert.ok(view, `${kind}: rendered nothing`)
    assert.ok(view.label.length > 0, `${kind}: empty label`)
    assert.ok(view.hint.length > 0, `${kind}: empty hint next to a coloured chip`)
    assert.ok(view.chipClass.length > 0, `${kind}: no chip class`)
  }
})

ok('labels are mutually distinct', () => {
  const labels = KINDS.map((kind) => probeDisplay(kind).label)
  assert.equal(new Set(labels).size, KINDS.length, `labels collide: ${labels.join(' / ')}`)
})

ok('hints are mutually distinct', () => {
  const hints = KINDS.map((kind) => probeDisplay(kind).hint)
  assert.equal(new Set(hints).size, KINDS.length, 'two failures give the same advice')
})

ok('auth is red, network is sky, unavailable is slate, rejected is amber', () => {
  // The colours carry the action: red = fix credentials now, sky = wait, slate = we never tried,
  // amber = read the message. A swap would send people to the wrong remedy.
  assert.ok(probeDisplay('auth_failed').chipClass.includes('red'))
  assert.ok(probeDisplay('network_timeout').chipClass.includes('sky'))
  assert.ok(probeDisplay('unavailable').chipClass.includes('slate'))
  assert.ok(probeDisplay('rejected').chipClass.includes('amber'))
})

ok('an unrecognised kind degrades to rejected, never to silence', () => {
  const view = probeDisplay('from_a_future_backend')
  assert.ok(view, 'unknown kind rendered nothing')
  assert.equal(view.label, probeDisplay('rejected').label)
})

ok('a successful probe has no display at all', () => {
  assert.equal(probeDisplay(null), null)
  assert.equal(probeDisplay(undefined), null)
})

for (const failure of failures) console.log('FAIL ' + failure)
console.log(`PROBE_DISPLAY total=${checks} failed=${failures.length}`)
if (failures.length) process.exit(1)
