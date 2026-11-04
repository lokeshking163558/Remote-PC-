const API_BASE = '/api';

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
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ token: string; user: any }>(res);
  },

  async login(data: { email: string; password: string }) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleResponse<{ token: string; user: any }>(res);
  },

  async getMe() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ user: any }>(res);
  },

  async changePassword(data: { currentPassword: string; newPassword: string }) {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Devices
  async getDevices() {
    const res = await fetch(`${API_BASE}/devices`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ devices: any[] }>(res);
  },

  async getDevice(id: string) {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ device: any }>(res);
  },

  async generatePairingCode() {
    const res = await fetch(`${API_BASE}/devices/generate-pairing-code`, {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ pairingCode: string; expiresAt: number; expiresInMinutes: number }>(res);
  },

  async verifyPin(deviceId: string, pin: string) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/verify-pin`, {
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
    const res = await fetch(`${API_BASE}/devices/${deviceId}/change-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async wakeDevice(deviceId: string) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/wake`, {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string; limitations?: string[] }>(res);
  },

  async updateDevice(deviceId: string, data: { deviceName: string }) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async deleteDevice(deviceId: string) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getMetrics(deviceId: string) {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/metrics`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ metrics: any[] }>(res);
  },

  // Sessions
  async getSessions() {
    const res = await fetch(`${API_BASE}/sessions`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ sessions: any[] }>(res);
  },

  async disconnectSession(sessionId: string) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/disconnect`, {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getIceServers() {
    const res = await fetch(`${API_BASE}/sessions/config/ice-servers`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ iceServers: any[] }>(res);
  }
};

