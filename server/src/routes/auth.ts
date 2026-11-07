import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken
} from '../security.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

export const authRouter = Router();

// Helper to determine secure cookie settings
const isProduction = process.env.NODE_ENV === 'production';
const REFRESH_TOKEN_COOKIE_NAME = 'remotehub_refresh_token';
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 1 day if rememberMe=false

function setRefreshTokenCookie(res: Response, refreshToken: string, maxAgeMs: number = REFRESH_TOKEN_EXPIRY_MS) {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: maxAgeMs
  });
}

function clearRefreshTokenCookie(res: Response) {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth'
  });
}

// 1. POST /api/auth/register
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

    // Issue short-lived access token + rotating refresh token
    const accessToken = generateAccessToken({ id: userId, email: trimmedEmail, fullName: userName });
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken();
    const refreshExpiresAt = now + REFRESH_TOKEN_EXPIRY_MS;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Browser';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    await execute(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), userId, refreshHash, deviceInfo, ipAddress, refreshExpiresAt, now, now]);

    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, 'user_register', 'User registered new account', ipAddress, now]
    );

    setRefreshTokenCookie(res, refreshToken, REFRESH_TOKEN_EXPIRY_MS);

    return res.status(201).json({
      token: accessToken,
      refreshToken,
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

// 2. POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
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
    const maxAgeMs = rememberMe === false ? SESSION_EXPIRY_MS : REFRESH_TOKEN_EXPIRY_MS;
    const displayName = user.name || user.full_name || '';

    // Issue short-lived access token + rotating refresh token
    const accessToken = generateAccessToken({ id: user.id, email: user.email, fullName: displayName });
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken();
    const refreshExpiresAt = now + maxAgeMs;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Browser';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    await execute(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), user.id, refreshHash, deviceInfo, ipAddress, refreshExpiresAt, now, now]);

    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'user_login', 'User signed in', ipAddress, now]
    );

    setRefreshTokenCookie(res, refreshToken, maxAgeMs);

    return res.json({
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: displayName,
        name: displayName,
        avatarUrl: user.avatar_url || null
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Failed to sign in' });
  }
});

// 3. POST /api/auth/refresh (Silent token rotation for persistent login)
authRouter.post('/refresh', async (req, res) => {
  try {
    const rawCookies = (req as any).cookies || {};
    const candidateToken = req.body?.refreshToken || rawCookies[REFRESH_TOKEN_COOKIE_NAME];

    if (!candidateToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const tokenHash = hashRefreshToken(candidateToken);
    const now = Date.now();

    const storedSession = await queryOne(`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ? AND (revoked_at IS NULL) AND expires_at > ?
    `, [tokenHash, now]);

    if (!storedSession) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ error: 'Session expired or invalidated. Please sign in again.' });
    }

    // Load user record
    const user = await queryOne('SELECT id, name, full_name, email, avatar_url FROM users WHERE id = ?', [
      storedSession.user_id
    ]);

    if (!user) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ error: 'User account not found' });
    }

    // Rotate refresh token: revoke current token and generate replacement
    const { token: newRefreshToken, hash: newRefreshHash } = generateRefreshToken();
    const remainingLifetime = Number(storedSession.expires_at) - now;
    const newExpiresAt = Math.max(now + 24 * 60 * 60 * 1000, now + remainingLifetime);
    const newSessionId = crypto.randomUUID();
    const deviceInfo = req.headers['user-agent'] || storedSession.device_info || 'Unknown Browser';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    // Revoke old session
    await execute('UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      storedSession.id
    ]);

    // Insert new rotated session
    await execute(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [newSessionId, user.id, newRefreshHash, deviceInfo, ipAddress, newExpiresAt, now, now]);

    const displayName = user.name || user.full_name || '';
    const newAccessToken = generateAccessToken({ id: user.id, email: user.email, fullName: displayName });

    setRefreshTokenCookie(res, newRefreshToken, Math.max(0, newExpiresAt - now));

    return res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: displayName,
        name: displayName,
        avatarUrl: user.avatar_url || null
      }
    });
  } catch (err: any) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Failed to refresh authentication session' });
  }
});

// 4. POST /api/auth/logout (Revoke current session)
authRouter.post('/logout', async (req, res) => {
  try {
    const rawCookies = (req as any).cookies || {};
    const candidateToken = req.body?.refreshToken || rawCookies[REFRESH_TOKEN_COOKIE_NAME];

    if (candidateToken) {
      const tokenHash = hashRefreshToken(candidateToken);
      await execute('UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE token_hash = ?', [
        Date.now(),
        Date.now(),
        tokenHash
      ]);
    }

    clearRefreshTokenCookie(res);
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Failed to logout' });
  }
});

