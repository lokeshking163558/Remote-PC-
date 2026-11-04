import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import url from 'node:url';
import { db } from './db.js';

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

  // Background interval: sweep inactive sessions and clean heartbeats
  setInterval(() => {
    const now = Date.now();
    // Devices with no heartbeat for > 45 seconds are marked offline
    const staleThreshold = now - 45000;
    try {
      const offlineDevices: any[] = db.prepare(`
        SELECT id, user_id, device_name FROM devices WHERE online_status = 1 AND last_seen < ?
      `).all(staleThreshold);

      if (offlineDevices.length > 0) {
        db.prepare('UPDATE devices SET online_status = 0 WHERE online_status = 1 AND last_seen < ?').run(staleThreshold);

        for (const dev of offlineDevices) {
          notifyUserDashboard(dev.user_id, {
            type: 'device:status-change',
            deviceId: dev.id,
            onlineStatus: false,
            lastSeen: now
          });
        }
      }
    } catch (e) {
      console.error('Error sweeping stale devices:', e);
    }
  }, 10000);
}

function handleDashboardConnection(ws: WebSocket, query: any) {
  const userId = query.userId as string;
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

function handleAgentConnection(ws: WebSocket, query: any) {
  const deviceId = query.deviceId as string;
  const token = query.token as string;

  if (!deviceId || !token) {
    ws.close(1008, 'Missing deviceId or authToken');
    return;
  }

  // Validate agent device & token in database
  const stmt = db.prepare('SELECT id, user_id, device_name, auth_token FROM devices WHERE id = ?');
  const device: any = stmt.get(deviceId);

  if (!device || device.auth_token !== token) {
    ws.close(1008, 'Invalid device credentials');
    return;
  }

  // Register connected agent
  connectedAgents.set(deviceId, ws);

  const now = Date.now();
  db.prepare('UPDATE devices SET online_status = 1, last_seen = ? WHERE id = ?').run(now, deviceId);

  // Notify dashboard
  notifyUserDashboard(device.user_id, {
    type: 'device:status-change',
    deviceId,
    onlineStatus: true,
    lastSeen: now
  });

  ws.send(JSON.stringify({
    type: 'server:agent-registered',
    deviceId,
    deviceName: device.device_name,
    timestamp: now
  }));

  ws.on('message', (data, isBinary) => {
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
        db.prepare('UPDATE devices SET last_seen = ?, local_ip = COALESCE(?, local_ip), mac_address = COALESCE(?, mac_address) WHERE id = ?')
          .run(timestamp, msg.localIp || null, msg.macAddress || null, deviceId);

        if (msg.metrics) {
          db.prepare(`
            INSERT INTO device_metrics (device_id, cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            deviceId,
            msg.metrics.cpuUsage || 0,
            msg.metrics.memoryUsage || 0,
            msg.metrics.storageUsage || 0,
            msg.metrics.batteryPercent ?? null,
            msg.metrics.isCharging ? 1 : 0,
            timestamp
          );

          // Relay metrics to active remote session client
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
      } else if (msg.type === 'agent:signal') {
        // WebRTC signaling from agent to browser client
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
        // Local user on the computer pressed "Stop Remote Session"
        const session = activeSessions.get(msg.sessionId);
        if (session) {
          endSessionAndNotify(msg.sessionId, 'Remote control was terminated by the host computer');
        }
      }
    } catch (err) {
      console.error('Error handling agent message:', err);
    }
  });

  ws.on('close', () => {
    connectedAgents.delete(deviceId);
    const closedNow = Date.now();
    db.prepare('UPDATE devices SET online_status = 0, last_seen = ? WHERE id = ?').run(closedNow, deviceId);

    notifyUserDashboard(device.user_id, {
      type: 'device:status-change',
      deviceId,
      onlineStatus: false,
      lastSeen: closedNow
    });

    // Terminate any active sessions for this device
    for (const [sessId, session] of activeSessions.entries()) {
      if (session.deviceId === deviceId) {
        endSessionAndNotify(sessId, 'Desktop Agent disconnected from RemoteHub');
      }
    }
  });
}

function handleClientConnection(ws: WebSocket, query: any) {
  const sessionId = query.sessionId as string;
  const sessionToken = query.sessionToken as string;

  if (!sessionId || !sessionToken) {
    ws.close(1008, 'Missing sessionId or sessionToken');
    return;
  }

  // Look up session in DB
  const stmt = db.prepare('SELECT * FROM remote_sessions WHERE id = ? AND session_token = ?');
  const session: any = stmt.get(sessionId, sessionToken);

  if (!session || (session.status !== 'authorized' && session.status !== 'active')) {
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

  // Update session status in DB
  db.prepare('UPDATE remote_sessions SET status = \'active\' WHERE id = ?').run(sessionId);

  const active: ActiveSession = {
    sessionId,
    deviceId,
    userId: session.user_id,
    clientWs: ws,
    agentWs,
    startedAt: Date.now()
  };
  activeSessions.set(sessionId, active);

  // Send session request to Agent
  agentWs.send(JSON.stringify({
    type: 'server:session-request',
    sessionId,
    userId: session.user_id,
    clientIp: session.client_ip
  }));

  ws.send(JSON.stringify({
    type: 'server:session-connected',
    sessionId,
    deviceId
  }));

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) return;

      const msg = JSON.parse(data.toString());

      if (msg.type === 'client:signal') {
        // WebRTC signaling from client to agent
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(JSON.stringify({
            type: 'server:signal',
            sessionId,
            signal: msg.signal
          }));
        }
      } else if (msg.type === 'client:input') {
        // Send user input (mouse, keyboard, touch) directly to Agent
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

export function endSessionAndNotify(sessionId: string, reason: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const now = Date.now();
  db.prepare(`
    UPDATE remote_sessions
    SET status = 'ended', ended_at = ?
    WHERE id = ?
  `).run(now, sessionId);

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

