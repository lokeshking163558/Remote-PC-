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
        private CancellationTokenSource? _sessionCts;
        private WebRtcStreamingService? _webRtc;
        private bool _isRunning;
        private string? _activeSessionId;
        private int _displayIndex = 0;
        private int _quality = 65;
        private int _fps = 30;
        private long _lastSignalTimestamp = 0;
        private readonly FloatingSessionBanner _banner;
        private readonly ConcurrentQueue<string> _logs = new();
        private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(10) };

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

            // 0. Verify registration with backend server to confirm ownership and active state
            Task.Run(() => VerifyServerRegistrationAsync(_cts.Token));

            // 1. WebSocket signaling loop (if server supports WebSockets)
            Task.Run(() => ConnectionLoopAsync(_cts.Token));

            // 2. Dedicated HTTP heartbeat loop (fires every 15s regardless of socket state)
            Task.Run(() => HttpHeartbeatLoopAsync(_cts.Token));

            // 3. HTTP Agent Polling loop (guarantees session requests arrive even when WebSockets are unavailable e.g. Vercel)
            Task.Run(() => HttpAgentPollingLoopAsync(_cts.Token));
        }

        public async Task<bool> VerifyServerRegistrationAsync(CancellationToken ct = default)
        {
            if (!_config.IsConfigured) return false;

            try
            {
                var payload = new
                {
                    deviceId = _config.DeviceId,
                    authToken = _config.AuthToken,
                    installationId = _config.InstallationId,
                    deviceName = _config.DeviceName
                };

                string json = JsonSerializer.Serialize(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/verify-registration";

                var res = await _httpClient.PostAsync(url, content, ct);
                string resBody = await res.Content.ReadAsStringAsync(ct);

                if (res.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(resBody);
                    bool verified = doc.RootElement.GetProperty("verified").GetBoolean();
                    if (verified)
                    {
                        _config.IsServerVerified = true;
                        _config.ServerRegistrationStatus = "confirmed";
                        if (doc.RootElement.TryGetProperty("accountEmail", out var emailProp))
                        {
                            _config.AccountEmail = emailProp.GetString() ?? _config.AccountEmail;
                        }
                        if (doc.RootElement.TryGetProperty("ownerId", out var ownerProp))
                        {
                            _config.AccountUserId = ownerProp.GetString() ?? _config.AccountUserId;
                        }
                        if (doc.RootElement.TryGetProperty("accessMethod", out var amProp))
                        {
                            _config.AccessMethod = amProp.GetString() ?? _config.AccessMethod;
                        }
                        _config.Save();
                        AddLog($"Server registration confirmed for account: {_config.AccountEmail}");
                        SetState(AgentConnectionState.Online, "Registration verified by server");
                        return true;
                    }
                }
                else if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    _config.IsServerVerified = false;
                    _config.ServerRegistrationStatus = "not_registered";
                    _config.Save();
                    AddLog("Notice: This computer is not yet in the active server database (synchronization required).");
                    SetState(AgentConnectionState.Reconnecting, "Computer awaiting server synchronization");
                    return false;
                }
                else if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    _config.IsServerVerified = false;
                    _config.ServerRegistrationStatus = "token_mismatch";
                    _config.Save();
                    AddLog("Device authentication token rejected by server.");
                    SetState(AgentConnectionState.Disconnected, "Invalid device credentials");
                    return false;
                }
            }
            catch (Exception ex)
            {
                AddLog($"Registration verification network check: {ex.Message}");
            }
            return false;
        }

        public void Stop()
        {
            _isRunning = false;
            _cts?.Cancel();
            _sessionCts?.Cancel();
            try
            {
                _ws?.Dispose();
            }
            catch {}
            _webRtc?.Dispose();
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

                    // Check if server returned a pending session request in heartbeat response
                    string respBody = await res.Content.ReadAsStringAsync(ct);
                    using var doc = JsonDocument.Parse(respBody);
                    if (doc.RootElement.TryGetProperty("pendingSession", out var pending) && pending.ValueKind == JsonValueKind.Object)
                    {
                        HandlePendingSessionRequest(pending);
                    }

                    return true;
                }
                else
                {
                    if (res.StatusCode == System.Net.HttpStatusCode.NotFound || res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                    {
                        _config.IsServerVerified = false;
                        _config.ServerRegistrationStatus = res.StatusCode == System.Net.HttpStatusCode.NotFound ? "not_registered" : "token_mismatch";
                        SetState(AgentConnectionState.Reconnecting, "Computer awaiting server synchronization");
                    }
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

        private async Task HttpAgentPollingLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _isRunning)
            {
                if (_config.IsConfigured && _activeSessionId == null)
                {
                    try
                    {
                        string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}/agent-poll?token={_config.AuthToken}";
                        var res = await _httpClient.GetAsync(url, ct);

                        if (res.IsSuccessStatusCode)
                        {
                            string body = await res.Content.ReadAsStringAsync(ct);
                            using var doc = JsonDocument.Parse(body);
                            if (doc.RootElement.TryGetProperty("pendingSession", out var pending) && pending.ValueKind == JsonValueKind.Object)
                            {
                                HandlePendingSessionRequest(pending);
                            }
                        }
                    }
                    catch {}
                }

                await Task.Delay(1500, ct).ContinueWith(_ => {}, CancellationToken.None);
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
                    _ws = new ClientWebSocket();
                    string baseUri = _config.ServerUrl.Replace("http://", "ws://").Replace("https://", "wss://");
                    Uri serverUri = new Uri($"{baseUri.TrimEnd('/')}/ws/agent?deviceId={_config.DeviceId}&token={_config.AuthToken}");

                    AddLog($"Attempting WebSocket signaling: {serverUri.Host}...");
                    await _ws.ConnectAsync(serverUri, ct);

                    SetState(AgentConnectionState.Online, "WebSocket signaling established");
                    retryDelayMs = 2000;

                    _ = SendHttpHeartbeatAsync(ct);

                    var wsHeartbeatTask = Task.Run(() => WsHeartbeatLoopAsync(ct), ct);
                    await ReceiveLoopAsync(ct);
                    await wsHeartbeatTask;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    // If WebSocket fails (e.g. 404 on Vercel Serverless), fall back cleanly to HTTP signaling without continuous failure loops
                    AddLog($"WebSocket gateway unavailable ({ex.Message}). Operating in HTTP Signaling & WebRTC P2P mode.");
                    SetState(AgentConnectionState.Online, "HTTP Signaling & WebRTC P2P Active");
                }
                finally
                {
                    try { _ws?.Dispose(); } catch {}
                    _ws = null;
                }

                // If on Vercel or server without WebSockets, wait longer before attempting reconnect
                await Task.Delay(Math.Max(30000, retryDelayMs), ct).ContinueWith(_ => {}, CancellationToken.None);
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
                        HandlePendingSessionRequest(root);
                        break;

                    case "server:start-stream":
                    {
                        string sessionId = root.GetProperty("sessionId").GetString() ?? "";
                        StartSessionStreaming(sessionId);
                        break;
                    }

                    case "server:signal":
                    {
                        if (root.TryGetProperty("signal", out var sig))
                        {
                            HandleSignalMessage(sig);
                        }
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

                    case "server:session-terminate":
                    {
                        AddLog("Server instructed session termination.");
                        EndActiveSession("Server terminated session");
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                AddLog($"Server message parsing error: {ex.Message}");
            }
        }

        private void HandlePendingSessionRequest(JsonElement req)
        {
            if (_activeSessionId != null) return; // Already in active session

            if (!req.TryGetProperty("sessionId", out var sessIdProp)) return;
            string sessionId = sessIdProp.GetString() ?? "";
            if (string.IsNullOrEmpty(sessionId)) return;

            string clientIp = req.TryGetProperty("clientIp", out var ip) ? ip.GetString() ?? "Web Browser" : "Web Browser";
            string deviceName = req.TryGetProperty("deviceName", out var dn) ? dn.GetString() ?? _config.DeviceName : _config.DeviceName;
            string accountName = req.TryGetProperty("accountName", out var an) ? an.GetString() ?? "" : "";
            string accountEmail = req.TryGetProperty("accountEmail", out var ae) ? ae.GetString() ?? "" : "";
            string userAgent = req.TryGetProperty("userAgent", out var ua) ? ua.GetString() ?? "" : "";
            long expiresAt = req.TryGetProperty("expiresAt", out var exp) ? exp.GetInt64() : 0;

            if (expiresAt > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= expiresAt)
            {
                AddLog($"Ignoring expired incoming session request {sessionId.Substring(0, Math.Min(8, sessionId.Length))}");
                return;
            }

            if (_config.PauseRemoteAccess)
            {
                AddLog($"Declined connection from {clientIp} (Remote Access is paused by host user)");
                _ = SendSignalAsync(sessionId, "session-rejected", new { reason = "Host computer has temporarily paused remote access." });
                return;
            }

            AddLog($"Remote session connection requested from {clientIp}. Prompting user on desktop...");

            string safeAccount = !string.IsNullOrEmpty(accountName)
                ? $"Authorized RemoteHub account ({accountName})"
                : (!string.IsNullOrEmpty(accountEmail) ? $"Authorized RemoteHub account ({accountEmail})" : "Authorized RemoteHub account");

            string safeRequestedFrom = !string.IsNullOrEmpty(userAgent)
                ? $"{clientIp} ({GetFriendlyBrowser(userAgent)})"
                : clientIp;

            // Launch approval prompt on STA desktop thread
            var staThread = new Thread(() =>
            {
                var prompt = new ApprovalPromptForm(deviceName, safeAccount, safeRequestedFrom, 45);
                prompt.Approved += async (s, e) =>
                {
                    AddLog($"Host user ALLOWED remote connection from {clientIp}");
                    await ApproveSessionAsync(sessionId, clientIp);
                };
                prompt.Rejected += async (s, e) =>
                {
                    AddLog($"Host user DENIED remote connection from {clientIp}");
                    await RejectSessionAsync(sessionId, "Host user declined connection");
                };
                Application.Run(prompt);
            });
            staThread.SetApartmentState(ApartmentState.STA);
            staThread.Start();
        }

        private static string GetFriendlyBrowser(string ua)
        {
            if (string.IsNullOrEmpty(ua)) return "Web Browser";
            if (ua.Contains("Edg/")) return "Microsoft Edge";
            if (ua.Contains("Chrome/")) return "Google Chrome";
            if (ua.Contains("Firefox/")) return "Mozilla Firefox";
            if (ua.Contains("Safari/") && !ua.Contains("Chrome/")) return "Apple Safari";
            return "Web Browser";
        }

        private async Task ApproveSessionAsync(string sessionId, string clientIp)
        {
            _activeSessionId = sessionId;
            _banner.ShowSession(clientIp);

            // 1. Notify server via HTTP endpoint with device auth token
            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessionId}/approve";
                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _config.AuthToken);
                req.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                await _httpClient.SendAsync(req);
            }
            catch (Exception ex)
            {
                AddLog($"Session approval notification error: {ex.Message}");
            }

            // 2. Also send over WebSocket if open
            await SendTextMessageAsync(new { type = "agent:approve-session", sessionId });

            // 3. Start streaming & WebRTC signaling
            StartSessionStreaming(sessionId);
        }

        private async Task RejectSessionAsync(string sessionId, string reason)
        {
            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessionId}/reject";
                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _config.AuthToken);
                req.Content = new StringContent(JsonSerializer.Serialize(new { reason }), Encoding.UTF8, "application/json");
                await _httpClient.SendAsync(req);
            }
            catch (Exception ex)
            {
                AddLog($"Session rejection notification error: {ex.Message}");
            }

            await SendTextMessageAsync(new { type = "agent:reject-session", sessionId, reason });
            _activeSessionId = null;
        }

        private void StartSessionStreaming(string sessionId)
        {
            _activeSessionId = sessionId;
            _sessionCts?.Cancel();
            _sessionCts = new CancellationTokenSource();
            var ct = _sessionCts.Token;

            AddLog($"Initializing WebRTC and screen capture engine for session {sessionId.Substring(0, Math.Min(8, sessionId.Length))}...");

            // Initialize WebRTC PeerConnection
            _webRtc?.Dispose();
            _webRtc = new WebRtcStreamingService();
            _webRtc.LogMessage += (msg) => AddLog(msg);
            _webRtc.IceCandidateGenerated += async (cand) =>
            {
                await SendSignalAsync(sessionId, "candidate", cand);
            };

            _webRtc.InitializePeerConnection();
            _webRtc.ConfigureStream(_displayIndex, _quality, _fps);

            // 1. Start HTTP signaling listener (polls for browser's SDP offer & ICE candidates)
            Task.Run(() => SessionSignalingPollingLoopAsync(sessionId, ct));

            // 2. Start dual screen streaming loop (WebRTC DataChannel + HTTP frame relay fallback)
            Task.Run(() => DualScreenStreamLoopAsync(sessionId, ct));
        }

        private async Task SessionSignalingPollingLoopAsync(string sessionId, CancellationToken ct)
        {
            _lastSignalTimestamp = 0;

            while (!ct.IsCancellationRequested && _activeSessionId == sessionId)
            {
                try
                {
                    string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessionId}/signal?receiver=agent&since={_lastSignalTimestamp}&timeout=2500";
                    var res = await _httpClient.GetAsync(url, ct);

                    if (res.IsSuccessStatusCode)
                    {
                        string body = await res.Content.ReadAsStringAsync(ct);
                        using var doc = JsonDocument.Parse(body);
                        var root = doc.RootElement;

                        if (root.TryGetProperty("timestamp", out var tsProp))
                        {
                            _lastSignalTimestamp = tsProp.GetInt64();
                        }

                        if (root.TryGetProperty("signals", out var signalsArray) && signalsArray.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in signalsArray.EnumerateArray())
                            {
                                if (item.TryGetProperty("data", out var dataEl))
                                {
                                    HandleSignalMessage(dataEl);
                                }
                            }
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch {}

                await Task.Delay(300, ct).ContinueWith(_ => {}, CancellationToken.None);
            }
        }

        private async void HandleSignalMessage(JsonElement sig)
        {
            if (!sig.TryGetProperty("type", out var typeProp)) return;
            string type = typeProp.GetString() ?? "";

            switch (type)
            {
                case "offer":
                {
                    if (sig.TryGetProperty("sdp", out var sdpProp))
                    {
                        string offerSdp = sdpProp.GetString() ?? "";
                        AddLog("[WebRTC] Received SDP Offer from browser. Generating Answer...");
                        if (_webRtc != null && !string.IsNullOrEmpty(offerSdp))
                        {
                            string answerSdp = await _webRtc.HandleOfferAsync(offerSdp);
                            await SendSignalAsync(_activeSessionId ?? "", "answer", new { type = "answer", sdp = answerSdp });
                        }
                    }
                    break;
                }

                case "candidate":
                {
                    if (sig.TryGetProperty("candidate", out var candProp))
                    {
                        string cand = candProp.TryGetProperty("candidate", out var c) ? c.GetString() ?? "" : "";
                        string sdpMid = candProp.TryGetProperty("sdpMid", out var m) ? m.GetString() ?? "" : "";
                        ushort sdpMLineIndex = candProp.TryGetProperty("sdpMLineIndex", out var idx) ? (ushort)idx.GetInt32() : (ushort)0;

                        if (_webRtc != null && !string.IsNullOrEmpty(cand))
                        {
                            _webRtc.AddIceCandidate(cand, sdpMid, sdpMLineIndex);
                        }
                    }
                    break;
                }

                case "input":
                {
                    if (sig.TryGetProperty("input", out var inputEl))
                    {
                        InputSimulator.ProcessInput(inputEl, _displayIndex);
                    }
                    break;
                }

                case "display-request":
                {
                    if (sig.TryGetProperty("displayIndex", out var dispIdx))
                        _displayIndex = dispIdx.GetInt32();
                    if (sig.TryGetProperty("quality", out var q))
                        _quality = q.GetInt32();
                    if (sig.TryGetProperty("fps", out var f))
                        _fps = Math.Clamp(f.GetInt32(), 10, 60);
                    _webRtc?.ConfigureStream(_displayIndex, _quality, _fps);
                    break;
                }
            }
        }

        private async Task SendSignalAsync(string sessionId, string signalType, object payload)
        {
            if (string.IsNullOrEmpty(sessionId)) return;

            try
            {
                var body = new
                {
                    sender = "agent",
                    signal = payload
                };

                string json = JsonSerializer.Serialize(body);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessionId}/signal";

                await _httpClient.PostAsync(url, content);
            }
            catch {}

            // Also send over WebSocket if open
            if (_ws != null && _ws.State == WebSocketState.Open)
            {
                await SendTextMessageAsync(new
                {
                    type = "agent:signal",
                    sessionId,
                    signal = payload
                });
            }
        }

        private async Task DualScreenStreamLoopAsync(string sessionId, CancellationToken ct)
        {
            AddLog($"[Stream] Desktop capture streaming active for session {sessionId.Substring(0, Math.Min(8, sessionId.Length))} (Quality: {_quality}%, Target FPS: {_fps})...");

            int httpPostSkipCounter = 0;

            while (!ct.IsCancellationRequested && _activeSessionId == sessionId)
            {
                try
                {
                    int delayMs = 1000 / Math.Max(10, _fps);
                    byte[] jpegBytes = ScreenCaptureService.CaptureDisplayJpeg(_displayIndex, _quality, true);

                    // 1. If WebRTC DataChannel is connected: Transmit frame directly peer-to-peer at high speed!
                    if (_webRtc != null && _webRtc.IsDataChannelOpen)
                    {
                        // WebRTC internal loop handles DataChannel transmission
                    }

                    // 2. Also send over WebSocket if connected
                    if (_ws != null && _ws.State == WebSocketState.Open)
                    {
                        await _ws.SendAsync(new ArraySegment<byte>(jpegBytes), WebSocketMessageType.Binary, true, ct);
                    }

                    // 3. HTTP Frame Relay fallback (posts frame every ~100ms so browser has zero black-screen lag)
                    httpPostSkipCounter++;
                    if (httpPostSkipCounter % 3 == 0)
                    {
                        _ = PostFrameToHttpRelayAsync(sessionId, jpegBytes);
                    }

                    await Task.Delay(delayMs, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    AddLog($"Stream frame loop exception: {ex.Message}");
                    await Task.Delay(50, ct);
                }
            }

            AddLog("[Stream] Screen stream ended.");
        }

        private async Task PostFrameToHttpRelayAsync(string sessionId, byte[] jpegBytes)
        {
            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessionId}/frame";
                var content = new ByteArrayContent(jpegBytes);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
                await _httpClient.PostAsync(url, content);
            }
            catch {}
        }

        private void EndActiveSession(string reason)
        {
            _activeSessionId = null;
            _sessionCts?.Cancel();
            _sessionCts = null;
            _webRtc?.Dispose();
            _webRtc = null;
            _banner.HideSession();
            AddLog($"Session closed: {reason}");
        }

        public void HandleEmergencyDisconnect()
        {
            AddLog("Emergency Disconnect triggered by host user!");
            if (_activeSessionId != null)
            {
                string sessId = _activeSessionId;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        string url = $"{_config.ServerUrl.TrimEnd('/')}/api/sessions/{sessId}/disconnect";
                        await _httpClient.PostAsync(url, new StringContent("{}", Encoding.UTF8, "application/json"));
                    }
                    catch {}
                });
            }
            EndActiveSession("Host emergency disconnect");
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

        // Rename Device
        public async Task<(bool Success, string Message)> RenameDeviceAsync(string newName)
        {
            if (!_config.IsConfigured || string.IsNullOrWhiteSpace(newName))
                return (false, "Device is not configured or name is empty.");

            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}";
                var payload = new { deviceName = newName.Trim() };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

                using var request = new HttpRequestMessage(HttpMethod.Patch, url) { Content = content };
                request.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");

                var res = await _httpClient.SendAsync(request);
                if (res.IsSuccessStatusCode)
                {
                    _config.DeviceName = newName.Trim();
                    _config.Save();
                    AddLog($"Device successfully renamed to '{newName.Trim()}'");
                    return (true, $"Computer successfully renamed to '{newName.Trim()}'.");
                }
                else
                {
                    return (false, $"Server returned error (HTTP {(int)res.StatusCode}).");
                }
            }
            catch (Exception ex)
            {
                AddLog($"Device renaming failed: {ex.Message}");
                return (false, $"Network error: {ex.Message}");
            }
        }

        // Change Permanent Access PIN
        public async Task<(bool Success, string Message)> ChangePinAsync(string currentPin, string newPin)
        {
            if (!_config.IsConfigured || string.IsNullOrWhiteSpace(newPin))
                return (false, "Device is not configured or PIN is empty.");

            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}/pin";
                var payload = new { currentPin, newPin };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

                using var request = new HttpRequestMessage(HttpMethod.Put, url) { Content = content };
                request.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");

                var res = await _httpClient.SendAsync(request);
                if (res.IsSuccessStatusCode)
                {
                    AddLog("Permanent Access PIN updated successfully on server.");
                    return (true, "Permanent access PIN updated successfully.");
                }
                else
                {
                    return (false, $"Failed to update PIN (HTTP {(int)res.StatusCode}).");
                }
            }
            catch (Exception ex)
            {
                AddLog($"PIN update failed: {ex.Message}");
                return (false, $"Network error: {ex.Message}");
            }
        }

        // Reset / Set Permanent Access PIN locally on host laptop (No old PIN needed)
        public async Task<(bool Success, string Message)> ResetPinLocalAsync(string newPin)
        {
            if (!_config.IsConfigured || string.IsNullOrWhiteSpace(newPin))
                return (false, "Device is not configured or PIN is empty.");

            if (newPin.Length < 6 || newPin.Length > 8)
                return (false, "PIN must be 6 to 8 digits.");

            try
            {
                string url = $"{_config.ServerUrl.TrimEnd('/')}/api/devices/{_config.DeviceId}/reset-pin-local";
                var payload = new { newPin };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

                using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
                request.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");

                var res = await _httpClient.SendAsync(request);
                if (res.IsSuccessStatusCode)
                {
                    _config.AccessMethod = "pin";
                    _config.Save();
                    AddLog("Permanent Access PIN configured/reset locally on host laptop.");
                    return (true, "Access PIN saved successfully. Computer is now PIN protected.");
                }
                else
                {
                    return (false, $"Failed to update PIN (HTTP {(int)res.StatusCode}).");
                }
            }
            catch (Exception ex)
            {
                AddLog($"Local PIN reset error: {ex.Message}");
                return (false, $"Network error: {ex.Message}");
            }
        }

        // Export Diagnostic Report
        public string ExportDiagnosticReport()
        {
            var sb = new StringBuilder();
            sb.AppendLine("==================================================");
            sb.AppendLine("           REMOTEHUB AGENT DIAGNOSTIC REPORT      ");
            sb.AppendLine("==================================================");
            sb.AppendLine($"Generated At: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"Device ID: {_config.DeviceId}");
            sb.AppendLine($"Device Name: {_config.DeviceName}");
            sb.AppendLine($"Installation ID: {_config.InstallationId}");
            sb.AppendLine($"Server URL: {_config.ServerUrl}");
            sb.AppendLine($"State: {State}");
            sb.AppendLine($"Last Heartbeat: {LastSuccessfulHeartbeat?.ToString("HH:mm:ss") ?? "Never"}");
            sb.AppendLine($"WebRTC PeerConnection: {_webRtc?.ConnectionState.ToString() ?? "Inactive"}");
            sb.AppendLine($"WebRTC ICE State: {_webRtc?.IceState.ToString() ?? "Inactive"}");
            sb.AppendLine($"Active Session: {_activeSessionId ?? "None"}");
            sb.AppendLine($"Operating System: {Environment.OSVersion}");
            sb.AppendLine($"Machine Name: {Environment.MachineName}");
            sb.AppendLine($"Process Uptime: {Process.GetCurrentProcess().TotalProcessorTime.TotalSeconds:F1}s");
            sb.AppendLine();
            sb.AppendLine("RECENT DIAGNOSTIC LOGS:");
            foreach (var log in DiagnosticLogs)
            {
                sb.AppendLine(log);
            }
            sb.AppendLine("==================================================");
            return sb.ToString();
        }
    }
}
