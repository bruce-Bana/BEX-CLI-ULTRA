@echo off
setlocal EnableExtensions
title BEX CLI ULTRA - Installer
cd /d "%~dp0"
echo.
echo  ============================================
echo       BEX CLI ULTRA - Windows Installer
echo  ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 (
  echo [ERROR] BEX requires Node.js 20 or newer.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js LTS with npm.
  pause
  exit /b 1
)
if not exist package.json (
  echo [ERROR] package.json is missing. Extract the full repository first.
  pause
  exit /b 1
)
echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed. Check the network and npm output.
  pause
  exit /b 1
)
if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo [2/3] Created .env from the example.
  )
)
echo [3/3] Running diagnostics...
call npm run doctor
echo.
echo Setup complete. Add API keys to .env, then run run.bat.
echo Do not share or commit .env.
if exist .env start notepad .env
pause
exit /b 0
