#requires -Version 7.0
<#
  Mirror Cloud SQLite 备份脚本（DDL/迁移前使用）

  默认数据库：%APPDATA%\dev.multicloud.publisher\publisher.sqlite3
  （与 apps/desktop/src-tauri/src/lib.rs:87-89 的 app_data_dir()/publisher.sqlite3 一致）

  用法：
    pwsh -File scripts/backup_db.ps1
    pwsh -File scripts/backup_db.ps1 -DatabasePath 'D:\path\publisher.sqlite3'
    pwsh -File scripts/backup_db.ps1 -Verify

  输出：备份文件 + .sha256 边车；校验源/副本 SHA256 一致后退出 0，否则退出 1。
#>
[CmdletBinding()]
param(
    [string]$DatabasePath,
    [string]$OutDir,
    [int]$KeepDays = 30,
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repoRoot '.ai\backups' }

function Resolve-DatabasePath {
    param([string]$Explicit)
    if ($Explicit) {
        if (-not (Test-Path -LiteralPath $Explicit)) { throw "数据库不存在：$Explicit" }
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    $candidates = @(
        (Join-Path $env:APPDATA 'dev.multicloud.publisher\publisher.sqlite3'),
        (Join-Path $env:LOCALAPPDATA 'dev.multicloud.publisher\publisher.sqlite3')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    $found = Get-ChildItem -Path $env:APPDATA -Filter 'publisher.sqlite3' -File -Depth 2 -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "未找到 publisher.sqlite3；请用 -DatabasePath 显式指定。"
}

function Get-Sha256 {
    param([string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$source = Resolve-DatabasePath -Explicit $DatabasePath
$sourceDir = Split-Path -Parent $source
$stem = [IO.Path]::GetFileNameWithoutExtension($source)

# SQLite 文件头校验，避免把误命名的文件当数据库备份
$header = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($source)[0..14])
if ($header -ne 'SQLite format 3') { throw "不是 SQLite 数据库（文件头=$header）：$source" }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $OutDir "$stem-$stamp.sqlite3"

$sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
if ($sqlite3 -and -not $Verify) {
    # 在线备份：包含未 checkpoint 的 WAL 内容
    & $sqlite3.Path $source ".backup '$target'"
    if ($LASTEXITCODE -ne 0) { throw "sqlite3 .backup 失败（exit=$LASTEXITCODE）" }
}
else {
    Copy-Item -LiteralPath $source -Destination $target -Force
    foreach ($suffix in @('-wal', '-shm')) {
        $side = "$source$suffix"
        if (Test-Path -LiteralPath $side) { Copy-Item -LiteralPath $side -Destination "$target$suffix" -Force }
    }
}

$sourceHash = Get-Sha256 -Path $source
$targetHash = Get-Sha256 -Path $target
$targetInfo = Get-Item -LiteralPath $target
"$targetHash  $($targetInfo.Name)" | Set-Content -LiteralPath "$target.sha256" -Encoding ascii

$walNote = ''
if (Test-Path -LiteralPath "$source-wal") {
    $walSize = (Get-Item -LiteralPath "$source-wal").Length
    if (-not $sqlite3) { $walNote = "；源库存在 WAL（$walSize bytes），已一并复制 -wal/-shm" }
}

if ($sourceHash -ne $targetHash) {
    throw "备份校验失败：源 $sourceHash ≠ 副本 $targetHash"
}

"backup=$target"
"size=$($targetInfo.Length)"
"sha256=$targetHash"
"source=$source$walNote"
"ok=true"

# 清理过期备份（只处理本脚本命名模式的 *.sqlite3 与边车）
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $OutDir -Filter "$stem-*.sqlite3" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        foreach ($p in @($_.FullName, "$($_.FullName)-wal", "$($_.FullName)-shm", "$($_.FullName).sha256")) {
            if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
        }
    }
