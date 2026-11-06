// RemoteHub Client API Service
// Production Gateway: https://remote-pc-server.vercel.app

export function getBackendUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }

  const stored = localStorage.getItem('remotehub_backend_url');
  if (stored && stored.trim()) {
    return stored.trim().replace(/\/$/, '');
  }

  if (window.location.hostname.includes('remote-pc-green.vercel.app') || window.location.hostname.includes('vercel.app')) {
    return 'https://remote-pc-server.vercel.app';
  }

  return 'https://remote-pc-server.vercel.app';
}

export function getWsBaseUrl(): string {
  const backend = getBackendUrl();
  if (backend) {
    return backend.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export const GITHUB_LATEST_AGENT_DOWNLOAD_URL = 'https://github.com/lokeshking163558/Remote-PC-/releases/latest/download/RemoteHubAgent.exe';
export const DIRECT_GITHUB_AGENT_DOWNLOAD_URL = 'https://github.com/lokeshking163558/Remote-PC-/releases/download/v1.3.1/RemoteHubAgent.exe';
export const DIRECT_GITHUB_AGENT_TXT_DOWNLOAD_URL = 'https://github.com/lokeshking163558/Remote-PC-/raw/main/windows-agent.txt';
export const GITHUB_RELEASES_PAGE_URL = 'https://github.com/lokeshking163558/Remote-PC-/releases';
export const GITHUB_TAG_RELEASE_DOWNLOAD_URL = 'https://github.com/lokeshking163558/Remote-PC-/releases/download/v1.3.1/RemoteHubAgent.exe';

export function getAgentDownloadUrl(): string {
  const backend = getBackendUrl();
  return backend ? `${backend}/api/downloads/windows-agent` : DIRECT_GITHUB_AGENT_DOWNLOAD_URL;
}

export function getAgentTxtDownloadUrl(): string {
  const backend = getBackendUrl();
  return backend ? `${backend}/api/downloads/windows-agent.txt` : DIRECT_GITHUB_AGENT_TXT_DOWNLOAD_URL;
}

export function setCustomBackendUrl(url: string) {
  if (!url || !url.trim()) {
    localStorage.removeItem('remotehub_backend_url');
  } else {
    localStorage.setItem('remotehub_backend_url', url.trim());
  }
}

function getApiEndpoint(path: string): string {
  const base = getBackendUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}/api${cleanPath}` : `/api${cleanPath}`;
}

export function getAuthToken(): string | null {
  return localStorage.getItem('remotehub_token');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('remotehub_refresh_token');
}

export function setAuthTokens(token: string, refreshToken?: string) {
  localStorage.setItem('remotehub_token', token);
  if (refreshToken) {
    localStorage.setItem('remotehub_refresh_token', refreshToken);
  }
}

export function clearAuthTokens() {
  localStorage.removeItem('remotehub_token');
  localStorage.removeItem('remotehub_refresh_token');
}

function getAuthHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Single active refresh promise to queue concurrent requests
let refreshPromise: Promise<string | null> | null = null;

async function doRefreshToken(): Promise<string | null> {
  const rToken = getRefreshToken();
  try {
    const res = await fetch(getApiEndpoint('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken: rToken || undefined })
    });

    if (!res.ok) {
      clearAuthTokens();
      return null;
    }

    const data = await res.json();
    if (data.token) {
      setAuthTokens(data.token, data.refreshToken);
      return data.token;
    }
  } catch (err) {
    console.warn('[Auth] Failed to refresh token silently', err);
  }
  return null;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  options.credentials = 'include';
  options.headers = {
    ...getAuthHeader(),
    ...(options.headers || {})
  };

  let res = await fetch(url, options);

  // If unauthorized and we have a refresh token, attempt silent token refresh once
  if (res.status === 401 && (getRefreshToken() || document.cookie.includes('remotehub_refresh_token'))) {
    if (!refreshPromise) {
      refreshPromise = doRefreshToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;
    if (newToken) {
      options.headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${newToken}`
      };
      res = await fetch(url, options);
    }
  }

  return res;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error: any = new Error(data.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

export const api = {
  // Auth
  async register(data: { email: string; password: string; fullName: string }) {
    const res = await fetch(getApiEndpoint('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    const result = await handleResponse<{ token: string; refreshToken?: string; user: any }>(res);
    if (result.token) {
      setAuthTokens(result.token, result.refreshToken);
    }
    return result;
  },

  async login(data: { email: string; password: string; rememberMe?: boolean }) {
    const res = await fetch(getApiEndpoint('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    });
    const result = await handleResponse<{ token: string; refreshToken?: string; user: any }>(res);
    if (result.token) {
      setAuthTokens(result.token, result.refreshToken);
    }
    return result;
  },

  async loginWithGoogle(credential: string) {
    const res = await fetch(getApiEndpoint('/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ credential })
    });
    const result = await handleResponse<{ token: string; refreshToken?: string; user: any }>(res);
    if (result.token) {
      setAuthTokens(result.token, result.refreshToken);
    }
    return result;
  },

  async getAuthConfig() {
    try {
      const res = await fetch(getApiEndpoint('/auth/config'));
      return handleResponse<{ googleAuthEnabled: boolean; googleClientId: string | null }>(res);
    } catch {
      return { googleAuthEnabled: false, googleClientId: null };
    }
  },

  async refreshToken() {
    const token = await doRefreshToken();
    if (!token) {
      throw new Error('Failed to refresh authentication session');
    }
    return token;
  },

  async getMe() {
    const res = await fetchWithAuth(getApiEndpoint('/auth/me'));
    return handleResponse<{ user: any }>(res);
  },

  async logout() {
    try {
      await fetch(getApiEndpoint('/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: getRefreshToken() || undefined })
      });
    } catch {}
    clearAuthTokens();
  },

  async logoutAll() {
    try {
      await fetchWithAuth(getApiEndpoint('/auth/logout-all'), {
        method: 'POST'
      });
    } catch {}
    clearAuthTokens();
  },

  async getUserSessions() {
    const res = await fetchWithAuth(getApiEndpoint('/auth/sessions'));
    return handleResponse<{ sessions: any[] }>(res);
  },

  async revokeUserSession(sessionId: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/auth/sessions/${sessionId}`), {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    const res = await fetchWithAuth(getApiEndpoint('/auth/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Devices
  async getDevices() {
    const res = await fetchWithAuth(getApiEndpoint('/devices'));
    return handleResponse<{ devices: any[] }>(res);
  },

  async getDeviceDiagnostics() {
    const res = await fetchWithAuth(getApiEndpoint('/devices/diagnostics'));
    return handleResponse<{
      account: { userId: string; email: string; fullName: string };
      backend: { serverUrl: string; uptime: number; database: any };
      devices: any[];
    }>(res);
  },

  async restoreDevice(data: {
    deviceId: string;
    installationId?: string;
    deviceName?: string;
    authToken?: string;
    os?: string;
    pin?: string;
  }) {
    const res = await fetchWithAuth(getApiEndpoint('/devices/restore-device'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string; deviceId: string; authToken?: string; isNew: boolean }>(res);
  },

  async verifyDeviceRegistration(deviceId: string, authToken?: string, installationId?: string) {
    const res = await fetch(getApiEndpoint('/devices/verify-registration'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, authToken, installationId })
    });
    return handleResponse<any>(res);
  },

  async getDevice(id: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${id}`));
    return handleResponse<{ device: any }>(res);
  },

  async generatePairingCode() {
    const res = await fetchWithAuth(getApiEndpoint('/devices/generate-pairing-code'), {
      method: 'POST'
    });
    return handleResponse<{ pairingCode: string; expiresAt: number; expiresInMinutes: number }>(res);
  },

  async connectDevice(deviceId: string, pin?: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}/connect`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin || undefined })
    });
    return handleResponse<{
      success: boolean;
      sessionId: string;
      sessionToken: string;
      deviceId: string;
      deviceName: string;
      approvalRequired: boolean;
      expiresInSeconds: number;
    }>(res);
  },

  async verifyPin(deviceId: string, pin: string) {
    return this.connectDevice(deviceId, pin);
  },

  async setTrustedMode(deviceId: string, trustedMode: boolean) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}/trusted-mode`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trustedMode })
    });
    return handleResponse<{ success: boolean; trustedMode: boolean }>(res);
  },

  async changePin(deviceId: string, data: { currentPin?: string; newPin: string }) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}/change-pin`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async wakeDevice(deviceId: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}/wake`), {
      method: 'POST'
    });
    return handleResponse<{ success: boolean; message: string; limitations?: string[] }>(res);
  },

  async updateDevice(deviceId: string, data: { deviceName: string }) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async deleteDevice(deviceId: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}`), {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getMetrics(deviceId: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/devices/${deviceId}/metrics`));
    return handleResponse<{ metrics: any[] }>(res);
  },

  // Sessions
  async getSessions() {
    const res = await fetchWithAuth(getApiEndpoint('/sessions'));
    return handleResponse<{ sessions: any[] }>(res);
  },

  async disconnectSession(sessionId: string) {
    const res = await fetchWithAuth(getApiEndpoint(`/sessions/${sessionId}/disconnect`), {
      method: 'POST'
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getIceServers() {
    const res = await fetchWithAuth(getApiEndpoint('/sessions/config/ice-servers'));
    return handleResponse<{ iceServers: any[] }>(res);
  },

  async sendSessionSignal(sessionId: string, sender: 'client' | 'agent', signal: any) {
    const res = await fetchWithAuth(getApiEndpoint(`/sessions/${sessionId}/signal`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, signal })
    });
    return handleResponse<{ success: boolean }>(res);
  },

  async pollSessionSignals(sessionId: string, receiver: 'client' | 'agent', since: number = 0, timeout = 2500) {
    const res = await fetchWithAuth(getApiEndpoint(`/sessions/${sessionId}/signal?receiver=${receiver}&since=${since}&timeout=${timeout}`));
    return handleResponse<{ success: boolean; signals: any[]; timestamp: number }>(res);
  },

  async sendSessionInput(sessionId: string, input: any) {
    const res = await fetchWithAuth(getApiEndpoint(`/sessions/${sessionId}/input`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
    return handleResponse<{ success: boolean }>(res);
  },

  getSessionFrameUrl(sessionId: string) {
    return getApiEndpoint(`/sessions/${sessionId}/frame?t=${Date.now()}`);
  }
};
