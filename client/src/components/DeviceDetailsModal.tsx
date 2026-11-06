import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  HardDrive,
  Battery,
  Wifi,
  Activity,
  Zap,
  KeyRound,
  History,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { api } from '../services/api';

interface DeviceDetailsModalProps {
  deviceId: string;
  onClose: () => void;
  onDeviceUpdated?: () => void;
}

export const DeviceDetailsModal: React.FC<DeviceDetailsModalProps> = ({ deviceId, onClose, onDeviceUpdated }) => {
  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'metrics' | 'wake' | 'pin' | 'history'>('metrics');

  // Change PIN states
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinStatus, setPinStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [changingPin, setChangingPin] = useState(false);

  // Wake on LAN states
  const [waking, setWaking] = useState(false);
  const [wakeResult, setWakeResult] = useState<any>(null);

  const fetchDetails = async () => {
    try {
      const res = await api.getDevice(deviceId);
      setDevice(res.device);
    } catch (err) {
      console.error('Failed to load device details', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [deviceId]);

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 6 || newPin.length > 8) {
      setPinStatus({ success: false, message: 'New PIN must be 6 to 8 digits' });
      return;
    }

    setChangingPin(true);
    setPinStatus(null);

    try {
      const res = await api.changePin(deviceId, {
        currentPin: currentPin || undefined,
        newPin
      });
      setPinStatus({ success: true, message: res.message });
      setCurrentPin('');
      setNewPin('');
      if (onDeviceUpdated) onDeviceUpdated();
    } catch (err: any) {
      setPinStatus({ success: false, message: err.message || 'Failed to update PIN' });
    } finally {
      setChangingPin(false);
    }
  };

  const handleWake = async () => {
    setWaking(true);
    setWakeResult(null);

    try {
      const res = await api.wakeDevice(deviceId);
      setWakeResult(res);
    } catch (err: any) {
      setWakeResult({ success: false, error: err.message });
    } finally {
      setWaking(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <div className="p-8 rounded-2xl bg-[#111827] border border-gray-800 flex items-center gap-3 text-gray-300">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <span>Loading telemetry...</span>
        </div>
      </div>
    );
  }

  if (!device) return null;

  const metrics = device.latestMetrics;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#111827] border border-gray-800 p-6 shadow-2xl shadow-blue-950/40 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Device Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-lg">
            {device.os.includes('Win') ? '🪟' : '💻'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold text-white tracking-tight">{device.deviceName}</h3>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  device.onlineStatus
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-gray-800 text-gray-400 border border-gray-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${device.onlineStatus ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                {device.onlineStatus ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {device.os} • Agent v{device.agentVersion} • MAC: {device.macAddress || 'Unavailable'}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 border-b border-gray-800 pb-3 mb-6">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'metrics'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Hardware Telemetry
          </button>
          <button
            onClick={() => setActiveTab('wake')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'wake'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Wake-on-LAN
          </button>
          <button
            onClick={() => setActiveTab('pin')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'pin'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Access Method & PIN
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Session History
          </button>
        </div>

        {/* Tab 1: Hardware Telemetry */}
        {activeTab === 'metrics' && (
          <div className="space-y-4">
            {metrics ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs text-blue-400 font-medium mb-1">
                    <Cpu className="w-4 h-4" />
                    CPU Usage
                  </div>
                  <div className="text-xl font-bold text-white font-mono">{metrics.cpu_usage}%</div>
                  <div className="w-full bg-gray-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.cpu_usage)}%` }}
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium mb-1">
                    <Activity className="w-4 h-4" />
                    RAM Usage
                  </div>
                  <div className="text-xl font-bold text-white font-mono">{metrics.memory_usage}%</div>
                  <div className="w-full bg-gray-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.memory_usage)}%` }}
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium mb-1">
                    <HardDrive className="w-4 h-4" />
                    Disk Capacity
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {metrics.storage_usage ? `${metrics.storage_usage}%` : 'N/A'}
                  </div>
                  <div className="w-full bg-gray-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, metrics.storage_usage || 0)}%` }}
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
                    <Battery className="w-4 h-4" />
                    Battery
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {metrics.battery_percent !== null && metrics.battery_percent !== undefined
                      ? `${metrics.battery_percent}%`
                      : 'AC Power'}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {metrics.is_charging ? '⚡ Plugged In' : 'On Battery'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500 border border-dashed border-gray-800 rounded-xl">
                No metrics collected yet. Device will stream metrics automatically while connected.
              </div>
            )}

            <div className="p-4 rounded-xl bg-gray-900/40 border border-gray-800 text-xs space-y-2">
              <div className="flex justify-between py-1 border-b border-gray-800/60">
                <span className="text-gray-400">Local Network IP</span>
                <span className="font-mono text-gray-200">{device.localIp || 'Unavailable'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-800/60">
                <span className="text-gray-400">Physical MAC Address</span>
                <span className="font-mono text-gray-200">{device.macAddress || 'Unavailable'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-800/60">
                <span className="text-gray-400">Registered At</span>
                <span className="text-gray-200">{new Date(device.registeredAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-400">Last Online Heartbeat</span>
                <span className="text-gray-200">{new Date(device.lastSeen).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Wake-on-LAN */}
        {activeTab === 'wake' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30">
              <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-blue-400" />
                Remote Wake-on-LAN Magic Packet
              </h4>
              <p className="text-xs text-gray-400 leading-relaxed mb-4">
                Wake-on-LAN broadcasts an industry-standard UDP magic packet to wake sleeping or hibernating computers.
              </p>

              <button
                onClick={handleWake}
                disabled={waking}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
              >
                {waking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Send Wake Magic Packet
              </button>
            </div>

            {wakeResult && (
              <div
                className={`p-4 rounded-xl border text-xs ${
                  wakeResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/20 text-red-300'
                }`}
              >
                <div className="font-semibold mb-1">
                  {wakeResult.success ? '✓ Magic Packet Dispatched' : '✗ Wake Request Notice'}
                </div>
                <p>{wakeResult.message || wakeResult.error}</p>
                {wakeResult.limitations && (
                  <ul className="list-disc pl-4 mt-2 space-y-1 text-gray-400">
                    {wakeResult.limitations.map((item: string, i: number) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Access Method & Security */}
        {activeTab === 'pin' && (
          <div className="space-y-6">
            {/* Access Method Selection */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">
                Connection Access Method
              </label>
              <div className="space-y-2">
                {/* Method 1: Host Approval */}
                <div
                  onClick={async () => {
                    await api.updateAccessMethod(deviceId, 'approval');
                    fetchDetails();
                    onDeviceUpdated?.();
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    (device.accessMethod === 'approval' || !device.accessMethod)
                      ? 'bg-blue-600/10 border-blue-500 text-white'
                      : 'bg-gray-900/40 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        checked={device.accessMethod === 'approval' || !device.accessMethod}
                        onChange={() => {}}
                        className="text-blue-500"
                      />
                      <span className="text-xs font-bold text-white">Ask for approval on laptop (Recommended)</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Default
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 ml-6 leading-relaxed">
                    Connecting requires clicking "Allow" on the laptop screen. No permanent PIN is required or stored.
                  </p>
                </div>

                {/* Method 2: Permanent PIN */}
                <div
                  onClick={async () => {
                    await api.updateAccessMethod(deviceId, 'pin');
                    fetchDetails();
                    onDeviceUpdated?.();
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    device.accessMethod === 'pin'
                      ? 'bg-blue-600/10 border-blue-500 text-white'
                      : 'bg-gray-900/40 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      checked={device.accessMethod === 'pin'}
                      onChange={() => {}}
                      className="text-blue-500"
                    />
                    <span className="text-xs font-bold text-white">Permanent Access PIN</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 ml-6 leading-relaxed">
                    Connect securely using a secret 6–8 digit PIN. Ideal for unattended or remote-only access.
                  </p>
                </div>

                {/* Method 3: Trusted Browser Sessions */}
                <div
                  onClick={async () => {
                    await api.updateAccessMethod(deviceId, 'trusted');
                    fetchDetails();
                    onDeviceUpdated?.();
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    device.accessMethod === 'trusted'
                      ? 'bg-blue-600/10 border-blue-500 text-white'
                      : 'bg-gray-900/40 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      checked={device.accessMethod === 'trusted'}
                      onChange={() => {}}
                      className="text-blue-500"
                    />
                    <span className="text-xs font-bold text-white">Trusted browser sessions (1-Click)</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 ml-6 leading-relaxed">
                    Instant 1-click connect from authenticated browser sessions of the registered account owner.
                  </p>
                </div>
              </div>
            </div>

            {/* PIN Configuration Form */}
            <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800">
              <h4 className="text-xs font-bold text-white mb-2">Configure / Update Permanent PIN</h4>
              <p className="text-xs text-gray-400 mb-4">
                {device.hasPin || device.pinConfigured
                  ? 'A PIN is currently configured on this device. You can update it below.'
                  : 'No PIN is currently configured. Enter a new PIN below if using PIN mode.'}
              </p>

              {pinStatus && (
                <div
                  className={`p-3 mb-4 rounded-xl border text-xs font-medium ${
                    pinStatus.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                  }`}
                >
                  {pinStatus.message}
                </div>
              )}

              <form onSubmit={handleChangePin} className="space-y-3">
                {(device.hasPin || device.pinConfigured) && (
                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1">Current PIN</label>
                    <input
                      type="password"
                      value={currentPin}
                      onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="Enter existing PIN"
                      className="w-full py-2 px-3 rounded-xl bg-gray-900 border border-gray-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">New PIN (6–8 Digits)</label>
                  <input
                    type="password"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    maxLength={8}
                    placeholder="Enter 6-8 digit PIN"
                    className="w-full py-2 px-3 rounded-xl bg-gray-900 border border-gray-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={changingPin || newPin.length < 6}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
                  >
                    {changingPin ? 'Saving...' : 'Save PIN'}
                  </button>
                  <span className="text-[11px] text-gray-500">
                    Forgot PIN? Reset directly on your host laptop via the desktop agent.
                  </span>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: Session History */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {device.recentSessions && device.recentSessions.length > 0 ? (
              <div className="divide-y divide-gray-800 text-xs">
                {device.recentSessions.map((s: any) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-200">
                        Remote Session ({s.connection_type})
                      </div>
                      <div className="text-gray-500">
                        Client IP: {s.client_ip || 'Unknown'} • {new Date(s.started_at).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        s.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 text-center py-6">No previous sessions recorded.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

