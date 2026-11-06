import { Router, Response } from 'express';
import crypto from 'node:crypto';
import { query, queryOne, execute } from '../db.js';
import {
  hashPin,
  verifyPin,
  generateDeviceAuthToken,
  generatePairingCode,
  generateSessionToken,
  sendWakeOnLan
} from '../security.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import {
  notifyUserDashboard,
  setDevicePendingRequest,
  getDevicePendingRequest,
  clearDevicePendingRequest
} from '../websocket.js';

export const devicesRouter = Router();

// 1. List user's devices
devicesRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const devices = await query(`
      SELECT
        d.id,
        d.device_name AS "deviceName",
        d.operating_system AS "os",
        d.agent_version AS "agentVersion",
        d.device_status AS "deviceStatus",
        d.last_seen AS "lastSeen",
        d.local_ip AS "localIp",
        d.mac_address AS "macAddress",
        d.installation_id AS "installationId",
        d.wake_support AS "wakeSupport",
        d.trusted_mode AS "trustedMode",
        d.created_at AS "registeredAt",
        CASE WHEN c.pin_hash IS NOT NULL THEN true ELSE false END AS "hasPin",
        c.failed_attempts AS "failedAttempts",
        c.lockout_until AS "lockoutUntil"
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.user_id = ?
      ORDER BY d.last_seen DESC
    `, [req.user!.id]);

    const now = Date.now();
    const formattedDevices = await Promise.all(
      devices.map(async (d: any) => {
        const latestMetrics = await queryOne(`
          SELECT cpu_usage AS "cpuUsage", memory_usage AS "memoryUsage", storage_usage AS "storageUsage",
                 battery_percent AS "batteryPercent", is_charging AS "isCharging", collected_at AS "collectedAt"
          FROM device_metrics
          WHERE device_id = ?
          ORDER BY collected_at DESC
          LIMIT 1
        `, [d.id]);

        const lastSeen = Number(d.lastSeen);
        const elapsedMs = Math.max(0, now - lastSeen);

        // 3-State Dynamic Resolution based on server time and 90s stale threshold
        let dynamicStatus: 'online' | 'reconnecting' | 'offline';
        if (elapsedMs <= 45000) {
          dynamicStatus = 'online';
        } else if (elapsedMs <= 90000) {
          dynamicStatus = 'reconnecting';
        } else {
          dynamicStatus = 'offline';
        }

        const isOnline = dynamicStatus === 'online';
        const isLocked = Number(d.lockoutUntil) > now;

        return {
          id: d.id,
          deviceName: d.deviceName,
          os: d.os,
          agentVersion: d.agentVersion,
          onlineStatus: isOnline,
          deviceStatus: dynamicStatus,
          lastSeen,
          lastSeenSecondsAgo: Math.floor(elapsedMs / 1000),
          localIp: d.localIp,
          macAddress: d.macAddress,
          installationId: d.installationId || null,
          registeredAt: Number(d.registeredAt),
          hasPin: Boolean(d.hasPin),
          trustedMode: d.trustedMode === undefined || d.trustedMode === null ? true : Boolean(d.trustedMode),
          isLocked,
          lockoutUntil: Number(d.lockoutUntil),
          latestMetrics: latestMetrics || null
        };
      })
    );

    return res.json({ devices: formattedDevices });
  } catch (err: any) {
    console.error('List devices error:', err);
    return res.status(500).json({ error: 'Failed to retrieve devices' });
  }
});

