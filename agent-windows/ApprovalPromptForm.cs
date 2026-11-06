using System;
using System.Drawing;
using System.Media;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class ApprovalPromptForm : Form
    {
        private readonly Label _titleLabel;
        private readonly Label _subtitleLabel;
        private readonly Panel _detailsPanel;
        private readonly Label _lblTimer;
        private readonly Button _btnApprove;
        private readonly Button _btnReject;
        private readonly System.Windows.Forms.Timer _timeoutTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        private int _secondsRemaining = 45;

        public event EventHandler? Approved;
        public event EventHandler? Rejected;

        public ApprovalPromptForm(string deviceName, string accountInfo, string requestedFrom, int timeoutSeconds = 45)
        {
            _secondsRemaining = timeoutSeconds > 0 ? timeoutSeconds : 45;

            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            Width = 480;
            Height = 310;
            BackColor = Color.FromArgb(15, 23, 42); // Slate-900
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9.5f);
            Text = "RemoteHub – Incoming Remote Connection";

            // Title Banner
            _titleLabel = new Label
            {
                Text = "RemoteHub – Incoming Remote Connection",
                Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                ForeColor = Color.FromArgb(96, 165, 250), // Blue-400
                Location = new Point(24, 18),
                AutoSize = true
            };

            // Subtitle
            _subtitleLabel = new Label
            {
                Text = "A remote connection is being requested.",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(203, 213, 225), // Slate-300
                Location = new Point(25, 46),
                AutoSize = true
            };

            // Details Container Card
            _detailsPanel = new Panel
            {
                Location = new Point(24, 76),
                Width = 416,
                Height = 112,
                BackColor = Color.FromArgb(30, 41, 59), // Slate-800
                Padding = new Padding(12)
            };

            // Paint subtle rounded border on panel
            _detailsPanel.Paint += (s, e) =>
            {
                using var p = new Pen(Color.FromArgb(51, 65, 85), 1);
                e.Graphics.DrawRectangle(p, 0, 0, _detailsPanel.Width - 1, _detailsPanel.Height - 1);
            };

            // Details Rows
            string safeDevice = string.IsNullOrWhiteSpace(deviceName) ? "LOKI" : deviceName;
            string safeAccount = string.IsNullOrWhiteSpace(accountInfo) ? "Authorized RemoteHub account" : accountInfo;
            string safeFrom = string.IsNullOrWhiteSpace(requestedFrom) ? "Web Browser" : requestedFrom;

            AddDetailRow(_detailsPanel, "Computer:", safeDevice, 12, Color.FromArgb(248, 250, 252));
            AddDetailRow(_detailsPanel, "Account:", safeAccount, 42, Color.FromArgb(52, 211, 153)); // Emerald
            AddDetailRow(_detailsPanel, "Requested from:", safeFrom, 72, Color.FromArgb(203, 213, 225));

            // Countdown Timer Label
            _lblTimer = new Label
            {
                Text = $"Auto-denying in {_secondsRemaining}s...",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(148, 163, 184), // Slate-400
                Location = new Point(24, 202),
                AutoSize = true
            };

            // Allow Button
            _btnApprove = new Button
            {
                Text = "Allow",
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                BackColor = Color.FromArgb(16, 185, 129), // Emerald-500
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(310, 226),
                Width = 130,
                Height = 38,
                Cursor = Cursors.Hand
            };
            _btnApprove.FlatAppearance.BorderSize = 0;
            _btnApprove.Click += (s, e) =>
            {
                _timeoutTimer.Stop();
                Approved?.Invoke(this, EventArgs.Empty);
                Close();
            };

            // Deny Button
            _btnReject = new Button
            {
                Text = "Deny",
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                BackColor = Color.FromArgb(220, 38, 38), // Red-600
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(170, 226),
                Width = 130,
                Height = 38,
                Cursor = Cursors.Hand
            };
            _btnReject.FlatAppearance.BorderSize = 0;
            _btnReject.Click += (s, e) =>
            {
                _timeoutTimer.Stop();
                Rejected?.Invoke(this, EventArgs.Empty);
                Close();
            };

            Controls.Add(_titleLabel);
            Controls.Add(_subtitleLabel);
            Controls.Add(_detailsPanel);
            Controls.Add(_lblTimer);
            Controls.Add(_btnApprove);
            Controls.Add(_btnReject);

            _timeoutTimer.Tick += (s, e) =>
            {
                _secondsRemaining--;
                if (_secondsRemaining <= 0)
                {
                    _timeoutTimer.Stop();
                    Rejected?.Invoke(this, EventArgs.Empty);
                    Close();
                }
                else
                {
                    _lblTimer.Text = $"Auto-denying in {_secondsRemaining}s...";
                }
            };

            Shown += (s, e) =>
            {
                try
                {
                    SystemSounds.Exclamation.Play();
                }
                catch {}
                Activate();
                _btnApprove.Focus();
                _timeoutTimer.Start();
            };
        }

        private static void AddDetailRow(Panel panel, string label, string value, int top, Color valColor)
        {
            var lblTitle = new Label
            {
                Text = label,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184), // Slate-400
                Location = new Point(12, top),
                Width = 110,
                AutoSize = false
            };

            var lblVal = new Label
            {
                Text = value,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                ForeColor = valColor,
                Location = new Point(126, top),
                Width = 276,
                AutoEllipsis = true,
                AutoSize = false
            };

            panel.Controls.Add(lblTitle);
            panel.Controls.Add(lblVal);
        }
    }
}
