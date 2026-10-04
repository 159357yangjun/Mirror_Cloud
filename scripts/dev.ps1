$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 未安装。"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust/Cargo 未安装。请先安装 rustup。"
}

Push-Location "$PSScriptRoot\..\apps\desktop"
try {
  if (-not (Test-Path node_modules)) {
    npm install
  }
  npm run tauri dev
}
finally {
  Pop-Location
}
