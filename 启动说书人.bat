@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24, then reopen this file.
  pause
  exit /b 1
)
node scripts/launch.mjs
set "launch_result=%errorlevel%"
if not "%launch_result%"=="0" pause
exit /b %launch_result%
