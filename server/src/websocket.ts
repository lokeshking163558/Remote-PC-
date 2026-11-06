import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import url from 'node:url';
import { query, queryOne, execute } from './db.js';

interface ActiveSession {
  sessionId: string;
  deviceId: string;
  userId: string;
  clientWs?: WebSocket;
  agentWs?: WebSocket;
  startedAt: number;
}

// Map deviceId -> WebSocket
const connectedAgents = new Map<string, WebSocket>();

// Map sessionId -> ActiveSession
const activeSessions = new Map<string, ActiveSession>();

// Map userId -> Set of WebSockets (for real-time dashboard device updates)
const dashboardClients = new Map<string, Set<WebSocket>>();

export function setupWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url || '', true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/ws/agent' || pathname === '/ws/client' || pathname === '/ws/dashboard') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    if (pathname === '/ws/dashboard') {
      handleDashboardConnection(ws, query);
    } else if (pathname === '/ws/agent') {
      handleAgentConnection(ws, query);
    } else if (pathname === '/ws/client') {
      handleClientConnection(ws, query);
    }
  });

  // Background interval: sweep inactive devices (every 15s)
  setInterval(async () => {
    const now = Date.now();
    const staleThreshold = now - 90000; // 90s stale threshold
    const reconnectingThreshold = now - 45000; // 45s reconnecting threshold
    try {
      // 1. Mark devices with no heartbeat for >90s as offline
      const offlineDevices = await query(`
        SELECT id, user_id, device_name FROM devices WHERE device_status != 'offline' AND last_seen < ?
      `, [staleThreshold]);

      if (offlineDevices.length > 0) {
        await execute("UPDATE devices SET device_status = 'offline' WHERE last_seen < ?", [
          staleThreshold
        ]);

        for (const dev of offlineDevices) {
          notifyUserDashboard(dev.user_id, {
            type: 'device:status-change',
            deviceId: dev.id,
            onlineStatus: false,
            deviceStatus: 'offline',
            lastSeen: now
          });
        }
      }

      // 2. Mark devices with no heartbeat for 45s-90s as reconnecting
      const reconnectingDevices = await query(`
        SELECT id, user_id, device_name FROM devices WHERE device_status = 'online' AND last_seen < ? AND last_seen >= ?
      `, [reconnectingThreshold, staleThreshold]);

      if (reconnectingDevices.length > 0) {
        await execute("UPDATE devices SET device_status = 'reconnecting' WHERE device_status = 'online' AND last_seen < ? AND last_seen >= ?", [
          reconnectingThreshold,
          staleThreshold
        ]);

        for (const dev of reconnectingDevices) {
          notifyUserDashboard(dev.user_id, {
            type: 'device:status-change',
            deviceId: dev.id,
            onlineStatus: false,
            deviceStatus: 'reconnecting',
            lastSeen: now
          });
        }
      }
    } catch (e) {
      console.error('Error sweeping stale devices:', e);
    }
  }, 15000);
}

function handleDashboardConnection(ws: WebSocket, queryParams: any) {
  const userId = queryParams.userId as string;
  if (!userId) {
    ws.close(1008, 'Missing userId');
    return;
  }

  if (!dashboardClients.has(userId)) {
    dashboardClients.set(userId, new Set());
  }
  dashboardClients.get(userId)!.add(ws);

  ws.on('close', () => {
    const userSet = dashboardClients.get(userId);
    if (userSet) {
      userSet.delete(ws);
      if (userSet.size === 0) {
        dashboardClients.delete(userId);
      }
    }
  });
}

