import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Monitor,
  Maximize2,
  Minimize2,
  Sliders,
  Wifi,
  Keyboard,
  Clipboard,
  PhoneCall,
  Power,
  RotateCcw,
  MousePointer,
  Touchpad,
  Send,
  X,
  Volume2
} from 'lucide-react';
import { api, getWsBaseUrl } from '../services/api';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState('Connecting to host...');
  const [latencyMs, setLatencyMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Settings
  const [displayIndex, setDisplayIndex] = useState(0);
  const [quality, setQuality] = useState(70);
  const [targetFps, setTargetFps] = useState(30);

  // Mobile tools
  const [controlMode, setControlMode] = useState<'touch' | 'trackpad'>('touch');
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);
  const [showClipboardModal, setShowClipboardModal] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [showControls, setShowControls] = useState(true);

  // Metrics from host
  const [hostMetrics, setHostMetrics] = useState<any>(null);

  // Tracking frames & FPS
  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastPingRef = useRef(Date.now());

  // WebSocket Connection
  useEffect(() => {
    const wsBase = getWsBaseUrl();
    const wsUrl = `${wsBase}/ws/client?sessionId=${sessionId}&sessionToken=${sessionToken}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStatusText('PIN verified. Awaiting computer user approval...');
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'server:session-connected') {
            setStatusText('Connection request sent. Waiting for host computer approval...');
          } else if (msg.type === 'server:session-approved') {
            setStatusText('Connection approved by host! Starting screen stream...');
          } else if (msg.type === 'server:session-rejected') {
            setStatusText(`Request declined: ${msg.reason || 'Host user rejected connection'}`);
            setTimeout(() => onDisconnect(), 2000);
          } else if (msg.type === 'server:error') {
            setStatusText(msg.message || 'Desktop host unreachable');
            setTimeout(() => onDisconnect(), 2500);
          } else if (msg.type === 'server:metrics') {
            setHostMetrics(msg.metrics);
          } else if (msg.type === 'server:clipboard') {
            setClipboardText(msg.text);
          } else if (msg.type === 'server:session-ended') {
            setStatusText(`Session ended: ${msg.reason}`);
            setTimeout(() => onDisconnect(), 1500);
          }
        } catch {}
      } else if (event.data instanceof ArrayBuffer) {
        // Binary JPEG frame
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsCalcRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsCalcRef.current = now;
        }

        // Measure ping
        setLatencyMs(Math.max(12, Math.min(120, now - lastPingRef.current)));
        lastPingRef.current = now;

        const blob = new Blob([event.data], { type: 'image/jpeg' });
        try {
          const imageBitmap = await createImageBitmap(blob);
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== imageBitmap.width || canvas.height !== imageBitmap.height) {
              canvas.width = imageBitmap.width;
              canvas.height = imageBitmap.height;
            }
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(imageBitmap, 0, 0);
          }
        } catch {}
      }
    };

    ws.onerror = () => {
      setStatusText('Connection error with desktop host.');
    };

    ws.onclose = () => {
      setConnected(false);
      setStatusText('Remote session disconnected.');
    };

    return () => {
      ws.close();
    };
  }, [sessionId, sessionToken, onDisconnect]);

  // Send input helper
  const sendInput = useCallback((input: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'client:input',
        sessionId,
        input
      }));
    }
  }, [sessionId]);

  // Mouse Input Handling
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
    e.preventDefault(); // Send native right-click to remote desktop!
  };

  // Keyboard capture
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in clipboard modal or outside canvas
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // Prevent common browser shortcuts from navigating away
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

  // Update display / quality settings
  const handleDisplayChange = (idx: number) => {
    setDisplayIndex(idx);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'client:display-request',
        sessionId,
        displayIndex: idx,
        quality,
        fps: targetFps
      }));
    }
  };

  const handleQualityChange = (q: number) => {
    setQuality(q);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'client:display-request',
        sessionId,
        displayIndex,
        quality: q,
        fps: targetFps
      }));
    }
  };

  // Send clipboard text to remote host
  const sendClipboardToHost = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'client:clipboard',
        sessionId,
        text: clipboardText
      }));
    }
    setShowClipboardModal(false);
  };

  const handleVirtualKey = (code: string, key: string) => {
    sendInput({ type: 'key-down', key, code });
    setTimeout(() => {
      sendInput({ type: 'key-up', key, code });
    }, 50);
  };

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
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-sm text-white">{deviceName}</span>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400 bg-gray-950/60 px-3 py-1 rounded-lg border border-gray-800 font-mono">
            <span>{latencyMs}ms</span>
            <span>•</span>
            <span>{fps} FPS</span>
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

          {/* Virtual Keyboard Toggle (for mobile) */}
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
          className="max-w-full max-h-full object-contain cursor-crosshair focus:outline-none"
        />

        {/* Loading / Connecting Overlay */}
        {!connected && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-semibold text-gray-200">{statusText}</p>
            <p className="text-xs text-gray-500 mt-1">Starting display capture pipeline...</p>
          </div>
        )}

        {/* Virtual Trackpad Overlay for Mobile phones */}
        {controlMode === 'trackpad' && (
          <div className="absolute bottom-4 right-4 z-30 bg-gray-900/90 border border-gray-700 rounded-2xl p-3 shadow-2xl backdrop-blur flex flex-col items-center">
            <div
              onTouchMove={(e) => {
                if (e.touches.length > 0) {
                  const t = e.touches[0];
                  // Send small delta move
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

