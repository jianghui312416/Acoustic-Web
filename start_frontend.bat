@echo off
setlocal
title Acoustic Field GeoVis - Frontend
cd /d "%~dp0"

echo [Frontend] Project: %CD%

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or is not available in PATH.
    echo Install Node.js and run this file again.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed or is not available in PATH.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERROR] package.json was not found in %CD%.
    pause
    exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
    echo [Frontend] Dependencies are missing. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo [Frontend] Starting http://127.0.0.1:5173 ...
echo [Frontend] Press Ctrl+C to stop.
call npm run dev -- --host 0.0.0.0 --port 5173 --strictPort

if errorlevel 1 (
    echo.
    echo [ERROR] Frontend stopped unexpectedly. Check whether port 5173 is already in use.
    pause
    exit /b 1
)

endlocal