// 5. POST /api/auth/logout-all (Revoke all sessions across all devices)
authRouter.post('/logout-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = Date.now();

    await execute('UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      now,
      now,
      userId
    ]);

    clearRefreshTokenCookie(res);

    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, 'user_logout_all', 'User revoked all active sessions', req.ip || '', now]
    );

    return res.json({ success: true, message: 'All sessions successfully revoked' });
  } catch (err: any) {
    console.error('Logout all error:', err);
    return res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// 6. GET /api/auth/sessions (List active devices/browsers for account)
authRouter.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = Date.now();
    const sessions = await query(`
      SELECT id, device_info, ip_address, created_at, updated_at, expires_at
      FROM refresh_tokens
      WHERE user_id = ? AND (revoked_at IS NULL) AND expires_at > ?
      ORDER BY updated_at DESC
    `, [req.user!.id, now]);

    return res.json({ sessions });
  } catch (err: any) {
    console.error('Get sessions error:', err);
    return res.status(500).json({ error: 'Failed to retrieve active sessions' });
  }
});

// 7. DELETE /api/auth/sessions/:id (Revoke a single remote browser session)
authRouter.delete('/sessions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = req.params.id;
    await execute('UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      Date.now(),
      Date.now(),
      sessionId,
      req.user!.id
    ]);

    return res.json({ success: true, message: 'Session revoked successfully' });
  } catch (err: any) {
    console.error('Revoke session error:', err);
    return res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// 8. GET /api/auth/config (Client configuration: Google OAuth status)
authRouter.get('/config', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  res.json({
    googleAuthEnabled: Boolean(googleClientId),
    googleClientId
  });
});

// 9. POST /api/auth/google (Google OAuth OpenID Connect verification)
authRouter.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is required' });
    }

    // Verify Google ID token using Google TokenInfo endpoint
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    const googleRes = await fetch(verifyUrl);

    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google authentication token' });
    }

    const payload: any = await googleRes.json();
    const googleEmail = payload.email?.toLowerCase();
    const googleSub = payload.sub; // Google User ID
    const googleName = payload.name || payload.given_name || 'Google User';
    const googlePicture = payload.picture || null;

    if (!googleEmail || !payload.email_verified) {
      return res.status(400).json({ error: 'Google email is not verified or unavailable' });
    }

    // Check if configured client ID matches (if set in production)
    const expectedClientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (expectedClientId && payload.aud !== expectedClientId) {
      return res.status(401).json({ error: 'Google token audience mismatch' });
    }

    const now = Date.now();
    let user = await queryOne('SELECT * FROM users WHERE email = ?', [googleEmail]);

    if (user) {
      // Existing user: Link Google ID and update avatar if missing
      await execute('UPDATE users SET google_id = COALESCE(google_id, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?', [
        googleSub,
        googlePicture,
        now,
        user.id
      ]);
    } else {
      // New user: Create account seamlessly
      const userId = crypto.randomUUID();
      const unusableHash = await hashPassword(crypto.randomBytes(32).toString('hex'));

      await execute(`
        INSERT INTO users (id, name, full_name, email, password_hash, google_id, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [userId, googleName, googleName, googleEmail, unusableHash, googleSub, googlePicture, now, now]);

      user = {
        id: userId,
        name: googleName,
        full_name: googleName,
        email: googleEmail,
        avatar_url: googlePicture
      };
    }

    const displayName = user.name || user.full_name || googleName;
    const accessToken = generateAccessToken({ id: user.id, email: user.email, fullName: displayName });
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken();
    const refreshExpiresAt = now + REFRESH_TOKEN_EXPIRY_MS;
    const deviceInfo = req.headers['user-agent'] || 'Google Authenticated Device';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    await execute(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [crypto.randomUUID(), user.id, refreshHash, deviceInfo, ipAddress, refreshExpiresAt, now, now]);

    await execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'user_login_google', 'User signed in with Google', ipAddress, now]
    );

    setRefreshTokenCookie(res, refreshToken, REFRESH_TOKEN_EXPIRY_MS);

    return res.json({
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: displayName,
        name: displayName,
        avatarUrl: user.avatar_url || googlePicture
      }
    });
  } catch (err: any) {
    console.error('Google login error:', err);
    return res.status(500).json({ error: 'Failed to process Google sign-in' });
  }
});

// 10. GET /api/auth/me (Get profile with auto-recovery)
authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let user = await queryOne('SELECT id, name, full_name, email, avatar_url, created_at FROM users WHERE id = ?', [req.user!.id]);
    if (!user && req.user?.id) {
      // In serverless multi-container environments where a container just spun up:
      // req.user has already been cryptographically validated by requireAuth (via verifyToken with server secret).
      // Auto-restore this user into this container's database so sessions persist across all containers!
      const now = Date.now();
      const userName = req.user.fullName || req.user.email?.split('@')[0] || 'User';
      const safeEmail = req.user.email || `${req.user.id}@remotehub.internal`;

      await execute(`
        INSERT INTO users (id, name, full_name, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [req.user.id, userName, userName, safeEmail, 'SESSION_RESTORED', now, now]);

      user = await queryOne('SELECT id, name, full_name, email, avatar_url, created_at FROM users WHERE id = ?', [req.user.id]);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const displayName = user.name || user.full_name || '';
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: displayName,
        name: displayName,
        avatarUrl: user.avatar_url || null,
        createdAt: user.created_at
      }
    });
  } catch (err: any) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
});

// 11. POST /api/auth/change-password
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
