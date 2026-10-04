$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot\..\apps\desktop"
try {
  if (-not (Test-Path node_modules)) { npm install }
  npm run dev
}
finally { Pop-Location }
