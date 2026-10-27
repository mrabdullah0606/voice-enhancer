@echo off
title VoiceForge AI - Web Studio Frontend
cd /d "%~dp0frontend"

echo ========================================================
echo       VoiceForge AI -- Web Studio Dashboard
echo ========================================================
echo.

if not exist "node_modules" (
    echo [INFO] Node modules not found. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to run npm install. Ensure Node.js is installed and in PATH.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Next.js Studio Dashboard on http://localhost:3000 ...
call npm run dev -- -p 3000
pause
