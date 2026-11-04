import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword, generateToken } from '../security.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const checkStmt = db.prepare('SELECT id FROM users WHERE email = ?');
    const existing = checkStmt.get(trimmedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    const insertStmt = db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(userId, trimmedEmail, passwordHash, fullName.trim(), now, now);

    const logStmt = db.prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
      VALUES (?, 'user_register', 'User registered new account', ?, ?)
    `);
    logStmt.run(userId, req.ip || '', now);

    const token = generateToken({ id: userId, email: trimmedEmail, fullName: fullName.trim() });

    return res.status(201).json({
      token,
      user: {
        id: userId,
        email: trimmedEmail,
        fullName: fullName.trim()
      }
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Failed to register account' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const user: any = stmt.get(trimmedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const now = Date.now();
    const logStmt = db.prepare(`
      INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
      VALUES (?, 'user_login', 'User signed in', ?, ?)
    `);
    logStmt.run(user.id, req.ip || '', now);

    const token = generateToken({ id: user.id, email: user.email, fullName: user.full_name });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to sign in' });
  }
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const stmt = db.prepare('SELECT id, email, full_name, created_at FROM users WHERE id = ?');
  const user = stmt.get(req.user!.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ user });
});

authRouter.post('/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const logStmt = db.prepare(`
    INSERT INTO audit_logs (user_id, action, details, ip_address, created_at)
    VALUES (?, 'user_logout', 'User signed out', ?, ?)
  `);
  logStmt.run(req.user!.id, req.ip || '', Date.now());
  return res.json({ success: true, message: 'Logged out successfully' });
});

authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const stmt = db.prepare('SELECT password_hash FROM users WHERE id = ?');
    const user: any = stmt.get(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = await hashPassword(newPassword);
    const updateStmt = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');
    updateStmt.run(newHash, Date.now(), req.user!.id);

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

