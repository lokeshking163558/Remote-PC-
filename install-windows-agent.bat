@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo        RemoteHub Windows Desktop Agent Setup        
echo ========================================================
echo.

set "SOURCE_EXE=%~dp0server\downloads\RemoteHubAgent.exe"
if not exist "!SOURCE_EXE!" (
    set "SOURCE_EXE=%~dp0agent-windows\bin\Release\net8.0-windows\RemoteHubAgent.exe"
)

if not exist "!SOURCE_EXE!" (
    echo [ERROR] Agent binary not found.
    echo Please compile the agent or check server/downloads/RemoteHubAgent.exe
    pause
    exit /b 1
)

echo [*] Installing RemoteHub Agent into Windows...
"!SOURCE_EXE!" --install

echo.
echo ========================================================
echo [SUCCESS] RemoteHub Agent has been installed!
echo - Available in Windows Start Menu ("RemoteHub Agent")
echo - Available in Windows Search
echo - Visible in Windows Settings -> Apps -> Installed apps
echo - Desktop shortcut created
echo ========================================================
echo.
pause