// 2. Generate a 6-digit pairing code
devicesRouter.post('/generate-pairing-code', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const now = Date.now();
    await execute('DELETE FROM pairing_codes WHERE expires_at < ?', [now]);

    const code = generatePairingCode();
    const expiresAt = now + 15 * 60 * 1000; // 15 mins

    await execute(
      'INSERT INTO pairing_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [code, req.user!.id, expiresAt, now]
    );

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

// 3. Pair device using a pairing code (Agent setup)
devicesRouter.post('/pair', async (req, res) => {
  try {
    const { pairingCode, deviceName, os, pin, agentVersion, macAddress, localIp, installationId, existingDeviceId } = req.body;

    if (!pairingCode || !deviceName || !pin) {
      return res.status(400).json({ error: 'Pairing code, device name, and access PIN are required' });
    }

    if (!/^\d{6,8}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 6 to 8 digits' });
    }

    const pairRecord = await queryOne('SELECT * FROM pairing_codes WHERE code = ? AND expires_at > ?', [
      pairingCode,
      Date.now()
    ]);

    if (!pairRecord) {
      return res.status(400).json({ error: 'Invalid or expired pairing code. Please generate a new code from the dashboard.' });
    }

    const userId = pairRecord.user_id;
    const now = Date.now();
    const authToken = generateDeviceAuthToken();
    const { hash, salt } = hashPin(pin);

    // Look up existing device for this user to prevent duplicate registrations
    let existingDevice: any = null;
    if (installationId) {
      existingDevice = await queryOne(
        'SELECT id, device_name FROM devices WHERE user_id = ? AND installation_id = ?',
        [userId, installationId]
      );
    }

    if (!existingDevice && existingDeviceId) {
      existingDevice = await queryOne(
        'SELECT id, device_name FROM devices WHERE user_id = ? AND id = ?',
        [userId, existingDeviceId]
      );
    }

    if (!existingDevice && macAddress) {
      existingDevice = await queryOne(
        'SELECT id, device_name FROM devices WHERE user_id = ? AND mac_address = ? AND device_name = ?',
        [userId, macAddress, deviceName.trim()]
      );
    }

    let finalDeviceId: string;

    if (existingDevice) {
      // Re-use and update existing device record
      finalDeviceId = existingDevice.id;
      await execute(`
        UPDATE devices
        SET device_name = ?, operating_system = ?, agent_version = ?,
            device_status = 'online', auth_token = ?, last_seen = ?,
            local_ip = COALESCE(?, local_ip), mac_address = COALESCE(?, mac_address),
            installation_id = COALESCE(?, installation_id)
        WHERE id = ?
      `, [
        deviceName.trim(),
        os || 'Windows',
        agentVersion || '1.0.0',
        authToken,
        now,
        localIp || null,
        macAddress || null,
        installationId || null,
        finalDeviceId
      ]);

      const existingCreds = await queryOne('SELECT device_id FROM device_credentials WHERE device_id = ?', [finalDeviceId]);
      if (existingCreds) {
        await execute(`
          UPDATE device_credentials
          SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, lockout_until = 0, updated_at = ?
          WHERE device_id = ?
        `, [hash, salt, now, finalDeviceId]);
      } else {
        await execute(`
          INSERT INTO device_credentials (device_id, pin_hash, pin_salt, failed_attempts, lockout_until, updated_at)
          VALUES (?, ?, ?, 0, 0, ?)
        `, [finalDeviceId, hash, salt, now]);
      }

      await execute(
        'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, finalDeviceId, 'device_repaired', `Existing device updated: ${deviceName.trim()}`, req.ip || '', now]
      );
    } else {
      // Create new device record
      finalDeviceId = crypto.randomUUID();
      await execute(`
        INSERT INTO devices (id, user_id, device_name, operating_system, agent_version, device_status, auth_token, last_seen, local_ip, mac_address, installation_id, wake_support, created_at)
        VALUES (?, ?, ?, ?, ?, 'online', ?, ?, ?, ?, ?, 1, ?)
      `, [
        finalDeviceId,
        userId,
        deviceName.trim(),
        os || 'Windows',
        agentVersion || '1.0.0',
        authToken,
        now,
        localIp || null,
        macAddress || null,
        installationId || null,
        now
      ]);

      await execute(`
        INSERT INTO device_credentials (device_id, pin_hash, pin_salt, failed_attempts, lockout_until, updated_at)
        VALUES (?, ?, ?, 0, 0, ?)
      `, [finalDeviceId, hash, salt, now]);

      await execute(
        'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, finalDeviceId, 'device_paired', `New device paired: ${deviceName.trim()}`, req.ip || '', now]
      );
    }

    // Invalidate single-use pairing code
    await execute('DELETE FROM pairing_codes WHERE code = ?', [pairingCode]);

    // Fetch account details to confirm ownership to the agent
    const user = await queryOne('SELECT email, name, full_name FROM users WHERE id = ?', [userId]);
    const accountEmail = user?.email || '';
    const accountName = user?.name || user?.full_name || '';

    return res.status(201).json({
      success: true,
      deviceId: finalDeviceId,
      authToken,
      deviceName: deviceName.trim(),
      userId,
      accountEmail,
      accountName,
      isExisting: !!existingDevice,
      message: existingDevice
        ? 'Existing computer successfully re-paired and updated'
        : 'Device successfully paired and registered to RemoteHub'
    });
  } catch (err: any) {
    console.error('Device pairing error:', err);
    return res.status(500).json({ error: 'Failed to pair device' });
  }
});

// 3b. POST /api/devices/verify-registration (Server-Confirmed Registration for Agent)
devicesRouter.post('/verify-registration', async (req, res) => {
  try {
    const { deviceId, authToken, installationId, deviceName } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required', verified: false });
    }

    const device = await queryOne(`
      SELECT d.*, u.email, u.name, u.full_name
      FROM devices d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [deviceId]);

    if (!device) {
      // Check if another device has the same installation_id for fallback recovery
      let matchedByInstallation: any = null;
      if (installationId) {
        matchedByInstallation = await queryOne(`
          SELECT d.*, u.email, u.name, u.full_name
          FROM devices d
          JOIN users u ON d.user_id = u.id
          WHERE d.installation_id = ?
        `, [installationId]);
      }

      return res.status(404).json({
        verified: false,
        status: 'not_registered',
        error: 'Device record not found in the server database',
        deviceId,
        installationId: installationId || null,
        alternativeDeviceId: matchedByInstallation?.id || null,
        canRecover: true
      });
    }

    if (authToken && device.auth_token !== authToken) {
      return res.status(401).json({
        verified: false,
        status: 'token_mismatch',
        error: 'Device authentication token does not match server record',
        deviceId
      });
    }

    // Update last_seen and online status on successful server verification
    const now = Date.now();
    await execute(`
      UPDATE devices
      SET device_status = 'online', last_seen = ?
      WHERE id = ?
    `, [now, deviceId]);

    return res.json({
      verified: true,
      status: 'confirmed',
      deviceId: device.id,
      ownerId: device.user_id,
      accountEmail: device.email,
      accountName: device.name || device.full_name || '',
      deviceName: device.device_name,
      trustedMode: device.trusted_mode === undefined || device.trusted_mode === null ? true : Boolean(device.trusted_mode)
    });
  } catch (err: any) {
    console.error('Verify registration error:', err);
    return res.status(500).json({ error: 'Failed to verify device registration', verified: false });
  }
});

// 3c. POST /api/devices/restore-device (Safe Account Sync & Device Recovery without creating duplicates)
devicesRouter.post('/restore-device', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, installationId, deviceName, authToken, os, pin } = req.body;
    const userId = req.user!.id;
    const now = Date.now();

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required for recovery' });
    }

    const finalName = (deviceName || 'My Computer').trim();
    const finalToken = authToken || generateDeviceAuthToken();

    // Check if device already exists in the database
    const existing = await queryOne('SELECT * FROM devices WHERE id = ?', [deviceId]);

    if (existing) {
      if (existing.user_id !== userId) {
        return res.status(403).json({
          error: 'This computer is currently registered to a different RemoteHub account.',
          ownerId: existing.user_id
        });
      }

      // Existing device belongs to this user: update credentials and bring online
      await execute(`
        UPDATE devices
        SET device_name = ?, auth_token = COALESCE(?, auth_token),
            installation_id = COALESCE(?, installation_id),
            device_status = 'online', last_seen = ?, trusted_mode = 1
        WHERE id = ?
      `, [finalName, authToken || null, installationId || null, now, deviceId]);

      if (pin && /^\d{6,8}$/.test(pin)) {
        const { hash, salt } = hashPin(pin);
        await execute(`
          UPDATE device_credentials
          SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, lockout_until = 0, updated_at = ?
          WHERE device_id = ?
        `, [hash, salt, now, deviceId]);
      }

      await execute(
        'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, deviceId, 'device_resynced', `Device re-synchronized: ${finalName}`, req.ip || '', now]
      );

      return res.json({
        success: true,
        message: 'Computer successfully re-synchronized with your account',
        deviceId,
        isNew: false
      });
    }

    // Device does not exist on server (e.g. database re-initialized): restore using original Device ID!
    await execute(`
      INSERT INTO devices (
        id, user_id, device_name, operating_system, agent_version, device_status,
        auth_token, trusted_mode, last_seen, installation_id, wake_support, created_at, registered_at
      )
      VALUES (?, ?, ?, ?, '1.3.0', 'online', ?, 1, ?, ?, 1, ?, ?)
    `, [
      deviceId,
      userId,
      finalName,
      os || 'Windows 11',
      finalToken,
      now,
      installationId || null,
      now,
      now
    ]);

    if (pin && /^\d{6,8}$/.test(pin)) {
      const { hash, salt } = hashPin(pin);
      await execute(`
        INSERT INTO device_credentials (device_id, pin_hash, pin_salt, failed_attempts, lockout_until, updated_at)
        VALUES (?, ?, ?, 0, 0, ?)
      `, [deviceId, hash, salt, now]);
    }

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, deviceId, 'device_restored', `Device restored with permanent ID: ${finalName}`, req.ip || '', now]
    );

    return res.status(201).json({
      success: true,
      message: 'Computer successfully registered and linked to your account',
      deviceId,
      authToken: finalToken,
      isNew: true
    });
  } catch (err: any) {
    console.error('Restore device error:', err);
    return res.status(500).json({ error: 'Failed to restore computer registration' });
  }
});

// 3d. GET /api/devices/diagnostics (Complete Diagnostics Panel Data)
devicesRouter.get('/diagnostics', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = Date.now();

    // Count system totals safely
    const totalUsersRow = await queryOne('SELECT COUNT(*) as count FROM users');
    const totalDevicesRow = await queryOne('SELECT COUNT(*) as count FROM devices');
    const userDevices = await query(`
      SELECT d.*, c.pin_hash IS NOT NULL as has_pin
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.user_id = ?
      ORDER BY d.last_seen DESC
    `, [userId]);

    return res.json({
      account: {
        userId: req.user!.id,
        email: req.user!.email,
        fullName: req.user!.fullName
      },
      backend: {
        serverUrl: `${req.protocol}://${req.get('host')}`,
        uptime: process.uptime(),
        database: {
          ...getDatabaseStatus(),
          totalUsers: Number(totalUsersRow?.count || 0),
          totalDevices: Number(totalDevicesRow?.count || 0),
          userDeviceCount: userDevices.length
        }
      },
      devices: userDevices.map((d: any) => {
        const lastSeen = Number(d.last_seen);
        const elapsedMs = Math.max(0, now - lastSeen);
        let dynamicStatus: 'online' | 'reconnecting' | 'offline';
        if (elapsedMs <= 45000) dynamicStatus = 'online';
        else if (elapsedMs <= 90000) dynamicStatus = 'reconnecting';
        else dynamicStatus = 'offline';

        return {
          id: d.id,
          deviceName: d.device_name,
          os: d.operating_system || d.os || 'Windows',
          deviceStatus: dynamicStatus,
          onlineStatus: dynamicStatus === 'online',
          lastSeen,
          lastSeenSecondsAgo: Math.floor(elapsedMs / 1000),
          installationId: d.installation_id || null,
          hasPin: Boolean(d.has_pin),
          trustedMode: d.trusted_mode === undefined || d.trusted_mode === null ? true : Boolean(d.trusted_mode),
          ownerId: d.user_id
        };
      })
    });
  } catch (err: any) {
    console.error('Get diagnostics error:', err);
    return res.status(500).json({ error: 'Failed to load device diagnostics' });
  }
});

