@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist "dist\win-unpacked\chromium.exe" (
  echo Install dependencies with npm ci, then build with:
  echo npm run pack -- --win --config.electronDist=node_modules/electron/dist
  pause
  exit /b 1
)
start "" "dist\win-unpacked\chromium.exe"
