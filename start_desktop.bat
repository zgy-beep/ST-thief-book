@echo off
chcp 65001 >nul
title ST-Thief-Desktop-Bar
cd /d "%~dp0"
rem 摸鱼条托盘+热键助手：Ctrl+Alt+B 老板键  Ctrl+B 召回/归位  Ctrl+H 显示/隐身（托盘图标左键同样可切换）
if exist "%~dp0bar_hotkey_helper.py" (
    start "" pythonw -u "%~dp0bar_hotkey_helper.py" --listen
)
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
