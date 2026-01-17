@echo off
REM =====================================================
REM Start GEMHUB Amazon Token Refresh Service
REM Refreshes GEMHUB Amazon token every 3500 seconds (~58 min)
REM =====================================================

cd /d "%~dp0"
echo Starting GEMHUB Amazon Token Refresh Service...
echo.

REM Check if Python is available (try py -3 first, then python)
py -3 --version >nul 2>&1
if errorlevel 1 (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python is not installed or not in PATH
        echo Please install Python and try again
        pause
        exit /b 1
    )
    set PYTHON_CMD=python
    set PIP_CMD=pip
) else (
    set PYTHON_CMD=py -3
    set PIP_CMD=py -3 -m pip
)

REM Install dependencies if needed
%PIP_CMD% install -q -r requirements.txt 2>nul

echo Press Ctrl+C to stop
echo.

%PYTHON_CMD% gemhub_amazon_token.py --loop
