# Windows GitHub-hosted runner only. Upgrade compatibility between the published
# 1.4.9 NSIS installer and the #33 candidate. No real user data or cloud provider.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$logDir = Join-Path $env:RUNNER_TEMP 'mirror-cloud-upgrade-compat'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$report = Join-Path $logDir 'upgrade-verdict.txt'
function Note([string]$message) {
  Write-Host $message
  Add-Content -LiteralPath $report -Value $message -Encoding utf8
}
function Assert([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}
function RunInstaller([string]$file, [string]$label) {
  $p = Start-Process -FilePath $file -ArgumentList @('/S','/NS') -PassThru
  try { Wait-Process -Id $p.Id -Timeout 240 -ErrorAction Stop }
  catch { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; throw "$label installer did not exit within 240s" }
  $p.Refresh()
  if ($p.ExitCode -ne 0) { throw "$label installer exited $($p.ExitCode)" }
  Note "INSTALL_$($label): exit 0"
}
function GetInstall {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $entries = @($roots | ForEach-Object { Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.DisplayName -eq 'Mirror Cloud' })
  Assert ($entries.Count -eq 1) "Expected exactly one installed Mirror Cloud registry entry; got $($entries.Count)"
  $path = ([string]$entries[0].InstallLocation).Trim('"')
  Assert (Test-Path -LiteralPath $path) "Installed location missing: $path"
  $apps = @(Get-ChildItem -LiteralPath $path -File -Filter '*.exe' | Where-Object { $_.Name -ne 'uninstall.exe' })
  Assert ($apps.Count -eq 1) "Expected one product EXE, got $($apps.Count)"
  return @{ Directory=$path; Executable=$apps[0].FullName }
}
function Launch([string]$file,[string]$stage,[string]$dbPath) {
  $p = Start-Process -FilePath $file -PassThru
  $script:processes += $p
  for ($i=0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    $live = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($null -eq $live) { throw "$stage executable exited before native readiness" }
    if ((Test-Path -LiteralPath $dbPath) -and $live.MainWindowHandle -ne [IntPtr]::Zero -and $live.MainWindowTitle -like '*Mirror Cloud*') {
      Note "WINDOW_$($stage): pass"
      return $p
    }
  }
  throw "$stage failed to show a native main window and valid app-data database within 40s"
}
function StopNative($p) {
  if ($null -eq $p) { return }
  $live=Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if ($null -ne $live) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $p.Id -Timeout 15 -ErrorAction SilentlyContinue
  }
}
$processes = @()
$profileDir=Join-Path $env:APPDATA 'dev.multicloud.publisher'
$db=Join-Path $profileDir 'publisher.sqlite3'
if (Test-Path -LiteralPath $profileDir) { throw "Unsafe existing app profile on runner: $profileDir" }
if (@(Get-Process -Name 'image-hosting-platform-desktop' -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'An app instance already exists on this runner'
}
$installedAlready = @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'Mirror Cloud' })
if ($installedAlready.Count) { throw 'Mirror Cloud already installed on this runner' }

$base='https://github.com/159357yangjun/Mirror_Cloud/releases/download/v1.4.9'
$official=Join-Path $logDir 'official-v1.4.9-setup.exe'
$sums=Join-Path $logDir 'official-SHA256SUMS.txt'
Invoke-WebRequest -Uri "$base/image-hosting-platform-v1.4.9-windows-x64-setup.exe" -OutFile $official -MaximumRedirection 8 -TimeoutSec 90
Invoke-WebRequest -Uri "$base/SHA256SUMS.txt" -OutFile $sums -MaximumRedirection 8 -TimeoutSec 90
$officialName = 'image-hosting-platform-v1.4.9-windows-x64-setup.exe'
$officialLine = @(Get-Content -LiteralPath $sums | Where-Object { $_ -like "*  $officialName" })
Assert ($officialLine.Count -eq 1) 'Published SHA256SUMS lacks exactly one official NSIS hash'
$officialExpected=($officialLine[0] -split '\s+')[0].ToLowerInvariant()
$officialActual=(Get-FileHash -LiteralPath $official -Algorithm SHA256).Hash.ToLowerInvariant()
Assert ($officialActual -eq $officialExpected) 'Official baseline checksum mismatch'
Note "OFFICIAL_RELEASE_SHA256: verified $officialActual"

