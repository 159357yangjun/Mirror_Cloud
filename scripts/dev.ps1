$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'desktop_dev.ps1') -Mode Native
exit $LASTEXITCODE
