import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getAuthToken, getRefreshToken, clearAuthTokens } from '../services/api';

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
  errorMessage: string | null;
  login: (email: string, pass: string, rememberMe?: boolean) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (email: string, pass: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    setAuthState('loading');
    setErrorMessage(null);

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

      // Distinguish explicit authentication rejection from temporary network/server issues
      if (err.status === 401 || err.message?.includes('401') || err.message?.includes('expired') || err.message?.includes('invalid')) {
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
        setAuthState('session_expired');
        setErrorMessage('Your session has expired. Please sign in again.');
      } else {
        // Network unavailable, offline, or transient server 5xx
        // Never log out the user due to a temporary network interruption!
        console.warn('[Auth] Network or server temporary issue during restore; preserving user state if present');
        if (storedToken) {
          // If we had a token, treat as network_unavailable or optimistic authenticated
          setAuthState('network_unavailable');
          setErrorMessage('Unable to connect to the authentication server. Please check your connection.');
        } else {
          setAuthState('unauthenticated');
        }
      }
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const login = async (email: string, pass: string, rememberMe: boolean = true) => {
    setAuthState('loading');
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
    setAuthState('loading');
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
    setAuthState('loading');
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
    setAuthState('loading');
    await api.logout();
    setUser(null);
    setToken(null);
    setAuthState('unauthenticated');
    setErrorMessage(null);
  };

  const logoutAll = async () => {
    setAuthState('loading');
    await api.logoutAll();
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
        isAuthenticated: authState === 'authenticated',
        isLoading: authState === 'loading',
        errorMessage,
        login,
        loginWithGoogle,
        register,
        logout,
        logoutAll,
        refreshUser,
        retrySession: restoreSession
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
