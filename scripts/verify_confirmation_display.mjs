/**
 * Unit proof for the confirmation-level column (piclist §18A, step two).
 *
 * Why this file exists instead of asserting in the browser: the panel renders inside SettingsPage,
 * which needs Tauri IPC to have anything to draw. The decision under test - which level gets which
 * colour, and what text explains it - is a pure function over values, so mounting a browser to check
 * it would measure the harness rather than the rule.
 *
 * Every case is two-sided on purpose. A suite that only asserts "content_verified is green" passes
 * unchanged if someone flips unknown to green as well, which is the failure mode that matters: an
 * unconfirmed row wearing a strong colour is a lie on screen. So each bucket is asserted present AND
 * distinct from the other two, and the reason text is asserted non-empty for all five levels.
 */
import assert from 'node:assert/strict'

// A path string is not a module specifier on Windows (`import('D:/...')` throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME); the URL form of this file's own directory is portable.
const MODULE = new URL(
  '../apps/desktop/src/lib/confirmationDisplay.ts',
  import.meta.url,
)
const mod = await import(MODULE.href)
const { tierDisplay, tierReason } = mod

const TIERS = [
  'unknown',
  'uploaded',
  'remote_observed',
  'content_verified',
  'publicly_reachable',
]

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

// --- the three buckets are reachable and mutually distinct -------------------------------------
ok('strong is emerald', () => {
  const view = tierDisplay('content_verified')
  assert.ok(view.chipClass.includes('emerald'), view.chipClass)
  assert.equal(view.strength, 'strong')
})

ok('weak is amber for both upload-only and observed rows', () => {
  for (const tier of ['uploaded', 'remote_observed']) {
    const view = tierDisplay(tier)
    assert.ok(view.chipClass.includes('amber'), `${tier}: ${view.chipClass}`)
    assert.equal(view.strength, 'weak', tier)
  }
})

ok('unconfirmed is slate, never emerald or amber', () => {
  const view = tierDisplay('unknown')
  assert.ok(view.chipClass.includes('slate'), view.chipClass)
  assert.ok(!view.chipClass.includes('emerald'), 'unconfirmed must not borrow the strong colour')
  assert.ok(!view.chipClass.includes('amber'), 'unconfirmed must not read as a warning either')
  assert.equal(view.strength, 'unconfirmed')
})

ok('the three chip classes are pairwise different', () => {
  const classes = ['strong', 'weak', 'unconfirmed'].map((bucket) => {
    const tier = bucket === 'strong' ? 'content_verified' : bucket === 'weak' ? 'uploaded' : 'unknown'
    return tierDisplay(tier).chipClass
  })
  assert.equal(new Set(classes).size, 3, `colours collapsed: ${classes.join(' | ')}`)
})

ok('publicly_reachable is at least as strong as content_verified', () => {
  // It has no producer today, but if one appears it must not render weaker than verification.
  assert.equal(tierDisplay('publicly_reachable').strength, 'strong')
})

ok('a missing level renders nothing rather than a default chip', () => {
  // The remote-only direction has no local row to grade. Inventing a colour there would show a
  // confirmation state for an object this build has never touched.
  assert.equal(tierDisplay(null), null)
})

// --- labels ------------------------------------------------------------------
ok('every level has a Chinese label and they are distinct', () => {
  const labels = TIERS.map((tier) => tierDisplay(tier).label)
  for (const label of labels) assert.ok(label.length > 0, 'empty label')
  assert.equal(new Set(labels).size, TIERS.length, `labels collide: ${labels.join(' / ')}`)
})

// --- reasons -----------------------------------------------------------------
ok('every level explains itself when the backend sent no reason', () => {
  for (const tier of TIERS) {
    const strength = tierDisplay(tier).strength
    const text = tierReason({ strength })
    assert.ok(text.length > 0, `${tier}: blank reason next to a coloured chip`)
  }
})

ok('the backend reason wins over the fallback', () => {
  assert.equal(
    tierReason({ missingEvidence: '缺内容比对：还没把字节和预期对过', strength: 'weak' }),
    '缺内容比对：还没把字节和预期对过',
  )
})

ok('reasons differ across the three buckets', () => {
  const texts = [
    tierReason({ strength: 'strong' }),
    tierReason({ strength: 'weak' }),
    tierReason({ strength: 'unconfirmed' }),
  ]
  assert.equal(new Set(texts).size, 3, `one reason serving two buckets: ${texts.join(' / ')}`)
})

ok('an entry with neither strength nor reason still says something', () => {
  assert.ok(tierReason({}).length > 0)
})

// --- printout ------------------------------------------------------------------
for (const line of failures) console.log('FAIL ' + line)
console.log(`CONFIRMATION_DISPLAY total=${checks} failed=${failures.length}`)
if (failures.length) process.exit(1)
