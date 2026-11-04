@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo       RemoteHub Windows Desktop Agent Uninstaller       
echo ========================================================
echo.

echo [*] Terminating running RemoteHub Agent processes...
taskkill /F /IM RemoteHubAgent.exe >nul 2>&1

echo [*] Removing Windows Startup shortcut...
powershell -Command "Remove-Item -Path ([Environment]::GetFolderPath('Startup') + '\RemoteHubAgent.lnk') -ErrorAction SilentlyContinue"

echo [*] Removing application files...
if exist "%LOCALAPPDATA%\RemoteHub" (
    rmdir /S /Q "%LOCALAPPDATA%\RemoteHub" >nul 2>&1
)

echo.
echo ========================================================
echo [SUCCESS] RemoteHub Agent has been completely removed.
echo ========================================================
echo.
pause

