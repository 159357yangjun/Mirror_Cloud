import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Pure calculations and subscription ownership only. No browser, cloud,
// dependency installation or mutation suite is started by this entry point.
const suites = [
  'test_desktop_subscription.mjs',
  'test_cloud_browser_utils.mjs',
  'verify_confirmation_display.mjs',
  'verify_probe_display.mjs',
  'test_r2_diagnostics.mjs',
]
let failed = 0
for (const suite of suites) {
  console.log(`UNIT_SUITE ${suite}`)
  // Node 22.12 supports type stripping behind this flag; later releases enable it by default.
  const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL(suite, import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
    windowsHide: true,
    timeout: 30_000,
  })
  if (result.error || result.status !== 0) {
    failed++
    console.error(`UNIT_SUITE_FAILED ${suite} status=${result.status ?? 'unavailable'}${result.error ? ` error=${result.error.code}` : ''}`)
  }
}
console.log(`UNIT_SUITES total=${suites.length} failed=${failed}`)
if (failed) process.exitCode = 1