// 4. POST /api/devices/register (Direct API registration endpoint)
devicesRouter.post('/register', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceName, os, agentVersion, pin, macAddress, localIp } = req.body;
    if (!deviceName) {
      return res.status(400).json({ error: 'Device name is required' });
    }

    const deviceId = crypto.randomUUID();
    const authToken = generateDeviceAuthToken();
    const now = Date.now();

    await execute(`
      INSERT INTO devices (id, user_id, device_name, operating_system, agent_version, device_status, auth_token, last_seen, local_ip, mac_address, wake_support, created_at)
      VALUES (?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?, 1, ?)
    `, [
      deviceId,
      req.user!.id,
      deviceName.trim(),
      os || 'Windows',
      agentVersion || '1.0.0',
      authToken,
      now,
      localIp || null,
      macAddress || null,
      now
    ]);

    if (pin && /^\d{6,8}$/.test(pin)) {
      const { hash, salt } = hashPin(pin);
      await execute(`
        INSERT INTO device_credentials (device_id, pin_hash, pin_salt, failed_attempts, lockout_until, updated_at)
        VALUES (?, ?, ?, 0, 0, ?)
      `, [deviceId, hash, salt, now]);
    }

    return res.status(201).json({
      success: true,
      deviceId,
      authToken,
      deviceName: deviceName.trim()
    });
  } catch (err: any) {
    console.error('Register device error:', err);
    return res.status(500).json({ error: 'Failed to register device' });
  }
});

