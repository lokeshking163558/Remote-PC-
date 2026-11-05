using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace RemoteHub.Agent
{
    internal static class Program
    {
        private const string StartupRegKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string AppName = "RemoteHubAgent";

        private static Mutex? _mutex;
        private static NotifyIcon? _trayIcon;
        private static AgentConfig? _config;
        private static AgentNetworkClient? _networkClient;
        private static SetupWizardForm? _setupForm;
        private static FloatingSessionBanner? _banner;

        [STAThread]
        static void Main(string[] args)
        {
            // Enforce single instance
            _mutex = new Mutex(true, "RemoteHubAgent_SingleInstance_Mutex", out bool createdNew);
            if (!createdNew)
            {
                MessageBox.Show("RemoteHub Desktop Agent is already running in the background.", "RemoteHub Agent", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            ApplicationConfiguration.Initialize();

            _config = AgentConfig.Load();
            _banner = new FloatingSessionBanner();
            _setupForm = new SetupWizardForm(_config);
            _networkClient = new AgentNetworkClient(_config, _banner);

            _networkClient.ConnectionStatusChanged += isOnline =>
            {
                if (_trayIcon != null)
                {
                    _trayIcon.Text = isOnline
                        ? $"RemoteHub Agent - Connected ({_config.DeviceName})"
                        : "RemoteHub Agent - Disconnected";
                }
            };

            _setupForm.SuccessfullyPaired += (s, e) =>
            {
                _networkClient.Start();
            };

            // Setup System Tray Icon
            SetupSystemTray();

            if (_config.IsConfigured)
            {
                _networkClient.Start();
            }
            else
            {
                _setupForm.Show();
            }

            Application.Run();
        }

        private static void SetupSystemTray()
        {
            var menu = new ContextMenuStrip();

            var statusItem = new ToolStripMenuItem("RemoteHub Agent: Starting...") { Enabled = false };
            var openSetupItem = new ToolStripMenuItem("Setup & Pairing...", null, (s, e) =>
            {
                if (_setupForm == null || _setupForm.IsDisposed)
                {
                    _setupForm = new SetupWizardForm(_config!);
                    _setupForm.SuccessfullyPaired += (sender, args) => _networkClient?.Start();
                }
                _setupForm.Show();
                _setupForm.BringToFront();
            });

            var startupItem = new ToolStripMenuItem("Start with Windows") { Checked = IsRunOnStartupEnabled() };
            startupItem.Click += (s, e) =>
            {
                bool newState = !startupItem.Checked;
                SetRunOnStartup(newState);
                startupItem.Checked = IsRunOnStartupEnabled();
            };

            var emergencyItem = new ToolStripMenuItem("Emergency Disconnect", null, (s, e) =>
            {
                _banner?.HideSession();
                _networkClient?.Stop();
                _networkClient?.Start();
            });

            var exitItem = new ToolStripMenuItem("Exit Agent", null, (s, e) =>
            {
                _networkClient?.Stop();
                _trayIcon?.Dispose();
                Application.Exit();
            });

            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openSetupItem);
            menu.Items.Add(startupItem);
            menu.Items.Add(emergencyItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            // Generate a clean program icon
            Icon icon = SystemIcons.Shield;
            try
            {
                using var bmp = new Bitmap(16, 16);
                using var g = Graphics.FromImage(bmp);
                g.Clear(Color.FromArgb(37, 99, 235));
                using var brush = new SolidBrush(Color.White);
                g.FillEllipse(brush, 3, 3, 10, 10);
                icon = Icon.FromHandle(bmp.GetHicon());
            }
            catch {}

            _trayIcon = new NotifyIcon
            {
                Icon = icon,
                ContextMenuStrip = menu,
                Text = "RemoteHub Agent",
                Visible = true
            };

            _trayIcon.DoubleClick += (s, e) => openSetupItem.PerformClick();
        }

        private static bool IsRunOnStartupEnabled()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(StartupRegKey, false);
                return key?.GetValue(AppName) != null;
            }
            catch
            {
                return false;
            }
        }

        private static void SetRunOnStartup(bool enable)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(StartupRegKey, true);
                if (key != null)
                {
                    if (enable)
                    {
                        var exePath = Environment.ProcessPath ?? Application.ExecutablePath;
                        key.SetValue(AppName, $"\"{exePath}\"");
                    }
                    else
                    {
                        key.DeleteValue(AppName, false);
                    }
                }
            }
            catch {}
        }
    }
}
