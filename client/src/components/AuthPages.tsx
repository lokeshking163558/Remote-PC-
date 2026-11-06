import React, { useState, useEffect } from 'react';
import { Monitor, Lock, Mail, User, ArrowRight, Loader2, CheckSquare, Square, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

interface AuthPagesProps {
  initialMode?: 'login' | 'register';
  onSuccess: () => void;
  onSwitchToLanding: () => void;
}

export const AuthPages: React.FC<AuthPagesProps> = ({
  initialMode = 'login',
  onSuccess,
  onSwitchToLanding
}) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);

  const { login, register, loginWithGoogle, authState, errorMessage } = useAuth();

  // Load Google Auth configuration
  useEffect(() => {
    let active = true;
    api.getAuthConfig().then(cfg => {
      if (!active) return;
      if (cfg.googleAuthEnabled && cfg.googleClientId) {
        setGoogleAuthEnabled(true);
        // Load Google Identity Services script
        if (!(window as any).google?.accounts?.id) {
          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = () => {
            if (active) initGoogleSignIn(cfg.googleClientId!);
          };
          document.body.appendChild(script);
        } else {
          initGoogleSignIn(cfg.googleClientId);
        }
      }
    }).catch(() => {});

    return () => { active = false; };
  }, []);

  const initGoogleSignIn = (clientId: string) => {
    try {
      if (!(window as any).google?.accounts?.id) return;
      (window as any).google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: any) => {
          if (response?.credential) {
            setLoading(true);
            setError(null);
            try {
              await loginWithGoogle(response.credential);
              onSuccess();
            } catch (err: any) {
              setError(err.message || 'Google authentication failed');
            } finally {
              setLoading(false);
            }
          }
        }
      });

      const container = document.getElementById('remotehub-google-signin');
      if (container) {
        container.innerHTML = '';
        (window as any).google.accounts.id.renderButton(container, {
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 340
        });
      }
    } catch (err) {
      console.warn('Failed to initialize Google Sign-In:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password, rememberMe);
      } else {
        await register(email, password, fullName);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0d14] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-600/10 blur-[120px] pointer-events-none -z-10" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div
          onClick={onSwitchToLanding}
          className="inline-flex items-center gap-2 cursor-pointer group mb-4"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <Monitor className="w-5 h-5" />
          </div>
          <span className="font-extrabold text-2xl text-white tracking-tight">RemoteHub</span>
        </div>

        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          {isLogin ? 'Sign in to your dashboard' : 'Create your RemoteHub account'}
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          {isLogin ? 'Access your registered computers' : 'Manage your PCs and laptops from any browser'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-[#111827] py-8 px-6 sm:px-10 rounded-2xl border border-gray-800 shadow-2xl shadow-blue-950/30">
          {/* Session expiration warning banner */}
          {authState === 'session_expired' && !error && (
            <div className="mb-5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{errorMessage || 'Your session expired. Please sign in again to continue.'}</span>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium text-center">
              {error}
            </div>
          )}

          {/* Optional Google Sign-In */}
          {googleAuthEnabled && isLogin && (
            <div className="mb-6">
              <div id="remotehub-google-signin" className="flex justify-center" />
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#111827] px-2 text-gray-500 font-semibold">Or with password</span>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Remember Me Checkbox */}
            {isLogin && (
              <div className="flex items-center justify-between pt-1">
                <label
                  onClick={() => setRememberMe(!rememberMe)}
                  className="inline-flex items-center gap-2 cursor-pointer select-none text-xs text-gray-300 hover:text-white"
                >
                  {rememberMe ? (
                    <CheckSquare className="w-4 h-4 text-blue-500" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-600" />
                  )}
                  <span>Remember this browser (Permanent session)</span>
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20 active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-gray-800 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError(null);
              }}
              className="text-xs text-gray-400 hover:text-blue-400 transition-colors"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
