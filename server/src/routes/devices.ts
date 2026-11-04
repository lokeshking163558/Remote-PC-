import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import {
  hashPin,
  verifyPin,
  generateDeviceAuthToken,
  generatePairingCode,
  generateSessionToken,
  sendWakeOnLan
} from '../security.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

export const devicesRouter = Router();

// 1. List user's devices
devicesRouter.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stmt = db.prepare(`
      SELECT
        d.id,
        d.device_name,
        d.os,
        d.agent_version,
        d.online_status,
        d.last_seen,
        d.local_ip,
        d.mac_address,
        d.registered_at,
        CASE WHEN c.pin_hash IS NOT NULL THEN 1 ELSE 0 END AS has_pin,
        c.failed_attempts,
        c.lockout_until,
        (SELECT json_object('cpuUsage', cpu_usage, 'memoryUsage', memory_usage, 'storageUsage', storage_usage, 'batteryPercent', battery_percent, 'isCharging', is_charging, 'collectedAt', collected_at)
         FROM device_metrics
         WHERE device_id = d.id
         ORDER BY collected_at DESC
         LIMIT 1) AS latest_metrics
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.user_id = ?
      ORDER BY d.online_status DESC, d.last_seen DESC
    `);

    const rows: any[] = stmt.all(req.user!.id);
    const devices = rows.map((r) => ({
      id: r.id,
      deviceName: r.device_name,
      os: r.os,
      agentVersion: r.agent_version,
      onlineStatus: Boolean(r.online_status),
      lastSeen: r.last_seen,
      localIp: r.local_ip,
      macAddress: r.mac_address,
      registeredAt: r.registered_at,
      hasPin: Boolean(r.has_pin),
      isLocked: r.lockout_until > Date.now(),
      lockoutUntil: r.lockout_until,
      latestMetrics: r.latest_metrics ? JSON.parse(r.latest_metrics) : null
    }));

    return res.json({ devices });
  } catch (err: any) {
    console.error('List devices error:', err);
    return res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

// 2. Generate a 6-digit pairing code for Windows Agent setup
devicesRouter.post('/generate-pairing-code', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    // Clean up expired pairing codes
    db.exec(`DELETE FROM pairing_codes WHERE expires_at < ${Date.now()}`);

    const code = generatePairingCode();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes validity
    const now = Date.now();

    const insertStmt = db.prepare(`
      INSERT INTO pairing_codes (code, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `);
    insertStmt.run(code, req.user!.id, expiresAt, now);

    return res.json({
      pairingCode: code,
      expiresAt,
      expiresInMinutes: 15
    });
  } catch (err: any) {
    console.error('Generate pairing code error:', err);
    return res.status(500).json({ error: 'Failed to generate pairing code' });
  }
});

// 3. Pair device using a pairing code (Called by desktop agent during initial setup)
devicesRouter.post('/pair', async (req, res) => {
  try {
    const { pairingCode, deviceName, os, pin, agentVersion, macAddress, localIp } = req.body;

    if (!pairingCode || !deviceName || !pin) {
      return res.status(400).json({ error: 'Pairing code, device name, and access PIN are required' });
    }

    if (!/^\d{6,8}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 6 to 8 digits' });
    }

    const codeStmt = db.prepare('SELECT * FROM pairing_codes WHERE code = ? AND expires_at > ?');
    const pairRecord: any = codeStmt.get(pairingCode, Date.now());

    if (!pairRecord) {
      return res.status(400).json({ error: 'Invalid or expired pairing code. Please generate a new code from the dashboard.' });
    }

    const userId = pairRecord.user_id;
    const deviceId = crypto.randomUUID();
    const authToken = generateDeviceAuthToken();
    const now = Date.now();

    const insertDevice = db.prepare(`
      INSERT INTO devices (id, user_id, device_name, os, agent_version, auth_token, online_status, last_seen, local_ip, mac_address, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);
    insertDevice.run(
      deviceId,
      userId,
      deviceName.trim(),
      os || 'Windows',
      agentVersion || '1.0.0',
      authToken,
      now,
      localIp || null,
      macAddress || null,
      now
    );

    const { hash, salt } = hashPin(pin);
    const insertCreds = db.prepare(`
      INSERT INTO device_credentials (device_id, pin_hash, pin_salt, pin_updated_at, failed_attempts, lockout_until)
      VALUES (?, ?, ?, ?, 0, 0)
    `);
    insertCreds.run(deviceId, hash, salt, now);

    // Consume pairing code
    db.prepare('DELETE FROM pairing_codes WHERE code = ?').run(pairingCode);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'device_paired', ?, ?, ?)
    `).run(userId, deviceId, `Device paired: ${deviceName.trim()}`, req.ip || '', now);

    return res.status(201).json({
      success: true,
      deviceId,
      authToken,
      deviceName: deviceName.trim(),
      message: 'Device successfully paired and registered to RemoteHub'
    });
  } catch (err: any) {
    console.error('Device pairing error:', err);
    return res.status(500).json({ error: 'Failed to pair device' });
  }
});

