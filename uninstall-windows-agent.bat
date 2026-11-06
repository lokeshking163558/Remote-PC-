@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo       RemoteHub Windows Desktop Agent Uninstaller       
echo ========================================================
echo.

set "TARGET_EXE=%LOCALAPPDATA%\Programs\RemoteHub\RemoteHubAgent.exe"
if exist "!TARGET_EXE!" (
    echo [*] Calling uninstaller service...
    "!TARGET_EXE!" --uninstall
) else (
    echo [*] Terminating running RemoteHub Agent processes...
    taskkill /F /IM RemoteHubAgent.exe >nul 2>&1
    
    echo [*] Removing shortcuts...
    powershell -Command "Remove-Item -Path ([Environment]::GetFolderPath('Startup') + '\RemoteHubAgent.lnk') -ErrorAction SilentlyContinue"
    powershell -Command "Remove-Item -Path ([Environment]::GetFolderPath('Desktop') + '\RemoteHub Agent.lnk') -ErrorAction SilentlyContinue"
    powershell -Command "Remove-Item -Path ([Environment]::GetFolderPath('ApplicationData') + '\Microsoft\Windows\Start Menu\Programs\RemoteHub') -Recurse -Force -ErrorAction SilentlyContinue"
    
    echo [*] Removing registry entries...
    powershell -Command "Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'RemoteHubAgent' -ErrorAction SilentlyContinue"
    powershell -Command "Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteHubAgent' -Recurse -Force -ErrorAction SilentlyContinue"
    
    echo [*] Removing application files...
    if exist "%LOCALAPPDATA%\Programs\RemoteHub" rmdir /S /Q "%LOCALAPPDATA%\Programs\RemoteHub" >nul 2>&1
)

echo.
echo ========================================================
echo [SUCCESS] RemoteHub Agent has been completely removed.
echo Start Menu shortcut, desktop shortcut, and Installed Apps entry cleared.
echo ========================================================
echo.
pause

