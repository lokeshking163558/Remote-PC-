import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { queryOne, execute } from '../db.js';
import { hashPassword, verifyPassword, generateToken } from '../security.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, name } = req.body;
    const userName = (fullName || name || '').trim();

    if (!email || !password || !userName) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const existingUser = await queryOne('SELECT id FROM users WHERE email = ?', [trimmedEmail]);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const now = Date.now();

    await execute(
      'INSERT INTO users (id, name, full_name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, userName, userName, trimmedEmail, passwordHash, now, now]
    );

    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, 'user_register', 'User registered new account', req.ip || '', now]
    );

    const token = generateToken({ id: userId, email: trimmedEmail, fullName: userName });

    return res.status(201).json({
      token,
      user: {
        id: userId,
        email: trimmedEmail,
        fullName: userName,
        name: userName
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
    const user = await queryOne('SELECT * FROM users WHERE email = ?', [trimmedEmail]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const now = Date.now();
    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'user_login', 'User signed in', req.ip || '', now]
    );

    const displayName = user.name || user.full_name || '';
    const token = generateToken({ id: user.id, email: user.email, fullName: displayName });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: displayName,
        name: displayName
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to sign in' });
  }
});

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await queryOne('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user!.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.name,
        name: user.name,
        createdAt: user.created_at
      }
    });
  } catch (err: any) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user!.id, 'user_logout', 'User signed out', req.ip || '', Date.now()]
    );
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to logout' });
  }
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

    const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user!.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = await hashPassword(newPassword);
    await execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [newHash, Date.now(), req.user!.id]);

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});
