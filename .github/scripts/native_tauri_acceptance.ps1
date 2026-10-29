# Ported from the legacy UX34 native test; runs only on an empty disposable Windows CI profile.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$logDir = Join-Path $env:RUNNER_TEMP 'mirror-cloud-native-acceptance'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'native-results.txt'
function Report([string]$message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}
$dataDir = Join-Path $env:APPDATA 'dev.multicloud.publisher'
$dbPath = Join-Path $dataDir 'publisher.sqlite3'
if (Test-Path -LiteralPath $dataDir) { throw "Refusing to test against existing app data: $dataDir" }
$binDir = Join-Path $env:GITHUB_WORKSPACE 'target\release'
$exe = @(Get-ChildItem -LiteralPath $binDir -File -Filter '*.exe' |
  Where-Object { $_.Name -like '*image-hosting-platform*' -or $_.Name -like '*multicloud*' })
if ($exe.Count -ne 1) { throw "Expected exactly one native app EXE, found $($exe.Count)" }
Report "APP_PATH: $($exe[0].FullName)"
Report "DB_PATH: $dbPath"
$procs = @()
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MirrorWindowBounds {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
function Assert-InitialWindowBounds([IntPtr]$handle, [string]$name) {
  $previous = [MirrorWindowBounds]::SetThreadDpiAwarenessContext([IntPtr](-4))
  try {
    $rect = [MirrorWindowBounds+Rect]::new()
    $info = [MirrorWindowBounds+MonitorInfo]::new()
    $info.Size = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $monitor = [MirrorWindowBounds]::MonitorFromWindow($handle, 2)
    if (-not [MirrorWindowBounds]::GetWindowRect($handle, [ref]$rect) -or -not [MirrorWindowBounds]::GetMonitorInfo($monitor, [ref]$info)) { throw 'Native window/monitor bounds unavailable' }
    $work = $info.Work
    $rw = ($rect.Right - $rect.Left) / [double]($work.Right - $work.Left)
    $rh = ($rect.Bottom - $rect.Top) / [double]($work.Bottom - $work.Top)
    if ($rect.Left -lt $work.Left -or $rect.Top -lt $work.Top -or $rect.Right -gt $work.Right -or $rect.Bottom -gt $work.Bottom) { throw 'Initial native window exceeds monitor work area' }
    if ([Math]::Abs($rw - 0.8) -gt 0.03 -or [Math]::Abs($rh - 0.8) -gt 0.03) { throw "Initial window ratio differs from 80%: $rw / $rh" }
    Report "NATIVE_WINDOW_BOUNDS_$($name): within_work_area=1 width_ratio=$rw height_ratio=$rh"
  } finally {
    if ($previous -ne [IntPtr]::Zero) { [void][MirrorWindowBounds]::SetThreadDpiAwarenessContext($previous) }
  }
}
function Stop-Native($p) {
  if ($null -eq $p) { return }
  $live = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if ($null -ne $live) {
    Stop-Process -Id $live.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $live.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
}
function Start-Native([string]$name) {
  $p = Start-Process -FilePath $exe[0].FullName -PassThru
  $script:procs += $p
  $window = $false
  $dbCreated = $false
  for ($i=0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    $live = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if ($null -eq $live) { throw "$name native process exited before readiness" }
    $dbCreated = Test-Path -LiteralPath $script:dbPath
    if ($live.MainWindowHandle -ne [IntPtr]::Zero -and $live.MainWindowTitle -like '*Mirror Cloud*') {
      $window = $true
    }
    if ($dbCreated -and $window) { break }
  }
  if (-not $dbCreated) {
    $found = @(Get-ChildItem -Path $env:APPDATA -File -Filter 'publisher.sqlite3' -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    throw "$name DB not created at expected path; other matches: $($found -join ',')"
  }
  if (-not $window) { throw "$name SQLite created but native UI window was not observed; cannot claim GUI launch" }
  Assert-InitialWindowBounds $live.MainWindowHandle $name
  Report "NATIVE_WINDOW_$($name): pass"
  Report "NATIVE_DB_$($name): pass"
  return $p
}
$py = Join-Path $logDir 'sqlite_marker.py'
@'
import sqlite3,sys
path,action=sys.argv[1:3]
with sqlite3.connect(path,timeout=10) as con:
    if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("SQLite failed integrity_check")
    if action=="write":
        con.execute("CREATE TABLE IF NOT EXISTS qa_native_smoke(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        con.execute("INSERT OR REPLACE INTO qa_native_smoke VALUES('restart','native-main-ci')")
        con.commit()
    elif action=="read":
        row=con.execute("SELECT value FROM qa_native_smoke WHERE key='restart'").fetchone()
        if row != ('native-main-ci',):
            raise SystemExit("SQLite marker not preserved across restart: "+str(row))
    else: raise SystemExit("unknown action")
print("SQLITE_"+action.upper()+"_PASS")
'@ | Set-Content -LiteralPath $py -Encoding utf8
try {
  $first = Start-Native 'FIRST'
  Stop-Native $first
  & python $py $dbPath write 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'sqlite-write.log')
  if ($LASTEXITCODE -ne 0) { throw 'SQLite fixture insert failed' }
  $second = Start-Native 'SECOND'
  Stop-Native $second
  & python $py $dbPath read 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'sqlite-read.log')
  if ($LASTEXITCODE -ne 0) { throw 'SQLite integrity or persistence check failed' }
  Report 'NATIVE_TAURI_GATE windows=2 sqlite=2 persisted=1 failed=0'
} catch {
  Report "NATIVE_TAURI_FAILURE: $($_.Exception.Message)"
  throw
} finally {
  foreach ($p in $procs) { Stop-Native $p }
}
