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

  // Background interval: sweep inactive devices (every 10s)
  setInterval(async () => {
    const now = Date.now();
    const staleThreshold = now - 45000;
    try {
      const offlineDevices = await query(`
        SELECT id, user_id, device_name FROM devices WHERE device_status = 'online' AND last_seen < ?
      `, [staleThreshold]);

      if (offlineDevices.length > 0) {
        await execute("UPDATE devices SET device_status = 'offline' WHERE device_status = 'online' AND last_seen < ?", [
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
    } catch (e) {
      console.error('Error sweeping stale devices:', e);
    }
  }, 10000);
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
    await execute("UPDATE devices SET device_status = 'offline', last_seen = ? WHERE id = ?", [closedNow, deviceId]);

    notifyUserDashboard(device.user_id, {
      type: 'device:status-change',
      deviceId,
      onlineStatus: false,
      deviceStatus: 'offline',
      lastSeen: closedNow
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
