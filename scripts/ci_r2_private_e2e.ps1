# Approval-gated GitHub Actions runner for the existing production-OpenDAL R2 E2E.
# Never echo raw SDK/test process output: it could contain presigned bearer URLs.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$report = Join-Path $env:RUNNER_TEMP 'r2-private-e2e-sanitized.txt'
# A default-branch dispatch may check out an immutable feature commit. Always attest
# the code actually tested, NOT the workflow-dispatch main branch GITHUB_SHA.
$testedCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $testedCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Cannot establish checked-out test commit'
}
if ($env:R2_E2E_EXPECTED_SHA -and $testedCommit -cne $env:R2_E2E_EXPECTED_SHA) {
    throw 'Checked-out test code differs from approved immutable commit'
}
$head = @(
    'R2 private object E2E - sanitized execution evidence'
    "tested_commit: $testedCommit"
    "run: $env:GITHUB_RUN_ID"
    'scope: R2 managed/custom domains and S3 API endpoint (not Workers/proxies)'
)

# Missing credentials must fail BEFORE any cloud request; never include their values
# or the test Bucket name in reports or log messages.
$required = @(
    'R2_E2E_ACCOUNT_ID',
    'R2_E2E_BUCKET',
    'R2_E2E_ACCESS_KEY_ID',
    'R2_E2E_SECRET_ACCESS_KEY',
    'R2_E2E_CLOUDFLARE_API_TOKEN'
)
$missing = @($required | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
})
if ($missing.Count -gt 0) {
    $lines = @($head) + @('status: BLOCKED - protected R2 test configuration missing')
    $lines | Set-Content -LiteralPath $report -Encoding utf8
    $lines | Add-Content -Path $env:GITHUB_STEP_SUMMARY
    throw 'Protected test variables or secrets not configured; no cloud request started'
}
if ($env:R2_E2E_ALLOW_TEST_WRITES -cne 'YES_TEST_BUCKET') {
    throw 'Explicit disposable test Bucket authorization is missing'
}

$name = 'commands::r2_private_live_e2e::real_r2_private_object_e2e'
# Capture the exact test's output in memory, not CI logs or artifacts.
$output = & cargo test --locked -p image-hosting-platform-desktop --lib $name -- --ignored --exact --nocapture 2>&1
$exitCode = $LASTEXITCODE
$combined = $output -join "`n"
$stages = [ordered]@{
    'pre-write domain audit' = 'PASS domain-audit:'
    'OpenDAL upload and authorized readback' = 'PASS upload:'
    'unsigned R2 GET denied' = 'PASS unsigned-read:'
    'presigned GET HTTP 200 and SHA256' = 'PASS presigned-read:'
    'original signed GET expired' = 'PASS expiry:'
    'remote test object deleted' = 'PASS cleanup:'
    'whole production test completed' = 'PASS LIVE R2 E2E:'
}
$lines = @($head)
$allStagesPassed = $true
foreach ($label in $stages.Keys) {
    $ok = $combined.Contains($stages[$label])
    if (-not $ok) { $allStagesPassed = $false }
    $verdict = if ($ok) { 'PASS' } else { 'UNVERIFIED' }
    $lines += "${label}: $verdict"
}
# Cargo may return success for a filter matching zero tests; fail closed.
$exactOnePassed = $combined -match 'test result: ok\. 1 passed; 0 failed;'
$pass = ($exitCode -eq 0) -and $exactOnePassed -and $allStagesPassed
$lines += "test harness ran exactly one successful test: $exactOnePassed"
$lines += $(if ($pass) { 'status: PASS' } else { 'status: FAIL / UNVERIFIED' })
$lines | Set-Content -LiteralPath $report -Encoding utf8
$lines | Add-Content -Path $env:GITHUB_STEP_SUMMARY
if (-not $pass) {
    throw 'R2 live E2E failed or incomplete. Only sanitized stage verdicts published.'
}
