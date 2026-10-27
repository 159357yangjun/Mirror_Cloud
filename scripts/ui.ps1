$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'desktop_dev.ps1') -Mode Ui
exit $LASTEXITCODE