// 4. Get specific device details
devicesRouter.get('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const stmt = db.prepare(`
      SELECT
        d.*,
        c.pin_updated_at,
        c.failed_attempts,
        c.lockout_until
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.id = ? AND d.user_id = ?
    `);

    const r: any = stmt.get(req.params.id, req.user!.id);
    if (!r) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Get latest metrics
    const metricsStmt = db.prepare(`
      SELECT cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at
      FROM device_metrics
      WHERE device_id = ?
      ORDER BY collected_at DESC
      LIMIT 1
    `);
    const metrics = metricsStmt.get(r.id);

    // Get recent sessions
    const sessionsStmt = db.prepare(`
      SELECT id, status, connection_type, started_at, ended_at, client_ip
      FROM remote_sessions
      WHERE device_id = ?
      ORDER BY started_at DESC
      LIMIT 10
    `);
    const recentSessions = sessionsStmt.all(r.id);

    return res.json({
      device: {
        id: r.id,
        deviceName: r.device_name,
        os: r.os,
        agentVersion: r.agent_version,
        onlineStatus: Boolean(r.online_status),
        lastSeen: r.last_seen,
        localIp: r.local_ip,
        macAddress: r.mac_address,
        registeredAt: r.registered_at,
        isLocked: r.lockout_until > Date.now(),
        lockoutUntil: r.lockout_until,
        failedAttempts: r.failed_attempts,
        pinConfigured: Boolean(r.pin_updated_at),
        pinUpdatedAt: r.pin_updated_at,
        latestMetrics: metrics || null,
        recentSessions
      }
    });
  } catch (err: any) {
    console.error('Get device error:', err);
    return res.status(500).json({ error: 'Failed to retrieve device details' });
  }
});

// 5. Update device name
devicesRouter.patch('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceName } = req.body;
    if (!deviceName || !deviceName.trim()) {
      return res.status(400).json({ error: 'Device name cannot be empty' });
    }

    const checkStmt = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?');
    const exists = checkStmt.get(req.params.id, req.user!.id);
    if (!exists) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const updateStmt = db.prepare('UPDATE devices SET device_name = ? WHERE id = ?');
    updateStmt.run(deviceName.trim(), req.params.id);

    return res.json({ success: true, message: 'Device updated successfully' });
  } catch (err: any) {
    console.error('Update device error:', err);
    return res.status(500).json({ error: 'Failed to update device' });
  }
});

// 6. Delete / unregister device
devicesRouter.delete('/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const checkStmt = db.prepare('SELECT id, device_name FROM devices WHERE id = ? AND user_id = ?');
    const device: any = checkStmt.get(req.params.id, req.user!.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'device_removed', ?, ?, ?)
    `).run(req.user!.id, req.params.id, `Removed device: ${device.device_name}`, req.ip || '', Date.now());

    return res.json({ success: true, message: 'Device removed successfully' });
  } catch (err: any) {
    console.error('Delete device error:', err);
    return res.status(500).json({ error: 'Failed to delete device' });
  }
});

