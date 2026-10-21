# HISTORICAL REFERENCE ONLY: frozen UX34 offline upgrade/rollback test.
# This archived script intentionally refuses to run on current main or real user profiles.
# Old candidate SHA, v1.4.9 installer, artifact run-id and test profile are obsolete.
# Adapt in a new reviewed main-only workflow with isolated Windows profile and checksum validation.
throw 'ARCHIVED-ONLY: UX34 frozen upgrade script must never be executed directly'

# Windows GitHub-hosted runner only. Upgrade compatibility between the published
# 1.4.9 NSIS installer and the #34 candidate. No real user data or cloud provider.
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
# Read only the app-created Windows Generic credential. Never print or export it.
# keyring windows-native uses the target-name convention user.service.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MirrorCloudCredentialProbe {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public Int64 LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr ptr);
  [DllImport("advapi32.dll", EntryPoint = "CredFree")]
  static extern void CredFree(IntPtr ptr);
  public static byte[] Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows app credential missing");
    try {
      var c = (Credential)Marshal.PtrToStructure(ptr, typeof(Credential));
      if (c.CredentialBlobSize < 32 || c.CredentialBlobSize > 8192 || c.CredentialBlob == IntPtr.Zero)
        throw new InvalidOperationException("Unexpected Windows Credential Manager data size");
      var bytes = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
      return bytes;
    } finally { CredFree(ptr); }
  }
}
'@
$localApiTarget = 'integration:local-api-token.com.multicloud.publisher'

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
$candidateName='mirror-cloud-ux34-candidate-e6c2e0e4e78d-windows-x64-setup.exe'
$candidate=Join-Path $candidateDir $candidateName
$candidateExpected='e483fc6e29faaa1517b0159eed5e7f690b8882fd0bb5ebea864e93fd4db9ccc9'
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
    if stage=='ready':
        completed=c.execute('SELECT COUNT(*) FROM _sqlx_migrations WHERE success=1').fetchone()[0]
        assert completed>=10, f'Migrations not finished yet: completed={completed}'
    elif stage=='baseline':
        c.execute("CREATE TABLE IF NOT EXISTS qa_upgrade_compat(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        c.execute("INSERT OR REPLACE INTO qa_upgrade_compat VALUES('sentinel','baseline-official-v1.4.9')")
        pref={"defaultFormat":"markdown","customTemplate":"![{name}]({url})",
              "autoCopyAfterPublish":False,"imageFormat":"png"}
        c.execute("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)",
                  ("output.preferences",json.dumps(pref),"2026-10-11T00:00:00Z"))
        # Synthetic but schema-valid storage config; disabled means no network access.
        sid="8fc4298a-a5d4-4c7a-a2f2-07addb2d37b8"
        config={"owner":"offline-example","repo":"not-a-real-repository",
                "branch":"main","root":"qa-test","public_base_url":None}
        c.execute("""INSERT INTO storages
                   (id,name,provider_key,category,credential_ref,config_json,capabilities_json,
                    enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                  (sid,"Offline QA Storage","github","repository","storage:"+sid,
                   json.dumps(config),"{}",0,"2026-10-11T00:00:00Z","2026-10-11T00:00:00Z"))
        c.commit()
        json.dump(tables,open(jsonfile,'w',encoding='utf-8'))
    elif stage in ('candidate','rollback'):
        row=c.execute("SELECT value FROM qa_upgrade_compat WHERE key='sentinel'").fetchone()
        assert row == ('baseline-official-v1.4.9',), f"sentinel missing: {row}"
        prior=json.load(open(jsonfile,encoding='utf-8'))
        assert set(prior).issubset(set(tables)), f"Tables lost: {sorted(set(prior)-set(tables))}"
        prefrow=c.execute("SELECT value_json FROM app_settings WHERE key='output.preferences'").fetchone()
        assert prefrow is not None,"output preference row missing"
        expected={"defaultFormat":"markdown","customTemplate":"![{name}]({url})",
                  "autoCopyAfterPublish":False,"imageFormat":"png"}
        assert json.loads(prefrow[0]) == expected,"output preference JSON changed"
        storage=c.execute("""SELECT provider_key,category,credential_ref,config_json,enabled
                           FROM storages WHERE name='Offline QA Storage'""").fetchone()
        assert storage and storage[:3]==("github","repository",
          "storage:8fc4298a-a5d4-4c7a-a2f2-07addb2d37b8"),"storage/ref changed"
        config={"owner":"offline-example","repo":"not-a-real-repository",
                "branch":"main","root":"qa-test","public_base_url":None}
        assert json.loads(storage[3])==config and storage[4]==0,"storage config changed"
        print("APP_SETTINGS_COMPAT_PASS preferences=retained")
        print("STORAGE_CONFIG_COMPAT_PASS record_and_reference=retained")
        if stage=='rollback':
            # Restoring the cold official snapshot must not keep tables
            # introduced only by running a newer candidate.
            expected_tables=set(prior) | {"qa_upgrade_compat"}
            assert set(tables)==expected_tables, (
                f"rollback schema drift: expected {sorted(expected_tables)}, got {tables}"
            )
            print("ROLLBACK_SCHEMA_PASS exact_official_snapshot=1")
    else: raise AssertionError('unknown stage')
print(f"SQLITE_COMPAT_{stage.upper()}_PASS base_tables={len(tables)} integrity=ok")
'@ | Set-Content -LiteralPath $py -Encoding utf8
$tablesFile=Join-Path $logDir 'baseline-schema.json'
# The WebView window can exist before .setup has finished applying embedded
# SQLx migrations. Never kill the baseline merely because publisher.sqlite3
# exists: a half-initialized database would be a false "upgrade" fixture.
function WaitForSchema([string]$stage, $process) {
  $statusLog=Join-Path $logDir "schema-wait-$stage.log"
  for ($i=0; $i -lt 90; $i++) {
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      throw "$stage process exited while initializing SQLx schema"
    }
    & python $py $db 'ready' $tablesFile *> $statusLog
    if ($LASTEXITCODE -eq 0) {
      Note "SCHEMA_READY_$($stage): pass"
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$stage schema remained incomplete after 45 seconds (see schema-wait-$stage.log)"
}
try {
  RunInstaller $official 'OFFICIAL'
  $installed=GetInstall
  $baselineHash=(Get-FileHash -LiteralPath $installed.Executable -Algorithm SHA256).Hash
  $first=Launch $installed.Executable 'OFFICIAL' $db
  WaitForSchema 'OFFICIAL' $first
  $apiTokenBefore = [MirrorCloudCredentialProbe]::Read($localApiTarget)
  Assert ($apiTokenBefore.Length -ge 32) 'The official app did not create its Windows credential'
  Note 'WINDOWS_CREDENTIAL_BASELINE: app token exists, secret withheld'
  StopNative $first
  & python $py $db 'baseline' $tablesFile 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'baseline-sqlite.log')
  Assert ($LASTEXITCODE -eq 0) 'Failed to create baseline SQLite fixture'

  # Offline and confidential: backup copies only a synthetic CI-only SQLite
  # profile while the old app process is fully stopped. No system credential
  # gets serialized into the ZIP artifact.
  $snapshot=Join-Path $logDir 'official-pre-upgrade-backup.sqlite3'
  $dbBackupUtility=Join-Path $logDir 'sqlite_backup_restore.py'
  @'
import sqlite3,sys,pathlib
source, target, stage=sys.argv[1:4]
assert stage in ("create","restore")
assert pathlib.Path(source).resolve() != pathlib.Path(target).resolve()
with sqlite3.connect(source,timeout=10) as original:
    assert original.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    with sqlite3.connect(target,timeout=10) as destination:
        original.backup(destination)
        assert destination.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
print("OFFLINE_BACKUP_" + stage.upper() + "_PASS")
'@ | Set-Content -LiteralPath $dbBackupUtility -Encoding utf8
  & python $dbBackupUtility $db $snapshot create 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'backup-create.log')
  Assert ($LASTEXITCODE -eq 0) 'Baseline offline SQLite backup failed'
  $snapshotSha = (Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash
  Assert ((Get-Item -LiteralPath $snapshot).Length -gt 8192) 'Backup file suspiciously empty'
  Note 'OFFLINE_BACKUP_CREATED: sqlite3 backup API, integrity=ok (hash withheld from logs)'


  RunInstaller $candidate 'CANDIDATE_SAME_VERSION'
  $replaced=GetInstall
  Assert ($replaced.Directory -eq $installed.Directory) 'Candidate did not preserve installation location'
  $replacedHash=(Get-FileHash -LiteralPath $replaced.Executable -Algorithm SHA256).Hash
  Assert ($replacedHash -ne $baselineHash) 'Installed binary unchanged: same-version NSIS installation was a no-op'
  Note 'BINARY_REPLACED: pass (installed exe SHA changed)'
  $second=Launch $replaced.Executable 'CANDIDATE' $db
  WaitForSchema 'CANDIDATE' $second
  $apiTokenAfter = [MirrorCloudCredentialProbe]::Read($localApiTarget)
  Assert ($apiTokenAfter.Length -eq $apiTokenBefore.Length) 'Windows API token length changed during upgrade'
  Assert ([System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($apiTokenBefore,$apiTokenAfter)) 'Windows API token changed during upgrade'
  Note 'WINDOWS_CREDENTIAL_COMPAT_PASS value preserved, not printed'
  StopNative $second
  & python $py $db 'candidate' $tablesFile 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'candidate-sqlite.log')
  Assert ($LASTEXITCODE -eq 0) 'Candidate did not retain baseline SQLite schema or test data'
  Note 'UPGRADE_UX34_COMPAT_GATE baseline=1 replaced=1 native=2 sqlite=1 settings=1 storage=1 keyring=1 failed=0'

  # Negative-path rollback rehearsal: restore the OLD installed official
  # program and offline SQLite snapshot. This is NOT an in-app rollback UI or
  # an automatic/recommended end-user downgrade procedure.
  RunInstaller $official 'ROLLBACK_OFFICIAL'
  $restoredInstall=GetInstall
  Assert ($restoredInstall.Directory -eq $installed.Directory) 'Rollback installed to a different location'
  $rollbackExeSha=(Get-FileHash -LiteralPath $restoredInstall.Executable -Algorithm SHA256).Hash
  Assert ($rollbackExeSha -eq $baselineHash) 'Official executable binary not restored during rollback'
  Note 'ROLLBACK_OFFICIAL_BINARY_PASS installed_exe_original_hash=1'

  & python $dbBackupUtility $snapshot $db restore 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'backup-restore.log')
  Assert ($LASTEXITCODE -eq 0) 'Offline SQLite backup restore failed'
  Assert ((Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash -eq $snapshotSha) 'Backup input changed during rollback'
  Note 'OFFLINE_BACKUP_RESTORE_PASS integrity=ok'
  $third=Launch $restoredInstall.Executable 'ROLLBACK_OFFICIAL' $db
  WaitForSchema 'ROLLBACK_OFFICIAL' $third
  $tokenAfterRollback=[MirrorCloudCredentialProbe]::Read($localApiTarget)
  Assert ([System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($apiTokenBefore,$tokenAfterRollback)) 'System API credential changed during offline rollback'
  Note 'WINDOWS_CREDENTIAL_ROLLBACK_PASS value preserved, not printed'
  StopNative $third
  & python $py $db 'rollback' $tablesFile 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'rollback-sqlite.log')
  Assert ($LASTEXITCODE -eq 0) 'Rollback restored DB did not preserve official schema, settings, and sentinel'
  Note 'ROLLBACK_UX34_GATE old_binary=1 restored_db=1 native=3 settings=1 storage=1 keyring=1 failed=0'

} catch {
  Note "UPGRADE_COMPAT_FAILURE: $($_.Exception.Message)"
  throw
} finally {
  foreach ($proc in $processes) { StopNative $proc }
}
