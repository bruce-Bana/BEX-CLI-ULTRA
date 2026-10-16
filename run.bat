@echo off
setlocal
title BEX CLI ULTRA
cd /d "%~dp0"
if not exist node_modules (
  echo Dependencies are missing. Run install.bat first.
  pause
  exit /b 1
)
node --check index.js
if errorlevel 1 (
  echo [ERROR] index.js has a syntax error. Fix it before launching.
  pause
  exit /b 1
)
node index.js %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo BEX exited with code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
