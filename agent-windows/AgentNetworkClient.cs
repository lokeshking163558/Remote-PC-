using System;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
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

        public event Action<bool>? ConnectionStatusChanged;

        public AgentNetworkClient(AgentConfig config, FloatingSessionBanner banner)
        {
            _config = config;
            _banner = banner;
            _banner.EmergencyDisconnectRequested += (s, e) => HandleEmergencyDisconnect();
        }

        public void Start()
        {
            if (_isRunning) return;
            _isRunning = true;
            _cts = new CancellationTokenSource();

            Task.Run(() => ConnectionLoopAsync(_cts.Token));
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
            ConnectionStatusChanged?.Invoke(false);
        }

        private async Task ConnectionLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _isRunning)
            {
                if (!_config.IsConfigured)
                {
                    await Task.Delay(2000, ct);
                    continue;
                }

                try
                {
                    _ws = new ClientWebSocket();
                    string baseUri = _config.ServerUrl.Replace("http://", "ws://").Replace("https://", "wss://");
                    Uri serverUri = new Uri($"{baseUri.TrimEnd('/')}/ws/agent?deviceId={_config.DeviceId}&token={_config.AuthToken}");

                    await _ws.ConnectAsync(serverUri, ct);
                    ConnectionStatusChanged?.Invoke(true);

                    // Start background heartbeat
                    var heartbeatTask = Task.Run(() => HeartbeatLoopAsync(ct), ct);
                    // Process incoming server messages
                    await ReceiveLoopAsync(ct);

                    await heartbeatTask;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[AgentWS] Error: {ex.Message}");
                }
                finally
                {
                    ConnectionStatusChanged?.Invoke(false);
                    _banner.HideSession();
                    _activeSessionId = null;
                }

                await Task.Delay(3000, ct);
            }
        }

        private async Task HeartbeatLoopAsync(CancellationToken ct)
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
                        metrics = new
                        {
                            cpuUsage = metrics.CpuUsage,
                            memoryUsage = metrics.MemoryUsage,
                            memoryTotalMb = metrics.MemoryTotalMb,
                            memoryUsedMb = metrics.MemoryUsedMb,
                            storageUsage = metrics.StorageUsage,
                            storageTotalGb = metrics.StorageTotalGb,
                            storageFreeGb = metrics.StorageFreeGb,
                            batteryPercent = metrics.BatteryPercent,
                            isCharging = metrics.IsCharging
                        }
                    };

                    string json = JsonSerializer.Serialize(heartbeatMsg);
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[AgentWS] Heartbeat error: {ex.Message}");
                    break;
                }

                await Task.Delay(10000, ct);
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken ct)
        {
            byte[] buffer = new byte[65536];

            while (!ct.IsCancellationRequested && _ws != null && _ws.State == WebSocketState.Open)
            {
                using var ms = new System.IO.MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                ms.Seek(0, System.IO.SeekOrigin.Begin);
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

                        // Show host user approval dialog on desktop UI thread
                        var staThread = new Thread(() =>
                        {
                            var prompt = new ApprovalPromptForm(clientIp);
                            prompt.Approved += async (s, e) =>
                            {
                                _activeSessionId = sessionId;
                                _banner.ShowSession(clientIp);

                                // Send approval back to server
                                await SendTextMessageAsync(new { type = "agent:approve-session", sessionId });

                                // Start desktop screen capture stream
                                _ = Task.Run(() => ScreenStreamLoopAsync(sessionId, _cts?.Token ?? CancellationToken.None));
                            };
                            prompt.Rejected += async (s, e) =>
                            {
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
                        _activeSessionId = null;
                        _banner.HideSession();
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AgentWS] Parse error: {ex.Message}");
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
                    Console.WriteLine($"[AgentWS] Screen capture frame error: {ex.Message}");
                    break;
                }
            }
        }

        private void HandleEmergencyDisconnect()
        {
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
    }
}
