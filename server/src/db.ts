import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool } = pg;

export const isPostgres = !!process.env.DATABASE_URL;
let pgPool: pg.Pool | null = null;
let sqliteDb: DatabaseSync | null = null;

if (isPostgres) {
  console.log('[DB] Connecting to PostgreSQL database...');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined : { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
  });

  pgPool.on('error', (err) => {
    console.error('[DB] Unexpected PostgreSQL client error:', err);
  });
} else {
  console.log('[DB] Using local SQLite database engine...');
  const isVercel = !!process.env.VERCEL;
  const dataDir = process.env.DATA_DIR || (isVercel ? '/tmp/data' : path.resolve(process.cwd(), 'data'));

  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // Ignore if directory exists or fails in read-only environment
    }
  }

  const dbPath = path.join(dataDir, 'remotehub.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
}

export function getDatabaseStatus() {
  return {
    engine: isPostgres ? 'postgresql' : 'sqlite',
    isPersistent: isPostgres,
    isPostgres,
    hasPool: !!pgPool,
    hasSqlite: !!sqliteDb
  };
}

/**
 * Executes a parameterized SQL query across PostgreSQL or SQLite.
 * Automatically translates '?' parameters to '$1, $2, ...' when connected to PostgreSQL.
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (isPostgres && pgPool) {
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pgPool.query(pgSql, params);
    return res.rows as T[];
  }

  if (sqliteDb) {
    const stmt = sqliteDb.prepare(sql);
    const rows = stmt.all(...params) as T[];
    return rows;
  }

  throw new Error('Database not initialized');
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function execute(sql: string, params: any[] = []): Promise<void> {
  if (isPostgres && pgPool) {
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    await pgPool.query(pgSql, params);
    return;
  }

  if (sqliteDb) {
    const stmt = sqliteDb.prepare(sql);
    stmt.run(...params);
    return;
  }

  throw new Error('Database not initialized');
}

/**
 * Initializes database tables, relationships, and performance indexes.
 */
