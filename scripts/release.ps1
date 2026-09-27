$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

if (-not $env:VITE_DOCS_BASE_URL) {
    Write-Warning "VITE_DOCS_BASE_URL is not set. The desktop build will hide online tutorial links."
}

Write-Host "[1/12] Verify tracked working tree is clean"
git diff --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Tracked working-tree changes detected. Commit or revert them before creating a release bundle."
}
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Staged changes detected. Commit or unstage them before creating a release bundle."
}

Write-Host "[2/12] Release version consistency"
Invoke-NativeChecked "python" @("scripts/check_release_version.py") "Release version validation"

Write-Host "[3/12] Tauri dependency family compatibility"
Invoke-NativeChecked "python" @("scripts/check_tauri_dependency_family.py") "Tauri dependency family validation"

Write-Host "[4/12] Static project validation"
Invoke-NativeChecked "python" @("scripts/validate.py") "Static validation"
Invoke-NativeChecked "python" @("scripts/check_contracts.py") "Command contract validation"
Invoke-NativeChecked "python" @("scripts/check_user_flow.py") "User-flow contract validation"
Invoke-NativeChecked "python" @("scripts/check_workflow_action_pins.py") "Workflow action pin validation"

Write-Host "[5/12] Verify committed dependency locks"
$LockFiles = @("Cargo.lock", "apps/desktop/package-lock.json", "website/package-lock.json")
foreach ($LockFile in $LockFiles) {
    if (-not (Test-Path $LockFile)) {
        throw "Missing committed dependency lock: $LockFile"
    }
}

Write-Host "[6/12] Rust format"
Invoke-NativeChecked "cargo" @("fmt", "--all", "--", "--check") "Rust format check"

Write-Host "[7/12] Rust check (locked)"
Invoke-NativeChecked "cargo" @("check", "--workspace", "--locked") "Rust check"

Write-Host "[8/12] Rust tests (locked)"
Invoke-NativeChecked "cargo" @("test", "--workspace", "--locked") "Rust tests"

Write-Host "[9/12] Desktop dependencies and frontend build"
Push-Location apps/desktop
try {
    Invoke-NativeChecked "npm" @("ci") "Desktop npm ci"
    Invoke-NativeChecked "npm" @("run", "build") "Desktop frontend build"

    Write-Host "[10/12] Tauri bundle"
    Invoke-NativeChecked "npm" @("run", "tauri", "build") "Tauri bundle"
}
finally {
    Pop-Location
}

Invoke-NativeChecked "git" @("diff", "--exit-code", "--", "Cargo.lock", "apps/desktop/package-lock.json", "website/package-lock.json") "Dependency-lock immutability check"

Write-Host "[11/12] Documentation site"
Push-Location website
try {
    Invoke-NativeChecked "npm" @("ci") "Docs npm ci"
    Invoke-NativeChecked "npm" @("run", "build") "Docs build"
}
finally {
    Pop-Location
}

Write-Host "[12/12] Stage installers, source archive and checksums"
$Version = (Get-Content apps/desktop/package.json -Raw | ConvertFrom-Json).version
$ArtifactDir = Join-Path $Root "artifacts"
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

$BundleRoot = Join-Path $Root "target\release\bundle"
$ExeFiles = @(Get-ChildItem $BundleRoot -Recurse -File -Filter "*.exe")
$MsiFiles = @(Get-ChildItem $BundleRoot -Recurse -File -Filter "*.msi")
if ($ExeFiles.Count -ne 1) {
    throw "Expected exactly one Windows EXE installer, found $($ExeFiles.Count)."
}
if ($MsiFiles.Count -ne 1) {
    throw "Expected exactly one Windows MSI installer, found $($MsiFiles.Count)."
}

$ExeArtifact = Join-Path $ArtifactDir "image-hosting-platform-v$Version-windows-x64-setup.exe"
$MsiArtifact = Join-Path $ArtifactDir "image-hosting-platform-v$Version-windows-x64.msi"
$SourceArchive = Join-Path $ArtifactDir "image-hosting-platform-v$Version-source.zip"
$ChecksumPath = Join-Path $ArtifactDir "SHA256SUMS.txt"

Copy-Item $ExeFiles[0].FullName -Destination $ExeArtifact -Force
Copy-Item $MsiFiles[0].FullName -Destination $MsiArtifact -Force
if (Test-Path $SourceArchive) {
    Remove-Item $SourceArchive -Force
}
Invoke-NativeChecked "git" @("archive", "--format=zip", "-o", $SourceArchive, "HEAD") "Source archive creation"

$ReleaseFiles = @($ExeArtifact, $MsiArtifact, $SourceArchive)
$ReleaseFiles |
    Sort-Object { Split-Path $_ -Leaf } |
    ForEach-Object {
        $hash = (Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $(Split-Path $_ -Leaf)"
    } | Set-Content -Encoding utf8 $ChecksumPath

Write-Host "Release summary"
Write-Host "EXE installer: $ExeArtifact"
Write-Host "MSI installer: $MsiArtifact"
Write-Host "Source archive: $SourceArchive"
Write-Host "Checksums: $ChecksumPath"
Write-Host "Dependency locks were consumed as-is and remained unchanged during the release build."
