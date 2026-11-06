import { Router, Response } from 'express';
import { query, queryOne, execute } from '../db.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import {
  endSessionAndNotify,
  approveSessionAndNotify,
  rejectSessionAndNotify,
  queueSessionSignal,
  pollSessionSignals,
  storeSessionFrame,
  getSessionFrame
} from '../websocket.js';

export const sessionsRouter = Router();

// 1. List user sessions
sessionsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessions = await query(`
      SELECT
        s.id,
        s.device_id,
        s.session_status,
        s.approval_status,
        s.connection_type,
        s.client_ip,
        s.created_at AS started_at,
        s.disconnected_at AS ended_at,
        d.device_name,
        d.operating_system AS os
      FROM remote_sessions s
      JOIN devices d ON s.device_id = d.id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
      LIMIT 50
    `, [req.user!.id]);

    return res.json({ sessions });
  } catch (err: any) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// 2. Get session details
sessionsRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const session = await queryOne(`
      SELECT
        s.*,
        d.device_name,
        d.operating_system AS os
      FROM remote_sessions s
      JOIN devices d ON s.device_id = d.id
      WHERE s.id = ? AND s.user_id = ?
    `, [req.params.id, req.user!.id]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({ session });
  } catch (err: any) {
    console.error('Get session error:', err);
    return res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// 3. POST /api/sessions/:id/approve (Host user approves remote session)
sessionsRouter.post('/:id/approve', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const token = req.headers.authorization?.replace('Bearer ', '').trim();
    const session = await queryOne('SELECT * FROM remote_sessions WHERE id = ?', [sessionId]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.approval_status !== 'pending') {
      return res.status(400).json({ error: `Session is already ${session.approval_status}` });
    }

    const now = Date.now();
    // Expiration check (45s window + 15s grace = 60s max)
    if (session.created_at && (now - Number(session.created_at)) > 60000) {
      await execute("UPDATE remote_sessions SET approval_status = 'expired', session_status = 'ended', disconnected_at = ? WHERE id = ?", [now, sessionId]);
      return res.status(410).json({ error: 'Approval request has expired' });
    }

    // Verify caller credential if supplied (must match device auth_token or session_token)
    if (token) {
      const device = await queryOne('SELECT auth_token FROM devices WHERE id = ?', [session.device_id]);
      if (device && device.auth_token !== token && session.session_token !== token) {
        return res.status(403).json({ error: 'Unauthorized device credential' });
      }
    }

    await execute(`
      UPDATE remote_sessions
      SET approval_status = 'approved', session_status = 'active', connected_at = ?
      WHERE id = ?
    `, [now, sessionId]);

    clearDevicePendingRequest(session.device_id, sessionId);
    approveSessionAndNotify(sessionId);

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [session.user_id, session.device_id, 'session_approved', 'Host user approved remote connection on laptop', req.ip || '', now]
    );

    return res.json({ success: true, message: 'Session approved' });
  } catch (err: any) {
    console.error('Approve session error:', err);
    return res.status(500).json({ error: 'Failed to approve session' });
  }
});

// 4. POST /api/sessions/:id/reject (Host user rejects remote session)
sessionsRouter.post('/:id/reject', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { reason } = req.body || {};
    const token = req.headers.authorization?.replace('Bearer ', '').trim();
    const session = await queryOne('SELECT * FROM remote_sessions WHERE id = ?', [sessionId]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (token) {
      const device = await queryOne('SELECT auth_token FROM devices WHERE id = ?', [session.device_id]);
      if (device && device.auth_token !== token && session.session_token !== token) {
        return res.status(403).json({ error: 'Unauthorized device credential' });
      }
    }

    const now = Date.now();
    await execute(`
      UPDATE remote_sessions
      SET approval_status = 'rejected', session_status = 'ended', disconnected_at = ?
      WHERE id = ?
    `, [now, sessionId]);

    clearDevicePendingRequest(session.device_id, sessionId);
    rejectSessionAndNotify(sessionId, reason || 'Host user declined remote connection request');

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [session.user_id, session.device_id, 'session_rejected', `Host user declined remote connection: ${reason || 'Declined'}`, req.ip || '', now]
    );

    return res.json({ success: true, message: 'Session rejected' });
  } catch (err: any) {
    console.error('Reject session error:', err);
    return res.status(500).json({ error: 'Failed to reject session' });
  }
});