// 5. POST /api/devices/heartbeat (Agent HTTP heartbeat backup)
devicesRouter.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, authToken, metrics, localIp, macAddress } = req.body;
    if (!deviceId || !authToken) {
      return res.status(401).json({ error: 'Missing device credentials' });
    }

    const device = await queryOne('SELECT * FROM devices WHERE id = ? AND auth_token = ?', [deviceId, authToken]);
    if (!device) {
      const existingById = await queryOne('SELECT id, user_id FROM devices WHERE id = ?', [deviceId]);
      if (existingById) {
        return res.status(401).json({ error: 'Invalid device credentials', code: 'TOKEN_MISMATCH' });
      }
      return res.status(404).json({
        error: 'Device not registered on server',
        code: 'NEEDS_SYNC',
        deviceId,
        canRecover: true
      });
    }

    const now = Date.now();
    await execute(`
      UPDATE devices
      SET device_status = 'online', last_seen = ?, local_ip = COALESCE(?, local_ip), mac_address = COALESCE(?, mac_address)
      WHERE id = ?
    `, [now, localIp || null, macAddress || null, deviceId]);

    if (metrics) {
      await execute(`
        INSERT INTO device_metrics (device_id, cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        deviceId,
        metrics.cpuUsage || 0,
        metrics.memoryUsage || 0,
        metrics.storageUsage || 0,
        metrics.batteryPercent ?? null,
        metrics.isCharging ? 1 : 0,
        now
      ]);
    }

    notifyUserDashboard(device.user_id, {
      type: 'device:status-change',
      deviceId,
      onlineStatus: true,
      deviceStatus: 'online',
      lastSeen: now
    });

    const pendingSession = getDevicePendingRequest(deviceId);
    return res.json({ success: true, timestamp: now, pendingSession });
  } catch (err: any) {
    console.error('Heartbeat error:', err);
    return res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// 6b. Agent polling endpoint (HTTP fallback for serverless environments where WebSockets fail)
devicesRouter.get('/:id/agent-poll', async (req, res) => {
  try {
    const deviceId = req.params.id;
    const token = req.query.token as string || req.headers.authorization?.replace('Bearer ', '');

    if (!deviceId || !token) {
      return res.status(401).json({ error: 'Missing device credentials' });
    }

    const device = await queryOne('SELECT id, user_id, device_name, auth_token FROM devices WHERE id = ?', [deviceId]);
    if (!device || device.auth_token !== token) {
      return res.status(401).json({ error: 'Invalid device credentials' });
    }

    const now = Date.now();
    await execute("UPDATE devices SET device_status = 'online', last_seen = ? WHERE id = ?", [now, deviceId]);

    const pendingSession = getDevicePendingRequest(deviceId);
    return res.json({
      success: true,
      timestamp: now,
      pendingSession: pendingSession || null
    });
  } catch (err: any) {
    console.error('Agent poll error:', err);
    return res.status(500).json({ error: 'Agent poll failed' });
  }
});

// 6. Get device details
devicesRouter.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const device = await queryOne(`
      SELECT d.*, c.updated_at AS pin_updated_at, c.failed_attempts, c.lockout_until
      FROM devices d
      LEFT JOIN device_credentials c ON d.id = c.device_id
      WHERE d.id = ? AND d.user_id = ?
    `, [req.params.id, req.user!.id]);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const metrics = await queryOne(`
      SELECT cpu_usage, memory_usage, storage_usage, battery_percent, is_charging, collected_at
      FROM device_metrics
      WHERE device_id = ?
      ORDER BY collected_at DESC
      LIMIT 1
    `, [device.id]);

    const recentSessions = await query(`
      SELECT id, session_status AS status, approval_status, connection_type, created_at AS started_at, disconnected_at AS ended_at, client_ip
      FROM remote_sessions
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [device.id]);

    const isLocked = Number(device.lockout_until) > Date.now();

    return res.json({
      device: {
        id: device.id,
        deviceName: device.device_name,
        os: device.operating_system,
        agentVersion: device.agent_version,
        onlineStatus: device.device_status === 'online',
        deviceStatus: device.device_status,
        lastSeen: Number(device.last_seen),
        localIp: device.local_ip,
        macAddress: device.mac_address,
        wakeSupport: Boolean(device.wake_support),
        registeredAt: Number(device.created_at),
        isLocked,
        lockoutUntil: Number(device.lockout_until),
        failedAttempts: device.failed_attempts,
        pinConfigured: Boolean(device.pin_updated_at),
        pinUpdatedAt: Number(device.pin_updated_at),
        latestMetrics: metrics || null,
        recentSessions
      }
    });
  } catch (err: any) {
    console.error('Get device error:', err);
    return res.status(500).json({ error: 'Failed to retrieve device details' });
  }
});

