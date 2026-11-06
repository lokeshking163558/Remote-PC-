using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SIPSorcery.Net;

namespace RemoteHub.Agent
{
    public class WebRtcStreamingService : IDisposable
    {
        private RTCPeerConnection? _pc;
        private RTCDataChannel? _dataChannel;
        private CancellationTokenSource? _streamCts;
        private bool _isStreaming;
        private int _displayIndex = 0;
        private int _quality = 65;
        private int _fps = 30;
        private readonly ConcurrentQueue<RTCIceCandidateInit> _queuedIceCandidates = new();

        public event Action<string>? LogMessage;
        public event Action<object>? IceCandidateGenerated;
        public event Action<string>? StreamStateChanged;

        public RTCPeerConnectionState ConnectionState => _pc?.connectionState ?? RTCPeerConnectionState.closed;
        public RTCIceConnectionState IceState => _pc?.iceConnectionState ?? RTCIceConnectionState.closed;
        public bool IsDataChannelOpen => _dataChannel?.readyState == RTCDataChannelState.open;
        public int FramesSent { get; private set; }
        public int CurrentFps { get; private set; }

        public void InitializePeerConnection()
        {
            Dispose();

            var config = new RTCConfiguration
            {
                iceServers = new List<RTCIceServer>
                {
                    new RTCIceServer { urls = "stun:stun.l.google.com:19302" },
                    new RTCIceServer { urls = "stun:stun1.l.google.com:19302" },
                    new RTCIceServer { urls = "stun:stun2.l.google.com:19302" },
                    new RTCIceServer { urls = "turn:openrelay.metered.ca:80", username = "openrelayproject", credential = "openrelayproject" },
                    new RTCIceServer { urls = "turn:openrelay.metered.ca:443", username = "openrelayproject", credential = "openrelayproject" },
                    new RTCIceServer { urls = "turns:openrelay.metered.ca:443?transport=tcp", username = "openrelayproject", credential = "openrelayproject" }
                }
            };

            _pc = new RTCPeerConnection(config);

            _pc.onicecandidate += (candidate) =>
            {
                if (candidate != null)
                {
                    IceCandidateGenerated?.Invoke(new
                    {
                        candidate = candidate.candidate,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex
                    });
                }
            };

            _pc.onconnectionstatechange += (state) =>
            {
                LogMessage?.Invoke($"[WebRTC] PeerConnection state: {state}");
                StreamStateChanged?.Invoke(state.ToString());
            };

            _pc.oniceconnectionstatechange += (state) =>
            {
                LogMessage?.Invoke($"[WebRTC] ICE connection state: {state}");
            };

            _pc.ondatachannel += (dc) =>
            {
                LogMessage?.Invoke($"[WebRTC] Remote DataChannel received: {dc.label}");
                BindDataChannel(dc);
            };
        }

        private void BindDataChannel(RTCDataChannel dc)
        {
            _dataChannel = dc;

            dc.onopen += () =>
            {
                LogMessage?.Invoke("[WebRTC] DataChannel opened. Starting real-time screen stream.");
                StartStreamingLoop();
            };

            dc.onclose += () =>
            {
                LogMessage?.Invoke("[WebRTC] DataChannel closed.");
                StopStreamingLoop();
            };

            dc.onmessage += (channel, protocol, data) =>
            {
                try
                {
                    string json = Encoding.UTF8.GetString(data);
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "input")
                    {
                        if (doc.RootElement.TryGetProperty("input", out var inputEl))
                        {
                            InputSimulator.ProcessInput(inputEl, _displayIndex);
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogMessage?.Invoke($"[WebRTC] DataChannel input processing error: {ex.Message}");
                }
            };
        }

        public async Task<string> HandleOfferAsync(string offerSdp)
        {
            if (_pc == null)
            {
                InitializePeerConnection();
            }

            var offer = new RTCSessionDescriptionInit
            {
                type = RTCSdpType.offer,
                sdp = offerSdp
            };

            var setRemoteResult = _pc!.setRemoteDescription(offer);
            LogMessage?.Invoke($"[WebRTC] Remote description (offer) set: {setRemoteResult}");

            // Process any early-arriving queued ICE candidates
            while (_queuedIceCandidates.TryDequeue(out var candidate))
            {
                _pc.addIceCandidate(candidate);
            }

            // Create answer
            var answer = _pc.createAnswer(null);
            await _pc.setLocalDescription(answer);
            LogMessage?.Invoke("[WebRTC] Local description (answer) created and set.");

            return answer.sdp;
        }

        public void AddIceCandidate(string candidate, string sdpMid, ushort sdpMLineIndex)
        {
            var init = new RTCIceCandidateInit
            {
                candidate = candidate,
                sdpMid = sdpMid,
                sdpMLineIndex = sdpMLineIndex
            };

            if (_pc != null && _pc.remoteDescription != null)
            {
                _pc.addIceCandidate(init);
            }
            else
            {
                _queuedIceCandidates.Enqueue(init);
            }
        }

        public void ConfigureStream(int displayIndex, int quality, int fps)
        {
            _displayIndex = displayIndex;
            _quality = Math.Clamp(quality, 20, 95);
            _fps = Math.Clamp(fps, 10, 60);
        }

        public void StartStreamingLoop()
        {
            StopStreamingLoop();
            _isStreaming = true;
            _streamCts = new CancellationTokenSource();
            Task.Run(() => StreamLoopAsync(_streamCts.Token));
        }

        public void StopStreamingLoop()
        {
            _isStreaming = false;
            _streamCts?.Cancel();
            _streamCts = null;
        }

        private async Task StreamLoopAsync(CancellationToken ct)
        {
            int frameCounter = 0;
            DateTime lastFpsCalc = DateTime.UtcNow;

            while (!ct.IsCancellationRequested && _isStreaming && _dataChannel != null && _dataChannel.readyState == RTCDataChannelState.open)
            {
                try
                {
                    int delayMs = 1000 / Math.Max(10, _fps);
                    byte[] jpegBytes = ScreenCaptureService.CaptureDisplayJpeg(_displayIndex, _quality);

                    _dataChannel.send(jpegBytes);
                    FramesSent++;
                    frameCounter++;

                    var now = DateTime.UtcNow;
                    if ((now - lastFpsCalc).TotalSeconds >= 1.0)
                    {
                        CurrentFps = frameCounter;
                        frameCounter = 0;
                        lastFpsCalc = now;
                    }

                    await Task.Delay(delayMs, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    LogMessage?.Invoke($"[WebRTC] Frame transmission error: {ex.Message}");
                    await Task.Delay(50, ct);
                }
            }
        }

        public void Dispose()
        {
            StopStreamingLoop();
            try
            {
                _dataChannel?.close();
                _pc?.close();
                _pc?.Dispose();
            }
            catch {}
            _dataChannel = null;
            _pc = null;
        }
    }
}