// 7. Verify Device PIN with progressive delays & rate-limiting lockout
devicesRouter.post('/:id/verify-pin', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pin } = req.body;
    const deviceId = req.params.id;

    if (!pin) {
      return res.status(400).json({ error: 'PIN is required' });
    }

    // Verify device ownership
    const devStmt = db.prepare('SELECT id, device_name, online_status FROM devices WHERE id = ? AND user_id = ?');
    const device: any = devStmt.get(deviceId, req.user!.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (!device.online_status) {
      return res.status(400).json({ error: 'Device is currently offline. Cannot establish a remote session.' });
    }

    // Load credentials
    const credStmt = db.prepare('SELECT * FROM device_credentials WHERE device_id = ?');
    const creds: any = credStmt.get(deviceId);
    if (!creds) {
      return res.status(400).json({ error: 'No PIN has been configured for this computer' });
    }

    const now = Date.now();

    // Check if device is in lockout
    if (creds.lockout_until && creds.lockout_until > now) {
      const remainingSeconds = Math.ceil((creds.lockout_until - now) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);

      db.prepare(`
        INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
        VALUES (?, ?, 'pin_attempt_blocked', 'Attempt while locked out', ?, ?)
      `).run(req.user!.id, deviceId, req.ip || '', now);

      return res.status(429).json({
        error: `PIN verification is locked due to too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
        locked: true,
        remainingSeconds
      });
    }

    // Verify PIN with constant-time scrypt
    const isMatch = verifyPin(pin, creds.pin_hash, creds.pin_salt);

    if (!isMatch) {
      const failedAttempts = creds.failed_attempts + 1;
      let lockoutUntil = 0;
      let delayMs = 1000;

      if (failedAttempts >= 5) {
        lockoutUntil = now + 15 * 60 * 1000; // 15 minutes lockout
      } else if (failedAttempts >= 3) {
        delayMs = 3000; // 3 seconds progressive delay
      }

      db.prepare(`
        UPDATE device_credentials
        SET failed_attempts = ?, lockout_until = ?
        WHERE device_id = ?
      `).run(failedAttempts, lockoutUntil, deviceId);

      db.prepare(`
        INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
        VALUES (?, ?, 'pin_failed', ?, ?, ?)
      `).run(req.user!.id, deviceId, `Failed attempt #${failedAttempts}`, req.ip || '', now);

      // Sleep to prevent rapid-fire brute-force
      await new Promise((r) => setTimeout(r, delayMs));

      if (lockoutUntil > 0) {
        return res.status(429).json({
          error: 'Maximum failed PIN attempts exceeded. Device locked for 15 minutes.',
          locked: true,
          remainingSeconds: 15 * 60
        });
      }

      return res.status(401).json({
        error: `Invalid PIN. ${5 - failedAttempts} attempts remaining before temporary lockout.`,
        attemptsRemaining: 5 - failedAttempts
      });
    }

    // Success! Reset failed attempts
    db.prepare(`
      UPDATE device_credentials
      SET failed_attempts = 0, lockout_until = 0
      WHERE device_id = ?
    `).run(deviceId);

    // Create a new authorized remote session record
    const sessionId = crypto.randomUUID();
    const sessionToken = generateSessionToken(req.user!.id, deviceId, sessionId);

    db.prepare(`
      INSERT INTO remote_sessions (id, user_id, device_id, session_token, status, connection_type, started_at, client_ip)
      VALUES (?, ?, ?, ?, 'authorized', 'p2p_direct', ?, ?)
    `).run(sessionId, req.user!.id, deviceId, sessionToken, now, req.ip || '');

    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'pin_verified', 'Session authorized', ?, ?)
    `).run(req.user!.id, deviceId, req.ip || '', now);

    return res.json({
      success: true,
      sessionId,
      sessionToken,
      deviceId,
      deviceName: device.device_name,
      expiresInSeconds: 60
    });
  } catch (err: any) {
    console.error('PIN verification error:', err);
    return res.status(500).json({ error: 'Failed to verify PIN' });
  }
});

// 8. Change Device PIN
devicesRouter.post('/:id/change-pin', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPin, newPin } = req.body;
    const deviceId = req.params.id;

    if (!newPin || !/^\d{6,8}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be 6 to 8 digits' });
    }

    const devStmt = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?');
    const device = devStmt.get(deviceId, req.user!.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const credStmt = db.prepare('SELECT * FROM device_credentials WHERE device_id = ?');
    const creds: any = credStmt.get(deviceId);

    if (creds && creds.pin_hash) {
      if (!currentPin) {
        return res.status(400).json({ error: 'Current PIN is required to set a new PIN' });
      }
      const isMatch = verifyPin(currentPin, creds.pin_hash, creds.pin_salt);
      if (!isMatch) {
        return res.status(401).json({ error: 'Current PIN is incorrect' });
      }
    }

    const { hash, salt } = hashPin(newPin);
    const now = Date.now();

    db.prepare(`
      UPDATE device_credentials
      SET pin_hash = ?, pin_salt = ?, pin_updated_at = ?, failed_attempts = 0, lockout_until = 0
      WHERE device_id = ?
    `).run(hash, salt, now, deviceId);

    // Invalidate any ongoing sessions for this device
    db.prepare(`
      UPDATE remote_sessions
      SET status = 'ended', ended_at = ?
      WHERE device_id = ? AND status IN ('authorized', 'active')
    `).run(now, deviceId);

    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'pin_changed', 'Access PIN updated and previous sessions invalidated', ?, ?)
    `).run(req.user!.id, deviceId, req.ip || '', now);

    return res.json({ success: true, message: 'Device PIN successfully updated' });
  } catch (err: any) {
    console.error('Change PIN error:', err);
    return res.status(500).json({ error: 'Failed to change PIN' });
  }
});

