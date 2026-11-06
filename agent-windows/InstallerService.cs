using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace RemoteHub.Agent
{
    public static class InstallerService
    {
        public const string AppName = "RemoteHub Agent";
        public const string AppId = "RemoteHubAgent";
        public const string Publisher = "RemoteHub";
        public const string Version = "1.0.0";

        public static string InstallDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "RemoteHub"
        );

        public static string TargetExecutablePath => Path.Combine(InstallDirectory, "RemoteHubAgent.exe");

        public static string StartMenuDirectory => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Start Menu\Programs\RemoteHub"
        );

        public static string StartMenuShortcutPath => Path.Combine(StartMenuDirectory, "RemoteHub Agent.lnk");

        public static string DesktopShortcutPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "RemoteHub Agent.lnk"
        );

        public static string UninstallScriptPath => Path.Combine(InstallDirectory, "uninstall.bat");

        public static bool IsInstalled()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId);
                return key != null && File.Exists(TargetExecutablePath);
            }
            catch
            {
                return false;
            }
        }

        public static void Install(bool createDesktopShortcut = true, bool autoStart = true)
        {
            try
            {
                string currentExe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName ?? "";
                if (string.IsNullOrEmpty(currentExe) || !File.Exists(currentExe))
                {
                    throw new FileNotFoundException("Cannot locate running executable for installation.");
                }

                // 1. Create installation directory
                if (!Directory.Exists(InstallDirectory))
                {
                    Directory.CreateDirectory(InstallDirectory);
                }

                // 2. Copy executable if not already running from target
                if (!string.Equals(currentExe, TargetExecutablePath, StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(currentExe, TargetExecutablePath, true);
                }

                // 3. Create Start Menu directory and shortcut
                if (!Directory.Exists(StartMenuDirectory))
                {
                    Directory.CreateDirectory(StartMenuDirectory);
                }

                CreateShortcut(StartMenuShortcutPath, TargetExecutablePath, "RemoteHub Personal Remote Desktop Platform");

                // 4. Create Desktop shortcut if requested
                if (createDesktopShortcut)
                {
                    CreateShortcut(DesktopShortcutPath, TargetExecutablePath, "RemoteHub Personal Remote Desktop Platform");
                }

                // 5. Create uninstaller batch script
                string uninstContent = $@"@echo off
echo Uninstalling RemoteHub Agent...
taskkill /F /IM RemoteHubAgent.exe >nul 2>&1
timeout /t 1 /nobreak >nul
""{TargetExecutablePath}"" --uninstall
echo Uninstallation completed successfully.
";
                File.WriteAllText(UninstallScriptPath, uninstContent);

                // 6. Register in Windows Settings -> Apps -> Installed Apps (Add/Remove Programs)
                using (var uninstKey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId))
                {
                    if (uninstKey != null)
                    {
                        uninstKey.SetValue("DisplayName", AppName);
                        uninstKey.SetValue("DisplayVersion", Version);
                        uninstKey.SetValue("Publisher", Publisher);
                        uninstKey.SetValue("DisplayIcon", $"\"{TargetExecutablePath}\",0");
                        uninstKey.SetValue("InstallLocation", InstallDirectory);
                        uninstKey.SetValue("UninstallString", $"\"{UninstallScriptPath}\"");
                        uninstKey.SetValue("QuietUninstallString", $"\"{TargetExecutablePath}\" --uninstall");
                        uninstKey.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        uninstKey.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        try
                        {
                            long sizeBytes = new FileInfo(TargetExecutablePath).Length;
                            uninstKey.SetValue("EstimatedSize", (int)(sizeBytes / 1024), RegistryValueKind.DWord);
                        }
                        catch {}
                    }
                }

                // 7. Auto-start registration
                if (autoStart)
                {
                    SetAutoStart(true);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Installer] Error during installation: {ex.Message}");
                throw;
            }
        }

        public static void Uninstall()
        {
            try
            {
                // Remove shortcuts
                if (File.Exists(StartMenuShortcutPath)) File.Delete(StartMenuShortcutPath);
                if (Directory.Exists(StartMenuDirectory)) Directory.Delete(StartMenuDirectory, true);
                if (File.Exists(DesktopShortcutPath)) File.Delete(DesktopShortcutPath);

                // Remove startup registration
                SetAutoStart(false);

                // Remove from Installed Apps
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId, false);

                // Self-deletion batch file for application directory
                string tempBat = Path.Combine(Path.GetTempPath(), "remove_remotehub.bat");
                string batContent = $@"@echo off
timeout /t 2 /nobreak >nul
rmdir /s /q ""{InstallDirectory}""
del ""%~f0""
";
                File.WriteAllText(tempBat, batContent);
                Process.Start(new ProcessStartInfo
                {
                    FileName = tempBat,
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Installer] Error during uninstallation: {ex.Message}");
            }
        }

        public static bool IsAutoStartEnabled()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
                return key?.GetValue(AppId) != null;
            }
            catch
            {
                return false;
            }
        }

        public static void SetAutoStart(bool enable)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (key != null)
                {
                    if (enable)
                    {
                        string exe = File.Exists(TargetExecutablePath) ? TargetExecutablePath : (Environment.ProcessPath ?? "");
                        key.SetValue(AppId, $"\"{exe}\" --minimized");
                    }
                    else
                    {
                        key.DeleteValue(AppId, false);
                    }
                }
            }
            catch {}
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string description)
        {
            try
            {
                Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic? shell = Activator.CreateInstance(shellType);
                    if (shell != null)
                    {
                        dynamic shortcut = shell.CreateShortcut(shortcutPath);
                        shortcut.TargetPath = targetPath;
                        shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                        shortcut.Description = description;
                        shortcut.IconLocation = $"{targetPath},0";
                        shortcut.Save();
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Installer] COM Shortcut creation error: {ex.Message}");
            }

            // Fallback via PowerShell
            try
            {
                string psCommand = $"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{shortcutPath}'); $s.TargetPath = '{targetPath}'; $s.WorkingDirectory = '{Path.GetDirectoryName(targetPath)}'; $s.Description = '{description}'; $s.Save()";
                Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -NonInteractive -Command \"{psCommand}\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                })?.WaitForExit(3000);
            }
            catch {}
        }
    }
}
