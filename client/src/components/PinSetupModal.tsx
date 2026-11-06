import React, { useState } from 'react';
import { Shield, KeyRound, Eye, EyeOff, Loader2, X, Check, Laptop } from 'lucide-react';
import { api } from '../services/api';

interface PinSetupModalProps {
  device: {
    id: string;
    deviceName: string;
  };
  onClose: () => void;
  onSuccess: (pin: string) => void;
  onSwitchToApprovalMode?: () => void;
}

export const PinSetupModal: React.FC<PinSetupModalProps> = ({
  device,
  onClose,
  onSuccess,
  onSwitchToApprovalMode
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (pin.length < 6 || pin.length > 8) {
      setError('PIN must be between 6 and 8 digits');
      return;
    }

    if (!/^\d+$/.test(pin)) {
      setError('PIN must contain only numbers');
      return;
    }

    if (pin !== confirmPin) {
      setError('PIN confirmation does not match');
      return;
    }

    setIsLoading(true);
    try {
      await api.setupPin(device.id, pin);
      onSuccess(pin);
    } catch (err: any) {
      setError(err.message || 'Failed to set up PIN');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Create Permanent PIN</h3>
              <p className="text-xs text-gray-400">
                Setup permanent access credentials for <span className="text-gray-200 font-semibold">{device.deviceName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational banner */}
        <div className="p-3 mb-5 rounded-xl bg-blue-950/30 border border-blue-800/40 text-xs text-blue-300 leading-relaxed">
          No PIN was previously configured for <strong>{device.deviceName}</strong>. Enter a 6–8 digit permanent PIN below to secure remote access.
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-400 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              New Access PIN (6–8 Digits)
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-8 digits"
                className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white font-mono text-center tracking-widest text-lg focus:outline-none focus:border-blue-500 transition-colors"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              Confirm PIN
            </label>
            <input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              maxLength={8}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Re-enter 6-8 digits"
              className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white font-mono text-center tracking-widest text-lg focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={pin.length < 6 || pin !== confirmPin || isLoading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Configuring PIN...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Access PIN & Connect</span>
                </>
              )}
            </button>
          </div>
        </form>

        {onSwitchToApprovalMode && (
          <div className="mt-4 pt-4 border-t border-gray-800/80 text-center">
            <p className="text-xs text-gray-400 mb-2">Prefer not to use a PIN?</p>
            <button
              type="button"
              onClick={onSwitchToApprovalMode}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
            >
              <Laptop className="w-3.5 h-3.5" />
              Switch to "Ask for approval on laptop" (Recommended)
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
          <Shield className="w-3.5 h-3.5 text-gray-400" />
          <span>Secured with Argon2id memory-hard cryptographic hashing</span>
        </div>
      </div>
    </div>
  );
};

