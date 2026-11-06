using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    internal static class Program
    {
        private static Mutex? _mutex;
        private static NotifyIcon? _trayIcon;
        private static AgentConfig? _config;
        private static AgentNetworkClient? _networkClient;
        private static AgentMainWindow? _mainWindow;
        private static FloatingSessionBanner? _banner;

        [STAThread]
        static void Main(string[] args)
        {
            // Handle installation / uninstallation CLI commands
            if (args.Any(a => a.Equals("--install", StringComparison.OrdinalIgnoreCase)))
            {
                try
                {
                    InstallerService.Install(true, true);
                    MessageBox.Show("RemoteHub Agent has been successfully installed.\nIt is now available in your Start Menu and Windows Installed Apps.", "RemoteHub Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Installation failed: {ex.Message}", "RemoteHub Setup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return;
            }

            if (args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)))
            {
                try
                {
                    InstallerService.Uninstall();
                    MessageBox.Show("RemoteHub Agent has been successfully uninstalled from this computer.", "RemoteHub Uninstaller", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Uninstallation error: {ex.Message}", "RemoteHub Uninstaller", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return;
            }

            // Enforce single instance per desktop session
            _mutex = new Mutex(true, "RemoteHubAgent_SingleInstance_Mutex", out bool createdNew);
            if (!createdNew)
            {
                MessageBox.Show("RemoteHub Desktop Agent is already running in your system tray.", "RemoteHub Agent", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            ApplicationConfiguration.Initialize();

            _config = AgentConfig.Load();
            _banner = new FloatingSessionBanner();
            _networkClient = new AgentNetworkClient(_config, _banner);
            _mainWindow = new AgentMainWindow(_config, _networkClient);

            _networkClient.StateChanged += (state, reason) =>
            {
                if (_trayIcon != null)
                {
                    string statusText = state switch
                    {
                        AgentConnectionState.Online => $"RemoteHub: Connected ({_config.DeviceName})",
                        AgentConnectionState.Reconnecting => "RemoteHub: Reconnecting...",
                        AgentConnectionState.Connecting => "RemoteHub: Connecting...",
                        _ => "RemoteHub: Disconnected"
                    };
                    _trayIcon.Text = statusText.Length > 63 ? statusText.Substring(0, 63) : statusText;
                }
            };

            SetupSystemTray();

            // Auto-start network services
            _networkClient.Start();

            // Check if launched with --minimized (e.g. from Windows Startup)
            bool startMinimized = args.Any(a => a.Equals("--minimized", StringComparison.OrdinalIgnoreCase)) || _config.LaunchMinimized;

            if (!startMinimized || !_config.IsConfigured)
            {
                _mainWindow.Show();
                _mainWindow.BringToFront();
            }

            Application.Run();
        }

        private static void SetupSystemTray()
        {
            var menu = new ContextMenuStrip();

            var openItem = new ToolStripMenuItem("Open RemoteHub", null, (s, e) =>
            {
                if (_mainWindow == null || _mainWindow.IsDisposed)
                {
                    _mainWindow = new AgentMainWindow(_config!, _networkClient!);
                }
                _mainWindow.Show();
                _mainWindow.WindowState = FormWindowState.Normal;
                _mainWindow.BringToFront();
            }) { Font = new Font("Segoe UI", 9f, FontStyle.Bold) };

            var statusItem = new ToolStripMenuItem("Status: Initializing...") { Enabled = false };

            _networkClient!.StateChanged += (state, reason) =>
            {
                statusItem.Text = state switch
                {
                    AgentConnectionState.Online => "Status: 🟢 Connected & Ready",
                    AgentConnectionState.Reconnecting => "Status: 🟡 Reconnecting...",
                    AgentConnectionState.Connecting => "Status: 🔵 Connecting...",
                    _ => "Status: ⚪ Disconnected"
                };
            };

            var startupItem = new ToolStripMenuItem("Start with Windows") { Checked = InstallerService.IsAutoStartEnabled() };
            startupItem.Click += (s, e) =>
            {
                bool newState = !startupItem.Checked;
                InstallerService.SetAutoStart(newState);
                _config!.AutoStart = newState;
                _config.Save();
                startupItem.Checked = InstallerService.IsAutoStartEnabled();
            };

            var pauseItem = new ToolStripMenuItem("Pause Remote Access") { Checked = _config!.PauseRemoteAccess };
            pauseItem.Click += (s, e) =>
            {
                _config.PauseRemoteAccess = !_config.PauseRemoteAccess;
                _config.Save();
                pauseItem.Checked = _config.PauseRemoteAccess;
                _networkClient?.AddLog($"Remote access paused: {_config.PauseRemoteAccess}");
            };

            var emergencyItem = new ToolStripMenuItem("Emergency Disconnect", null, (s, e) =>
            {
                _networkClient?.HandleEmergencyDisconnect();
            });

            var exitItem = new ToolStripMenuItem("Exit Agent", null, (s, e) =>
            {
                _networkClient?.Stop();
                _trayIcon?.Dispose();
                Application.Exit();
            });

            menu.Items.Add(openItem);
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(startupItem);
            menu.Items.Add(pauseItem);
            menu.Items.Add(emergencyItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            // Generate high-DPI system tray icon
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

            _trayIcon.DoubleClick += (s, e) => openItem.PerformClick();
        }
    }
}
