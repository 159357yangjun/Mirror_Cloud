# Executes the ignored *real* R2 integration test using the application's production
# OpenDAL implementation. Secrets are typed into hidden prompts, never command arguments.
# Use ONLY a disposable private R2 test Bucket. Requires Windows PowerShell 5.1+ / pwsh.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AccountId,
    [Parameter(Mandatory = $true)]
    [string]$Bucket
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Secret([string]$Prompt) {
    $secureValue = Read-Host -Prompt $Prompt -AsSecureString
    $credential = [System.Net.NetworkCredential]::new('e2e', $secureValue)
    try {
        return $credential.Password
    }
    finally {
        $secureValue.Dispose()
    }
}

$variables = @(
    'R2_E2E_ACCOUNT_ID',
    'R2_E2E_BUCKET',
    'R2_E2E_ACCESS_KEY_ID',
    'R2_E2E_SECRET_ACCESS_KEY',
    'R2_E2E_CLOUDFLARE_API_TOKEN',
    'R2_E2E_ALLOW_TEST_WRITES'
)
# Restore the caller's previous environment after the test completes.
$previous = @{}
foreach ($name in $variables) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $env:R2_E2E_ACCOUNT_ID = $AccountId
    $env:R2_E2E_BUCKET = $Bucket
    if (-not $env:R2_E2E_ACCESS_KEY_ID) {
        $env:R2_E2E_ACCESS_KEY_ID = Read-Secret 'R2 Access Key ID'
    }
    if (-not $env:R2_E2E_SECRET_ACCESS_KEY) {
        $env:R2_E2E_SECRET_ACCESS_KEY = Read-Secret 'R2 Secret Access Key'
    }
    if (-not $env:R2_E2E_CLOUDFLARE_API_TOKEN) {
        $env:R2_E2E_CLOUDFLARE_API_TOKEN = Read-Secret 'Cloudflare API token (R2 domains read)'
    }

    Write-Host 'R2 real E2E: checks Cloudflare public domain switches BEFORE test upload.'
    Write-Host 'This writes a single random test object and tests a 10-minute GET signature.'
    Write-Host 'No keys or signed links are printed or stored as artifacts.'
    $confirmation = Read-Host "Enter YES_TEST_BUCKET only if this is a disposable private test Bucket"
    if ($confirmation -cne 'YES_TEST_BUCKET') {
        throw 'Not authorized to write into this Bucket'
    }
    $env:R2_E2E_ALLOW_TEST_WRITES = 'YES_TEST_BUCKET'
    & cargo test --locked -p image-hosting-platform-desktop --lib real_r2_private_object_e2e -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) {
        throw 'R2 live integration test failed or remains unverified'
    }
}
finally {
    foreach ($name in $variables) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
