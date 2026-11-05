import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Terminal, Laptop, ShieldCheck, RefreshCw, AlertCircle, FileText } from 'lucide-react';
import { api, getAgentDownloadUrl, getAgentTxtDownloadUrl, DIRECT_GITHUB_AGENT_DOWNLOAD_URL } from '../services/api';

interface AddDeviceModalProps {
  onClose: () => void;
  onDeviceAdded?: () => void;
}

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({ onClose, onDeviceAdded }) => {
  const [selectedOs, setSelectedOs] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadingCode, setLoadingCode] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const fetchPairingCode = async () => {
    setLoadingCode(true);
    try {
      const res = await api.generatePairingCode();
      setPairingCode(res.pairingCode);
      setExpiresAt(res.expiresAt);
      setTimeLeft(Math.floor((res.expiresAt - Date.now()) / 1000));
    } catch (err) {
      console.error('Failed to generate pairing code', err);
    } finally {
      setLoadingCode(false);
    }
  };

  useEffect(() => {
    fetchPairingCode();
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const copyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#111827] border border-gray-800 p-6 shadow-2xl shadow-blue-950/40 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5 text-blue-400 mb-1">
            <Laptop className="w-5 h-5" />
            <h3 className="text-xl font-bold text-white tracking-tight">Add a Computer</h3>
          </div>
          <p className="text-xs text-gray-400">
            Pair your computer to your RemoteHub account in three simple steps.
          </p>
        </div>

        {/* Step 1: Select OS */}
        <div className="mb-6">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">
            Step 1: Choose Operating System
          </label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setSelectedOs('windows')}
              className={`p-3 rounded-xl border text-center transition-all ${
                selectedOs === 'windows'
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-gray-800 bg-gray-900/60 text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className="text-sm font-bold">Windows</div>
              <div className="text-[10px] text-blue-400 mt-0.5">Win 10 & 11</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedOs('macos')}
              className={`p-3 rounded-xl border text-center transition-all ${
                selectedOs === 'macos'
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-gray-800 bg-gray-900/60 text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className="text-sm font-bold">macOS</div>
              <div className="text-[10px] text-gray-500 mt-0.5">CLI Agent</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedOs('linux')}
              className={`p-3 rounded-xl border text-center transition-all ${
                selectedOs === 'linux'
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-gray-800 bg-gray-900/60 text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className="text-sm font-bold">Linux</div>
              <div className="text-[10px] text-gray-500 mt-0.5">Headless / X11</div>
            </button>
          </div>
        </div>

        {/* Step 2: Download Agent */}
        <div className="mb-6 p-4 rounded-xl bg-gray-900/60 border border-gray-800">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">
            Step 2: Download & Run Agent
          </label>

          {selectedOs === 'windows' ? (
            <div>
              <p className="text-xs text-gray-300 mb-3">
                Download the lightweight Windows desktop agent. It runs natively in your Windows system tray.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={getAgentDownloadUrl()}
                  download="RemoteHubAgent.exe"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
                >
                  <Download className="w-4 h-4" />
                  Download RemoteHubAgent.exe
                </a>

                <a
                  href={DIRECT_GITHUB_AGENT_DOWNLOAD_URL}
                  download="RemoteHubAgent.exe"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-xs transition-colors"
                  title="Direct GitHub CDN Mirror"
                >
                  <Download className="w-3.5 h-3.5" />
                  GitHub Direct Mirror
                </a>

                <a
                  href={getAgentTxtDownloadUrl()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-xs transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  SHA-256 Checksum
                </a>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              <div className="flex items-center gap-1.5 text-amber-400 mb-1 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Preview Runtime
              </div>
              Cross-platform daemon available via Node/Python protocol runner. Windows is the primary certified desktop agent in this release.
            </div>
          )}
        </div>

        {/* Step 3: Pairing Code */}
        <div className="mb-6 p-4 rounded-xl bg-gradient-to-b from-blue-950/20 to-gray-900/60 border border-blue-500/30">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-blue-400">
              Step 3: Enter Pairing Code in Agent
            </label>
            <button
              onClick={fetchPairingCode}
              disabled={loadingCode}
              title="Generate New Code"
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCode ? 'animate-spin' : ''}`} />
              New Code
            </button>
          </div>

          <p className="text-xs text-gray-400 mb-3">
            Open the agent setup dialog on the target computer and enter this temporary pairing code:
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1 py-3 px-4 bg-gray-950 rounded-xl border border-blue-500/40 text-center font-mono text-3xl font-extrabold tracking-[0.25em] text-white">
              {pairingCode || '------'}
            </div>
            <button
              onClick={copyCode}
              className="p-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 active:scale-95 transition-all"
              title="Copy code"
            >
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400 mt-2 px-1">
            <span>Valid for single use</span>
            <span>
              Expires in {Math.floor(timeLeft / 60)}m {timeLeft % 60}s
            </span>
          </div>
        </div>

        {/* Instructions summary */}
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>
            During pairing, set your computer's 6–8 digit permanent access PIN. That PIN will be required whenever you connect from your phone or browser.
          </span>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-xs transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};

