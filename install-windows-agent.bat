@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo        RemoteHub Windows Desktop Agent Installer        
echo ========================================================
echo.

set "TARGET_DIR=%LOCALAPPDATA%\RemoteHub\bin"
set "SOURCE_DIR=%~dp0agent-windows\bin\Release\net8.0-windows"

if not exist "!SOURCE_DIR!\RemoteHubAgent.exe" (
    echo [ERROR] Agent binary not found at !SOURCE_DIR!\RemoteHubAgent.exe
    echo Please build the project first using dotnet build.
    pause
    exit /b 1
)

echo [*] Creating application directory: !TARGET_DIR!
if not exist "!TARGET_DIR!" mkdir "!TARGET_DIR!"

echo [*] Copying RemoteHub Agent binaries...
xcopy /Y /E /I "!SOURCE_DIR!\*" "!TARGET_DIR!\" >nul

echo [*] Configuring Windows Startup shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\RemoteHubAgent.lnk'); $s.TargetPath = '!TARGET_DIR!\RemoteHubAgent.exe'; $s.WorkingDirectory = '!TARGET_DIR!'; $s.Save()"

echo [*] Starting RemoteHub Agent...
start "" "!TARGET_DIR!\RemoteHubAgent.exe"

echo.
echo ========================================================
echo [SUCCESS] RemoteHub Agent installed and launched!
echo Check your system tray (bottom-right of taskbar).
echo ========================================================
echo.
pause