$candidateDir=Join-Path $env:GITHUB_WORKSPACE 'candidate'
$candidateName='mirror-cloud-ux-native-candidate-0f7ac930860c-windows-x64-setup.exe'
$candidate=Join-Path $candidateDir $candidateName
$candidateExpected='a0e7c1013866c0602ba2e4debad8bacbdc3e1b634ea9c3bb75f0e13880b083c8'
Assert (Test-Path -LiteralPath $candidate) "Missing candidate Artifact file: $candidate"
$candidateActual=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
Assert ($candidateActual -eq $candidateExpected) 'Candidate installer checksum does not match fixed source SHA'
Note "CANDIDATE_SHA256: verified $candidateActual"

$py=Join-Path $logDir 'sqlite_upgrade_fixture.py'
@'
import sqlite3, json, pathlib, sys
dbfile, stage, jsonfile = sys.argv[1:4]
with sqlite3.connect(dbfile, timeout=10) as c:
    assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok", "integrity_check"
    tables=sorted(x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
    assert len(tables)>=5, f"Real application schema did not initialize: {tables}"
    if stage=='baseline':
        c.execute("CREATE TABLE IF NOT EXISTS qa_upgrade_compat(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        c.execute("INSERT OR REPLACE INTO qa_upgrade_compat VALUES('sentinel','baseline-official-v1.4.9')")
        c.commit()
        json.dump(tables, open(jsonfile,'w',encoding='utf-8'))
    elif stage=='candidate':
        row=c.execute("SELECT value FROM qa_upgrade_compat WHERE key='sentinel'").fetchone()
        assert row == ('baseline-official-v1.4.9',), f"sentinel missing: {row}"
        prior=json.load(open(jsonfile,encoding='utf-8'))
        assert set(prior).issubset(set(tables)), f"Tables lost: {sorted(set(prior)-set(tables))}"
    else: raise AssertionError('unknown stage')
print(f"SQLITE_COMPAT_{stage.upper()}_PASS base_tables={len(tables)} integrity=ok")
'@ | Set-Content -LiteralPath $py -Encoding utf8
$tablesFile=Join-Path $logDir 'baseline-schema.json'
try {
  RunInstaller $official 'OFFICIAL'
  $installed=GetInstall
  $baselineHash=(Get-FileHash -LiteralPath $installed.Executable -Algorithm SHA256).Hash
  $first=Launch $installed.Executable 'OFFICIAL' $db
  StopNative $first
  & python $py $db 'baseline' $tablesFile 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'baseline-sqlite.log')
  Assert ($LASTEXITCODE -eq 0) 'Failed to create baseline SQLite fixture'

  RunInstaller $candidate 'CANDIDATE_SAME_VERSION'
  $replaced=GetInstall
  Assert ($replaced.Directory -eq $installed.Directory) 'Candidate did not preserve installation location'
  $replacedHash=(Get-FileHash -LiteralPath $replaced.Executable -Algorithm SHA256).Hash
  Assert ($replacedHash -ne $baselineHash) 'Installed binary unchanged: same-version NSIS installation was a no-op'
  Note 'BINARY_REPLACED: pass (installed exe SHA changed)'
  $second=Launch $replaced.Executable 'CANDIDATE' $db
  StopNative $second
  & python $py $db 'candidate' $tablesFile 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'candidate-sqlite.log')
  Assert ($LASTEXITCODE -eq 0) 'Candidate did not retain baseline SQLite schema or test data'
  Note 'UPGRADE_COMPAT_GATE baseline=1 replaced=1 native=2 sqlite=1 failed=0'
} catch {
  Note "UPGRADE_COMPAT_FAILURE: $($_.Exception.Message)"
  throw
} finally {
  foreach ($proc in $processes) { StopNative $proc }
}
