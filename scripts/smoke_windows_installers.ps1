param(
    [string]$BundleRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "target\release\bundle"),
    [string]$ProductName = "Mirror Cloud"
)

$ErrorActionPreference = "Stop"

function Invoke-ProcessChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)][string]$Description,
        [int[]]$SuccessExitCodes = @(0)
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
    if ($SuccessExitCodes -notcontains $process.ExitCode) {
        throw "$Description failed with exit code $($process.ExitCode)."
    }
}

function Get-InstalledAppEntries {
    param([Parameter(Mandatory = $true)][string]$DisplayName)

    $registryPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $entries = foreach ($path in $registryPaths) {
        Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -eq $DisplayName }
    }
    return @($entries)
}

function Wait-ForInstalledState {
    param(
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][bool]$Present,
        [int]$Attempts = 40,
        [int]$DelayMilliseconds = 500
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $entries = @(Get-InstalledAppEntries -DisplayName $DisplayName)
        if ($Present -and $entries.Count -gt 0) {
            return $entries
        }
        if (-not $Present -and $entries.Count -eq 0) {
            return @()
        }
        Start-Sleep -Milliseconds $DelayMilliseconds
    }

    $state = if ($Present) { "appear" } else { "disappear" }
    throw "Timed out waiting for '$DisplayName' to $state in the Windows uninstall registry."
}

function Assert-SignPathApplicationSignature {
    param([Parameter(Mandatory = $true)][string]$ExecutablePath)

    if ($env:MIRROR_SIGNPATH_ENABLED -ne "true") {
        return
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $ExecutablePath
    if ($signature.Status -ne "Valid") {
        throw "Installed application Authenticode signature is not valid: $($signature.Status)."
    }
    if ($signature.SignerCertificate.Subject -notmatch "SignPath Foundation") {
        throw "Installed application has an unexpected signer: $($signature.SignerCertificate.Subject)."
    }
}

if (-not (Test-Path $BundleRoot)) {
    throw "Bundle root not found: $BundleRoot"
}

$nsisFiles = @(Get-ChildItem -Path $BundleRoot -Recurse -File -Filter "*-setup.exe")
$msiFiles = @(Get-ChildItem -Path $BundleRoot -Recurse -File -Filter "*.msi")
if ($nsisFiles.Count -ne 1) {
    throw "Expected exactly one NSIS setup executable, found $($nsisFiles.Count)."
}
if ($msiFiles.Count -ne 1) {
    throw "Expected exactly one MSI installer, found $($msiFiles.Count)."
}

$logRoot = if ($env:RUNNER_TEMP) {
    Join-Path $env:RUNNER_TEMP "image-hosting-platform-installer-smoke"
} else {
    Join-Path $env:TEMP "image-hosting-platform-installer-smoke"
}
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$existing = @(Get-InstalledAppEntries -DisplayName $ProductName)
if ($existing.Count -gt 0) {
    throw "Refusing installer smoke test because '$ProductName' is already installed on this machine."
}

Write-Host "[1/4] Silent-install NSIS bundle"
Invoke-ProcessChecked -FilePath $nsisFiles[0].FullName -ArgumentList @("/S", "/NS") -Description "NSIS silent install"
$nsisEntries = @(Wait-ForInstalledState -DisplayName $ProductName -Present $true)
$nsisEntry = $nsisEntries[0]
$installLocation = [string]$nsisEntry.InstallLocation
$installLocation = $installLocation.Trim('"')
if (-not $installLocation -or -not (Test-Path $installLocation)) {
    throw "NSIS install registry entry did not expose a valid InstallLocation: '$installLocation'."
}
$installedExecutables = @(
    Get-ChildItem -Path $installLocation -File -Filter "*.exe" -ErrorAction Stop |
        Where-Object { $_.Name -ne "uninstall.exe" }
)
if ($installedExecutables.Count -lt 1) {
    throw "NSIS install completed but no application executable was found in '$installLocation'."
}
$applicationExecutables = @($installedExecutables | Where-Object { $_.Name -eq "image-hosting-platform-desktop.exe" })
if ($applicationExecutables.Count -ne 1) {
    throw "NSIS install completed but expected exactly one Mirror Cloud application executable, found $($applicationExecutables.Count)."
}
Assert-SignPathApplicationSignature -ExecutablePath $applicationExecutables[0].FullName
$uninstaller = Join-Path $installLocation "uninstall.exe"
if (-not (Test-Path $uninstaller)) {
    throw "NSIS install completed but uninstall.exe was not found in '$installLocation'."
}

Write-Host "[2/4] Silent-uninstall NSIS bundle"
Invoke-ProcessChecked -FilePath $uninstaller -ArgumentList @("/S") -Description "NSIS silent uninstall"
Wait-ForInstalledState -DisplayName $ProductName -Present $false | Out-Null

Write-Host "[3/4] Quiet-install MSI bundle"
$msiInstallLog = Join-Path $logRoot "msi-install.log"
Invoke-ProcessChecked -FilePath "msiexec.exe" -ArgumentList @(
    "/i",
    "`"$($msiFiles[0].FullName)`"",
    "/quiet",
    "/norestart",
    "/L*v",
    "`"$msiInstallLog`""
) -Description "MSI quiet install" -SuccessExitCodes @(0, 3010)
$msiEntries = @(Wait-ForInstalledState -DisplayName $ProductName -Present $true)
$msiInstallLocation = [string]$msiEntries[0].InstallLocation
$msiInstallLocation = $msiInstallLocation.Trim('"')
if (-not $msiInstallLocation) {
    $msiInstallLocation = $installLocation
}
$msiApplicationExecutable = Join-Path $msiInstallLocation "image-hosting-platform-desktop.exe"
if (-not (Test-Path -LiteralPath $msiApplicationExecutable -PathType Leaf)) {
    throw "MSI install completed but the application executable was not found at '$msiApplicationExecutable'."
}
Assert-SignPathApplicationSignature -ExecutablePath $msiApplicationExecutable

Write-Host "[4/4] Quiet-uninstall MSI bundle"
$msiUninstallLog = Join-Path $logRoot "msi-uninstall.log"
Invoke-ProcessChecked -FilePath "msiexec.exe" -ArgumentList @(
    "/x",
    "`"$($msiFiles[0].FullName)`"",
    "/quiet",
    "/norestart",
    "/L*v",
    "`"$msiUninstallLog`""
) -Description "MSI quiet uninstall" -SuccessExitCodes @(0, 3010)
Wait-ForInstalledState -DisplayName $ProductName -Present $false | Out-Null

Write-Host "Windows installer smoke test passed for NSIS and MSI."
Write-Host "Installer logs: $logRoot"
