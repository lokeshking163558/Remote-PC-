// Configurable Server URL resolution:
// 1. Stored user preference in localStorage ('remotehub_backend_url')
// 2. Vite environment variable (VITE_API_URL)
// 3. Auto-detected Vercel server sibling if on Vercel
// 4. Default relative URL for standalone or local setups

export function getBackendUrl(): string {
  const custom = localStorage.getItem('remotehub_backend_url');
  if (custom) return custom.replace(/\/$/, '');

  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  // If running on a Vercel deployment ending in .vercel.app
  if (typeof window !== 'undefined' && window.location.hostname.includes('remote-pc-green.vercel.app')) {
    return 'https://remote-pc-server.vercel.app';
  }

  return '';
}

export function getWsBaseUrl(): string {
  const backend = getBackendUrl();
  if (backend) {
    return backend.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function getAgentDownloadUrl(): string {
  const backend = getBackendUrl();
  return backend ? `${backend}/api/downloads/windows-agent` : '/api/downloads/windows-agent';
}

export function getAgentTxtDownloadUrl(): string {
  const backend = getBackendUrl();
  return backend ? `${backend}/api/downloads/windows-agent.txt` : '/api/downloads/windows-agent.txt';
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

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('remotehub_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  // Auth
  async register(data: { email: string; password: string; fullName: string }) {
    const res = await fetch(getApiEndpoint('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ token: string; user: any }>(res);
  },

  async login(data: { email: string; password: string }) {
    const res = await fetch(getApiEndpoint('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ token: string; user: any }>(res);
  },

  async getMe() {
    const res = await fetch(getApiEndpoint('/auth/me'), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ user: any }>(res);
  },

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    const res = await fetch(getApiEndpoint('/auth/change-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Devices
  async getDevices() {
    const res = await fetch(getApiEndpoint('/devices'), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ devices: any[] }>(res);
  },

  async getDevice(id: string) {
    const res = await fetch(getApiEndpoint(`/devices/${id}`), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ device: any }>(res);
  },

  async generatePairingCode() {
    const res = await fetch(getApiEndpoint('/devices/generate-pairing-code'), {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ pairingCode: string; expiresAt: number; expiresInMinutes: number }>(res);
  },

  async verifyPin(deviceId: string, pin: string) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}/verify-pin`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ pin })
    });
    return handleResponse<{
      success: boolean;
      sessionId: string;
      sessionToken: string;
      deviceId: string;
      deviceName: string;
      expiresInSeconds: number;
    }>(res);
  },

  async changePin(deviceId: string, data: { currentPin?: string; newPin: string }) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}/change-pin`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async wakeDevice(deviceId: string) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}/wake`), {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string; limitations?: string[] }>(res);
  },

  async updateDevice(deviceId: string, data: { deviceName: string }) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async deleteDevice(deviceId: string) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}`), {
      method: 'DELETE',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getMetrics(deviceId: string) {
    const res = await fetch(getApiEndpoint(`/devices/${deviceId}/metrics`), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ metrics: any[] }>(res);
  },

  // Sessions
  async getSessions() {
    const res = await fetch(getApiEndpoint('/sessions'), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ sessions: any[] }>(res);
  },

  async disconnectSession(sessionId: string) {
    const res = await fetch(getApiEndpoint(`/sessions/${sessionId}/disconnect`), {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getIceServers() {
    const res = await fetch(getApiEndpoint('/sessions/config/ice-servers'), {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ iceServers: any[] }>(res);
  }
};
