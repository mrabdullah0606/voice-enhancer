@echo off
title VoiceForge AI - Backend Server
cd /d "%~dp0backend"

echo ========================================================
echo       VoiceForge AI -- DSP & Acoustic Backend
echo ========================================================
echo.

if not exist "venv\Scripts\python.exe" (
    echo [INFO] Python virtual environment not found. Creating venv...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment. Ensure Python is installed and in PATH.
        pause
        exit /b 1
    )
    echo [INFO] Installing backend dependencies...
    venv\Scripts\python.exe -m pip install --upgrade pip
    venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install pip requirements.
        pause
        exit /b 1
    )
)

echo [INFO] Starting FastAPI / WebSocket server on http://127.0.0.1:8000 ...
venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
