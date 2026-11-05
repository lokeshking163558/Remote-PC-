# RemoteHub Windows Agent — Installation & User Guide

The **RemoteHub Windows Agent** (`RemoteHubAgent.exe`) runs on your host Windows PC or laptop, providing secure screen capture, remote input handling, hardware telemetry, and host safety controls.

---

## 1. System Requirements

- **Operating System**: Windows 10 (version 1903+) or Windows 11 (64-bit / ARM64 via emulation)
- **Runtime**: [.NET 8.0 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0) (usually pre-installed on Windows 11; installer prompts if required)
- **Network**: Internet connection with outbound HTTPS/WSS (Port 443) access. No port forwarding or static IP required.

---

## 2. Downloading the Agent

You can obtain `RemoteHubAgent.exe` through any of the following methods:

### Method A: RemoteHub Web Dashboard (Easiest)
1. Sign in to your RemoteHub account at [remote-pc-green.vercel.app](https://remote-pc-green.vercel.app/).
2. On the dashboard, click **"Add Computer"**.
3. Click the **"Download RemoteHub Agent (.exe)"** button.

### Method B: Direct URL Download
- Executable: `https://<YOUR-SERVER-DOMAIN>/api/downloads/windows-agent`
- Verification Info: `https://<YOUR-SERVER-DOMAIN>/api/downloads/windows-agent.txt`

### Method C: GitHub Releases
Download the latest pre-compiled binary from the repository's GitHub Releases page:
`https://github.com/lokeshking163558/Remote-PC-/releases`

---

## 3. Cryptographic Verification (SHA-256)

To verify the integrity of the downloaded executable, run the following command in Windows PowerShell:

```powershell
Get-FileHash .\RemoteHubAgent.exe -Algorithm SHA256
```

Compare the resulting hash against the reference hash published in `windows-agent.txt`:
```text
Algorithm: SHA256
Hash: BCEABBB364ACFE9B68C4B8ED9A46348E16569D264E3028CAF1051C9B742A8E81
```

If the hashes match, the binary is authentic and untampered.

---

## 4. Setup & Pairing Walkthrough

1. **Launch `RemoteHubAgent.exe`**:
   Double-click `RemoteHubAgent.exe`. If Windows SmartScreen displays a warning, click *More info* -> *Run anyway*.

2. **Setup Wizard Dialog**:
   If the computer has not been paired yet, the Setup Wizard window will appear automatically:
   - **RemoteHub Server URL**: Enter your server address (default: `https://remote-pc-server.onrender.com` or your custom server domain).
   - **Computer Name**: Enter a recognizable name (e.g., `Work Laptop`, `Home Desktop`).
   - **Pairing Code**: Enter the 6-digit one-time code shown in your RemoteHub web dashboard.
   - **Device Access PIN**: Set a permanent 6–8 digit security PIN for this computer.
   - **Confirm PIN**: Re-type the access PIN.

3. **Complete Pairing**:
   Click **"Pair This Computer"**.
   - The agent securely communicates with the RemoteHub gateway.
   - The permanent PIN is hashed using Scrypt with a 32-byte salt before transmission.
   - Upon successful registration, the agent minimizes to the Windows System Tray (notification area).

---

## 5. Daily Operation & Tray Controls

Once paired, RemoteHub Agent runs silently in the background:
- **System Tray Icon**: Look for the RemoteHub icon in your taskbar tray.
- **Right-Click Menu Options**:
  - **Open Dashboard**: Opens your default browser to the RemoteHub web app.
  - **Connection Status**: Displays whether the agent is currently connected to the server gateway.
  - **Settings / Re-pair**: Reconfigures server URL or re-pairs the device.
  - **Exit**: Stops the agent and disconnects all active sessions.

---

## 6. Host User Security & Safety Features

RemoteHub is engineered with strict host consent principles to prevent covert access:

### A. Host Connection Approval Prompt
Whenever an authorized user enters the device PIN on the web dashboard to start a remote session, the host laptop immediately displays a high-priority approval prompt:
- **Prompt Details**: Shows the requesting account email, client IP address, and timestamp.
- **Host Options**:
  - Click **"Approve"** to allow screen streaming and remote control.
  - Click **"Reject"** to immediately decline the connection.
- **Safety Timeout**: If no host action is taken within 30 seconds, the request is automatically rejected.

### B. Active Session Floating Banner
During any active remote desktop session:
- A prominent floating banner appears on the top-right corner of the host's screen:
  `🔴 RemoteHub — Remote Session Active`
- An emergency **"Disconnect"** button is always accessible on the banner. Clicking it terminates the remote session instantly from the host side.

---

## 7. Uninstallation

To cleanly remove RemoteHub Agent from your computer:

1. Right-click the RemoteHub system tray icon and select **Exit**.
2. Run the included uninstaller script:
   ```cmd
   uninstall-windows-agent.bat
   ```
3. Alternatively, manually delete `RemoteHubAgent.exe` and remove its configuration directory at:
   `%LOCALAPPDATA%\RemoteHub\`
