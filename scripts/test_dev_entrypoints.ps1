$ErrorActionPreference = 'Stop'

# Run copied, real entrypoints in an isolated project. Only fake commands are on
# PATH, so no case can install dependencies or start the actual application.
$sourceScripts = $PSScriptRoot
$shellPath = (Get-Process -Id $PID).Path
$tempDirectory = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $tempDirectory ('mirror-cloud-dev-entrypoints-' + [Guid]::NewGuid().ToString('N'))
$results = @()
$caseNumber = 0

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-EntrypointFixture {
  param(
    [string]$Entry,
    [bool]$Dependencies = $true,
    [int]$NpmExit = 0,
    [string]$MissingTool = '',
    [bool]$Direct = $false,
    [bool]$DependencyFile = $false
  )

  $script:caseNumber++
  $caseRoot = Join-Path $fixtureRoot ('case ' + $script:caseNumber)
  $project = Join-Path $caseRoot 'project with spaces'
  $scripts = Join-Path $project 'scripts'
  $desktop = Join-Path $project 'apps\desktop'
  $caller = Join-Path $caseRoot 'caller with spaces'
  $bin = Join-Path $caseRoot 'fake bin'
  $log = Join-Path $caseRoot 'npm.jsonl'
  $resultPath = Join-Path $caseRoot 'result.json'
  foreach ($directory in @($scripts, $desktop, $caller, $bin)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }
  foreach ($name in @('dev.ps1', 'ui.ps1', 'desktop_dev.ps1')) {
    $source = Join-Path $sourceScripts $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $scripts }
  }
  $dependencyPath = Join-Path $desktop 'node_modules'
  if ($DependencyFile) {
    [System.IO.File]::WriteAllText($dependencyPath, 'not a dependency directory')
  } elseif ($Dependencies) {
    [System.IO.Directory]::CreateDirectory($dependencyPath) | Out-Null
  }
  foreach ($tool in @('node', 'cargo')) {
    if ($MissingTool -ne $tool) {
      [System.IO.File]::WriteAllText((Join-Path $bin ($tool + '.cmd')), "@echo off`r`nexit /b 0`r`n")
    }
  }
  if ($MissingTool -ne 'npm') {
    [System.IO.File]::WriteAllText((Join-Path $bin 'npm.ps1'), @'
$record = [PSCustomObject]@{ arguments = @($args); directory = (Get-Location).Path }
Add-Content -LiteralPath $env:MIRROR_DEV_TEST_LOG -Value ($record | ConvertTo-Json -Compress)
exit ([int]$env:MIRROR_DEV_TEST_EXIT)
'@)
  }
  $entryPath = Join-Path $scripts $Entry
  $runnerPath = Join-Path $caseRoot 'run entry.ps1'
  [System.IO.File]::WriteAllText($runnerPath, @'
param([string]$EntryPath, [string]$ResultPath)
$ErrorActionPreference = 'Stop'
$before = (Get-Location).Path
$failure = $null
$global:LASTEXITCODE = 0
try {
  & $EntryPath
} catch {
  $failure = $_.Exception.Message
  $global:LASTEXITCODE = 1
} finally {
  [PSCustomObject]@{ before = $before; after = (Get-Location).Path; failure = $failure } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath
}
exit $LASTEXITCODE
'@)

  $originalPath = $env:PATH
  $originalLog = $env:MIRROR_DEV_TEST_LOG
  $originalExit = $env:MIRROR_DEV_TEST_EXIT
  try {
    $env:PATH = $bin
    $env:MIRROR_DEV_TEST_LOG = $log
    $env:MIRROR_DEV_TEST_EXIT = [string]$NpmExit
    Push-Location -LiteralPath $caller
    try {
      if ($Direct) {
        $output = & $shellPath -NoProfile -ExecutionPolicy Bypass -File $entryPath 2>&1
      } else {
        $output = & $shellPath -NoProfile -ExecutionPolicy Bypass -File $runnerPath -EntryPath $entryPath -ResultPath $resultPath 2>&1
      }
      $exitCode = $LASTEXITCODE
    } finally { Pop-Location }
  } finally {
    $env:PATH = $originalPath
    $env:MIRROR_DEV_TEST_LOG = $originalLog
    $env:MIRROR_DEV_TEST_EXIT = $originalExit
  }
  $calls = @()
  if (Test-Path -LiteralPath $log) {
    $calls = @(Get-Content -LiteralPath $log | ForEach-Object { $_ | ConvertFrom-Json })
  }
  $state = $null
  if (Test-Path -LiteralPath $resultPath) { $state = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json }
  [PSCustomObject]@{ exitCode = $exitCode; calls = $calls; state = $state; desktop = $desktop; output = ($output | Out-String) }
}

function Test-Case {
  param([string]$Name, [scriptblock]$Run)
  try {
    & $Run
    $script:results += [PSCustomObject]@{ name = $Name; passed = $true }
    Write-Output ('DEV_ENTRYPOINT PASS ' + $Name)
  } catch {
    $script:results += [PSCustomObject]@{ name = $Name; passed = $false }
    Write-Output ('DEV_ENTRYPOINT FAIL ' + $Name + ': ' + $_.Exception.Message)
  }
}

try {
  foreach ($entry in @('ui.ps1', 'dev.ps1')) {
    Test-Case ($entry + ' missing dependencies refuses without npm calls') {
      $run = Invoke-EntrypointFixture -Entry $entry -Dependencies $false
      $calls = @($run.calls | ForEach-Object { $_.arguments -join ' ' }) -join '; '
      Assert-Condition ($run.exitCode -ne 0) ('expected failure, got exit ' + $run.exitCode + '; npm calls: ' + $calls)
      Assert-Condition ($run.calls.Count -eq 0) ('unexpected npm calls: ' + $calls)
      Assert-Condition ($null -ne $run.state -and $run.state.failure -match 'npm ci') 'missing explicit npm ci guidance'
      Assert-Condition ($run.state.before -eq $run.state.after) 'caller location changed on missing dependencies'
    }
    Test-Case ($entry + ' starts only its intended command in a path with spaces') {
      $run = Invoke-EntrypointFixture -Entry $entry
      $expected = if ($entry -eq 'ui.ps1') { 'run dev' } else { 'run tauri dev' }
      Assert-Condition ($run.exitCode -eq 0) ('unexpected exit ' + $run.exitCode + ': ' + $run.output)
      Assert-Condition ($run.calls.Count -eq 1) ('expected one npm call, got ' + $run.calls.Count)
      Assert-Condition (($run.calls[0].arguments -join ' ') -eq $expected) 'wrong npm arguments'
      Assert-Condition ($run.calls[0].directory -eq $run.desktop) 'npm did not run in the desktop directory'
      Assert-Condition ($null -ne $run.state -and $run.state.before -eq $run.state.after) 'caller location was not restored'
    }
    Test-Case ($entry + ' restores location after npm fails') {
      $run = Invoke-EntrypointFixture -Entry $entry -NpmExit 23
      Assert-Condition ($run.exitCode -eq 23) ('expected exit 23, got ' + $run.exitCode)
      Assert-Condition ($null -ne $run.state -and $run.state.before -eq $run.state.after) 'caller location changed on npm failure'
    }
    Test-Case ($entry + ' direct process preserves npm failure exit') {
      $run = Invoke-EntrypointFixture -Entry $entry -NpmExit 23 -Direct $true
      Assert-Condition ($run.exitCode -eq 23) ('expected direct exit 23, got ' + $run.exitCode)
    }
    foreach ($tool in @('node', 'npm')) {
      Test-Case ($entry + ' requires ' + $tool + ' before running npm') {
        $run = Invoke-EntrypointFixture -Entry $entry -MissingTool $tool
        Assert-Condition ($run.exitCode -ne 0 -and $run.calls.Count -eq 0) ('missing ' + $tool + ' did not stop before npm')
        Assert-Condition ($null -ne $run.state -and $run.state.before -eq $run.state.after) 'caller location changed on missing tool'
      }
    }
    Test-Case ($entry + ' rejects a node_modules file') {
      $run = Invoke-EntrypointFixture -Entry $entry -DependencyFile $true
      Assert-Condition ($run.exitCode -ne 0 -and $run.calls.Count -eq 0) 'a file was accepted as installed dependencies'
    }
  }
  Test-Case 'UI does not require Cargo' {
    $run = Invoke-EntrypointFixture -Entry 'ui.ps1' -MissingTool 'cargo'
    Assert-Condition ($run.exitCode -eq 0 -and $run.calls.Count -eq 1) 'UI unexpectedly required Cargo'
  }
  Test-Case 'native requires Cargo before running npm' {
    $run = Invoke-EntrypointFixture -Entry 'dev.ps1' -MissingTool 'cargo'
    Assert-Condition ($run.exitCode -ne 0 -and $run.calls.Count -eq 0) 'native did not stop before npm without Cargo'
  }
} finally {
  # Only remove this run's absolute temporary fixture directory.
  $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
  $tempPrefix = $tempDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedFixture.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
      [System.IO.Path]::GetFileName($resolvedFixture) -notlike 'mirror-cloud-dev-entrypoints-*') {
    throw 'Refusing to remove a fixture outside the intended temporary directory.'
  }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}

$failed = @($results | Where-Object { -not $_.passed })
Write-Output ('DEV_ENTRYPOINT_GATE checks=' + $results.Count + ' failed=' + $failed.Count + ' shell=' + $PSVersionTable.PSVersion)
if ($failed.Count -gt 0) { exit 1 }
