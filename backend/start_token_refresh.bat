@echo off
REM =====================================================
REM Start Multi-Account Token Refresh Service
REM Refreshes Amazon tokens every 3500 seconds (~58 min)
REM =====================================================

cd /d "%~dp0"
echo Starting Token Refresh Service...
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
echo Checking Python dependencies...
%PIP_CMD% install -q -r requirements.txt

echo.
echo Starting token refresh scheduler...
echo Press Ctrl+C to stop
echo.

%PYTHON_CMD% token_refresh_scheduler.py