// 5. POST /api/sessions/:id/disconnect (Disconnect session)
sessionsRouter.post('/:id/disconnect', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const session = await queryOne('SELECT * FROM remote_sessions WHERE id = ? AND user_id = ?', [
      sessionId,
      req.user!.id
    ]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const now = Date.now();
    await execute(`
      UPDATE remote_sessions
      SET session_status = 'ended', disconnected_at = ?
      WHERE id = ?
    `, [now, sessionId]);

    endSessionAndNotify(sessionId, 'User requested disconnect');

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user!.id, session.device_id, 'session_disconnected', 'Session manually ended by user', req.ip || '', now]
    );

    return res.json({ success: true, message: 'Session disconnected' });
  } catch (err: any) {
    console.error('Disconnect session error:', err);
    return res.status(500).json({ error: 'Failed to disconnect session' });
  }
});

// 6. WebRTC ICE configuration
sessionsRouter.get('/config/ice-servers', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  const iceServers: any[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ]
    },
    // Public fallback TURN servers (OpenRelay) for NAT traversal across different internet networks
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  if (process.env.TURN_SERVER_URL) {
    iceServers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || ''
    });
  }

  return res.json({ iceServers });
});

// 7. POST /api/sessions/:id/signal (Send WebRTC SDP Offer/Answer, ICE Candidate, or Control Signal)
sessionsRouter.post('/:id/signal', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { sender, signal } = req.body;

    if (!sender || !signal) {
      return res.status(400).json({ error: 'Sender and signal payload are required' });
    }

    queueSessionSignal(sessionId, sender, signal);
    return res.json({ success: true, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Signal dispatch error:', err);
    return res.status(500).json({ error: 'Failed to dispatch signal' });
  }
});

// 8. GET /api/sessions/:id/signal (Poll WebRTC Signals - Supports Long Polling)
sessionsRouter.get('/:id/signal', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const receiver = (req.query.receiver as 'client' | 'agent') || 'client';
    const since = Number(req.query.since || 0);
    const timeout = Math.min(5000, Math.max(0, Number(req.query.timeout || 3500)));

    const signals = await pollSessionSignals(sessionId, receiver, since, timeout);
    return res.json({
      success: true,
      sessionId,
      timestamp: Date.now(),
      signals
    });
  } catch (err: any) {
    console.error('Signal poll error:', err);
    return res.status(500).json({ error: 'Failed to poll signals' });
  }
});

// 9. POST /api/sessions/:id/input (Input relay for mouse and keyboard)
sessionsRouter.post('/:id/input', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'Input event is required' });
    }

    queueSessionSignal(sessionId, 'client', {
      type: 'input',
      input
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Input dispatch error:', err);
    return res.status(500).json({ error: 'Failed to dispatch input' });
  }
});

// 10. POST /api/sessions/:id/frame (Frame relay fallback from Agent)
sessionsRouter.post('/:id/frame', (req, res) => {
  try {
    const sessionId = req.params.id;
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (typeof req.body === 'string') {
      buffer = Buffer.from(req.body, 'base64');
    } else if (req.body && req.body.frame) {
      buffer = Buffer.from(req.body.frame, 'base64');
    }

    if (buffer && buffer.length > 0) {
      storeSessionFrame(sessionId, buffer);
      return res.json({ success: true, timestamp: Date.now() });
    }

    return res.status(400).json({ error: 'Empty frame buffer' });
  } catch (err: any) {
    console.error('Store frame error:', err);
    return res.status(500).json({ error: 'Failed to store frame' });
  }
});

// 11. GET /api/sessions/:id/frame (Fetch latest frame fallback for Browser)
sessionsRouter.get('/:id/frame', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const frame = await getSessionFrame(sessionId);

    if (!frame) {
      return res.status(204).end();
    }

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': frame.length.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });

    return res.send(frame);
  } catch (err: any) {
    console.error('Get frame error:', err);
    return res.status(500).json({ error: 'Failed to retrieve frame' });
  }
});
