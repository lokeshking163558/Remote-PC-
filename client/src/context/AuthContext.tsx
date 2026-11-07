import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  api,
  getAuthToken,
  getRefreshToken,
  clearAuthTokens,
  testBackendHealth,
  resetBackendUrl,
  getBackendUrl,
  DEFAULT_BACKEND_URL
} from '../services/api';

export type AuthState = 'loading' | 'authenticated' | 'unauthenticated' | 'session_expired' | 'network_unavailable';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  createdAt?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  authState: AuthState;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  errorMessage: string | null;
  login: (email: string, pass: string, rememberMe?: boolean) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (email: string, pass: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retrySession: () => Promise<void>;
  resetSessionAndSignIn: () => void;
  resetServerToDefault: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [isInitializing, setIsInitializing] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    setAuthState('loading');
    setErrorMessage(null);

    try {
      const storedToken = getAuthToken();
      const storedRefresh = getRefreshToken();

      // If neither access token nor refresh token exists, user is unauthenticated
      if (!storedToken && !storedRefresh) {
        setUser(null);
        setToken(null);
        setAuthState('unauthenticated');
        return;
      }

      try {
        const res = await api.getMe();
        setUser(res.user);
        setToken(getAuthToken());
        setAuthState('authenticated');
      } catch (err: any) {
        console.warn('[Auth] Session restoration check returned error:', err);

        // Check for explicit authentication rejection
        const isAuthError =
          err.status === 401 ||
          err.status === 403 ||
          err.message?.includes('401') ||
          err.message?.includes('403') ||
          err.message?.includes('expired') ||
          err.message?.includes('invalid') ||
          err.message?.includes('Authentication required');

        if (isAuthError) {
          // Attempt one silent refresh if a refresh token exists
          try {
            const newToken = await api.refreshToken();
            if (newToken) {
              const retryRes = await api.getMe();
              setUser(retryRes.user);
              setToken(newToken);
              setAuthState('authenticated');
              return;
            }
          } catch {
            // Refresh token is genuinely invalid or revoked
          }

          clearAuthTokens();
          setUser(null);
          setToken(null);
          setAuthState('unauthenticated');
          setErrorMessage('Your session has expired. Please sign in again.');
          return;
        }

        // If getMe failed with a network or server error, test backend health
        try {
          const health = await testBackendHealth();
          if (health.ok) {
            // The server is healthy and responding!
            console.warn('[Auth] Server is healthy but session restoration failed. Redirecting to login.');
            clearAuthTokens();
            setUser(null);
            setToken(null);
            setAuthState('unauthenticated');
            setErrorMessage('Session expired or invalidated. Please sign in.');
            return;
          }

          // Target server failed health probe. If target was a custom URL, test official production gateway
          if (health.target !== DEFAULT_BACKEND_URL) {
            console.warn('[Auth] Custom server unreachable. Testing official gateway:', DEFAULT_BACKEND_URL);
            const prodHealth = await testBackendHealth(DEFAULT_BACKEND_URL);
            if (prodHealth.ok) {
              console.info('[Auth] Production gateway is healthy! Auto-resetting backend URL...');
              resetBackendUrl();
              try {
                const res = await api.getMe();
                setUser(res.user);
                setToken(getAuthToken());
                setAuthState('authenticated');
                return;
              } catch {
                clearAuthTokens();
                setUser(null);
                setToken(null);
                setAuthState('unauthenticated');
                return;
              }
            }
          }

          // Both endpoints failed or network truly offline
          setAuthState('network_unavailable');
          setErrorMessage(
            `Unable to reach authentication server (${getBackendUrl()}). ${health.error || 'Please check your connection.'}`
          );
        } catch (healthErr: any) {
          setAuthState('network_unavailable');
          setErrorMessage(`Unable to connect to authentication server. ${healthErr.message || ''}`);
        }
      }
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const resetSessionAndSignIn = useCallback(() => {
    clearAuthTokens();
    setUser(null);
    setToken(null);
    setAuthState('unauthenticated');
    setErrorMessage(null);
  }, []);

  const resetServerToDefault = useCallback(async () => {
    resetBackendUrl();
    await restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const login = async (email: string, pass: string, rememberMe: boolean = true) => {
    setErrorMessage(null);
    try {
      const res = await api.login({ email, password: pass, rememberMe });
      setToken(res.token);
      setUser(res.user);
      setAuthState('authenticated');
    } catch (err: any) {
      setAuthState('unauthenticated');
      setErrorMessage(err.message || 'Invalid email or password');
      throw err;
    }
  };

  const loginWithGoogle = async (credential: string) => {
    setErrorMessage(null);
    try {
      const res = await api.loginWithGoogle(credential);
      setToken(res.token);
      setUser(res.user);
      setAuthState('authenticated');
    } catch (err: any) {
      setAuthState('unauthenticated');
      setErrorMessage(err.message || 'Google sign-in failed');
      throw err;
    }
  };

  const register = async (email: string, pass: string, fullName: string) => {
    setErrorMessage(null);
    try {
      const res = await api.register({ email, password: pass, fullName });
      setToken(res.token);
      setUser(res.user);
      setAuthState('authenticated');
    } catch (err: any) {
      setAuthState('unauthenticated');
      setErrorMessage(err.message || 'Registration failed');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {}
    clearAuthTokens();
    setUser(null);
    setToken(null);
    setAuthState('unauthenticated');
    setErrorMessage(null);
  };

  const logoutAll = async () => {
    try {
      await api.logoutAll();
    } catch {}
    clearAuthTokens();
    setUser(null);
    setToken(null);
    setAuthState('unauthenticated');
    setErrorMessage(null);
  };

  const refreshUser = async () => {
    await restoreSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        authState,
        isAuthenticated: authState === 'authenticated' && !!user,
        isLoading: isInitializing,
        isInitializing,
        errorMessage,
        login,
        loginWithGoogle,
        register,
        logout,
        logoutAll,
        refreshUser,
        retrySession: restoreSession,
        resetSessionAndSignIn,
        resetServerToDefault
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
