import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const isVercel = !!process.env.VERCEL;
const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp/data' : path.resolve(process.cwd(), 'data'));
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    // Fallback to /tmp if current dir is read-only
  }
}

const dbPath = path.join(dataDir, 'remotehub.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode for high performance concurrent reads and writes
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      os TEXT NOT NULL DEFAULT 'Windows',
      agent_version TEXT NOT NULL DEFAULT '1.0.0',
      auth_token TEXT NOT NULL,
      online_status INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL,
      local_ip TEXT,
      mac_address TEXT,
      registered_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_credentials (
      device_id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_updated_at INTEGER NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      lockout_until INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS remote_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      session_token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      connection_type TEXT NOT NULL DEFAULT 'p2p_direct',
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      client_ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      cpu_usage REAL NOT NULL,
      memory_usage REAL NOT NULL,
      storage_usage REAL,
      battery_percent REAL,
      is_charging INTEGER,
      collected_at INTEGER NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      device_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices (user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON remote_sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON remote_sessions (device_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_device_id ON device_metrics (device_id, collected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
  `);
}

