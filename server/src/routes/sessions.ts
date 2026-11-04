import { Router, Response } from 'express';
import { db } from '../db.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { endSessionAndNotify } from '../websocket.js';

export const sessionsRouter = Router();

// Get list of active and recent sessions
sessionsRouter.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stmt = db.prepare(`
      SELECT
        s.*,
        d.device_name,
        d.os
      FROM remote_sessions s
      JOIN devices d ON s.device_id = d.id
      WHERE s.user_id = ?
      ORDER BY s.started_at DESC
      LIMIT 50
    `);

    const sessions = stmt.all(req.user!.id);
    return res.json({ sessions });
  } catch (err: any) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get session details
sessionsRouter.get('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stmt = db.prepare(`
      SELECT
        s.*,
        d.device_name,
        d.os
      FROM remote_sessions s
      JOIN devices d ON s.device_id = d.id
      WHERE s.id = ? AND s.user_id = ?
    `);

    const session = stmt.get(req.params.id, req.user!.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({ session });
  } catch (err: any) {
    console.error('Get session error:', err);
    return res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// Explicitly disconnect a session
sessionsRouter.post('/:id/disconnect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    const stmt = db.prepare('SELECT * FROM remote_sessions WHERE id = ? AND user_id = ?');
    const session: any = stmt.get(sessionId, req.user!.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const now = Date.now();
    db.prepare(`
      UPDATE remote_sessions
      SET status = 'ended', ended_at = ?
      WHERE id = ?
    `).run(now, sessionId);

    // Notify WebSocket peers
    endSessionAndNotify(sessionId, 'User requested disconnect');

    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'session_disconnected', 'Session manually ended by user', ?, ?)
    `).run(req.user!.id, session.device_id, req.ip || '', now);

    return res.json({ success: true, message: 'Session disconnected' });
  } catch (err: any) {
    console.error('Disconnect session error:', err);
    return res.status(500).json({ error: 'Failed to disconnect session' });
  }
});

// Return WebRTC ICE servers configuration (STUN + optional TURN)
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