// 7. Update device name
devicesRouter.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceName } = req.body;
    if (!deviceName || !deviceName.trim()) {
      return res.status(400).json({ error: 'Device name cannot be empty' });
    }

    const device = await queryOne('SELECT id FROM devices WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await execute('UPDATE devices SET device_name = ? WHERE id = ?', [deviceName.trim(), req.params.id]);
    return res.json({ success: true, message: 'Device updated successfully' });
  } catch (err: any) {
    console.error('Update device error:', err);
    return res.status(500).json({ error: 'Failed to update device' });
  }
});

// 8. Delete / Unregister device
devicesRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const device = await queryOne('SELECT id, device_name FROM devices WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await execute('DELETE FROM devices WHERE id = ?', [req.params.id]);
    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user!.id, req.params.id, 'device_removed', `Removed device: ${device.device_name}`, req.ip || '', Date.now()]
    );

    return res.json({ success: true, message: 'Device removed successfully' });
  } catch (err: any) {
    console.error('Delete device error:', err);
    return res.status(500).json({ error: 'Failed to delete device' });
  }
});

// 9. POST /api/devices/:id/verify-pin & POST /api/devices/:id/connect (Initiate remote session with PIN or Trusted Mode)
const handleConnectAndPin = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pin } = req.body;
    const deviceId = req.params.id;

    const device = await queryOne('SELECT id, device_name, device_status, trusted_mode FROM devices WHERE id = ? AND user_id = ?', [
      deviceId,
      req.user!.id
    ]);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.device_status !== 'online') {
      return res.status(400).json({ error: 'Device is currently offline. Cannot establish a remote session.' });
    }

    const creds = await queryOne('SELECT * FROM device_credentials WHERE device_id = ?', [deviceId]);
    const isTrustedMode = device.trusted_mode === undefined || device.trusted_mode === null || Number(device.trusted_mode) !== 0;

    // Enforce PIN validation only if not in trusted mode OR if a PIN was explicitly provided
    if (!isTrustedMode || pin) {
      if (!pin) {
        return res.status(400).json({ error: 'Access PIN is required for this computer' });
      }

      if (!creds || !creds.pin_hash) {
        return res.status(400).json({ error: 'No PIN has been configured for this computer' });
      }

      const now = Date.now();
      const lockoutUntil = Number(creds.lockout_until);

      if (lockoutUntil > now) {
        const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);

        await execute(
          'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [req.user!.id, deviceId, 'pin_attempt_blocked', 'Attempt while locked out', req.ip || '', now]
        );

        return res.status(429).json({
          error: `PIN verification is locked due to too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
          locked: true,
          remainingSeconds
        });
      }

      const isMatch = verifyPin(pin, creds.pin_hash, creds.pin_salt);

      if (!isMatch) {
        const failedAttempts = (creds.failed_attempts || 0) + 1;
        let newLockout = 0;
        let delayMs = 1000;

        if (failedAttempts >= 5) {
          newLockout = now + 15 * 60 * 1000; // 15 mins
        } else if (failedAttempts >= 3) {
          delayMs = 3000;
        }

        await execute('UPDATE device_credentials SET failed_attempts = ?, lockout_until = ? WHERE device_id = ?', [
          failedAttempts,
          newLockout,
          deviceId
        ]);

        await execute(
          'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [req.user!.id, deviceId, 'pin_failed', `Failed attempt #${failedAttempts}`, req.ip || '', now]
        );

        await new Promise((r) => setTimeout(r, delayMs));

        if (newLockout > 0) {
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

      // PIN verified successfully
      await execute('UPDATE device_credentials SET failed_attempts = 0, lockout_until = 0 WHERE device_id = ?', [deviceId]);
    }
    await execute('UPDATE device_credentials SET failed_attempts = 0, lockout_until = 0 WHERE device_id = ?', [deviceId]);

    const sessionId = crypto.randomUUID();
    const sessionToken = generateSessionToken(req.user!.id, deviceId, sessionId);

    await execute(`
      INSERT INTO remote_sessions (id, user_id, device_id, session_token, session_status, status, approval_status, connection_type, client_ip, created_at, started_at)
      VALUES (?, ?, ?, ?, 'authorized', 'authorized', 'pending', 'p2p_direct', ?, ?, ?)
    `, [sessionId, req.user!.id, deviceId, sessionToken, req.ip || '', now, now]);

    // Dispatch pending session request to agent (works over active WebSocket OR HTTP agent polling)
    setDevicePendingRequest(deviceId, {
      sessionId,
      sessionToken,
      userId: req.user!.id,
      clientIp: req.ip || '',
      createdAt: now,
      approvalStatus: 'pending'
    });

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user!.id, deviceId, 'pin_verified', 'Session authorized, awaiting host approval', req.ip || '', now]
    );

    return res.json({
      success: true,
      sessionId,
      sessionToken,
      deviceId,
      deviceName: device.device_name,
      approvalRequired: true,
      expiresInSeconds: 60
    });
  } catch (err: any) {
    console.error('PIN verification error:', err);
    return res.status(500).json({ error: 'Failed to verify PIN' });
  }
};

