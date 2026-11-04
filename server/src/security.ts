import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dgram from 'node:dgram';

const JWT_SECRET = process.env.JWT_SECRET || 'remotehub-super-secret-jwt-key-2026-production';
const SESSION_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || 'remotehub-session-hmac-key-security-2026';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Scrypt-based secure PIN hashing (memory-hard, resistant to GPU attacks).
 * Encodes salt and derived key cleanly.
 */
export function hashPin(pin: string, providedSalt?: string): { hash: string; salt: string } {
  const salt = providedSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 });
  return {
    hash: derivedKey.toString('hex'),
    salt
  };
}

export function verifyPin(pin: string, storedHash: string, salt: string): boolean {
  try {
    const { hash } = hashPin(pin, salt);
    const hashBuf = Buffer.from(hash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (hashBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, storedBuf);
  } catch {
    return false;
  }
}

export function generateToken(payload: object, expiresIn: string | number = '7d'): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken<T>(token: string): T | null {
  try {
    return jwt.verify(token, JWT_SECRET) as T;
  } catch {
    return null;
  }
}

export function generateSessionToken(userId: string, deviceId: string, sessionId: string): string {
  const timestamp = Date.now();
  const raw = `${userId}:${deviceId}:${sessionId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', SESSION_HMAC_SECRET).update(raw).digest('hex');
  return `${timestamp}.${hmac}`;
}

export function verifySessionToken(userId: string, deviceId: string, sessionId: string, token: string): boolean {
  try {
    const [timestampStr, hmac] = token.split('.');
    const timestamp = parseInt(timestampStr, 10);
    // Token is valid for 5 minutes maximum for connection handshake
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      return false;
    }
    const raw = `${userId}:${deviceId}:${sessionId}:${timestamp}`;
    const expected = crypto.createHmac('sha256', SESSION_HMAC_SECRET).update(raw).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function generatePairingCode(): string {
  // Generate a cryptographically random 6-digit numeric pairing code
  return crypto.randomInt(100000, 999999).toString();
}

export function generateDeviceAuthToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sends a Wake-on-LAN magic packet over UDP broadcast (port 9 and port 7).
 */
export function sendWakeOnLan(macAddress: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const cleanMac = macAddress.replace(/[^0-9A-Fa-f]/g, '');
      if (cleanMac.length !== 12) {
        return resolve(false);
      }

      const macBytes = Buffer.from(cleanMac, 'hex');
      const magicPacket = Buffer.alloc(6 + 16 * 6);
      magicPacket.fill(0xff, 0, 6);

      for (let i = 0; i < 16; i++) {
        macBytes.copy(magicPacket, 6 + i * 6);
      }

      const socket = dgram.createSocket('udp4');
      socket.once('error', () => {
        try { socket.close(); } catch {}
        resolve(false);
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err) => {
          try { socket.close(); } catch {}
          resolve(!err);
        });
      });
    } catch {
      resolve(false);
    }
  });
}

