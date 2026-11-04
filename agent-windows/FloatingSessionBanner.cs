using System;
using System.Drawing;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class FloatingSessionBanner : Form
    {
        private readonly Label _statusLabel;
        private readonly Label _clientLabel;
        private readonly Button _killButton;
        public event EventHandler? EmergencyDisconnectRequested;

        public FloatingSessionBanner()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            Width = 340;
            Height = 64;
            BackColor = Color.FromArgb(20, 24, 34);

            // Position at top-right of primary screen
            var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
            Location = new Point(screen.Right - Width - 24, screen.Top + 24);

            // Subtle border effect using Paint
            Paint += (s, e) =>
            {
                using var pen = new Pen(Color.FromArgb(239, 68, 68), 2); // Red border
                e.Graphics.DrawRectangle(pen, 1, 1, Width - 2, Height - 2);
            };

            // Dot and status indicator
            _statusLabel = new Label
            {
                Text = "● RemoteHub: Active Remote Session",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(239, 68, 68),
                Location = new Point(14, 12),
                AutoSize = true
            };

            _clientLabel = new Label
            {
                Text = "Controlled remotely via Web Browser",
                Font = new Font("Segoe UI", 8f),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(14, 34),
                AutoSize = true
            };

            // Emergency stop button
            _killButton = new Button
            {
                Text = "Disconnect",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                ForeColor = Color.White,
                BackColor = Color.FromArgb(220, 38, 38),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(236, 15),
                Width = 90,
                Height = 34,
                Cursor = Cursors.Hand
            };
            _killButton.FlatAppearance.BorderSize = 0;
            _killButton.Click += (s, e) =>
            {
                EmergencyDisconnectRequested?.Invoke(this, EventArgs.Empty);
                Hide();
            };

            Controls.Add(_statusLabel);
            Controls.Add(_clientLabel);
            Controls.Add(_killButton);
        }

        public void ShowSession(string clientIp)
        {
            if (InvokeRequired)
            {
                Invoke(new Action(() => ShowSession(clientIp)));
                return;
            }

            _clientLabel.Text = string.IsNullOrEmpty(clientIp)
                ? "Controlled remotely via Web Browser"
                : $"Client: {clientIp}";

            Show();
            BringToFront();
        }

        public void HideSession()
        {
            if (InvokeRequired)
            {
                Invoke(new Action(HideSession));
                return;
            }

            Hide();
        }
    }
}

