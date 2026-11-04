using System;
using System.Drawing;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class SetupWizardForm : Form
    {
        private readonly AgentConfig _config;
        private readonly TextBox _txtServer;
        private readonly TextBox _txtCode;
        private readonly TextBox _txtName;
        private readonly TextBox _txtPin;
        private readonly Button _btnPair;
        private readonly Label _lblStatus;
        public event EventHandler? SuccessfullyPaired;

        public SetupWizardForm(AgentConfig config)
        {
            _config = config;

            Text = "RemoteHub Agent Setup";
            Width = 460;
            Height = 480;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(17, 24, 39); // Deep Slate
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9.5f);

            var titleLabel = new Label
            {
                Text = "RemoteHub Desktop Agent",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(59, 130, 246),
                Location = new Point(24, 20),
                AutoSize = true
            };

            var subtitleLabel = new Label
            {
                Text = "Connect this computer to your RemoteHub account.",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(24, 52),
                AutoSize = true
            };

            int top = 90;

            // Server URL
            Controls.Add(CreateLabel("RemoteHub Server URL:", 24, top));
            _txtServer = CreateTextBox(_config.ServerUrl, 24, top + 22, 396);
            Controls.Add(_txtServer);

            top += 60;
            // Pairing Code
            Controls.Add(CreateLabel("6-Digit Pairing Code (from Web Dashboard):", 24, top));
            _txtCode = CreateTextBox("", 24, top + 22, 396);
            _txtCode.MaxLength = 6;
            Controls.Add(_txtCode);

            top += 60;
            // Device Name
            Controls.Add(CreateLabel("Computer Name:", 24, top));
            _txtName = CreateTextBox(_config.DeviceName, 24, top + 22, 396);
            Controls.Add(_txtName);

            top += 60;
            // Access PIN
            Controls.Add(CreateLabel("Permanent Access PIN (6-8 Digits):", 24, top));
            _txtPin = CreateTextBox("", 24, top + 22, 396);
            _txtPin.PasswordChar = '●';
            _txtPin.MaxLength = 8;
            Controls.Add(_txtPin);

            top += 64;
            // Pair Button
            _btnPair = new Button
            {
                Text = "Pair This Computer",
                Location = new Point(24, top),
                Width = 396,
                Height = 38,
                BackColor = Color.FromArgb(37, 99, 235),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            _btnPair.FlatAppearance.BorderSize = 0;
            _btnPair.Click += async (s, e) => await HandlePairAsync();
            Controls.Add(_btnPair);

            top += 46;
            _lblStatus = new Label
            {
                Text = _config.IsConfigured ? "✓ This device is currently paired." : "Enter the details above to pair.",
                Location = new Point(24, top),
                Width = 396,
                Height = 40,
                ForeColor = _config.IsConfigured ? Color.FromArgb(52, 211, 153) : Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 8.5f)
            };
            Controls.Add(_lblStatus);

            Controls.Add(titleLabel);
            Controls.Add(subtitleLabel);
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
                BackColor = Color.FromArgb(31, 41, 55),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 10f)
            };
        }

        private async Task HandlePairAsync()
        {
            string serverUrl = _txtServer.Text.Trim();
            string code = _txtCode.Text.Trim();
            string name = _txtName.Text.Trim();
            string pin = _txtPin.Text.Trim();

            if (string.IsNullOrEmpty(code) || code.Length != 6)
            {
                _lblStatus.Text = "Please enter a valid 6-digit pairing code.";
                _lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            if (string.IsNullOrEmpty(name))
            {
                _lblStatus.Text = "Please specify a computer name.";
                _lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            if (string.IsNullOrEmpty(pin) || pin.Length < 6 || pin.Length > 8)
            {
                _lblStatus.Text = "Access PIN must be 6 to 8 digits.";
                _lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                return;
            }

            _btnPair.Enabled = false;
            _lblStatus.Text = "Pairing with RemoteHub...";
            _lblStatus.ForeColor = Color.FromArgb(147, 197, 253);

            try
            {
                using var client = new HttpClient();
                client.Timeout = TimeSpan.FromSeconds(10);

                var metrics = MetricsCollector.Collect();
                var payload = new
                {
                    pairingCode = code,
                    deviceName = name,
                    os = "Windows 11",
                    pin = pin,
                    agentVersion = "1.0.0",
                    macAddress = metrics.MacAddress,
                    localIp = metrics.IpAddress
                };

                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                string targetEndpoint = $"{serverUrl.TrimEnd('/')}/api/devices/pair";
                var res = await client.PostAsync(targetEndpoint, content);
                string resBody = await res.Content.ReadAsStringAsync();

                if (res.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(resBody);
                    string deviceId = doc.RootElement.GetProperty("deviceId").GetString() ?? "";
                    string authToken = doc.RootElement.GetProperty("authToken").GetString() ?? "";

                    _config.ServerUrl = serverUrl;
                    _config.DeviceId = deviceId;
                    _config.AuthToken = authToken;
                    _config.DeviceName = name;
                    _config.Save();

                    _lblStatus.Text = "✓ Successfully paired! Agent is now connected.";
                    _lblStatus.ForeColor = Color.FromArgb(52, 211, 153);

                    SuccessfullyPaired?.Invoke(this, EventArgs.Empty);

                    await Task.Delay(1500);
                    Hide();
                }
                else
                {
                    try
                    {
                        using var errDoc = JsonDocument.Parse(resBody);
                        string errMsg = errDoc.RootElement.GetProperty("error").GetString() ?? "Pairing failed.";
                        _lblStatus.Text = errMsg;
                    }
                    catch
                    {
                        _lblStatus.Text = $"Pairing failed (HTTP {(int)res.StatusCode}).";
                    }
                    _lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                }
            }
            catch (Exception ex)
            {
                _lblStatus.Text = $"Connection error: {ex.Message}";
                _lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
            }
            finally
            {
                _btnPair.Enabled = true;
            }
        }
    }
}

