import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { api } from './services/api';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { DashboardPage } from './components/DashboardPage';
import { SessionsPage } from './components/SessionsPage';
import { SettingsPage } from './components/SettingsPage';
import { AuthPages } from './components/AuthPages';
import { PinModal } from './components/PinModal';
import { AddDeviceModal } from './components/AddDeviceModal';
import { DeviceDetailsModal } from './components/DeviceDetailsModal';
import { RemoteDesktopStudio } from './components/RemoteDesktopStudio';
import { WifiOff, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const { isAuthenticated, isLoading, authState, errorMessage, retrySession } = useAuth();

  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [selectedDeviceForPin, setSelectedDeviceForPin] = useState<any | null>(null);
  const [selectedDeviceForDetails, setSelectedDeviceForDetails] = useState<string | null>(null);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);

  // Active Remote Session state
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    deviceId: string;
    deviceName: string;
  } | null>(null);

  const handleConnectDevice = async (device: any) => {
    // If device has Trusted Mode enabled (default), connect in 1-CLICK without PIN prompt!
    if (device.trustedMode !== false) {
      setConnectingDeviceId(device.id);
      try {
        const res = await api.connectDevice(device.id);
        setActiveSession({
          sessionId: res.sessionId,
          sessionToken: res.sessionToken,
          deviceId: device.id,
          deviceName: device.deviceName
        });
        return;
      } catch (err: any) {
        console.warn('[Connect] Direct trusted connect prompt:', err);
        // Fallback to PIN prompt if PIN is required or trusted mode not accepted
        setSelectedDeviceForPin(device);
      } finally {
        setConnectingDeviceId(null);
      }
    } else {
      setSelectedDeviceForPin(device);
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

  // Network unavailable screen with retry button (does not log the user out)
  if (authState === 'network_unavailable') {
    return (
      <div className="min-h-screen bg-[#0a0d14] flex items-center justify-center px-4">
        <div className="max-w-md w-full p-8 rounded-2xl bg-gray-900 border border-gray-800 text-center shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <WifiOff className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Network Unavailable</h2>
          <p className="text-xs text-gray-400 mb-6">
            {errorMessage || 'Unable to connect to the RemoteHub server. Your session has been preserved.'}
          </p>
          <button
            onClick={() => retrySession()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </button>
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
          window.location.href = '/api/downloads/windows-agent';
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

      {/* PIN Verification Modal (Only displayed when trustedMode is disabled or PIN required) */}
      {selectedDeviceForPin && (
        <PinModal
          device={selectedDeviceForPin}
          onClose={() => setSelectedDeviceForPin(null)}
          onSuccess={(sessionId, sessionToken, deviceId, deviceName) => {
            setSelectedDeviceForPin(null);
            setActiveSession({ sessionId, sessionToken, deviceId, deviceName });
          }}
        />
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
