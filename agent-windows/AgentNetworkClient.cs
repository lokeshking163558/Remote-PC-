using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public enum AgentConnectionState
    {
        Disconnected,
        Connecting,
        Online,
        Reconnecting
    }

    public class AgentNetworkClient
    {
        private readonly AgentConfig _config;
        private ClientWebSocket? _ws;
        private CancellationTokenSource? _cts;
        private bool _isRunning;
        private string? _activeSessionId;
        private int _displayIndex = 0;
        private int _quality = 65;
        private int _fps = 25;
        private readonly FloatingSessionBanner _banner;
        private readonly ConcurrentQueue<string> _logs = new();
        private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(8) };

        public AgentConnectionState State { get; private set; } = AgentConnectionState.Disconnected;
        public DateTime? LastSuccessfulHeartbeat { get; private set; }
        public IReadOnlyList<string> DiagnosticLogs => _logs.ToArray();

        public event Action<bool>? ConnectionStatusChanged;
        public event Action<AgentConnectionState, string>? StateChanged;
        public event Action<string>? LogAdded;

        public AgentNetworkClient(AgentConfig config, FloatingSessionBanner banner)
        {
            _config = config;
            _banner = banner;
            _banner.EmergencyDisconnectRequested += (s, e) => HandleEmergencyDisconnect();
            AddLog("AgentNetworkClient initialized.");
        }

        public void AddLog(string message)
        {
            string entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
            _logs.Enqueue(entry);
            while (_logs.Count > 100)
            {
                _logs.TryDequeue(out _);
            }
            LogAdded?.Invoke(entry);
            Console.WriteLine(entry);
        }

        private void SetState(AgentConnectionState newState, string reason = "")
        {
            if (State != newState)
            {
                State = newState;
                StateChanged?.Invoke(newState, reason);
                ConnectionStatusChanged?.Invoke(newState == AgentConnectionState.Online);
                AddLog($"State changed to {newState}{(string.IsNullOrEmpty(reason) ? "" : ": " + reason)}");
            }
        }

        public void Start()
        {
            if (_isRunning) return;
            _isRunning = true;
            _cts = new CancellationTokenSource();

            AddLog($"Starting background agent network services (Server: {_config.ServerUrl})...");

            // 1. Start persistent WebSocket signaling loop
            Task.Run(() => ConnectionLoopAsync(_cts.Token));

            // 2. Start dedicated HTTP heartbeat loop (fires every 15s regardless of socket state)
            Task.Run(() => HttpHeartbeatLoopAsync(_cts.Token));
        }

        public void Stop()
        {
            _isRunning = false;
            _cts?.Cancel();
            try
            {
                _ws?.Dispose();
            }
            catch {}
            _banner.HideSession();
            SetState(AgentConnectionState.Disconnected, "Agent stopped by user");
        }

        public void ForceReconnect()
        {
            AddLog("Manual reconnection requested by user.");
            try
            {
                _ws?.Abort();
            }
            catch {}
            _cts?.Cancel();
            _isRunning = false;
            Start();
        }

        private async Task HttpHeartbeatLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _isRunning)
            {
                if (_config.IsConfigured)
                {
                    await SendHttpHeartbeatAsync(ct);
                }
                int intervalSec = Math.Clamp(_config.HeartbeatIntervalSeconds, 5, 60);
                await Task.Delay(TimeSpan.FromSeconds(intervalSec), ct).ContinueWith(_ => {}, CancellationToken.None);
            }
        }

        public async Task<bool> SendHttpHeartbeatAsync(CancellationToken ct = default)
        {
            if (!_config.IsConfigured) return false;

            try
            {
                var metrics = MetricsCollector.Collect();
                var payload = new
                {
                    deviceId = _config.DeviceId,
                    authToken = _config.AuthToken,
                    localIp = metrics.IpAddress,
                    macAddress = metrics.MacAddress,
                    installationId = _config.InstallationId,
                    metrics = new
                    {
                        cpuUsage = metrics.CpuUsage,
                        memoryUsage = metrics.MemoryUsage,
                        storageUsage = metrics.StorageUsage,
                        batteryPercent = metrics.BatteryPercent,
                        isCharging = metrics.IsCharging
                    }
                };

                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/heartbeat";

                var res = await _httpClient.PostAsync(url, content, ct);
                if (res.IsSuccessStatusCode)
                {
                    LastSuccessfulHeartbeat = DateTime.Now;
                    if (State == AgentConnectionState.Disconnected || State == AgentConnectionState.Reconnecting)
                    {
                        SetState(AgentConnectionState.Online, "HTTP Heartbeat verified");
                    }
                    return true;
                }
                else
                {
                    AddLog($"HTTP Heartbeat rejected (HTTP {(int)res.StatusCode})");
                    return false;
                }
            }
            catch (Exception ex)
            {
                AddLog($"HTTP Heartbeat network error: {ex.Message}");
                return false;
            }
        }

        private async Task ConnectionLoopAsync(CancellationToken ct)
        {
            int retryDelayMs = 2000;

            while (!ct.IsCancellationRequested && _isRunning)
            {
                if (!_config.IsConfigured)
                {
                    SetState(AgentConnectionState.Disconnected, "Awaiting pairing configuration");
                    await Task.Delay(2000, ct).ContinueWith(_ => {}, CancellationToken.None);
                    continue;
                }

                try
                {
                    SetState(AgentConnectionState.Connecting, "Connecting to WebSocket gateway");
                    _ws = new ClientWebSocket();
                    string baseUri = _config.ServerUrl.Replace("http://", "ws://").Replace("https://", "wss://");
                    Uri serverUri = new Uri($"{baseUri.TrimEnd('/')}/ws/agent?deviceId={_config.DeviceId}&token={_config.AuthToken}");

                    AddLog($"Connecting to WS: {serverUri.Host}...");
                    await _ws.ConnectAsync(serverUri, ct);

                    SetState(AgentConnectionState.Online, "WebSocket signaling established");
                    retryDelayMs = 2000; // Reset backoff delay on successful connection

                    // Send fresh heartbeat immediately upon connect
                    _ = SendHttpHeartbeatAsync(ct);

                    // Start background WS heartbeat ping
                    var wsHeartbeatTask = Task.Run(() => WsHeartbeatLoopAsync(ct), ct);

                    // Process incoming server messages
                    await ReceiveLoopAsync(ct);

                    await wsHeartbeatTask;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    AddLog($"WebSocket disconnected: {ex.Message}");
                    SetState(AgentConnectionState.Reconnecting, $"Retrying in {retryDelayMs / 1000}s...");
                }
                finally
                {
                    _banner.HideSession();
                    _activeSessionId = null;
                }

                await Task.Delay(retryDelayMs, ct).ContinueWith(_ => {}, CancellationToken.None);
                retryDelayMs = Math.Min(30000, retryDelayMs * 2); // Exponential backoff max 30s
            }
        }

        private async Task WsHeartbeatLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _ws != null && _ws.State == WebSocketState.Open)
            {
                try
                {
                    var metrics = MetricsCollector.Collect();
                    var heartbeatMsg = new
                    {
                        type = "agent:heartbeat",
                        deviceId = _config.DeviceId,
                        localIp = metrics.IpAddress,
                        macAddress = metrics.MacAddress,
                        installationId = _config.InstallationId,
                        metrics = new
                        {
                            cpuUsage = metrics.CpuUsage,
                            memoryUsage = metrics.MemoryUsage,
                            storageUsage = metrics.StorageUsage,
                            batteryPercent = metrics.BatteryPercent,
                            isCharging = metrics.IsCharging
                        }
                    };

                    string json = JsonSerializer.Serialize(heartbeatMsg);
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
                    LastSuccessfulHeartbeat = DateTime.Now;
                }
                catch (Exception ex)
                {
                    AddLog($"WS Heartbeat loop exception: {ex.Message}");
                    break;
                }

                await Task.Delay(15000, ct).ContinueWith(_ => {}, CancellationToken.None);
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken ct)
        {
            byte[] buffer = new byte[65536];

            while (!ct.IsCancellationRequested && _ws != null && _ws.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        AddLog("Server requested WebSocket close.");
                        return;
                    }
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                ms.Seek(0, SeekOrigin.Begin);
                string text = Encoding.UTF8.GetString(ms.ToArray());
                ProcessServerMessage(text);
            }
        }

        private void ProcessServerMessage(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeProp)) return;
                string type = typeProp.GetString() ?? "";

                switch (type)
                {
                    case "server:session-request":
                    {
                        string sessionId = root.GetProperty("sessionId").GetString() ?? "";
                        string clientIp = root.TryGetProperty("clientIp", out var ip) ? ip.GetString() ?? "" : "";

                        // Check privacy setting
                        if (_config.PauseRemoteAccess)
                        {
                            AddLog($"Declined connection from {clientIp} (Remote Access is paused by host user)");
                            _ = SendTextMessageAsync(new
                            {
                                type = "agent:reject-session",
                                sessionId,
                                reason = "Host computer has temporarily paused remote access."
                            });
                            break;
                        }

                        AddLog($"Remote session connection requested by {clientIp}. Prompting user...");

                        // Show host user approval dialog on desktop UI thread
                        var staThread = new Thread(() =>
                        {
                            var prompt = new ApprovalPromptForm(clientIp);
                            prompt.Approved += async (s, e) =>
                            {
                                _activeSessionId = sessionId;
                                _banner.ShowSession(clientIp);
                                AddLog($"Host user APPROVED session {sessionId.Substring(0, Math.Min(8, sessionId.Length))} from {clientIp}");

                                await SendTextMessageAsync(new { type = "agent:approve-session", sessionId });
                                _ = Task.Run(() => ScreenStreamLoopAsync(sessionId, _cts?.Token ?? CancellationToken.None));
                            };
                            prompt.Rejected += async (s, e) =>
                            {
                                AddLog($"Host user REJECTED session from {clientIp}");
                                await SendTextMessageAsync(new { type = "agent:reject-session", sessionId, reason = "Host user declined connection" });
                            };
                            Application.Run(prompt);
                        });
                        staThread.SetApartmentState(ApartmentState.STA);
                        staThread.Start();
                        break;
                    }

                    case "server:start-stream":
                    {
                        string sessionId = root.GetProperty("sessionId").GetString() ?? "";
                        _activeSessionId = sessionId;
                        Task.Run(() => ScreenStreamLoopAsync(sessionId, _cts?.Token ?? CancellationToken.None));
                        break;
                    }

                    case "server:input":
                    {
                        if (root.TryGetProperty("input", out var inputEl))
                        {
                            InputSimulator.ProcessInput(inputEl, _displayIndex);
                        }
                        break;
                    }

                    case "server:display-request":
                    {
                        if (root.TryGetProperty("displayIndex", out var dispIdx))
                            _displayIndex = dispIdx.GetInt32();
                        if (root.TryGetProperty("quality", out var q))
                            _quality = q.GetInt32();
                        if (root.TryGetProperty("fps", out var f))
                            _fps = Math.Clamp(f.GetInt32(), 10, 60);
                        break;
                    }

                    case "server:clipboard":
                    {
                        if (root.TryGetProperty("text", out var textProp))
                        {
                            string text = textProp.GetString() ?? "";
                            if (!string.IsNullOrEmpty(text))
                            {
                                try
                                {
                                    Thread staThread = new Thread(() => Clipboard.SetText(text));
                                    staThread.SetApartmentState(ApartmentState.STA);
                                    staThread.Start();
                                }
                                catch {}
                            }
                        }
                        break;
                    }

                    case "server:session-terminate":
                    {
                        AddLog("Server instructed session termination.");
                        _activeSessionId = null;
                        _banner.HideSession();
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                AddLog($"Server message parsing error: {ex.Message}");
            }
        }

        private async Task SendTextMessageAsync(object payload)
        {
            if (_ws != null && _ws.State == WebSocketState.Open)
            {
                try
                {
                    string json = JsonSerializer.Serialize(payload);
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch {}
            }
        }

        private async Task ScreenStreamLoopAsync(string sessionId, CancellationToken ct)
        {
            AddLog($"Starting screen capture stream for session {sessionId.Substring(0, Math.Min(8, sessionId.Length))} (FPS: {_fps}, Quality: {_quality}%)...");
            while (!ct.IsCancellationRequested && _activeSessionId == sessionId && _ws != null && _ws.State == WebSocketState.Open)
            {
                try
                {
                    int delayMs = 1000 / Math.Max(10, _fps);
                    byte[] jpegBytes = ScreenCaptureService.CaptureDisplayJpeg(_displayIndex, _quality);

                    await _ws.SendAsync(new ArraySegment<byte>(jpegBytes), WebSocketMessageType.Binary, true, ct);
                    await Task.Delay(delayMs, ct);
                }
                catch (Exception ex)
                {
                    AddLog($"Screen stream frame error: {ex.Message}");
                    break;
                }
            }
            AddLog("Screen capture stream ended.");
        }

        public void HandleEmergencyDisconnect()
        {
            AddLog("Emergency Disconnect triggered by host user!");
            if (_activeSessionId != null && _ws != null && _ws.State == WebSocketState.Open)
            {
                try
                {
                    var msg = new
                    {
                        type = "agent:emergency-disconnect",
                        sessionId = _activeSessionId
                    };
                    string json = JsonSerializer.Serialize(msg);
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                }
                catch {}
            }
            _activeSessionId = null;
            _banner.HideSession();
        }

        // Connection Test Utility
        public async Task<(bool Reachable, long LatencyMs, string Message)> TestServerConnectionAsync(string serverUrl)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                string target = $"{serverUrl.TrimEnd('/')}/api/health";
                var res = await _httpClient.GetAsync(target);
                sw.Stop();

                if (res.IsSuccessStatusCode)
                {
                    string body = await res.Content.ReadAsStringAsync();
                    return (true, sw.ElapsedMilliseconds, $"✓ Reachable (HTTP {(int)res.StatusCode}, {sw.ElapsedMilliseconds}ms)");
                }
                else
                {
                    return (false, sw.ElapsedMilliseconds, $"Server responded with HTTP {(int)res.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                return (false, sw.ElapsedMilliseconds, $"Connection failed: {ex.Message}");
            }
        }

        // Device Rename Utility
        public async Task<(bool Success, string Message)> RenameDeviceAsync(string newName)
        {
            if (!_config.IsConfigured || string.IsNullOrEmpty(newName))
            {
                return (false, "Device not paired or name is empty.");
            }

            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}";
                var payload = new { deviceName = newName.Trim() };
                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                using var req = new HttpRequestMessage(HttpMethod.Patch, url) { Content = content };
                req.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");

                var res = await _httpClient.SendAsync(req);
                if (res.IsSuccessStatusCode)
                {
                    _config.DeviceName = newName.Trim();
                    _config.Save();
                    AddLog($"Device renamed to: {_config.DeviceName}");
                    return (true, "Computer name updated successfully.");
                }
                else
                {
                    return (false, $"Rename failed (HTTP {(int)res.StatusCode}).");
                }
            }
            catch (Exception ex)
            {
                return (false, $"Rename error: {ex.Message}");
            }
        }

        // Change Permanent Access PIN Utility
        public async Task<(bool Success, string Message)> ChangePinAsync(string currentPin, string newPin)
        {
            if (!_config.IsConfigured)
            {
                return (false, "Device is not currently paired.");
            }

            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}/change-pin";
                var payload = new { currentPin, newPin };
                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
                req.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");

                var res = await _httpClient.SendAsync(req);
                string resBody = await res.Content.ReadAsStringAsync();

                if (res.IsSuccessStatusCode)
                {
                    AddLog("Permanent access PIN changed successfully.");
                    return (true, "Access PIN updated successfully.");
                }
                else
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(resBody);
                        string err = doc.RootElement.GetProperty("error").GetString() ?? "Failed to change PIN.";
                        return (false, err);
                    }
                    catch
                    {
                        return (false, $"Failed to change PIN (HTTP {(int)res.StatusCode})");
                    }
                }
            }
            catch (Exception ex)
            {
                return (false, $"Error updating PIN: {ex.Message}");
            }
        }

        public string ExportDiagnosticReport()
        {
            var sb = new StringBuilder();
            sb.AppendLine("=================================================================");
            sb.AppendLine("           REMOTEHUB WINDOWS AGENT DIAGNOSTIC REPORT            ");
            sb.AppendLine("=================================================================");
            sb.AppendLine($"Generated At: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"Machine Name: {Environment.MachineName}");
            sb.AppendLine($"OS Version:   {Environment.OSVersion}");
            sb.AppendLine($".NET Runtime: {Environment.Version}");
            sb.AppendLine();
            sb.AppendLine("--- AGENT CONFIGURATION ---");
            sb.AppendLine($"Device Name:      {_config.DeviceName}");
            sb.AppendLine($"Device ID:        {_config.DeviceId}");
            sb.AppendLine($"Installation ID:  {_config.InstallationId}");
            sb.AppendLine($"Server URL:       {_config.ServerUrl}");
            sb.AppendLine($"Is Paired:        {_config.IsConfigured}");
            sb.AppendLine($"AutoStart:        {_config.AutoStart}");
            sb.AppendLine($"PauseRemoteAccess:{_config.PauseRemoteAccess}");
            sb.AppendLine();
            sb.AppendLine("--- STATUS & TELEMETRY ---");
            sb.AppendLine($"Current State:    {State}");
            sb.AppendLine($"Last Heartbeat:   {(LastSuccessfulHeartbeat.HasValue ? LastSuccessfulHeartbeat.Value.ToString("HH:mm:ss") : "Never")}");
            sb.AppendLine($"Active Session:   {(_activeSessionId ?? "None")}");

            var metrics = MetricsCollector.Collect();
            sb.AppendLine($"Local IP Address: {metrics.IpAddress}");
            sb.AppendLine($"MAC Address:      {metrics.MacAddress}");
            sb.AppendLine($"CPU Usage:        {metrics.CpuUsage}%");
            sb.AppendLine($"RAM Usage:        {metrics.MemoryUsage}% ({metrics.MemoryUsedMb}MB / {metrics.MemoryTotalMb}MB)");
            sb.AppendLine($"Battery:          {metrics.BatteryPercent}% (Charging: {metrics.IsCharging})");
            sb.AppendLine();
            sb.AppendLine("--- RECENT DIAGNOSTIC LOGS ---");
            foreach (var log in _logs)
            {
                sb.AppendLine(log);
            }
            sb.AppendLine("=================================================================");
            return sb.ToString();
        }
    }
}