export async function initDatabase(): Promise<void> {
  if (isPostgres && pgPool) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name VARCHAR(255) NOT NULL,
        operating_system VARCHAR(100) NOT NULL DEFAULT 'Windows',
        os VARCHAR(100) DEFAULT 'Windows',
        agent_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
        device_status VARCHAR(50) NOT NULL DEFAULT 'offline',
        online_status INT DEFAULT 0,
        auth_token VARCHAR(255) NOT NULL,
        last_seen BIGINT NOT NULL,
        local_ip VARCHAR(100),
        mac_address VARCHAR(100),
        installation_id VARCHAR(128),
        wake_support INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        registered_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS device_credentials (
        device_id VARCHAR(64) PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        failed_attempts INT NOT NULL DEFAULT 0,
        lockout_until BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pairing_codes (
        code VARCHAR(20) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS remote_sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        session_token TEXT NOT NULL,
        session_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        status VARCHAR(50) DEFAULT 'pending',
        approval_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        connection_type VARCHAR(50) NOT NULL DEFAULT 'p2p_direct',
        client_ip VARCHAR(100),
        created_at BIGINT NOT NULL,
        started_at BIGINT,
        connected_at BIGINT,
        disconnected_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS device_metrics (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        cpu_usage REAL NOT NULL,
        memory_usage REAL NOT NULL,
        storage_usage REAL,
        battery_percent REAL,
        is_charging INT,
        collected_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64),
        device_id VARCHAR(64),
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(100),
        created_at BIGINT NOT NULL
      );

      ALTER TABLE devices ADD COLUMN IF NOT EXISTS installation_id VARCHAR(128);
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS trusted_mode INT DEFAULT 1;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS access_method VARCHAR(50) DEFAULT 'approval';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        device_info TEXT,
        ip_address VARCHAR(45),
        expires_at BIGINT NOT NULL,
        revoked_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_signals (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        sender VARCHAR(20) NOT NULL,
        data TEXT NOT NULL,
        timestamp BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_frames (
        session_id VARCHAR(64) PRIMARY KEY,
        frame_data TEXT NOT NULL,
        timestamp BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_session ON session_signals(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_devices_installation ON devices(installation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON remote_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON remote_sessions(device_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_device_id ON device_metrics(device_id, collected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
    `);
    console.log('[DB] PostgreSQL schema migrations verified.');
    return;
  }

  if (sqliteDb) {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        operating_system TEXT NOT NULL DEFAULT 'Windows',
        agent_version TEXT NOT NULL DEFAULT '1.0.0',
        device_status TEXT NOT NULL DEFAULT 'offline',
        auth_token TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        local_ip TEXT,
        mac_address TEXT,
        installation_id TEXT,
        wake_support INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS device_credentials (
        device_id TEXT PRIMARY KEY,
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        lockout_until INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
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
        session_status TEXT NOT NULL DEFAULT 'pending',
        approval_status TEXT NOT NULL DEFAULT 'pending',
        connection_type TEXT NOT NULL DEFAULT 'p2p_direct',
        client_ip TEXT,
        created_at INTEGER NOT NULL,
        connected_at INTEGER,
        disconnected_at INTEGER,
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

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        device_info TEXT,
        ip_address TEXT,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_signals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_frames (
        session_id TEXT PRIMARY KEY,
        frame_data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_session ON session_signals (session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices (user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON remote_sessions (user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON remote_sessions (device_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_device_id ON device_metrics (device_id, collected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);
    `);

    // Safe column migrations for existing SQLite databases
    try {
      const userCols: any[] = sqliteDb.prepare("PRAGMA table_info(users)").all();
      const userColNames = userCols.map((c) => c.name);
      if (!userColNames.includes('name')) {
        sqliteDb.exec('ALTER TABLE users ADD COLUMN name TEXT');
        sqliteDb.exec('UPDATE users SET name = full_name WHERE full_name IS NOT NULL');
      }
      if (!userColNames.includes('full_name')) {
        sqliteDb.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
        sqliteDb.exec('UPDATE users SET full_name = name WHERE name IS NOT NULL');
      }
      if (!userColNames.includes('google_id')) {
        sqliteDb.exec('ALTER TABLE users ADD COLUMN google_id TEXT');
      }
      if (!userColNames.includes('avatar_url')) {
        sqliteDb.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
      }
    } catch {}

    try {
      const devCols: any[] = sqliteDb.prepare("PRAGMA table_info(devices)").all();
      const devColNames = devCols.map((c) => c.name);
      if (!devColNames.includes('device_status')) {
        sqliteDb.exec("ALTER TABLE devices ADD COLUMN device_status TEXT DEFAULT 'offline'");
        sqliteDb.exec("UPDATE devices SET device_status = CASE WHEN online_status = 1 THEN 'online' ELSE 'offline' END");
      }
      if (!devColNames.includes('wake_support')) {
        sqliteDb.exec('ALTER TABLE devices ADD COLUMN wake_support INTEGER DEFAULT 1');
      }
      if (!devColNames.includes('operating_system')) {
        sqliteDb.exec("ALTER TABLE devices ADD COLUMN operating_system TEXT DEFAULT 'Windows'");
        sqliteDb.exec('UPDATE devices SET operating_system = os WHERE os IS NOT NULL');
      }
      if (!devColNames.includes('os')) {
        sqliteDb.exec("ALTER TABLE devices ADD COLUMN os TEXT DEFAULT 'Windows'");
        sqliteDb.exec('UPDATE devices SET os = operating_system WHERE operating_system IS NOT NULL');
      }
      if (!devColNames.includes('created_at')) {
        sqliteDb.exec('ALTER TABLE devices ADD COLUMN created_at INTEGER');
        sqliteDb.exec('UPDATE devices SET created_at = registered_at WHERE registered_at IS NOT NULL');
      }
      if (!devColNames.includes('registered_at')) {
        sqliteDb.exec('ALTER TABLE devices ADD COLUMN registered_at INTEGER');
        sqliteDb.exec('UPDATE devices SET registered_at = created_at WHERE created_at IS NOT NULL');
      }
      if (!devColNames.includes('installation_id')) {
        sqliteDb.exec('ALTER TABLE devices ADD COLUMN installation_id TEXT');
      }
      if (!devColNames.includes('trusted_mode')) {
        sqliteDb.exec('ALTER TABLE devices ADD COLUMN trusted_mode INTEGER DEFAULT 1');
      }
      if (!devColNames.includes('access_method')) {
        sqliteDb.exec("ALTER TABLE devices ADD COLUMN access_method TEXT DEFAULT 'approval'");
        sqliteDb.exec("UPDATE devices SET access_method = 'approval' WHERE access_method IS NULL");
      }
    } catch {}

    try {
      const credCols: any[] = sqliteDb.prepare("PRAGMA table_info(device_credentials)").all();
      const credColNames = credCols.map((c) => c.name);
      console.log('[DB] device_credentials columns:', credColNames);
      if (!credColNames.includes('updated_at')) {
        sqliteDb.exec('ALTER TABLE device_credentials ADD COLUMN updated_at INTEGER DEFAULT 0');
      }
      if (!credColNames.includes('failed_attempts')) {
        sqliteDb.exec('ALTER TABLE device_credentials ADD COLUMN failed_attempts INTEGER DEFAULT 0');
      }
      if (!credColNames.includes('lockout_until')) {
        sqliteDb.exec('ALTER TABLE device_credentials ADD COLUMN lockout_until INTEGER DEFAULT 0');
      }
      if (!credColNames.includes('pin_updated_at')) {
        sqliteDb.exec('ALTER TABLE device_credentials ADD COLUMN pin_updated_at INTEGER DEFAULT 0');
      }
    } catch {}

    try {
      const sessCols: any[] = sqliteDb.prepare("PRAGMA table_info(remote_sessions)").all();
      const sessColNames = sessCols.map((c) => c.name);
      if (!sessColNames.includes('session_status')) {
        sqliteDb.exec("ALTER TABLE remote_sessions ADD COLUMN session_status TEXT DEFAULT 'pending'");
        sqliteDb.exec('UPDATE remote_sessions SET session_status = status WHERE status IS NOT NULL');
      }
      if (!sessColNames.includes('status')) {
        sqliteDb.exec("ALTER TABLE remote_sessions ADD COLUMN status TEXT DEFAULT 'pending'");
        sqliteDb.exec('UPDATE remote_sessions SET status = session_status WHERE session_status IS NOT NULL');
      }
      if (!sessColNames.includes('approval_status')) {
        sqliteDb.exec("ALTER TABLE remote_sessions ADD COLUMN approval_status TEXT DEFAULT 'pending'");
      }
      if (!sessColNames.includes('created_at')) {
        sqliteDb.exec('ALTER TABLE remote_sessions ADD COLUMN created_at INTEGER');
        sqliteDb.exec('UPDATE remote_sessions SET created_at = started_at WHERE started_at IS NOT NULL');
      }
      if (!sessColNames.includes('started_at')) {
        sqliteDb.exec('ALTER TABLE remote_sessions ADD COLUMN started_at INTEGER');
        sqliteDb.exec('UPDATE remote_sessions SET started_at = created_at WHERE created_at IS NOT NULL');
      }
      if (!sessColNames.includes('disconnected_at')) {
        sqliteDb.exec('ALTER TABLE remote_sessions ADD COLUMN disconnected_at INTEGER');
      }
      if (!sessColNames.includes('connected_at')) {
        sqliteDb.exec('ALTER TABLE remote_sessions ADD COLUMN connected_at INTEGER');
      }
    } catch {}

    console.log('[DB] SQLite schema verified.');
  }
}
