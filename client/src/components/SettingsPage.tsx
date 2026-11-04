import React, { useState } from 'react';
import { User, Shield, Lock, Key, Check, AlertCircle, LogOut, Server } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, getBackendUrl, setCustomBackendUrl } from '../services/api';

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Backend URL configuration
  const [backendUrlInput, setBackendUrlInput] = useState(getBackendUrl());
  const [backendSaved, setBackendSaved] = useState(false);

  const handleSaveBackendUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomBackendUrl(backendUrlInput);
    setBackendSaved(true);
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus({ success: false, message: 'New passwords do not match' });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({ success: false, message: 'Password must be at least 8 characters long' });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const res = await api.changePassword({ currentPassword, newPassword });
      setStatus({ success: true, message: res.message });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setStatus({ success: false, message: err.message || 'Failed to update password' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white tracking-tight">Account & Security Settings</h2>
        <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
          Manage your personal account profile, authentication, and security preferences.
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Card */}
        <div className="rounded-2xl bg-[#0f1524] border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Profile Details</h3>
              <p className="text-xs text-gray-400">Your account identity</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-gray-950/60 border border-gray-800">
              <span className="text-gray-400 block mb-1">Full Name</span>
              <span className="font-semibold text-white text-sm">{user?.fullName}</span>
            </div>
            <div className="p-3.5 rounded-xl bg-gray-950/60 border border-gray-800">
              <span className="text-gray-400 block mb-1">Email Address</span>
              <span className="font-semibold text-white text-sm">{user?.email}</span>
            </div>
          </div>
        </div>

        {/* Backend Server Connection */}
        <div className="rounded-2xl bg-[#0f1524] border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Backend Server Gateway</h3>
              <p className="text-xs text-gray-400">WebSocket Signaling & API Endpoint URL</p>
            </div>
          </div>

          <form onSubmit={handleSaveBackendUrl} className="space-y-3 max-w-md">
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">
                Server Base URL
              </label>
              <input
                type="text"
                value={backendUrlInput}
                onChange={(e) => setBackendUrlInput(e.target.value)}
                placeholder="e.g. https://your-server.onrender.com or http://localhost:5000"
                className="w-full py-2.5 px-3 rounded-xl bg-gray-950 border border-gray-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Leave empty to use default relative path on standalone deployments.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition-all shadow-md shadow-purple-600/20"
              >
                {backendSaved ? '✓ Saved! Reloading...' : 'Save Server URL'}
              </button>
              {backendSaved && <span className="text-xs text-emerald-400">Settings updated</span>}
            </div>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="rounded-2xl bg-[#0f1524] border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Security & Password</h3>
              <p className="text-xs text-gray-400">Update your login credentials</p>
            </div>
          </div>

          {status && (
            <div
              className={`mb-4 p-3 rounded-xl border text-xs font-medium ${
                status.success
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}
            >
              {status.message}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full py-2.5 px-3 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">New Password (Min 8 chars)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full py-2.5 px-3 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full py-2.5 px-3 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
            >
              {loading ? 'Updating Password...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Security Policy Card */}
        <div className="rounded-2xl bg-[#0f1524] border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Active Protection Policies</h3>
              <p className="text-xs text-gray-400">Built-in safeguards for your remote desktop</p>
            </div>
          </div>

          <div className="space-y-3 text-xs text-gray-400">
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span><strong>Argon2id Memory-Hard PIN Hashing:</strong> Device access PINs are never stored in plaintext and cannot be brute-forced with GPU farms.</span>
            </div>
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span><strong>Progressive Lockout Guard:</strong> 5 failed PIN attempts trigger a mandatory 15-minute verification freeze.</span>
            </div>
            <div className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span><strong>Visual Host Notification:</strong> Connected computers display an active session banner with an instant local kill button. Invisible remote surveillance is strictly prohibited.</span>
            </div>
          </div>
        </div>

        {/* Logout Section */}
        <div className="pt-4">
          <button
            onClick={logout}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out of RemoteHub
          </button>
        </div>
      </div>
    </div>
  );
};

