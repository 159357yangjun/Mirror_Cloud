param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Ui', 'Native')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$desktopPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\apps\desktop'))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found. Prepare the Node.js toolchain explicitly before starting.'
}
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $npmCommand) {
  throw 'npm was not found. Prepare npm explicitly before starting.'
}
if ($Mode -eq 'Native' -and -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw 'Cargo was not found. Prepare Rust explicitly before native development; MSVC and SDK readiness have not been checked.'
}
if (-not (Test-Path -LiteralPath (Join-Path $desktopPath 'node_modules') -PathType Container)) {
  throw "Desktop dependencies are missing. Run 'npm ci' explicitly in '$desktopPath', then retry."
}

$npmArguments = if ($Mode -eq 'Native') { @('run', 'tauri', 'dev') } else { @('run', 'dev') }
Push-Location -LiteralPath $desktopPath
try {
  $global:LASTEXITCODE = 0
  & $npmCommand @npmArguments
  $npmExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $npmExitCode