devicesRouter.post('/:id/verify-pin', requireAuth, handleConnectAndPin);
devicesRouter.post('/:id/connect', requireAuth, handleConnectAndPin);

// Toggle Trusted Account Mode (1-Click Connect vs PIN-Protected)
devicesRouter.patch('/:id/trusted-mode', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { trustedMode } = req.body;
    const deviceId = req.params.id;

    const device = await queryOne('SELECT id FROM devices WHERE id = ? AND user_id = ?', [deviceId, req.user!.id]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const modeVal = trustedMode ? 1 : 0;
    await execute('UPDATE devices SET trusted_mode = ? WHERE id = ?', [modeVal, deviceId]);

    return res.json({ success: true, trustedMode: Boolean(modeVal) });
  } catch (err: any) {
    console.error('Update trusted mode error:', err);
    return res.status(500).json({ error: 'Failed to update trusted mode' });
  }
});

// 10. Change Device PIN
devicesRouter.post('/:id/change-pin', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPin, newPin } = req.body;
    const deviceId = req.params.id;

    if (!newPin || !/^\d{6,8}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be 6 to 8 digits' });
    }

    const device = await queryOne('SELECT id FROM devices WHERE id = ? AND user_id = ?', [deviceId, req.user!.id]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const creds = await queryOne('SELECT * FROM device_credentials WHERE device_id = ?', [deviceId]);
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

    await execute(`
      UPDATE device_credentials
      SET pin_hash = ?, pin_salt = ?, updated_at = ?, failed_attempts = 0, lockout_until = 0
      WHERE device_id = ?
    `, [hash, salt, now, deviceId]);

    // Invalidate ongoing sessions
    await execute(`
      UPDATE remote_sessions
      SET session_status = 'ended', disconnected_at = ?
      WHERE device_id = ? AND session_status IN ('authorized', 'active')
    `, [now, deviceId]);

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user!.id, deviceId, 'pin_changed', 'Access PIN updated and previous sessions invalidated', req.ip || '', now]
    );

    return res.json({ success: true, message: 'Device PIN successfully updated' });
  } catch (err: any) {
    console.error('Change PIN error:', err);
    return res.status(500).json({ error: 'Failed to change PIN' });
  }
});