export function notifyUserDashboard(userId: string, message: any) {
  const set = dashboardClients.get(userId);
  if (set) {
    const payload = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

async function handleAgentConnection(ws: WebSocket, queryParams: any) {
  const deviceId = queryParams.deviceId as string;
  const token = queryParams.token as string;

  if (!deviceId || !token) {
    ws.close(1008, 'Missing deviceId or authToken');
    return;
  }

  // Validate agent in database
  const device = await queryOne('SELECT id, user_id, device_name, auth_token FROM devices WHERE id = ?', [deviceId]);

  if (!device || device.auth_token !== token) {
    ws.close(1008, 'Invalid device credentials');
    return;
  }

  connectedAgents.set(deviceId, ws);

  const now = Date.now();
  await execute("UPDATE devices SET device_status = 'online', last_seen = ? WHERE id = ?", [now, deviceId]);

  notifyUserDashboard(device.user_id, {
    type: 'device:status-change',
    deviceId,
    onlineStatus: true,
    deviceStatus: 'online',
    lastSeen: now
  });

  ws.send(JSON.stringify({
    type: 'server:agent-registered',
    deviceId,
    deviceName: device.device_name,
    timestamp: now
  }));

  ws.on('message', async (data, isBinary) => {
    try {
      if (isBinary) {
        // Binary frame data (screen capture) -> relay to active client session
        for (const session of activeSessions.values()) {
          if (session.deviceId === deviceId && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
            session.clientWs.send(data, { binary: true });
          }
        }
        return;
      }

      const msg = JSON.parse(data.toString());

      if (msg.type === 'agent:heartbeat') {
        const timestamp = Date.now();
        await execute(
          'UPDATE devices SET last_seen = ?, local_ip = COALESCE(?, local_ip), mac_address = COALESCE(?, mac_address) WHERE id = ?',
          [timestamp, msg.localIp || null, msg.macAddress || null, deviceId]
        );

        if (msg.metrics) {
          await execute(`
            INSERT INTO device_metrics (device_id, cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            deviceId,
            msg.metrics.cpuUsage || 0,
            msg.metrics.memoryUsage || 0,
            msg.metrics.storageUsage || 0,
            msg.metrics.batteryPercent ?? null,
            msg.metrics.isCharging ? 1 : 0,
            timestamp
          ]);

          for (const session of activeSessions.values()) {
            if (session.deviceId === deviceId && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
              session.clientWs.send(JSON.stringify({
                type: 'server:metrics',
                metrics: msg.metrics
              }));
            }
          }
        }

        ws.send(JSON.stringify({ type: 'server:heartbeat-ack', timestamp }));
      } else if (msg.type === 'agent:approve-session') {
        approveSessionAndNotify(msg.sessionId);
      } else if (msg.type === 'agent:reject-session') {
        rejectSessionAndNotify(msg.sessionId, msg.reason || 'Host rejected connection');
      } else if (msg.type === 'agent:signal') {
        const session = activeSessions.get(msg.sessionId);
        if (session && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(JSON.stringify({
            type: 'server:signal',
            sessionId: msg.sessionId,
            signal: msg.signal
          }));
        }
      } else if (msg.type === 'agent:clipboard') {
        const session = activeSessions.get(msg.sessionId);
        if (session && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(JSON.stringify({
            type: 'server:clipboard',
            sessionId: msg.sessionId,
            text: msg.text
          }));
        }
      } else if (msg.type === 'agent:emergency-disconnect') {
        endSessionAndNotify(msg.sessionId, 'Remote control was terminated locally by the host computer');
      }
    } catch (err) {
      console.error('Error handling agent message:', err);
    }
  });

  ws.on('close', async () => {
    connectedAgents.delete(deviceId);
    const closedNow = Date.now();

    // Check device's most recent heartbeat to prevent premature offline marking during brief socket drops
    const dev = await queryOne('SELECT last_seen, user_id FROM devices WHERE id = ?', [deviceId]);
    const elapsed = dev ? closedNow - Number(dev.last_seen) : 999999;
    const newStatus = elapsed < 90000 ? 'reconnecting' : 'offline';

    await execute("UPDATE devices SET device_status = ? WHERE id = ?", [newStatus, deviceId]);

    notifyUserDashboard(device.user_id, {
      type: 'device:status-change',
      deviceId,
      onlineStatus: newStatus === 'online',
      deviceStatus: newStatus,
      lastSeen: dev ? Number(dev.last_seen) : closedNow
    });

    for (const [sessId, session] of activeSessions.entries()) {
      if (session.deviceId === deviceId) {
        endSessionAndNotify(sessId, 'Desktop Agent disconnected from RemoteHub');
      }
    }
  });
}

async function handleClientConnection(ws: WebSocket, queryParams: any) {
  const sessionId = queryParams.sessionId as string;
  const sessionToken = queryParams.sessionToken as string;

  if (!sessionId || !sessionToken) {
    ws.close(1008, 'Missing sessionId or sessionToken');
    return;
  }

  const session = await queryOne('SELECT * FROM remote_sessions WHERE id = ? AND session_token = ?', [
    sessionId,
    sessionToken
  ]);

  if (!session || (session.session_status !== 'authorized' && session.session_status !== 'active')) {
    ws.close(1008, 'Invalid or expired remote session');
    return;
  }

  const deviceId = session.device_id;
  const agentWs = connectedAgents.get(deviceId);

  if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'server:error',
      message: 'Desktop Agent is currently unreachable or offline'
    }));
    ws.close(1000, 'Agent unavailable');
    return;
  }

  const active: ActiveSession = {
    sessionId,
    deviceId,
    userId: session.user_id,
    clientWs: ws,
    agentWs,
    startedAt: Date.now()
  };
  activeSessions.set(sessionId, active);

  // Send request to Desktop Agent with required local approval prompt
  agentWs.send(JSON.stringify({
    type: 'server:session-request',
    sessionId,
    userId: session.user_id,
    clientIp: session.client_ip
  }));

  ws.send(JSON.stringify({
    type: 'server:session-connected',
    sessionId,
    deviceId,
    approvalStatus: session.approval_status
  }));

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) return;

      const msg = JSON.parse(data.toString());

      if (msg.type === 'client:signal') {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({
            type: 'server:signal',
            sessionId,
            signal: msg.signal
          }));
        }
      } else if (msg.type === 'client:input') {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({
            type: 'server:input',
            sessionId,
            input: msg.input
          }));
        }
      } else if (msg.type === 'client:display-request') {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({
            type: 'server:display-request',
            sessionId,
            displayIndex: msg.displayIndex,
            quality: msg.quality,
            fps: msg.fps
          }));
        }
      } else if (msg.type === 'client:clipboard') {
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({
            type: 'server:clipboard',
            sessionId,
            text: msg.text
          }));
        }
      } else if (msg.type === 'client:disconnect') {
        endSessionAndNotify(sessionId, 'Client disconnected');
      }
    } catch (err) {
      console.error('Error handling client message:', err);
    }
  });

  ws.on('close', () => {
    endSessionAndNotify(sessionId, 'Client closed connection');
  });
}

export function approveSessionAndNotify(sessionId: string) {
  // Queue signaling message for HTTP polling clients
  queueSessionSignal(sessionId, 'agent', {
    type: 'server:session-approved',
    sessionId
  });

  const session = activeSessions.get(sessionId);
  if (session) {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify({
        type: 'server:session-approved',
        sessionId
      }));
    }
    if (session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
      session.agentWs.send(JSON.stringify({
        type: 'server:start-stream',
        sessionId
      }));
    }
  }
}

export function rejectSessionAndNotify(sessionId: string, reason: string) {
  queueSessionSignal(sessionId, 'agent', {
    type: 'server:session-rejected',
    sessionId,
    reason
  });

  const session = activeSessions.get(sessionId);
  if (session) {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify({
        type: 'server:session-rejected',
        sessionId,
        reason
      }));
      session.clientWs.close(1000, reason);
    }
    activeSessions.delete(sessionId);
  }
}

export async function endSessionAndNotify(sessionId: string, reason: string) {
  queueSessionSignal(sessionId, 'agent', {
    type: 'server:session-ended',
    sessionId,
    reason
  });

  const session = activeSessions.get(sessionId);
  if (!session) return;

  const now = Date.now();
  await execute("UPDATE remote_sessions SET session_status = 'ended', disconnected_at = ? WHERE id = ?", [
    now,
    sessionId
  ]);

  if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.send(JSON.stringify({
      type: 'server:session-ended',
      sessionId,
      reason
    }));
    session.clientWs.close(1000, reason);
  }

  if (session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
    session.agentWs.send(JSON.stringify({
      type: 'server:session-terminate',
      sessionId,
      reason
    }));
  }

  activeSessions.delete(sessionId);
}

// -------------------------------------------------------------
// Universal Dual-Transport Signaling (WebSockets + HTTP Fallback)
// -------------------------------------------------------------
export interface QueuedSignal {
  id: string;
  sender: 'client' | 'agent';
  timestamp: number;
  data: any;
}

const sessionSignalQueues = new Map<string, QueuedSignal[]>();
const devicePendingRequests = new Map<string, any>();
const latestSessionFrames = new Map<string, { buffer: Buffer; timestamp: number }>();
const signalWaiters = new Map<string, Array<{ receiver: string; resolve: (signals: QueuedSignal[]) => void }>>();

export async function queueSessionSignal(sessionId: string, sender: 'client' | 'agent', data: any): Promise<void> {
  if (!sessionSignalQueues.has(sessionId)) {
    sessionSignalQueues.set(sessionId, []);
  }
  const queue = sessionSignalQueues.get(sessionId)!;
  const signalItem: QueuedSignal = {
    id: crypto.randomUUID(),
    sender,
    timestamp: Date.now(),
    data
  };
  queue.push(signalItem);

  if (queue.length > 200) {
    queue.splice(0, queue.length - 200);
  }

  // Persist to database for cross-instance serverless signaling (awaited so serverless container doesn't freeze before write)
  try {
    await execute(
      'INSERT INTO session_signals (id, session_id, sender, data, timestamp) VALUES (?, ?, ?, ?, ?)',
      [signalItem.id, sessionId, sender, JSON.stringify(data), signalItem.timestamp]
    );
  } catch {}

  // Wake up any long-polling listeners
  const waiters = signalWaiters.get(sessionId);
  if (waiters) {
    const remaining: typeof waiters = [];
    for (const waiter of waiters) {
      if (waiter.receiver !== sender) {
        waiter.resolve([signalItem]);
      } else {
        remaining.push(waiter);
      }
    }
    signalWaiters.set(sessionId, remaining);
  }

  // Also deliver over active WebSocket if connected
  const session = activeSessions.get(sessionId);
  if (session) {
    if (sender === 'client' && session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
      session.agentWs.send(JSON.stringify({
        type: 'server:signal',
        sessionId,
        signal: data
      }));
    } else if (sender === 'agent' && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify({
        type: 'server:signal',
        sessionId,
        signal: data
      }));
    }
  }
}

export async function pollSessionSignals(sessionId: string, receiver: 'client' | 'agent', since: number, timeoutMs = 3500): Promise<QueuedSignal[]> {
  const targetSender = receiver === 'client' ? 'agent' : 'client';

  // 1. Check in-memory queue first
  const queue = sessionSignalQueues.get(sessionId) || [];
  const memorySignals = queue.filter(s => s.sender === targetSender && s.timestamp > since);
  if (memorySignals.length > 0) {
    return memorySignals;
  }

  // 2. Query database for signals dispatched by another serverless container instance
  try {
    const dbSignals = await query(
      'SELECT id, sender, data, timestamp FROM session_signals WHERE session_id = ? AND sender = ? AND timestamp > ? ORDER BY timestamp ASC',
      [sessionId, targetSender, since]
    );

    if (dbSignals && dbSignals.length > 0) {
      return dbSignals.map(row => ({
        id: row.id,
        sender: row.sender,
        timestamp: Number(row.timestamp),
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      }));
    }
  } catch {}

  if (timeoutMs <= 0) {
    return [];
  }

  return new Promise<QueuedSignal[]>((resolve) => {
    if (!signalWaiters.has(sessionId)) {
      signalWaiters.set(sessionId, []);
    }
    const waiterEntry = { receiver, resolve };
    signalWaiters.get(sessionId)!.push(waiterEntry);

    setTimeout(() => {
      const list = signalWaiters.get(sessionId);
      if (list) {
        const idx = list.indexOf(waiterEntry);
        if (idx !== -1) list.splice(idx, 1);
      }
      resolve([]);
    }, timeoutMs);
  });
}

export function setDevicePendingRequest(deviceId: string, request: any) {
  devicePendingRequests.set(deviceId, request);

  // Deliver over active WebSocket if open
  const agentWs = connectedAgents.get(deviceId);
  if (agentWs && agentWs.readyState === WebSocket.OPEN) {
    agentWs.send(JSON.stringify({
      type: 'server:session-request',
      sessionId: request.sessionId,
      userId: request.userId,
      accountName: request.accountName || '',
      accountEmail: request.accountEmail || '',
      deviceName: request.deviceName || 'LOKI',
      clientIp: request.clientIp || 'Web Browser',
      userAgent: request.userAgent || '',
      expiresAt: request.expiresAt || 0,
      createdAt: request.createdAt || Date.now()
    }));
  }
}

export async function getDevicePendingRequest(deviceId: string): Promise<any> {
  const inMemory = devicePendingRequests.get(deviceId);
  if (inMemory && (!inMemory.expiresAt || inMemory.expiresAt > Date.now())) {
    return inMemory;
  }

  // Fallback: Query remote_sessions table from database (survives across serverless containers!)
  try {
    const now = Date.now();
    const activeThreshold = now - 60000; // within last 60 seconds
    const dbRow = await queryOne(`
      SELECT s.id AS sessionId, s.session_token AS sessionToken, s.device_id AS deviceId,
             s.user_id AS userId, s.client_ip AS clientIp, s.approval_status AS approvalStatus,
             s.created_at AS createdAt, u.name AS accountName, u.email AS accountEmail,
             d.device_name AS deviceName
      FROM remote_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN devices d ON s.device_id = d.id
      WHERE s.device_id = ? AND s.approval_status IN ('pending', 'approved')
        AND s.session_status IN ('pending_approval', 'authorized', 'active')
        AND s.created_at > ?
      ORDER BY s.created_at DESC LIMIT 1
    `, [deviceId, activeThreshold]);

    if (dbRow) {
      return {
        sessionId: dbRow.sessionId,
        sessionToken: dbRow.sessionToken,
        deviceId: dbRow.deviceId,
        deviceName: dbRow.deviceName || 'LOKI',
        userId: dbRow.userId,
        accountName: dbRow.accountName || dbRow.accountEmail || 'Authorized User',
        accountEmail: dbRow.accountEmail || '',
        clientIp: dbRow.clientIp || 'Web Browser',
        createdAt: Number(dbRow.createdAt),
        approvalStatus: dbRow.approvalStatus || 'pending'
      };
    }
  } catch {}

  return null;
}

export function clearDevicePendingRequest(deviceId: string, sessionId?: string) {
  const existing = devicePendingRequests.get(deviceId);
  if (!sessionId || (existing && existing.sessionId === sessionId)) {
    devicePendingRequests.delete(deviceId);
  }
}

export async function storeSessionFrame(sessionId: string, buffer: Buffer): Promise<void> {
  latestSessionFrames.set(sessionId, { buffer, timestamp: Date.now() });

  // Store in database / shared store for multi-container retrieval (awaited)
  try {
    const base64 = buffer.toString('base64');
    await execute(
      isPostgres
        ? 'INSERT INTO session_frames (session_id, frame_data, timestamp) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET frame_data = $2, timestamp = $3'
        : 'INSERT OR REPLACE INTO session_frames (session_id, frame_data, timestamp) VALUES (?, ?, ?)',
      [sessionId, base64, Date.now()]
    );
  } catch (err) {
    console.warn('[Frame] DB frame store warning:', err);
  }

  // Also deliver to client WebSocket if open
  const session = activeSessions.get(sessionId);
  if (session && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.send(buffer, { binary: true });
  }
}

export async function getSessionFrame(sessionId: string): Promise<Buffer | null> {
  const item = latestSessionFrames.get(sessionId);
  if (item && Date.now() - item.timestamp < 30000) {
    return item.buffer;
  }

  // Cross-container DB fallback (allows 30s buffer threshold)
  try {
    const row = await queryOne(
      'SELECT frame_data, timestamp FROM session_frames WHERE session_id = ? AND timestamp > ?',
      [sessionId, Date.now() - 30000]
    );
    if (row && row.frame_data) {
      const buf = Buffer.from(row.frame_data, 'base64');
      latestSessionFrames.set(sessionId, { buffer: buf, timestamp: Number(row.timestamp) });
      return buf;
    }
  } catch {}

  return null;
}
