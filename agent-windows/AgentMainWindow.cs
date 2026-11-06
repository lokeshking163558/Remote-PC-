using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class AgentMainWindow : Form
    {
        private readonly AgentConfig _config;
        private readonly AgentNetworkClient _client;
        private readonly System.Windows.Forms.Timer _uiTimer;

        // Header controls
        private Label _lblHeaderStatus = null!;
        private Label _lblHeaderDevice = null!;

        // Tab 1: Dashboard
        private Label _lblDashStatus = null!;
        private Label _lblDashServer = null!;
        private Label _lblDashHeartbeat = null!;
        private Label _lblDashCpu = null!;
        private Label _lblDashRam = null!;
        private Label _lblDashBattery = null!;
        private Panel _pnlPairing = null!;
        private TextBox _txtPairCode = null!;
        private TextBox _txtPairPin = null!;
        private TextBox _txtPairName = null!;
        private Button _btnPair = null!;
        private Label _lblPairStatus = null!;

        // Tab 2: Device
        private Label _lblDeviceId = null!;
        private Label _lblInstallId = null!;
        private TextBox _txtRename = null!;
        private Button _btnRename = null!;

        // Tab 3: Security
        private TextBox _txtCurPin = null!;
        private TextBox _txtNewPin = null!;
        private Button _btnChangePin = null!;
        private CheckBox _chkPauseAccess = null!;
        private Label _lblPinStatus = null!;

        // Tab 4: Settings
        private CheckBox _chkAutoStart = null!;
        private CheckBox _chkLaunchMinimized = null!;

        // Tab 5: Advanced
        private TextBox _txtServerUrl = null!;
        private Button _btnTestConn = null!;
        private Label _lblTestResult = null!;
        private TextBox _txtLogs = null!;

        public event EventHandler? DeviceUnpaired;

        public AgentMainWindow(AgentConfig config, AgentNetworkClient client)
        {
            _config = config;
            _client = client;

            Text = "RemoteHub Agent";
            Width = 620;
            Height = 580;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(17, 24, 39); // Deep Slate (#111827)
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9.5f);

            InitializeComponents();

            _client.StateChanged += (state, reason) =>
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(() => UpdateStatusLabels(state, reason)));
                }
                else
                {
                    UpdateStatusLabels(state, reason);
                }
            };

            _client.LogAdded += entry =>
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(() => AppendLog(entry)));
                }
                else
                {
                    AppendLog(entry);
                }
            };

            // Periodic UI refresh timer (every 1 second for heartbeat seconds ago & gauges)
            _uiTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            _uiTimer.Tick += (s, e) => RefreshLiveMetrics();
            _uiTimer.Start();

            FormClosing += (s, e) =>
            {
                if (e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    Hide();
                }
            };
        }

        private void InitializeComponents()
        {
            // Top Header Panel
            var pnlTop = new Panel
            {
                Dock = DockStyle.Top,
                Height = 70,
                BackColor = Color.FromArgb(24, 33, 53)
            };

            var lblLogo = new Label
            {
                Text = "RemoteHub Agent",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(59, 130, 246),
                Location = new Point(20, 14),
                AutoSize = true
            };

            _lblHeaderDevice = new Label
            {
                Text = _config.DeviceName,
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(22, 42),
                AutoSize = true
            };

            _lblHeaderStatus = new Label
            {
                Text = "● Disconnected",
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(460, 26),
                Width = 140,
                TextAlign = ContentAlignment.MiddleRight
            };

            pnlTop.Controls.Add(lblLogo);
            pnlTop.Controls.Add(_lblHeaderDevice);
            pnlTop.Controls.Add(_lblHeaderStatus);
            Controls.Add(pnlTop);

            // Tab Control
            var tabControl = new TabControl
            {
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 9.5f),
                Padding = new Point(12, 6)
            };

            tabControl.TabPages.Add(BuildDashboardTab());
            tabControl.TabPages.Add(BuildDeviceTab());
            tabControl.TabPages.Add(BuildSecurityTab());
            tabControl.TabPages.Add(BuildSettingsTab());
            tabControl.TabPages.Add(BuildAdvancedTab());

            Controls.Add(tabControl);
        }

        // TAB 1: DASHBOARD
        private TabPage BuildDashboardTab()
        {
            var tab = new TabPage("Dashboard") { BackColor = Color.FromArgb(17, 24, 39) };
            int top = 16;

            // Overview Card
            var card = CreateCard(16, top, 570, 160);
            card.Controls.Add(CreateHeaderLabel("Live Connection Status", 16, 12));

            _lblDashStatus = new Label { Text = "Status: Initializing...", Location = new Point(16, 38), AutoSize = true, ForeColor = Color.FromArgb(156, 163, 175) };
            _lblDashServer = new Label { Text = $"Server: {_config.ServerUrl}", Location = new Point(16, 62), AutoSize = true, ForeColor = Color.FromArgb(156, 163, 175) };
            _lblDashHeartbeat = new Label { Text = "Last Heartbeat: Waiting...", Location = new Point(16, 86), AutoSize = true, ForeColor = Color.FromArgb(156, 163, 175) };

            card.Controls.Add(_lblDashStatus);
            card.Controls.Add(_lblDashServer);
            card.Controls.Add(_lblDashHeartbeat);

            // Gauges row inside card
            var gaugePanel = new Panel { Location = new Point(16, 114), Width = 538, Height = 34 };
            _lblDashCpu = new Label { Text = "CPU: --%", Location = new Point(0, 6), AutoSize = true, Font = new Font("Consolas", 9f), ForeColor = Color.FromArgb(96, 165, 250) };
            _lblDashRam = new Label { Text = "RAM: --%", Location = new Point(160, 6), AutoSize = true, Font = new Font("Consolas", 9f), ForeColor = Color.FromArgb(129, 140, 248) };
            _lblDashBattery = new Label { Text = "Battery: --%", Location = new Point(320, 6), AutoSize = true, Font = new Font("Consolas", 9f), ForeColor = Color.FromArgb(52, 211, 153) };
            gaugePanel.Controls.Add(_lblDashCpu);
            gaugePanel.Controls.Add(_lblDashRam);
            gaugePanel.Controls.Add(_lblDashBattery);
            card.Controls.Add(gaugePanel);

            tab.Controls.Add(card);
            top += 175;

            // Pairing Section Panel
            _pnlPairing = CreateCard(16, top, 570, 250);
            _pnlPairing.Controls.Add(CreateHeaderLabel("Device Pairing", 16, 12));

            var lblDesc = new Label
            {
                Text = "Enter the 6-digit pairing code from your web dashboard and configure an access PIN:",
                Location = new Point(16, 36),
                Width = 538,
                ForeColor = Color.FromArgb(209, 213, 219),
                Font = new Font("Segoe UI", 9f)
            };
            _pnlPairing.Controls.Add(lblDesc);

            _pnlPairing.Controls.Add(CreateLabel("6-Digit Pairing Code:", 16, 68));
            _txtPairCode = CreateTextBox("", 16, 88, 160);
            _txtPairCode.MaxLength = 6;
            _pnlPairing.Controls.Add(_txtPairCode);

            _pnlPairing.Controls.Add(CreateLabel("Permanent Access PIN (6-8 Digits):", 190, 68));
            _txtPairPin = CreateTextBox("", 190, 88, 170);
            _txtPairPin.PasswordChar = '●';
            _txtPairPin.MaxLength = 8;
            _pnlPairing.Controls.Add(_txtPairPin);

            _pnlPairing.Controls.Add(CreateLabel("Computer Name:", 374, 68));
            _txtPairName = CreateTextBox(_config.DeviceName, 374, 88, 180);
            _pnlPairing.Controls.Add(_txtPairName);

            _btnPair = new Button
            {
                Text = "Pair This Computer",
                Location = new Point(16, 128),
                Width = 538,
                Height = 36,
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            _btnPair.FlatAppearance.BorderSize = 0;
            _btnPair.Click += async (s, e) => await HandlePairAsync();
            _pnlPairing.Controls.Add(_btnPair);

            _lblPairStatus = new Label
            {
                Text = _config.IsConfigured ? "✓ This computer is currently paired with RemoteHub." : "Awaiting pairing with your RemoteHub account.",
                Location = new Point(16, 176),
                Width = 538,
                ForeColor = _config.IsConfigured ? Color.FromArgb(52, 211, 153) : Color.FromArgb(156, 163, 175)
            };
            _pnlPairing.Controls.Add(_lblPairStatus);

            tab.Controls.Add(_pnlPairing);
            return tab;
        }

        // TAB 2: DEVICE
        private TabPage BuildDeviceTab()
        {
            var tab = new TabPage("Device") { BackColor = Color.FromArgb(17, 24, 39) };
            int top = 16;

            var card = CreateCard(16, top, 570, 390);
            card.Controls.Add(CreateHeaderLabel("Hardware & Identity", 16, 12));

            card.Controls.Add(CreateLabel("Device ID:", 16, 44));
            _lblDeviceId = new Label
            {
                Text = string.IsNullOrEmpty(_config.DeviceId) ? "(Unpaired)" : _config.DeviceId,
                Location = new Point(16, 64),
                Width = 430,
                Font = new Font("Consolas", 9f),
                ForeColor = Color.FromArgb(147, 197, 253)
            };
            card.Controls.Add(_lblDeviceId);

            var btnCopyDevId = CreateButton("Copy", 456, 60, 98, 26);
            btnCopyDevId.Click += (s, e) => { if (!string.IsNullOrEmpty(_config.DeviceId)) Clipboard.SetText(_config.DeviceId); };
            card.Controls.Add(btnCopyDevId);

            card.Controls.Add(CreateLabel("Installation ID (Hardware GUID):", 16, 96));
            _lblInstallId = new Label
            {
                Text = _config.InstallationId,
                Location = new Point(16, 116),
                Width = 430,
                Font = new Font("Consolas", 9f),
                ForeColor = Color.FromArgb(156, 163, 175)
            };
            card.Controls.Add(_lblInstallId);

            var btnCopyInstId = CreateButton("Copy", 456, 112, 98, 26);
            btnCopyInstId.Click += (s, e) => Clipboard.SetText(_config.InstallationId);
            card.Controls.Add(btnCopyInstId);

            card.Controls.Add(CreateLabel($"Operating System: {Environment.OSVersion}", 16, 148));
            card.Controls.Add(CreateLabel("Agent Version: 1.0.0 (Production)", 16, 172));

            // Rename Computer
            card.Controls.Add(CreateHeaderLabel("Rename Computer", 16, 210));
            _txtRename = CreateTextBox(_config.DeviceName, 16, 236, 430);
            card.Controls.Add(_txtRename);

            _btnRename = CreateButton("Save Name", 456, 234, 98, 30);
            _btnRename.Click += async (s, e) =>
            {
                string newName = _txtRename.Text.Trim();
                if (string.IsNullOrEmpty(newName)) return;
                _btnRename.Enabled = false;
                var res = await _client.RenameDeviceAsync(newName);
                _btnRename.Enabled = true;
                MessageBox.Show(res.Message, "RemoteHub", MessageBoxButtons.OK, res.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
                if (res.Success) _lblHeaderDevice.Text = newName;
            };
            card.Controls.Add(_btnRename);

            // Reconnect & Unpair Actions
            var btnReconnect = CreateButton("Force Reconnect", 16, 310, 260, 36);
            btnReconnect.Click += (s, e) => _client.ForceReconnect();
            card.Controls.Add(btnReconnect);

            var btnUnpair = new Button
            {
                Text = "Unpair This Computer",
                Location = new Point(294, 310),
                Width = 260,
                Height = 36,
                BackColor = Color.FromArgb(185, 28, 28),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnUnpair.FlatAppearance.BorderSize = 0;
            btnUnpair.Click += (s, e) =>
            {
                if (MessageBox.Show("Are you sure you want to unpair this computer? Remote access will be disconnected until re-paired.", "Unpair Computer", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                {
                    _config.ResetPairing();
                    _client.Stop();
                    _lblDashStatus.Text = "Status: Unpaired";
                    _lblPairStatus.Text = "Device unpaired. Enter a new code to pair.";
                    _lblDeviceId.Text = "(Unpaired)";
                    DeviceUnpaired?.Invoke(this, EventArgs.Empty);
                }
            };
            card.Controls.Add(btnUnpair);

            tab.Controls.Add(card);
            return tab;
        }

        // TAB 3: SECURITY
        private TabPage BuildSecurityTab()
        {
            var tab = new TabPage("Security") { BackColor = Color.FromArgb(17, 24, 39) };
            int top = 16;

            var card = CreateCard(16, top, 570, 390);
            card.Controls.Add(CreateHeaderLabel("Access PIN & Privacy Controls", 16, 12));

            // Pause remote access switch
            _chkPauseAccess = new CheckBox
            {
                Text = "Pause Remote Access (temporarily decline all incoming connections)",
                Location = new Point(16, 44),
                Width = 538,
                Checked = _config.PauseRemoteAccess,
                ForeColor = Color.FromArgb(245, 158, 11),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            _chkPauseAccess.CheckedChanged += (s, e) =>
            {
                _config.PauseRemoteAccess = _chkPauseAccess.Checked;
                _config.Save();
                _client.AddLog($"PauseRemoteAccess set to: {_config.PauseRemoteAccess}");
            };
            card.Controls.Add(_chkPauseAccess);

            // Change PIN Section
            card.Controls.Add(CreateHeaderLabel("Change Permanent Access PIN", 16, 94));
            card.Controls.Add(CreateLabel("Current PIN:", 16, 124));
            _txtCurPin = CreateTextBox("", 16, 146, 260);
            _txtCurPin.PasswordChar = '●';
            _txtCurPin.MaxLength = 8;
            card.Controls.Add(_txtCurPin);

            card.Controls.Add(CreateLabel("New PIN (6-8 Digits):", 294, 124));
            _txtNewPin = CreateTextBox("", 294, 146, 260);
            _txtNewPin.PasswordChar = '●';
            _txtNewPin.MaxLength = 8;
            card.Controls.Add(_txtNewPin);

            _btnChangePin = CreateButton("Update Access PIN", 16, 188, 538, 34);
            _btnChangePin.Click += async (s, e) =>
            {
                string cur = _txtCurPin.Text.Trim();
                string nw = _txtNewPin.Text.Trim();
                if (nw.Length < 6 || nw.Length > 8)
                {
                    _lblPinStatus.Text = "New PIN must be 6 to 8 digits.";
                    _lblPinStatus.ForeColor = Color.FromArgb(248, 113, 113);
                    return;
                }
                _btnChangePin.Enabled = false;
                var res = await _client.ChangePinAsync(cur, nw);
                _btnChangePin.Enabled = true;
                _lblPinStatus.Text = res.Message;
                _lblPinStatus.ForeColor = res.Success ? Color.FromArgb(52, 211, 153) : Color.FromArgb(248, 113, 113);
                if (res.Success)
                {
                    _txtCurPin.Text = "";
                    _txtNewPin.Text = "";
                }
            };
            card.Controls.Add(_btnChangePin);

            _lblPinStatus = new Label
            {
                Text = "",
                Location = new Point(16, 230),
                Width = 538,
                ForeColor = Color.FromArgb(156, 163, 175)
            };
            card.Controls.Add(_lblPinStatus);

            // Emergency disconnect
            card.Controls.Add(CreateHeaderLabel("Emergency Disconnect", 16, 270));
            var btnEmerg = new Button
            {
                Text = "Disconnect Any Active Remote Session Now",
                Location = new Point(16, 300),
                Width = 538,
                Height = 36,
                BackColor = Color.FromArgb(220, 38, 38),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnEmerg.FlatAppearance.BorderSize = 0;
            btnEmerg.Click += (s, e) => _client.HandleEmergencyDisconnect();
            card.Controls.Add(btnEmerg);

            tab.Controls.Add(card);
            return tab;
        }

        // TAB 4: SETTINGS
        private TabPage BuildSettingsTab()
        {
            var tab = new TabPage("Settings") { BackColor = Color.FromArgb(17, 24, 39) };
            int top = 16;

            var card = CreateCard(16, top, 570, 390);
            card.Controls.Add(CreateHeaderLabel("Startup & Integration Options", 16, 12));

            _chkAutoStart = new CheckBox
            {
                Text = "Start RemoteHub automatically when Windows starts",
                Location = new Point(16, 44),
                Width = 538,
                Checked = InstallerService.IsAutoStartEnabled(),
                ForeColor = Color.White
            };
            _chkAutoStart.CheckedChanged += (s, e) =>
            {
                InstallerService.SetAutoStart(_chkAutoStart.Checked);
                _config.AutoStart = _chkAutoStart.Checked;
                _config.Save();
            };
            card.Controls.Add(_chkAutoStart);

            _chkLaunchMinimized = new CheckBox
            {
                Text = "Launch minimized to system tray",
                Location = new Point(16, 76),
                Width = 538,
                Checked = _config.LaunchMinimized,
                ForeColor = Color.White
            };
            _chkLaunchMinimized.CheckedChanged += (s, e) =>
            {
                _config.LaunchMinimized = _chkLaunchMinimized.Checked;
                _config.Save();
            };
            card.Controls.Add(_chkLaunchMinimized);

            card.Controls.Add(CreateHeaderLabel("Windows Installation & Shortcuts", 16, 128));
            var lblInstDesc = new Label
            {
                Text = "Ensure RemoteHub appears in Windows Start Menu and Windows Settings 'Installed Apps':",
                Location = new Point(16, 154),
                Width = 538,
                ForeColor = Color.FromArgb(156, 163, 175)
            };
            card.Controls.Add(lblInstDesc);

            var btnReinstall = CreateButton("Register Start Menu & Installed Apps Shortcuts", 16, 186, 538, 36);
            btnReinstall.Click += (s, e) =>
            {
                try
                {
                    InstallerService.Install(true, _chkAutoStart.Checked);
                    MessageBox.Show("RemoteHub Agent shortcuts and Installed Apps registration refreshed successfully!", "RemoteHub", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Installation error: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
            card.Controls.Add(btnReinstall);

            card.Controls.Add(CreateHeaderLabel("Software Updates", 16, 246));
            var btnCheckUpdates = CreateButton("Check for Updates", 16, 276, 538, 36);
            btnCheckUpdates.Click += (s, e) =>
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "https://github.com/lokeshking163558/Remote-PC-/releases/latest",
                    UseShellExecute = true
                });
            };
            card.Controls.Add(btnCheckUpdates);

            tab.Controls.Add(card);
            return tab;
        }

        // TAB 5: ADVANCED & DIAGNOSTICS
        private TabPage BuildAdvancedTab()
        {
            var tab = new TabPage("Advanced") { BackColor = Color.FromArgb(17, 24, 39) };
            int top = 16;

            var card = CreateCard(16, top, 570, 390);
            card.Controls.Add(CreateHeaderLabel("Server Configuration & Diagnostics", 16, 12));

            card.Controls.Add(CreateLabel("RemoteHub Backend URL:", 16, 38));
            _txtServerUrl = CreateTextBox(_config.ServerUrl, 16, 58, 420);
            card.Controls.Add(_txtServerUrl);

            _btnTestConn = CreateButton("Test", 444, 56, 110, 28);
            _btnTestConn.Click += async (s, e) => await HandleTestConnectionAsync();
            card.Controls.Add(_btnTestConn);

            // Preset Buttons
            var btnProd = CreateButton("Use Production", 16, 92, 130, 24);
            btnProd.Click += (s, e) => { _txtServerUrl.Text = AgentConfig.DefaultProductionServerUrl; ApplyServerUrl(); };
            card.Controls.Add(btnProd);

            var btnLocal = CreateButton("Use Localhost", 152, 92, 130, 24);
            btnLocal.Click += (s, e) => { _txtServerUrl.Text = AgentConfig.DefaultLocalServerUrl; ApplyServerUrl(); };
            card.Controls.Add(btnLocal);

            _lblTestResult = new Label { Text = "", Location = new Point(290, 95), Width = 264, ForeColor = Color.FromArgb(52, 211, 153) };
            card.Controls.Add(_lblTestResult);

            // Logs Viewer
            card.Controls.Add(CreateHeaderLabel("Diagnostic Event Logs", 16, 130));
            _txtLogs = new TextBox
            {
                Location = new Point(16, 154),
                Width = 538,
                Height = 170,
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                ReadOnly = true,
                BackColor = Color.FromArgb(15, 23, 42),
                ForeColor = Color.FromArgb(203, 213, 225),
                Font = new Font("Consolas", 8.5f)
            };
            card.Controls.Add(_txtLogs);

            var btnExport = CreateButton("Export Report to Desktop", 16, 334, 260, 32);
            btnExport.Click += (s, e) =>
            {
                try
                {
                    string report = _client.ExportDiagnosticReport();
                    string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "RemoteHub-Diagnostics.txt");
                    File.WriteAllText(path, report);
                    MessageBox.Show($"Diagnostic report saved to:\n{path}", "Report Exported", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Failed to export report: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
            card.Controls.Add(btnExport);

            var btnClearLogs = CreateButton("Clear Logs", 294, 334, 260, 32);
            btnClearLogs.Click += (s, e) => _txtLogs.Clear();
            card.Controls.Add(btnClearLogs);

            tab.Controls.Add(card);
            return tab;
        }

        private void ApplyServerUrl()
        {
            string url = _txtServerUrl.Text.Trim();
            if (!string.IsNullOrEmpty(url))
            {
                _config.ServerUrl = url;
                _config.Save();
                _lblDashServer.Text = $"Server: {_config.ServerUrl}";
            }
        }

        private async Task HandleTestConnectionAsync()
        {
            string url = _txtServerUrl.Text.Trim();
            if (string.IsNullOrEmpty(url)) return;
            ApplyServerUrl();

            _btnTestConn.Enabled = false;
            _lblTestResult.Text = "Testing...";
            _lblTestResult.ForeColor = Color.FromArgb(147, 197, 253);

            var res = await _client.TestServerConnectionAsync(url);
            _btnTestConn.Enabled = true;
            _lblTestResult.Text = res.Message;
            _lblTestResult.ForeColor = res.Reachable ? Color.FromArgb(52, 211, 153) : Color.FromArgb(248, 113, 113);
        }

        private async Task HandlePairAsync()
        {
            string code = _txtPairCode.Text.Trim();
            string pin = _txtPairPin.Text.Trim();
            string name = _txtPairName.Text.Trim();
            string serverUrl = _config.ServerUrl;

            if (code.Length != 6)
            {
                _lblPairStatus.Text = "Please enter a valid 6-digit pairing code.";
                _lblPairStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            if (pin.Length < 6 || pin.Length > 8)
            {
                _lblPairStatus.Text = "Access PIN must be 6 to 8 digits.";
                _lblPairStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            if (string.IsNullOrEmpty(name))
            {
                _lblPairStatus.Text = "Please specify a computer name.";
                _lblPairStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            _btnPair.Enabled = false;
            _lblPairStatus.Text = "Pairing with RemoteHub backend...";
            _lblPairStatus.ForeColor = Color.FromArgb(147, 197, 253);

            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                var metrics = MetricsCollector.Collect();
                var payload = new
                {
                    pairingCode = code,
                    deviceName = name,
                    os = "Windows 11",
                    pin = pin,
                    agentVersion = "1.0.0",
                    macAddress = metrics.MacAddress,
                    localIp = metrics.IpAddress,
                    installationId = _config.InstallationId,
                    existingDeviceId = _config.DeviceId
                };

                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                string targetEndpoint = $"{serverUrl.TrimEnd('/')}/api/devices/pair";

                var res = await http.PostAsync(targetEndpoint, content);
                string resBody = await res.Content.ReadAsStringAsync();

                if (res.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(resBody);
                    string deviceId = doc.RootElement.GetProperty("deviceId").GetString() ?? "";
                    string authToken = doc.RootElement.GetProperty("authToken").GetString() ?? "";

                    _config.DeviceId = deviceId;
                    _config.AuthToken = authToken;
                    _config.DeviceName = name;
                    _config.Save();

                    _lblPairStatus.Text = "✓ Successfully paired! Agent is now connected.";
                    _lblPairStatus.ForeColor = Color.FromArgb(52, 211, 153);
                    _lblDeviceId.Text = deviceId;
                    _lblHeaderDevice.Text = name;

                    _client.Start();
                }
                else
                {
                    try
                    {
                        using var errDoc = JsonDocument.Parse(resBody);
                        _lblPairStatus.Text = errDoc.RootElement.GetProperty("error").GetString() ?? "Pairing failed.";
                    }
                    catch
                    {
                        _lblPairStatus.Text = $"Pairing failed (HTTP {(int)res.StatusCode}).";
                    }
                    _lblPairStatus.ForeColor = Color.FromArgb(248, 113, 113);
                }
            }
            catch (Exception ex)
            {
                _lblPairStatus.Text = $"Connection error: {ex.Message}";
                _lblPairStatus.ForeColor = Color.FromArgb(248, 113, 113);
            }
            finally
            {
                _btnPair.Enabled = true;
            }
        }

        private void UpdateStatusLabels(AgentConnectionState state, string reason)
        {
            switch (state)
            {
                case AgentConnectionState.Online:
                    _lblHeaderStatus.Text = "● Online & Ready";
                    _lblHeaderStatus.ForeColor = Color.FromArgb(52, 211, 153);
                    _lblDashStatus.Text = "Status: Online (Active Heartbeats)";
                    _lblDashStatus.ForeColor = Color.FromArgb(52, 211, 153);
                    break;
                case AgentConnectionState.Reconnecting:
                    _lblHeaderStatus.Text = "● Reconnecting";
                    _lblHeaderStatus.ForeColor = Color.FromArgb(245, 158, 11);
                    _lblDashStatus.Text = $"Status: Reconnecting... ({reason})";
                    _lblDashStatus.ForeColor = Color.FromArgb(245, 158, 11);
                    break;
                case AgentConnectionState.Connecting:
                    _lblHeaderStatus.Text = "● Connecting";
                    _lblHeaderStatus.ForeColor = Color.FromArgb(96, 165, 250);
                    _lblDashStatus.Text = "Status: Connecting to server...";
                    _lblDashStatus.ForeColor = Color.FromArgb(96, 165, 250);
                    break;
                default:
                    _lblHeaderStatus.Text = "● Disconnected";
                    _lblHeaderStatus.ForeColor = Color.FromArgb(156, 163, 175);
                    _lblDashStatus.Text = "Status: Disconnected";
                    _lblDashStatus.ForeColor = Color.FromArgb(156, 163, 175);
                    break;
            }
        }

        private void RefreshLiveMetrics()
        {
            if (_client.LastSuccessfulHeartbeat.HasValue)
            {
                var elapsedSec = (int)(DateTime.Now - _client.LastSuccessfulHeartbeat.Value).TotalSeconds;
                _lblDashHeartbeat.Text = $"Last Heartbeat: {elapsedSec}s ago ({_client.LastSuccessfulHeartbeat.Value:HH:mm:ss})";
            }
            else
            {
                _lblDashHeartbeat.Text = "Last Heartbeat: None yet";
            }

            try
            {
                var m = MetricsCollector.Collect();
                _lblDashCpu.Text = $"CPU: {m.CpuUsage}%";
                _lblDashRam.Text = $"RAM: {m.MemoryUsage}%";
                _lblDashBattery.Text = $"Battery: {m.BatteryPercent}% {(m.IsCharging ? "(⚡)" : "")}";
            }
            catch {}
        }

        private void AppendLog(string entry)
        {
            if (_txtLogs != null && !_txtLogs.IsDisposed)
            {
                _txtLogs.AppendText(entry + Environment.NewLine);
            }
        }

        // Helper UI Factory Methods
        private Panel CreateCard(int x, int y, int width, int height)
        {
            return new Panel
            {
                Location = new Point(x, y),
                Width = width,
                Height = height,
                BackColor = Color.FromArgb(31, 41, 55),
                BorderStyle = BorderStyle.None
            };
        }

        private Label CreateHeaderLabel(string text, int x, int y)
        {
            return new Label
            {
                Text = text,
                Location = new Point(x, y),
                AutoSize = true,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                ForeColor = Color.White
            };
        }

        private Label CreateLabel(string text, int x, int y)
        {
            return new Label
            {
                Text = text,
                Location = new Point(x, y),
                AutoSize = true,
                ForeColor = Color.FromArgb(209, 213, 219),
                Font = new Font("Segoe UI", 9f)
            };
        }

        private TextBox CreateTextBox(string text, int x, int y, int width)
        {
            return new TextBox
            {
                Text = text,
                Location = new Point(x, y),
                Width = width,
                BackColor = Color.FromArgb(17, 24, 39),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 9.5f)
            };
        }

        private Button CreateButton(string text, int x, int y, int width, int height)
        {
            var btn = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Width = width,
                Height = height,
                BackColor = Color.FromArgb(55, 65, 81),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btn.FlatAppearance.BorderSize = 0;
            return btn;
        }
    }
}
