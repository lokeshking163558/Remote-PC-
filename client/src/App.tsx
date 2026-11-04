import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
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

export const App: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [selectedDeviceForPin, setSelectedDeviceForPin] = useState<any | null>(null);
  const [selectedDeviceForDetails, setSelectedDeviceForDetails] = useState<string | null>(null);

  // Active Remote Session state
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    deviceId: string;
    deviceName: string;
  } | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0d14] flex items-center justify-center text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-mono">Initializing RemoteHub Platform...</p>
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
            onConnectDevice={(device) => setSelectedDeviceForPin(device)}
            onOpenDetails={(deviceId) => setSelectedDeviceForDetails(deviceId)}
            onAddDevice={() => setShowAddDevice(true)}
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

