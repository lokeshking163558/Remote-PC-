import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { api, getBackendUrl, DIRECT_GITHUB_AGENT_DOWNLOAD_URL, testBackendHealth, DEFAULT_BACKEND_URL } from './services/api';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { DashboardPage } from './components/DashboardPage';
import { SessionsPage } from './components/SessionsPage';
import { SettingsPage } from './components/SettingsPage';
import { AuthPages } from './components/AuthPages';
import { PinModal } from './components/PinModal';
import { PinSetupModal } from './components/PinSetupModal';
import { AddDeviceModal } from './components/AddDeviceModal';
import { DeviceDetailsModal } from './components/DeviceDetailsModal';
import { RemoteDesktopStudio } from './components/RemoteDesktopStudio';
import { WifiOff, RefreshCw, LogIn, Server, RotateCcw, Activity, CheckCircle2, AlertTriangle, Download } from 'lucide-react';

export const App: React.FC = () => {
  const {
    isAuthenticated,
    isLoading,
    authState,
    errorMessage,
    retrySession,
    resetSessionAndSignIn,
    resetServerToDefault
  } = useAuth();

  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [selectedDeviceForPin, setSelectedDeviceForPin] = useState<any | null>(null);
  const [pinSetupDevice, setPinSetupDevice] = useState<any | null>(null);
  const [selectedDeviceForDetails, setSelectedDeviceForDetails] = useState<string | null>(null);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Network screen state
  const [isRetrying, setIsRetrying] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    tested: boolean;
    ok?: boolean;
    target?: string;
    latency?: number;
    error?: string;
  } | null>(null);

  // Active Remote Session state
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    deviceId: string;
    deviceName: string;
    approvalRequired?: boolean;
  } | null>(null);

  const handleConnectDevice = async (device: any) => {
    setConnectError(null);
    const method = device.accessMethod || 'approval';

    // Access Method 1: Ask for approval on laptop (Recommended & Default)
    // Never show a PIN prompt! The owner approves from the laptop desktop notification.
    if (method === 'approval') {
      setConnectingDeviceId(device.id);
      try {
        const res = await api.connectDevice(device.id);
        setActiveSession({
          sessionId: res.sessionId,
          sessionToken: res.sessionToken,
          deviceId: device.id,
          deviceName: device.deviceName,
          approvalRequired: res.approvalRequired ?? true
        });
      } catch (err: any) {
        console.error('[Connect] Approval session request error:', err);
        setConnectError(err.message || `Unable to reach ${device.deviceName}. Ensure the desktop agent is running.`);
      } finally {
        setConnectingDeviceId(null);
      }
    } else if (method === 'pin') {
      // Access Method 2: Permanent PIN
      if (!device.hasPin) {
        // No PIN configured yet -> provide explicit PIN setup screen
        setPinSetupDevice(device);
      } else {
        // PIN exists -> show PIN entry modal
        setSelectedDeviceForPin(device);
      }
    } else {
      // Access Method 3: Trusted Mode (1-Click)
      setConnectingDeviceId(device.id);
      try {
        const res = await api.connectDevice(device.id);
        setActiveSession({
          sessionId: res.sessionId,
          sessionToken: res.sessionToken,
          deviceId: device.id,
          deviceName: device.deviceName,
          approvalRequired: false
        });
      } catch (err: any) {
        setConnectError(err.message || `Unable to connect to ${device.deviceName}`);
      } finally {
        setConnectingDeviceId(null);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0d14] flex items-center justify-center text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-mono">Restoring RemoteHub Session...</p>
        </div>
      </div>
    );
  }

  // Network unavailable screen with self-healing, clear-session, and diagnostic options
  if (authState === 'network_unavailable') {
    const handleRunDiag = async () => {
      setDiagResult({ tested: true, latency: undefined });
      const res = await testBackendHealth();
      setDiagResult({
        tested: true,
        ok: res.ok,
        target: res.target,
        latency: res.latency,
        error: res.error
      });
    };

    const handleRetry = async () => {
      setIsRetrying(true);
      try {
        await retrySession();
      } finally {
        setIsRetrying(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#0a0d14] flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full p-6 sm:p-8 rounded-2xl bg-[#0e1424] border border-gray-800 text-center shadow-2xl relative overflow-hidden">
          {/* Subtle top indicator bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />

          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold text-white mb-1.5">Network Unavailable</h2>
          <p className="text-xs text-gray-400 mb-5 leading-relaxed">
            {errorMessage || 'Unable to connect to the authentication server. Your session is safely preserved.'}
          </p>

          <div className="mb-5 p-3 rounded-xl bg-gray-950/80 border border-gray-800 text-left font-mono text-[11px] text-gray-400 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Gateway:</span>
              <span className="text-blue-400 truncate max-w-[200px]">{getBackendUrl()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Browser Online:</span>
              <span className={navigator.onLine ? 'text-emerald-400' : 'text-rose-400'}>
                {navigator.onLine ? 'Connected (Online)' : 'Offline'}
              </span>
            </div>
            {diagResult?.tested && (
              <div className="pt-1 mt-1 border-t border-gray-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Health Probe:</span>
                  <span className={diagResult.ok ? 'text-emerald-400' : 'text-rose-400'}>
                    {diagResult.ok ? `OK (${diagResult.latency}ms)` : `Failed (${diagResult.error || 'No response'})`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="space-y-2.5">
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? 'Verifying Gateway...' : 'Retry Connection'}
            </button>

            <button
              onClick={resetSessionAndSignIn}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs transition-colors border border-gray-700"
            >
              <LogIn className="w-4 h-4 text-gray-400" />
              Sign In with Another Account
            </button>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={resetServerToDefault}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[11px] font-medium transition-colors border border-gray-800"
                title="Reset backend endpoint to official production gateway"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Server URL
              </button>

              <button
                onClick={handleRunDiag}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[11px] font-medium transition-colors border border-gray-800"
                title="Run real-time latency and connectivity diagnostics"
              >
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                Test Health
              </button>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-500">
            <span>Windows Desktop Agent:</span>
            <a
              href={DIRECT_GITHUB_AGENT_DOWNLOAD_URL}
              download="RemoteHubAgent.exe"
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              Direct CDN (173MB)
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Active full-screen remote desktop session
  if (activeSession) {
    return (
      <RemoteDesktopStudio
        sessionId={activeSession.sessionId}
        sessionToken={activeSession.sessionToken}
        deviceId={activeSession.deviceId}
        deviceName={activeSession.deviceName}
        approvalRequired={activeSession.approvalRequired}
        onDisconnect={() => setActiveSession(null)}
      />
    );
  }

  // Unauthenticated views
  if (!isAuthenticated) {
    if (currentView === 'login') {
      return (
        <AuthPages
          initialMode="login"
          onSuccess={() => setCurrentView('dashboard')}
          onSwitchToLanding={() => setCurrentView('landing')}
        />
      );
    }
    if (currentView === 'register') {
      return (
        <AuthPages
          initialMode="register"
          onSuccess={() => setCurrentView('dashboard')}
          onSwitchToLanding={() => setCurrentView('landing')}
        />
      );
    }
    return (
      <LandingPage
        onGetStarted={() => setCurrentView('register')}
        onLogin={() => setCurrentView('login')}
        onDownloadAgent={() => {
          window.location.href = DIRECT_GITHUB_AGENT_DOWNLOAD_URL;
        }}
      />
    );
  }

  // Authenticated views
  return (
    <div className="min-h-screen bg-[#0a0d14] flex flex-col">
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        onAddDevice={() => setShowAddDevice(true)}
      />

      <main className="flex-1">
        {currentView === 'dashboard' && (
          <DashboardPage
            onConnectDevice={handleConnectDevice}
            onOpenDetails={(deviceId) => setSelectedDeviceForDetails(deviceId)}
            onAddDevice={() => setShowAddDevice(true)}
            connectingDeviceId={connectingDeviceId}
          />
        )}

        {currentView === 'sessions' && <SessionsPage />}

        {currentView === 'settings' && <SettingsPage />}
      </main>

      {/* PIN Verification Modal */}
      {selectedDeviceForPin && (
        <PinModal
          device={selectedDeviceForPin}
          onClose={() => setSelectedDeviceForPin(null)}
          onSuccess={(sessionId, sessionToken, deviceId, deviceName) => {
            setSelectedDeviceForPin(null);
            setActiveSession({ sessionId, sessionToken, deviceId, deviceName });
          }}
          onSwitchToApprovalMode={async () => {
            const dev = selectedDeviceForPin;
            setSelectedDeviceForPin(null);
            try {
              await api.updateAccessMethod(dev.id, 'approval');
              handleConnectDevice({ ...dev, accessMethod: 'approval' });
            } catch {}
          }}
        />
      )}

      {/* First-time PIN Setup Modal */}
      {pinSetupDevice && (
        <PinSetupModal
          device={pinSetupDevice}
          onClose={() => setPinSetupDevice(null)}
          onSuccess={(newPin) => {
            const dev = pinSetupDevice;
            setPinSetupDevice(null);
            handleConnectDevice({ ...dev, accessMethod: 'pin', hasPin: true });
          }}
          onSwitchToApprovalMode={async () => {
            const dev = pinSetupDevice;
            setPinSetupDevice(null);
            try {
              await api.updateAccessMethod(dev.id, 'approval');
              handleConnectDevice({ ...dev, accessMethod: 'approval' });
            } catch {}
          }}
        />
      )}

      {/* Meaningful Connection Error Toast/Modal */}
      {connectError && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md w-full bg-red-950/90 border border-red-800 text-white rounded-2xl p-4 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom duration-200">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h4 className="text-sm font-bold text-red-200">Connection Failed</h4>
                <p className="text-xs text-red-300 mt-1 leading-relaxed">{connectError}</p>
              </div>
            </div>
            <button
              onClick={() => setConnectError(null)}
              className="text-red-300 hover:text-white p-1 rounded-lg hover:bg-red-900/50"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Add Device Wizard Modal */}
      {showAddDevice && (
        <AddDeviceModal
          onClose={() => setShowAddDevice(false)}
        />
      )}

      {/* Device Details Telemetry Modal */}
      {selectedDeviceForDetails && (
        <DeviceDetailsModal
          deviceId={selectedDeviceForDetails}
          onClose={() => setSelectedDeviceForDetails(null)}
        />
      )}
    </div>
  );
};
