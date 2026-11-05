using System;
using System.Drawing;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class ApprovalPromptForm : Form
    {
        private readonly Label _titleLabel;
        private readonly Label _infoLabel;
        private readonly Button _btnApprove;
        private readonly Button _btnReject;
        private readonly System.Windows.Forms.Timer _timeoutTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        private int _secondsRemaining = 30;

        public event EventHandler? Approved;
        public event EventHandler? Rejected;

        public ApprovalPromptForm(string clientIp)
        {
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            Width = 420;
            Height = 220;
            BackColor = Color.FromArgb(17, 24, 39); // Deep dark slate
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 9.5f);
            Text = "RemoteHub - Connection Request";

            _titleLabel = new Label
            {
                Text = "Incoming Remote Control Request",
                Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                ForeColor = Color.FromArgb(59, 130, 246),
                Location = new Point(24, 18),
                AutoSize = true
            };

            string ipDisplay = string.IsNullOrEmpty(clientIp) ? "Remote Browser" : clientIp;
            _infoLabel = new Label
            {
                Text = $"A verified session from [{ipDisplay}] is requesting permission to view and control this computer.\n\nDo you want to grant remote access? (Auto-reject in 30s)",
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(209, 213, 219),
                Location = new Point(24, 52),
                Width = 360,
                Height = 65
            };

            _btnApprove = new Button
            {
                Text = "Approve Access",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(16, 185, 129), // Emerald Green
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(190, 130),
                Width = 130,
                Height = 36,
                Cursor = Cursors.Hand
            };
            _btnApprove.FlatAppearance.BorderSize = 0;
            _btnApprove.Click += (s, e) =>
            {
                _timeoutTimer?.Stop();
                Approved?.Invoke(this, EventArgs.Empty);
                Close();
            };

            _btnReject = new Button
            {
                Text = "Decline",
                Font = new Font("Segoe UI", 9.5f),
                BackColor = Color.FromArgb(55, 65, 81), // Gray
                ForeColor = Color.FromArgb(243, 244, 246),
                FlatStyle = FlatStyle.Flat,
                Location = new Point(90, 130),
                Width = 90,
                Height = 36,
                Cursor = Cursors.Hand
            };
            _btnReject.FlatAppearance.BorderSize = 0;
            _btnReject.Click += (s, e) =>
            {
                _timeoutTimer?.Stop();
                Rejected?.Invoke(this, EventArgs.Empty);
                Close();
            };

            Controls.Add(_titleLabel);
            Controls.Add(_infoLabel);
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
                    _infoLabel.Text = $"A verified session from [{ipDisplay}] is requesting permission to view and control this computer.\n\nDo you want to grant remote access? (Auto-reject in {_secondsRemaining}s)";
                }
            };
            _timeoutTimer.Start();
        }
    }
}
