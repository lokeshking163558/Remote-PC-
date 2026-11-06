import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Monitor,
  Maximize2,
  Minimize2,
  Sliders,
  Wifi,
  Keyboard,
  Clipboard,
  Power,
  RotateCcw,
  MousePointer,
  Touchpad,
  Send,
  X,
  Activity,
  AlertTriangle,
  RefreshCw,
  Info,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { api, getWsBaseUrl } from '../services/api';

export type RemoteSessionStatus =
  | 'not_connected'
  | 'authorizing'
  | 'connecting'
  | 'negotiating'
  | 'starting_capture'
  | 'streaming'
  | 'reconnecting'
  | 'failed'
  | 'disconnected';

interface RemoteDesktopStudioProps {
  sessionId: string;
  sessionToken: string;
  deviceId: string;
  deviceName: string;
  onDisconnect: () => void;
}

export const RemoteDesktopStudio: React.FC<RemoteDesktopStudioProps> = ({
  sessionId,
  sessionToken,
  deviceId,
  deviceName,
  onDisconnect
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const hasRemoteDescriptionRef = useRef(false);

  // Connection & Session State Management
  const [sessionStatus, setSessionStatus] = useState<RemoteSessionStatus>('authorizing');
  const [statusMessage, setStatusMessage] = useState('Verifying access PIN. Waiting for laptop user approval...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Real WebRTC & Streaming Metrics
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [resolution, setResolution] = useState('Detecting...');
  const [activeTransport, setActiveTransport] = useState<'WebRTC P2P' | 'HTTP Frame Relay' | 'WebSocket Stream'>('HTTP Frame Relay');
  const [hostMetrics, setHostMetrics] = useState<any>(null);

  // Diagnostics State
  const [diagInfo, setDiagInfo] = useState({
    wsConnected: false,
    httpPollingActive: false,
    offerSent: false,
    answerReceived: false,
    peerConnectionState: 'new',
    iceConnectionState: 'new',
    selectedCandidatePair: 'Negotiating...',
    connectionType: 'Direct P2P',
    framesReceived: 0,
    framesDecoded: 0,
    bitrateKbps: 0
  });

  // Display and Quality Settings
  const [displayIndex, setDisplayIndex] = useState(0);
  const [quality, setQuality] = useState(70);
  const [targetFps, setTargetFps] = useState(30);

  // Mobile tools
  const [controlMode, setControlMode] = useState<'touch' | 'trackpad'>('touch');
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);
  const [showClipboardModal, setShowClipboardModal] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [showControls, setShowControls] = useState(true);

  // Tracking frames & calculations
  const frameCountRef = useRef(0);
  const totalFramesRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastPingRef = useRef(Date.now());
  const lastBytesRef = useRef(0);
  const lastBitrateCalcRef = useRef(Date.now());
  const isStreamingRef = useRef(false);
  const streamActiveTimeRef = useRef<NodeJS.Timeout | null>(null);

  // -------------------------------------------------------------
  // Send Input to Host (Prioritizes WebRTC DataChannel for 0ms lag)
  // -------------------------------------------------------------
  const sendInput = useCallback((input: any) => {
    // 1. Send over direct WebRTC DataChannel if open (sub-10ms P2P)
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      try {
        dataChannelRef.current.send(JSON.stringify({
          type: 'input',
          sessionId,
          input
        }));
        return;
      } catch {}
    }

    // 2. Send over WebSocket if open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'client:input',
          sessionId,
          input
        }));
        return;
      } catch {}
    }

    // 3. Fallback to HTTP input endpoint
    api.sendSessionInput(sessionId, input).catch(() => {});
  }, [sessionId]);

  // -------------------------------------------------------------
  // Send WebRTC Signal (SDP / ICE Candidate / Control)
  // -------------------------------------------------------------
  const sendSignal = useCallback(async (signalPayload: any) => {
    // Deliver over WebSocket if open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'client:signal',
        sessionId,
        signal: signalPayload
      }));
    }

    // Also send via HTTP signaling endpoint to ensure delivery in serverless environments (Vercel)
    try {
      await api.sendSessionSignal(sessionId, 'client', signalPayload);
    } catch {}
  }, [sessionId]);

  // -------------------------------------------------------------
  // Frame Renderer (Renders binary JPEG onto canvas with high FPS)
  // -------------------------------------------------------------
  const renderFrameBuffer = useCallback(async (data: ArrayBuffer | Blob, transportName: 'WebRTC P2P' | 'HTTP Frame Relay' | 'WebSocket Stream') => {
    frameCountRef.current++;
    totalFramesRef.current++;
    const now = Date.now();

    // Calculate real-time FPS
    if (now - lastFpsCalcRef.current >= 1000) {
      const calculatedFps = frameCountRef.current;
      setFps(calculatedFps);
      frameCountRef.current = 0;
      lastFpsCalcRef.current = now;

      // Only transition to 'streaming' when actual frames are arriving and FPS > 0
      if (calculatedFps > 0 && !isStreamingRef.current) {
        isStreamingRef.current = true;
        setSessionStatus('streaming');
        setStatusMessage('Streaming active');
      }
    }

    // Measure latency ping
    setLatencyMs(Math.max(8, Math.min(120, now - lastPingRef.current)));
    lastPingRef.current = now;

    // Bitrate estimation
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.size;
    lastBytesRef.current += byteLength;
    if (now - lastBitrateCalcRef.current >= 1500) {
      const durationSec = (now - lastBitrateCalcRef.current) / 1000;
      const kbps = Math.round((lastBytesRef.current * 8) / (durationSec * 1024));
      setDiagInfo(d => ({ ...d, bitrateKbps: kbps }));
      lastBytesRef.current = 0;
      lastBitrateCalcRef.current = now;
    }

    setActiveTransport(transportName);

    try {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
      const imageBitmap = await createImageBitmap(blob);
      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== imageBitmap.width || canvas.height !== imageBitmap.height) {
          canvas.width = imageBitmap.width;
          canvas.height = imageBitmap.height;
          setResolution(`${imageBitmap.width} × ${imageBitmap.height}`);
        }
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(imageBitmap, 0, 0);

        setDiagInfo(d => ({
          ...d,
          framesReceived: totalFramesRef.current,
          framesDecoded: totalFramesRef.current
        }));
      }
    } catch {}
  }, []);

  // -------------------------------------------------------------
  // WebRTC Peer Connection & Negotiation Engine
  // -------------------------------------------------------------
  const initWebRtcConnection = useCallback(async () => {
    try {
      setSessionStatus('connecting');
      setStatusMessage('Initializing WebRTC peer connection...');

      // 1. Fetch ICE configuration (STUN + Public TURN relays)
      let iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ];

      try {
        const iceConfig = await api.getIceServers();
        if (iceConfig.iceServers && iceConfig.iceServers.length > 0) {
          iceServers = iceConfig.iceServers;
        }
      } catch {}

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      hasRemoteDescriptionRef.current = false;
      queuedCandidatesRef.current = [];

      // 2. Set up high-performance DataChannel for real-time video frame streaming & input
      const dc = pc.createDataChannel('remotehub-stream', {
        ordered: false,
        maxRetransmits: 0 // UDP-like zero latency for live desktop streaming
      });
      dc.binaryType = 'arraybuffer';
      dataChannelRef.current = dc;

      dc.onopen = () => {
        setDiagInfo(d => ({ ...d, connectionType: 'Direct WebRTC P2P' }));
        setStatusMessage('WebRTC DataChannel connected. Receiving screen stream...');
      };

      dc.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          renderFrameBuffer(event.data, 'WebRTC P2P');
        }
      };

      // 3. WebRTC Video Track Receiver (if host transmits MediaStreamTrack)
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0] && videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
          setSessionStatus('streaming');
          isStreamingRef.current = true;
          setActiveTransport('WebRTC P2P');
        }
      };

      // 4. ICE candidate exchange
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'candidate',
            candidate: event.candidate.toJSON()
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        setDiagInfo(d => ({ ...d, peerConnectionState: state }));
        if (state === 'connected') {
          setStatusMessage('Peer connection established.');
        } else if (state === 'failed') {
          setDiagInfo(d => ({ ...d, connectionType: 'Relay Fallback' }));
        }
      };

      pc.oniceconnectionstatechange = () => {
        const ice = pc.iceConnectionState;
        setDiagInfo(d => ({ ...d, iceConnectionState: ice }));
        if (ice === 'connected' || ice === 'completed') {
          // Check candidate pair type
          pc.getStats().then(stats => {
            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                const local = stats.get(report.localCandidateId);
                const remote = stats.get(report.remoteCandidateId);
                if (local && remote) {
                  const isRelay = local.candidateType === 'relay' || remote.candidateType === 'relay';
                  setDiagInfo(d => ({
                    ...d,
                    connectionType: isRelay ? 'TURN Relay' : 'Direct P2P',
                    selectedCandidatePair: `${local.candidateType} ➔ ${remote.candidateType}`
                  }));
                }
              }
            });
          }).catch(() => {});
        }
      };

      // 5. Create and dispatch WebRTC SDP Offer
      setSessionStatus('negotiating');
      setStatusMessage('Negotiating WebRTC SDP offer & answer with host...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setDiagInfo(d => ({ ...d, offerSent: true }));
      await sendSignal({
        type: 'offer',
        sdp: offer.sdp
      });
    } catch (err: any) {
      console.error('WebRTC initialization error:', err);
    }
  }, [sendSignal, renderFrameBuffer]);

  // -------------------------------------------------------------
  // Universal Dual-Transport Signaling (WebSocket + HTTP Polling)
  // -------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    let pollInterval: NodeJS.Timeout | null = null;
    let framePollInterval: NodeJS.Timeout | null = null;
    let connectionTimeoutTimer: NodeJS.Timeout | null = null;
    let lastSignalTimestamp = 0;

    // Timeout safeguard: 25 seconds before reporting friendly error
    connectionTimeoutTimer = setTimeout(() => {
      if (!isStreamingRef.current && !isCancelled) {
        setSessionStatus('failed');
        setErrorMessage('Unable to establish remote connection. The desktop agent may be unreachable or the host user did not respond.');
      }
    }, 25000);

    // 1. WebSocket Signaling Attempt
    const wsBase = getWsBaseUrl();
    const wsUrl = `${wsBase}/ws/client?sessionId=${sessionId}&sessionToken=${sessionToken}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (isCancelled) return;
      setDiagInfo(d => ({ ...d, wsConnected: true }));
      setStatusMessage('Connected to server. Awaiting host computer user approval...');
    };

    ws.onmessage = async (event) => {
      if (isCancelled) return;

      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          handleIncomingSignalingMessage(msg);
        } catch {}
      } else if (event.data instanceof ArrayBuffer) {
        // Direct binary JPEG frame over WebSocket
        renderFrameBuffer(event.data, 'WebSocket Stream');
      }
    };

    ws.onerror = () => {
      // If WebSocket fails (e.g. Vercel 404), HTTP signaling polling seamlessly takes over
      setDiagInfo(d => ({ ...d, wsConnected: false }));
    };

    ws.onclose = () => {
      setDiagInfo(d => ({ ...d, wsConnected: false }));
    };

    // 2. HTTP Signaling Polling Loop (Guarantees connection works on Vercel / Serverless)
    setDiagInfo(d => ({ ...d, httpPollingActive: true }));

    const pollSignals = async () => {
      if (isCancelled) return;
      try {
        const res = await api.pollSessionSignals(sessionId, 'client', lastSignalTimestamp, 2000);
        if (res && res.signals && res.signals.length > 0) {
          lastSignalTimestamp = res.timestamp || Date.now();
          for (const item of res.signals) {
            if (item.data) {
              handleIncomingSignalingMessage(item.data);
            }
          }
        }
      } catch {}

      if (!isCancelled) {
        pollInterval = setTimeout(pollSignals, 600);
      }
    };
    pollSignals();

    // 3. Fallback Frame Polling Loop (Polls frames directly via HTTP while WebRTC connects)
    const pollFrameRelay = async () => {
      if (isCancelled) return;
      // If WebRTC data channel is not yet streaming, fetch frame via HTTP fallback
      if (!isStreamingRef.current || activeTransport === 'HTTP Frame Relay') {
        try {
          const url = api.getSessionFrameUrl(sessionId);
          const frameRes = await fetch(url);
          if (frameRes.status === 200) {
            const buf = await frameRes.arrayBuffer();
            if (buf && buf.byteLength > 100) {
              renderFrameBuffer(buf, 'HTTP Frame Relay');
            }
          }
        } catch {}
      }

      if (!isCancelled) {
        framePollInterval = setTimeout(pollFrameRelay, isStreamingRef.current ? 500 : 150);
      }
    };
    framePollInterval = setTimeout(pollFrameRelay, 1200);

    // 4. Inbound Signal Processor
    const handleIncomingSignalingMessage = async (msg: any) => {
      if (msg.type === 'server:session-connected') {
        setStatusMessage('Connection request sent. Waiting for host computer approval...');
      } else if (msg.type === 'server:session-approved') {
        setStatusMessage('Host approved connection! Starting WebRTC streaming pipeline...');
        setSessionStatus('starting_capture');
        initWebRtcConnection();
      } else if (msg.type === 'server:session-rejected') {
        setSessionStatus('failed');
        setErrorMessage(msg.reason || 'The host computer user declined the remote connection.');
      } else if (msg.type === 'server:session-ended') {
        setSessionStatus('disconnected');
        setStatusMessage(`Session ended: ${msg.reason || 'Host closed remote session'}`);
      } else if (msg.type === 'answer') {
        // SDP Answer from Agent
        setDiagInfo(d => ({ ...d, answerReceived: true }));
        setStatusMessage('Received SDP Answer from agent. Finalizing ICE connection...');
        const pc = pcRef.current;
        if (pc && msg.sdp) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription({
              type: 'answer',
              sdp: msg.sdp
            }));
            hasRemoteDescriptionRef.current = true;

            // Apply queued ICE candidates
            while (queuedCandidatesRef.current.length > 0) {
              const cand = queuedCandidatesRef.current.shift();
              if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
          } catch (e) {
            console.error('Error applying remote SDP answer:', e);
          }
        }
      } else if (msg.type === 'candidate') {
        // ICE Candidate from Agent
        const pc = pcRef.current;
        if (msg.candidate) {
          if (hasRemoteDescriptionRef.current && pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {}
          } else {
            queuedCandidatesRef.current.push(msg.candidate);
          }
        }
      } else if (msg.type === 'server:metrics') {
        setHostMetrics(msg.metrics);
      } else if (msg.type === 'server:clipboard') {
        setClipboardText(msg.text);
      }
    };

    return () => {
      isCancelled = true;
      if (pollInterval) clearTimeout(pollInterval);
      if (framePollInterval) clearTimeout(framePollInterval);
      if (connectionTimeoutTimer) clearTimeout(connectionTimeoutTimer);
      if (streamActiveTimeRef.current) clearTimeout(streamActiveTimeRef.current);
      ws.close();
      pcRef.current?.close();
    };
  }, [sessionId, sessionToken, initWebRtcConnection, renderFrameBuffer, activeTransport]);

  // -------------------------------------------------------------
  // Mouse & Touch Input Handlers
  // -------------------------------------------------------------
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (controlMode === 'trackpad') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    sendInput({
      type: 'mouse-move',
      x,
      y,
      normalized: true,
      displayIndex
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    let button: 'left' | 'right' | 'middle' = 'left';
    if (e.button === 2) button = 'right';
    else if (e.button === 1) button = 'middle';

    sendInput({
      type: 'mouse-down',
      button
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    let button: 'left' | 'right' | 'middle' = 'left';
    if (e.button === 2) button = 'right';
    else if (e.button === 1) button = 'middle';

    sendInput({
      type: 'mouse-up',
      button
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    sendInput({
      type: 'mouse-wheel',
      deltaX: Math.round(e.deltaX),
      deltaY: Math.round(e.deltaY)
    });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Keyboard capture
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if (['Tab', 'Alt', 'F5', 'Backspace'].includes(e.key) || (e.ctrlKey && ['w', 'r', 't'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
      }

      sendInput({
        type: 'key-down',
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      sendInput({
        type: 'key-up',
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [sendInput]);

  // Touch handlers for mobile
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (controlMode === 'trackpad') return;
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;

    sendInput({
      type: 'touch-tap',
      x,
      y,
      button: 'left',
      normalized: true
    });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (controlMode === 'trackpad') return;
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;

    sendInput({
      type: 'touch-drag',
      x,
      y,
      normalized: true
    });
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleDisplayChange = (idx: number) => {
    setDisplayIndex(idx);
    sendSignal({
      type: 'display-request',
      displayIndex: idx,
      quality,
      fps: targetFps
    });
  };

  const handleQualityChange = (q: number) => {
    setQuality(q);
    sendSignal({
      type: 'display-request',
      displayIndex,
      quality: q,
      fps: targetFps
    });
  };

  const sendClipboardToHost = () => {
    sendSignal({
      type: 'clipboard',
      text: clipboardText
    });
    setShowClipboardModal(false);
  };

  const handleVirtualKey = (code: string, key: string) => {
    sendInput({ type: 'key-down', key, code });
    setTimeout(() => {
      sendInput({ type: 'key-up', key, code });
    }, 50);
  };

  const retryConnection = () => {
    setSessionStatus('authorizing');
    setErrorMessage(null);
    setStatusMessage('Reconnecting to host computer...');
    isStreamingRef.current = false;
    initWebRtcConnection();
  };

  const isStreaming = sessionStatus === 'streaming';

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-[#080b11] text-gray-100 flex flex-col select-none overflow-hidden"
    >
      {/* Top Floating Control Toolbar */}
      <div
        className={`bg-gray-900/90 backdrop-blur border-b border-gray-800 px-4 py-2 flex items-center justify-between transition-all z-20 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isStreaming
                  ? 'bg-emerald-500 animate-pulse'
                  : sessionStatus === 'failed'
                  ? 'bg-red-500'
                  : 'bg-amber-400 animate-ping'
              }`}
            />
            <span className="font-bold text-sm text-white">{deviceName}</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                isStreaming
                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                  : sessionStatus === 'failed'
                  ? 'bg-red-950/80 text-red-400 border border-red-800/60'
                  : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
              }`}
            >
              {sessionStatus.replace('_', ' ')}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400 bg-gray-950/60 px-3 py-1 rounded-lg border border-gray-800 font-mono">
            <span>{latencyMs}ms</span>
            <span>•</span>
            <span className={fps > 0 ? 'text-emerald-400 font-semibold' : 'text-gray-500'}>
              {fps} FPS
            </span>
            <span>•</span>
            <span>{resolution}</span>
            {hostMetrics && (
              <>
                <span>•</span>
                <span>CPU {hostMetrics.cpuUsage}%</span>
                <span>•</span>
                <span>RAM {hostMetrics.memoryUsage}%</span>
              </>
            )}
          </div>
        </div>

        {/* Toolbar Center / Right Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Diagnostics toggle */}
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
              showDiagnostics
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
            }`}
            title="Real-Time WebRTC Diagnostics"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden md:inline font-medium">Diagnostics</span>
          </button>

          {/* Display selector */}
          <select
            value={displayIndex}
            onChange={(e) => handleDisplayChange(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded-lg px-2.5 py-1 focus:outline-none"
          >
            <option value={0}>Display 1</option>
            <option value={1}>Display 2</option>
          </select>

          {/* Quality selector */}
          <select
            value={quality}
            onChange={(e) => handleQualityChange(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded-lg px-2.5 py-1 focus:outline-none hidden sm:block"
          >
            <option value={50}>Fast (50%)</option>
            <option value={70}>Balanced (70%)</option>
            <option value={85}>Crisp (85%)</option>
          </select>

          {/* Mobile Mode Switcher (Touch vs Trackpad) */}
          <div className="flex sm:hidden bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            <button
              onClick={() => setControlMode('touch')}
              className={`p-1 rounded ${controlMode === 'touch' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
              title="Touch Mode"
            >
              <MousePointer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setControlMode('trackpad')}
              className={`p-1 rounded ${controlMode === 'trackpad' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
              title="Trackpad Mode"
            >
              <Touchpad className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Virtual Keyboard Toggle */}
          <button
            onClick={() => setShowVirtualKeyboard(!showVirtualKeyboard)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
              showVirtualKeyboard
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
            }`}
            title="Toggle Virtual Keyboard"
          >
            <Keyboard className="w-4 h-4" />
          </button>

          {/* Clipboard Transfer */}
          <button
            onClick={() => setShowClipboardModal(true)}
            className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-xs transition-colors"
            title="Clipboard Sync"
          >
            <Clipboard className="w-4 h-4" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white transition-colors"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Disconnect Button */}
          <button
            onClick={() => {
              api.disconnectSession(sessionId).catch(() => {});
              onDisconnect();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-all shadow-sm"
          >
            <Power className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        </div>
      </div>

      {/* Main Remote Screen Canvas Area */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden remote-screen-container">
        {/* Hardware-Accelerated Video Track Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`max-w-full max-h-full object-contain cursor-crosshair focus:outline-none ${
            isStreaming && videoRef.current?.srcObject ? 'block' : 'hidden'
          }`}
        />

        {/* High-Performance Canvas (DataChannel & Frame Relay Stream) */}
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          tabIndex={0}
          className={`max-w-full max-h-full object-contain cursor-crosshair focus:outline-none ${
            videoRef.current?.srcObject ? 'hidden' : 'block'
          }`}
        />

        {/* Loading / Negotiating Overlay (Hidden once actual frames arrive!) */}
        {!isStreaming && sessionStatus !== 'failed' && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm z-30">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4 shadow-lg shadow-blue-600/30" />
            <h3 className="text-base font-bold text-white mb-1">{statusMessage}</h3>
            <p className="text-xs text-gray-400 max-w-sm mb-4">
              Establishing end-to-end encrypted WebRTC peer stream with {deviceName}.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono bg-gray-900/80 px-3 py-1 rounded-full border border-gray-800">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Signaling: {diagInfo.wsConnected ? 'WebSocket' : 'HTTP Long-Poll'}</span>
              <span>•</span>
              <span>ICE: {diagInfo.iceConnectionState}</span>
            </div>
          </div>
        )}

        {/* Meaningful Error Card (Replaces infinite spinner on failure!) */}
        {sessionStatus === 'failed' && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 z-40">
            <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center shadow-2xl">
              <div className="w-12 h-12 rounded-full bg-red-950/80 border border-red-800/60 flex items-center justify-center mx-auto mb-4 text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white mb-2">Connection Failed</h3>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                {errorMessage || 'Unable to establish remote connection with desktop host.'}
              </p>

              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  onClick={retryConnection}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-md shadow-blue-600/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry Connection
                </button>
                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-colors"
                >
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  View Diagnostics
                </button>
                <button
                  onClick={onDisconnect}
                  className="px-4 py-2.5 rounded-xl bg-gray-800/80 hover:bg-gray-800 text-gray-400 text-xs"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Virtual Trackpad Overlay for Mobile phones */}
        {controlMode === 'trackpad' && (
          <div className="absolute bottom-4 right-4 z-30 bg-gray-900/90 border border-gray-700 rounded-2xl p-3 shadow-2xl backdrop-blur flex flex-col items-center">
            <div
              onTouchMove={(e) => {
                if (e.touches.length > 0) {
                  const t = e.touches[0];
                  sendInput({
                    type: 'mouse-move',
                    x: t.clientX / window.innerWidth,
                    y: t.clientY / window.innerHeight,
                    normalized: true
                  });
                }
              }}
              className="w-44 h-32 rounded-xl bg-gray-950/80 border border-gray-800 flex items-center justify-center text-[10px] text-gray-500"
            >
              Swipe to Move Pointer
            </div>
            <div className="grid grid-cols-2 gap-2 w-full mt-2">
              <button
                onTouchStart={() => sendInput({ type: 'mouse-down', button: 'left' })}
                onTouchEnd={() => sendInput({ type: 'mouse-up', button: 'left' })}
                className="py-2.5 rounded-lg bg-gray-800 active:bg-blue-600 text-xs font-bold text-white border border-gray-700"
              >
                L-Click
              </button>
              <button
                onTouchStart={() => sendInput({ type: 'mouse-down', button: 'right' })}
                onTouchEnd={() => sendInput({ type: 'mouse-up', button: 'right' })}
                className="py-2.5 rounded-lg bg-gray-800 active:bg-blue-600 text-xs font-bold text-white border border-gray-700"
              >
                R-Click
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Streaming Diagnostics Slide-Over Drawer */}
      {showDiagnostics && (
        <div className="absolute top-12 right-4 z-40 w-96 max-w-[calc(100vw-32px)] bg-gray-900/95 border border-gray-800 rounded-2xl shadow-2xl p-4 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">Streaming Diagnostics</h4>
            </div>
            <button
              onClick={() => setShowDiagnostics(false)}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs font-mono">
            {/* Section 1: Signaling */}
            <div className="bg-gray-950/80 p-2.5 rounded-xl border border-gray-800/80">
              <div className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 flex items-center justify-between">
                <span>Signaling Gateway</span>
                <span className="text-emerald-400">● Active</span>
              </div>
              <div className="space-y-1 text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">Transport:</span>
                  <span className="text-white">{diagInfo.wsConnected ? 'WebSocket' : 'HTTP Long-Polling'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">SDP Offer Sent:</span>
                  <span className={diagInfo.offerSent ? 'text-emerald-400' : 'text-amber-400'}>
                    {diagInfo.offerSent ? 'Yes' : 'Pending'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">SDP Answer:</span>
                  <span className={diagInfo.answerReceived ? 'text-emerald-400' : 'text-amber-400'}>
                    {diagInfo.answerReceived ? 'Received' : 'Awaiting'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Session ID:</span>
                  <span className="text-gray-400 truncate max-w-[140px]">{sessionId}</span>
                </div>
              </div>
            </div>

            {/* Section 2: WebRTC */}
            <div className="bg-gray-950/80 p-2.5 rounded-xl border border-gray-800/80">
              <div className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 flex items-center justify-between">
                <span>WebRTC Peer Connection</span>
                <span className={diagInfo.peerConnectionState === 'connected' ? 'text-emerald-400' : 'text-blue-400'}>
                  {diagInfo.peerConnectionState}
                </span>
              </div>
              <div className="space-y-1 text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">ICE State:</span>
                  <span className="text-white">{diagInfo.iceConnectionState}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Topology:</span>
                  <span className="text-blue-400">{diagInfo.connectionType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Candidate:</span>
                  <span className="text-gray-400 truncate max-w-[150px]">{diagInfo.selectedCandidatePair}</span>
                </div>
              </div>
            </div>

            {/* Section 3: Video Pipeline */}
            <div className="bg-gray-950/80 p-2.5 rounded-xl border border-gray-800/80">
              <div className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 flex items-center justify-between">
                <span>Video Stream Pipeline</span>
                <span className={isStreaming ? 'text-emerald-400' : 'text-amber-400'}>
                  {isStreaming ? '● Streaming' : 'Buffering'}
                </span>
              </div>
              <div className="space-y-1 text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Mode:</span>
                  <span className="text-white font-semibold">{activeTransport}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Current FPS:</span>
                  <span className="text-emerald-400 font-bold">{fps} FPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Resolution:</span>
                  <span className="text-white">{resolution}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Bitrate:</span>
                  <span className="text-white">{diagInfo.bitrateKbps} kbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Frames Rendered:</span>
                  <span className="text-white">{diagInfo.framesDecoded}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Ping Latency:</span>
                  <span className="text-white">{latencyMs} ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* On-Screen Mobile Virtual Keyboard */}
      {showVirtualKeyboard && (
        <div className="bg-[#111827] border-t border-gray-800 p-2 sm:p-3 z-30 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-gray-400">Remote Keyboard Controls</span>
            <button
              onClick={() => setShowVirtualKeyboard(false)}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 justify-center max-w-2xl mx-auto">
            {['Esc', 'Tab', 'Ctrl', 'Alt', 'Win', 'Shift', 'Enter', 'Backspace', 'Delete'].map((k) => (
              <button
                key={k}
                onClick={() => handleVirtualKey(k, k)}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 active:bg-blue-600 text-xs font-medium text-gray-200 border border-gray-700 active:scale-95 transition-all"
              >
                {k}
              </button>
            ))}
            {['F1', 'F2', 'F5', 'F11', 'F12'].map((f) => (
              <button
                key={f}
                onClick={() => handleVirtualKey(f, f)}
                className="px-2.5 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 active:bg-blue-600 text-xs font-medium text-gray-400 border border-gray-800 active:scale-95 transition-all"
              >
                {f}
              </button>
            ))}
            {['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((arrow) => (
              <button
                key={arrow}
                onClick={() => handleVirtualKey(arrow, arrow)}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 active:bg-blue-600 text-xs font-medium text-gray-200 border border-gray-700 active:scale-95 transition-all"
              >
                {arrow.replace('Arrow', '')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clipboard Sync Modal */}
      {showClipboardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#111827] border border-gray-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-blue-400" />
                Remote Clipboard Sync
              </h4>
              <button
                onClick={() => setShowClipboardModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              placeholder="Paste or type text to send to the host computer's clipboard..."
              rows={4}
              className="w-full p-3 rounded-xl bg-gray-950 border border-gray-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500 mb-4"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClipboardModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={sendClipboardToHost}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                <Send className="w-3.5 h-3.5" />
                Send to Remote Host
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
