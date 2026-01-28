@echo off
cls
title BEX CLI ULTRA INSTALLER
echo ==========================================
echo      BEX CLI ULTRA INSTALLER
echo ==========================================
echo.

REM Check if Node is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

echo [1/3] Installing dependencies (this may take a minute)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    echo Please check your internet connection and try again.
    pause
    exit /b
)

echo.
echo [2/3] Linking the 'bex' command globally...
echo Cleaning up old versions...
call npm uninstall -g bex-cli-ultra
call npm link
if %errorlevel% neq 0 (
    echo [WARNING] Failed to create global 'bex' command.
    echo You might need to run your terminal as an Administrator.
    echo You can still run the app with 'node index.js'.
)

echo.
echo [3/3] Creating .env file...
if not exist .env (
    if exist "%USERPROFILE%\.bex.env" (
        copy "%USERPROFILE%\.bex.env" .env >nul
        echo Restored .env from global configuration.
    ) else if exist .env.example (
        copy .env.example .env >nul
        echo Created .env file from template.
    ) else (
        (
            echo GOOGLE_API_KEY=
            echo DEEPSEEK_API_KEY=
        ) > .env
        echo Created new .env file.
    )
    echo Opening .env file in Notepad...
    start notepad .env
) else (
    echo .env file already exists. Skipping creation.
)

echo.
echo ******************************************************
echo ACTION REQUIRED:
echo 1. If .env opened, paste your API keys into it.
echo 2. Save the file.
echo 3. Press any key here to finish installation.
echo ******************************************************
pause >nul

echo.
echo [4/3] Installing global configuration...
copy /Y .env "%USERPROFILE%\.bex.env" >nul
echo Copied .env to %USERPROFILE%\.bex.env

echo.
echo ==========================================
echo      SETUP COMPLETE!
echo ==========================================
echo.
echo To run the agent from anywhere, just type: bex
echo.
pause