// 11. Wake-on-LAN
devicesRouter.post('/:id/wake', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const device = await queryOne(
      'SELECT id, device_name, mac_address, device_status FROM devices WHERE id = ? AND user_id = ?',
      [req.params.id, req.user!.id]
    );

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (device.device_status === 'online') {
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

    await execute(
      'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user!.id, device.id, 'wake_requested', `Wake-on-LAN packet dispatched to ${device.mac_address}`, req.ip || '', now]
    );

    return res.json({
      success: sent,
      macAddress: device.mac_address,
      message: sent
        ? `Magic packet broadcast sent to ${device.mac_address}. Host BIOS/UEFI and network adapter must have Wake-on-LAN enabled.`
        : 'Failed to send broadcast magic packet.',
      limitations: [
        'Device must be connected to AC power.',
        'Wake-on-LAN must be enabled in BIOS/UEFI power management.',
        'Network adapter must support wake packets in Windows Device Manager.',
        'Wired Ethernet is substantially more reliable than Wi-Fi across deep sleep states.'
      ]
    });
  } catch (err: any) {
    console.error('Wake-on-LAN error:', err);
    return res.status(500).json({ error: 'Failed to send Wake-on-LAN packet' });
  }
});

// 12. Get device metrics
devicesRouter.get('/:id/metrics', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const device = await queryOne('SELECT id FROM devices WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const metrics = await query(`
      SELECT cpu_usage AS "cpuUsage", memory_usage AS "memoryUsage", storage_usage AS "storageUsage",
             battery_percent AS "batteryPercent", is_charging AS "isCharging", collected_at AS "collectedAt"
      FROM device_metrics
      WHERE device_id = ?
      ORDER BY collected_at DESC
      LIMIT 60
    `, [req.params.id]);

    return res.json({ metrics });
  } catch (err: any) {
    console.error('Get metrics error:', err);
    return res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});
