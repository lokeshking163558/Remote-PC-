import React, { useState, useEffect } from 'react';
import { Lock, X, ShieldAlert, KeyRound, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api } from '../services/api';

interface PinModalProps {
  device: {
    id: string;
    deviceName: string;
    os: string;
    isLocked?: boolean;
    lockoutUntil?: number;
  };
  onClose: () => void;
  onSuccess: (sessionId: string, sessionToken: string, deviceId: string, deviceName: string) => void;
  onSwitchToApprovalMode?: () => void;
}

export const PinModal: React.FC<PinModalProps> = ({ device, onClose, onSuccess, onSwitchToApprovalMode }) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutTimer, setLockoutTimer] = useState<number>(0);

  useEffect(() => {
    if (device.lockoutUntil && device.lockoutUntil > Date.now()) {
      setLockoutTimer(Math.ceil((device.lockoutUntil - Date.now()) / 1000));
    }
  }, [device]);

  useEffect(() => {
    if (lockoutTimer <= 0) return;
    const interval = setInterval(() => {
      setLockoutTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  const handleKeyPress = (num: string) => {
    if (lockoutTimer > 0) return;
    if (pin.length < 8) {
      setPin((prev) => prev + num);
      setError(null);
    }
  };

  const handleBackspace = () => {
    if (lockoutTimer > 0) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  };

  const handleClear = () => {
    if (lockoutTimer > 0) return;
    setPin('');
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutTimer > 0) return;
    if (pin.length < 6 || pin.length > 8) {
      setError('PIN must be 6 to 8 digits');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await api.verifyPin(device.id, pin);
      if (res.success) {
        onSuccess(res.sessionId, res.sessionToken, res.deviceId, res.deviceName);
      }
    } catch (err: any) {
      setError(err.message || 'Incorrect PIN');
      if (err.message && err.message.toLowerCase().includes('locked')) {
        setLockoutTimer(15 * 60);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm rounded-2xl bg-[#111827] border border-gray-800 p-6 shadow-2xl shadow-blue-950/40">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-tight">Access Verification</h3>
          <p className="text-xs text-gray-400 mt-1">
            Enter the permanent access PIN for <span className="font-semibold text-gray-200">{device.deviceName}</span>
          </p>
        </div>

        {/* Lockout Warning */}
        {lockoutTimer > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <div>
              <p className="font-semibold">Too many failed attempts</p>
              <p>Locked for {Math.floor(lockoutTimer / 60)}m {lockoutTimer % 60}s</p>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && lockoutTimer <= 0 && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-medium">
            {error}
          </div>
        )}

        {/* PIN display input */}
        <form onSubmit={handleSubmit} className="mb-5">
          <div className="relative">
            <input
              type={showPin ? 'text' : 'password'}
              value={pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                setPin(val);
                setError(null);
              }}
              disabled={lockoutTimer > 0 || isLoading}
              maxLength={8}
              autoFocus
              placeholder="••••••"
              className="w-full text-center text-2xl tracking-[0.5em] font-mono py-3 px-4 rounded-xl bg-gray-900 border border-gray-700 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 p-1"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </form>

        {/* Touch Numeric Keypad (Crucial for mobile phones) */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleKeyPress(num)}
              disabled={lockoutTimer > 0 || isLoading}
              className="py-3 rounded-xl bg-gray-900/80 hover:bg-gray-800 text-lg font-semibold text-white border border-gray-800 active:scale-95 transition-all disabled:opacity-50"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            disabled={lockoutTimer > 0 || isLoading}
            className="py-3 rounded-xl bg-gray-900/40 hover:bg-gray-800/60 text-xs font-semibold text-gray-400 border border-gray-800 active:scale-95 transition-all disabled:opacity-50"
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            disabled={lockoutTimer > 0 || isLoading}
            className="py-3 rounded-xl bg-gray-900/80 hover:bg-gray-800 text-lg font-semibold text-white border border-gray-800 active:scale-95 transition-all disabled:opacity-50"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            disabled={lockoutTimer > 0 || isLoading}
            className="py-3 rounded-xl bg-gray-900/40 hover:bg-gray-800/60 text-xs font-semibold text-gray-400 border border-gray-800 active:scale-95 transition-all disabled:opacity-50"
          >
            ⌫
          </button>
        </div>

        {/* Connect Action Button */}
        <button
          onClick={() => handleSubmit()}
          disabled={pin.length < 6 || lockoutTimer > 0 || isLoading}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold text-sm transition-all shadow-md shadow-blue-600/20 active:scale-95"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying & Connecting...</span>
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4" />
              <span>Establish Remote Session</span>
            </>
          )}
        </button>

        {onSwitchToApprovalMode && (
          <div className="mt-3 pt-3 border-t border-gray-800/80 text-center">
            <button
              type="button"
              onClick={onSwitchToApprovalMode}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
            >
              Prefer no PIN? Switch to "Ask for approval on laptop"
            </button>
          </div>
        )}

        <p className="text-[11px] text-gray-500 text-center mt-3">
          Forgot PIN? Reset directly on your host laptop via the Windows agent.
        </p>
      </div>
    </div>
  );
};

