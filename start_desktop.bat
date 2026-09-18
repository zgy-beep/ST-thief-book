@echo off
chcp 65001 >nul
title ST-Thief-Desktop-Bar
cd /d "%~dp0"
python -u "%~dp0thief_desktop_bar.py"
if %errorlevel% neq 0 (
    echo.
    echo ===================================================
    echo  [Error] Python script exited unexpectedly.
    echo  Please check if Python 3 is installed and in PATH.
    echo ===================================================
    echo.
    pause
)
