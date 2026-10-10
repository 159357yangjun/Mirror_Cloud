# Manual GitHub Actions R2 E2E runner. Do not echo raw test output (it may contain
# presigned bearer URLs). The file is used ONLY after protected Environment approval.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$report = Join-Path $env:RUNNER_TEMP 'r2-private-e2e-sanitized.txt'
$head = @(
    'R2 private object E2E - sanitized execution evidence'
    "commit: $env:GITHUB_SHA"
    "run: $env:GITHUB_RUN_ID"
    'scope: R2 managed/custom domains and S3 API endpoint (not Workers/proxies)'
)

# Missing secrets must fail BEFORE starting any network request.
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
    throw 'Missing protected R2 E2E configuration. No cloud request was started.'
}
if ($env:R2_E2E_ALLOW_TEST_WRITES -cne 'YES_TEST_BUCKET') {
    throw 'Explicit disposable test Bucket authorization missing'
}

$name = 'commands::r2_private_live_e2e::real_r2_private_object_e2e'
# In-memory output only. No raw logs in console, artifacts, or step summary.
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

# A test-name typo can make Cargo succeed with zero tests; reject that explicitly.
$exactOnePassed = $combined -match 'test result: ok\. 1 passed; 0 failed;'
$pass = ($exitCode -eq 0) -and $exactOnePassed -and $allStagesPassed
$lines += "test harness ran exactly one successful test: $exactOnePassed"
$lines += $(if ($pass) { 'status: PASS' } else { 'status: FAIL / UNVERIFIED' })
$lines | Set-Content -LiteralPath $report -Encoding utf8
$lines | Add-Content -Path $env:GITHUB_STEP_SUMMARY
if (-not $pass) {
    throw 'R2 live E2E failed or incomplete. Only sanitized stage verdicts are published.'
}
