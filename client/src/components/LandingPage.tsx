import React from 'react';
import {
  Monitor,
  Shield,
  Zap,
  Lock,
  Smartphone,
  Download,
  Wifi,
  Radio,
  ArrowRight,
  CheckCircle,
  EyeOff,
  Cpu
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
  onDownloadAgent: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onLogin, onDownloadAgent }) => {
  return (
    <div className="min-h-screen bg-[#0a0d14] text-gray-100 overflow-hidden">
      {/* Glow background accents */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-600/10 blur-[130px] pointer-events-none -z-10" />

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs sm:text-sm font-medium mb-6 animate-pulse">
          <Zap className="w-4 h-4 text-blue-400" />
          <span>Production-Grade Personal Remote Desktop</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.1] mb-6">
          Your computers. <br className="hidden sm:inline" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-400">
            Anywhere. Anytime.
          </span>
        </h1>

        <p className="max-w-2xl mx-auto text-base sm:text-lg text-gray-400 mb-10 leading-relaxed">
          Access and control your Windows PCs and laptops across the internet directly from any browser.
          No mobile app installation. Zero browser pairing. Protected with permanent device PINs.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-all shadow-lg shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
          >
            Launch Web App
            <ArrowRight className="w-4 h-4" />
          </button>

          <a
            href="/api/downloads/windows-agent"
            download="RemoteHubAgent.exe"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-200 font-semibold text-base transition-all hover:scale-[1.02] active:scale-95"
          >
            <Download className="w-4 h-4 text-blue-400" />
            Download Windows Agent
          </a>
        </div>

        {/* Live System Architecture Interactive Visual */}
        <div className="relative mx-auto max-w-4xl rounded-2xl border border-gray-800 bg-[#0d1322] p-4 sm:p-6 shadow-2xl shadow-blue-950/40">
          <div className="flex items-center justify-between border-b border-gray-800/80 pb-4 mb-6">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-green-500/80 inline-block" />
              <span className="text-xs text-gray-400 ml-2 font-mono">remotehub-engine :: realtime-p2p</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Live WebRTC Ready
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800/80">
              <div className="flex items-center gap-2 text-blue-400 text-xs font-semibold mb-2">
                <Smartphone className="w-4 h-4" />
                1. ANY DEVICE BROWSER
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Phone, Tablet, or PC</h4>
              <p className="text-xs text-gray-400">
                Open RemoteHub in Chrome, Safari, or Edge. No native mobile app install needed.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800/80">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold mb-2">
                <Lock className="w-4 h-4" />
                2. PERMANENT DEVICE PIN
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Argon2id Verification</h4>
              <p className="text-xs text-gray-400">
                Enter the computer's 6-digit access PIN. Protected against brute-force with automatic progressive lockouts.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800/80">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold mb-2">
                <Monitor className="w-4 h-4" />
                3. NATIVE DESKTOP CONTROL
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Real Windows Screen & Input</h4>
              <p className="text-xs text-gray-400">
                Real-time 60 FPS screen capture and Win32 SendInput mouse, keyboard, and touch synthesis.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Genuine Features Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-gray-800/60">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Engineered for Everyday Remote Access
          </h2>
          <p className="text-sm sm:text-base text-gray-400">
            Everything you need to control your workstation or home PC from coffee shops, commuting, or travel.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <Radio className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">True Internet Traversal</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Works across different Wi-Fi networks, cellular LTE/5G, and NAT firewalls using WebRTC STUN/TURN relays.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Hardware-Backed Security</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              PIN belongs to the computer, not the phone. Active sessions display a visible floating indicator on the laptop with an emergency kill switch.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Mobile Touch & Trackpad</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Switch between natural touch gestures and a precision virtual trackpad with on-screen keyboard shortcuts on mobile phones.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-yellow-500/10 text-yellow-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Wake-on-LAN Integration</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Send standard magic broadcast packets to wake sleeping computers on demand directly from your dashboard.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Live Hardware Telemetry</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Inspect real-time CPU, RAM, disk storage, battery percentage, network IP and connection latency without connecting.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#0e1424] border border-gray-800/80 hover:border-blue-500/30 transition-all group">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
              <EyeOff className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">No Invisible Spyware</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Built strictly for personal use. Host user is always alerted during remote control and can terminate access instantly with 1-click.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Footer */}
      <div className="border-t border-gray-800 py-12 bg-[#0d121f]">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">
            Ready to control your computers anywhere?
          </h3>
          <p className="text-sm text-gray-400 mb-6">
            Install the lightweight agent in seconds and start accessing your desktop from your phone.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onGetStarted}
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all shadow-md shadow-blue-600/20"
            >
              Create Free Account
            </button>
            <button
              onClick={onLogin}
              className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-sm transition-all"
            >
              Sign In to Existing Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