// 9. Wake-on-LAN request
devicesRouter.post('/:id/wake', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const devStmt = db.prepare('SELECT id, device_name, mac_address, online_status FROM devices WHERE id = ? AND user_id = ?');
    const device: any = devStmt.get(req.params.id, req.user!.id);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.online_status) {
      return res.json({
        success: true,
        message: `${device.device_name} is already online.`,
        alreadyOnline: true
      });
    }

    if (!device.mac_address) {
      return res.status(400).json({
        error: 'Wake-on-LAN requires a MAC address, but none has been reported by the agent yet. Please ensure the agent has connected at least once.',
        code: 'MAC_UNAVAILABLE'
      });
    }

    const sent = await sendWakeOnLan(device.mac_address);
    const now = Date.now();

    db.prepare(`
      INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at)
      VALUES (?, ?, 'wake_requested', ?, ?, ?)
    `).run(
      req.user!.id,
      device.id,
      `Wake-on-LAN magic packet sent to ${device.mac_address}`,
      req.ip || '',
      now
    );

    return res.json({
      success: sent,
      macAddress: device.mac_address,
      message: sent
        ? `Magic packet sent to ${device.mac_address}. Note: Wake-on-LAN requires the target PC to have Wake-on-LAN enabled in BIOS/UEFI, connected to power, and typically requires a wired Ethernet or supported Wake-on-WLAN adapter.`
        : 'Failed to send broadcast magic packet.',
      limitations: [
        'Device must be connected to power (AC adapter plugged in for laptops).',
        'Wake-on-LAN must be enabled in the BIOS/UEFI power management settings.',
        'Network adapter must support wake packets in Windows Device Manager.',
        'Wired Ethernet is substantially more reliable than Wi-Fi across power states.'
      ]
    });
  } catch (err: any) {
    console.error('Wake-on-LAN error:', err);
    return res.status(500).json({ error: 'Failed to send Wake-on-LAN packet' });
  }
});

// 10. Get Device historical metrics
devicesRouter.get('/:id/metrics', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const devStmt = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?');
    const device = devStmt.get(req.params.id, req.user!.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const stmt = db.prepare(`
      SELECT cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at
      FROM device_metrics
      WHERE device_id = ?
      ORDER BY collected_at DESC
      LIMIT 60
    `);

    const metrics = stmt.all(req.params.id);
    return res.json({ metrics });
  } catch (err: any) {
    console.error('Get metrics error:', err);
    return res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

