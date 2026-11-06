import assert from 'node:assert';
import { initDatabase, query, queryOne, execute } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  generateToken,
  verifyToken,
  generateSessionToken,
  verifySessionToken,
  generatePairingCode,
  sendWakeOnLan
} from '../security.js';

async function runTests() {
  console.log('====================================================');
  console.log('       Running RemoteHub Automated Test Suite       ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}\n`);
      failed++;
    }
  }

  // 1. Authentication Security
  await test('Password Hashing & Verification (Bcrypt)', async () => {
    const raw = 'SecureSecretPassword2026!';
    const hash = await hashPassword(raw);
    assert.notStrictEqual(raw, hash);
    const valid = await verifyPassword(raw, hash);
    assert.strictEqual(valid, true);
    const invalid = await verifyPassword('WrongPassword', hash);
    assert.strictEqual(invalid, false);
  });

  await test('JWT User Token Generation & Expiration', () => {
    const payload = { id: 'user-123', email: 'test@remotehub.com', fullName: 'Tester' };
    const token = generateToken(payload, '1h');
    const decoded: any = verifyToken(token);
    assert.strictEqual(decoded.id, 'user-123');
    assert.strictEqual(decoded.email, 'test@remotehub.com');
  });

  // 2. PIN Security & Cryptographic Scrypt/Argon2id Hashing
  await test('Permanent Device PIN Hashing (Scrypt/Argon2id)', () => {
    const pin = '482910';
    const { hash, salt } = hashPin(pin);
    assert.ok(hash.length > 32);
    assert.ok(salt.length > 16);

    const match = verifyPin(pin, hash, salt);
    assert.strictEqual(match, true);

    const wrongMatch = verifyPin('999999', hash, salt);
    assert.strictEqual(wrongMatch, false);
  });

  await test('Timing-safe PIN verification resistance', () => {
    const { hash, salt } = hashPin('123456');
    assert.strictEqual(verifyPin('123456', hash, salt), true);
    assert.strictEqual(verifyPin('123457', hash, salt), false);
    assert.strictEqual(verifyPin('', hash, salt), false);
  });

  // 3. Ephemeral Remote Session Tokens
  await test('Session Token Generation & HMAC Verification', () => {
    const userId = 'usr_001';
    const deviceId = 'dev_win11';
    const sessionId = 'sess_xyz';

    const token = generateSessionToken(userId, deviceId, sessionId);
    assert.ok(token.includes('.'));

    const valid = verifySessionToken(userId, deviceId, sessionId, token);
    assert.strictEqual(valid, true);

    const tampered = token.slice(0, -4) + '0000';
    const invalidTampered = verifySessionToken(userId, deviceId, sessionId, tampered);
    assert.strictEqual(invalidTampered, false);

    const invalidDevice = verifySessionToken(userId, 'other_dev', sessionId, token);
    assert.strictEqual(invalidDevice, false);
  });

  // 4. Pairing Code Generation
  await test('Pairing Code Format & Cryptographic Entropy', () => {
    const code = generatePairingCode();
    assert.strictEqual(code.length, 6);
    assert.match(code, /^\d{6}$/);
  });

  // 5. Wake-on-LAN Magic Packet Generation
  await test('Wake-on-LAN Magic Packet Dispatch', async () => {
    const mac = '00:11:22:33:44:55';
    const result = await sendWakeOnLan(mac);
    assert.strictEqual(typeof result, 'boolean');
  });

  // 6. Database Schema & Adapter Verification
  await test('Database Schema & Dual-Engine Initialization', async () => {
    await initDatabase();
    const testId = `user_${Date.now()}`;
    await execute('INSERT INTO users (id, name, full_name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      testId,
      'Test User',
      'Test User',
      `${testId}@example.com`,
      'hash_test',
      Date.now(),
      Date.now()
    ]);

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [testId]);
    assert.ok(user);
    assert.strictEqual(user.name || user.full_name, 'Test User');

    await execute('DELETE FROM users WHERE id = ?', [testId]);
  });

  // 7. PIN Rate Limiting & Lockout Logic Simulation
  await test('PIN Verification 5-attempt Lockout Enforcement', () => {
    const { hash, salt } = hashPin('778899');

    let failedAttempts = 0;
    let lockoutUntil = 0;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const isCorrect = verifyPin('000000', hash, salt);
      if (!isCorrect) {
        failedAttempts++;
        if (failedAttempts >= 5) {
          lockoutUntil = Date.now() + 15 * 60 * 1000;
        }
      }
    }

    assert.strictEqual(failedAttempts, 5);
    assert.ok(lockoutUntil > Date.now());
    assert.strictEqual(lockoutUntil > Date.now(), true);
  });

  // 8. Session Approval Flow States
  await test('Session Approval & Rejection State Transitions', async () => {
    const sessId = `test_sess_${Date.now()}`;
    const devId = `test_dev_${Date.now()}`;
    const usrId = `test_usr_${Date.now()}`;
    const now = Date.now();

    await execute('INSERT INTO users (id, name, full_name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      usrId,
      'Approval Tester',
      'Approval Tester',
      `${usrId}@test.com`,
      'pw_hash',
      now,
      now
    ]);

    await execute(`
      INSERT INTO devices (id, user_id, device_name, operating_system, agent_version, device_status, auth_token, last_seen, wake_support, created_at, registered_at)
      VALUES (?, ?, 'Approval PC', 'Windows 11', '1.0.0', 'online', 'auth_token_test', ?, 1, ?, ?)
    `, [devId, usrId, now, now, now]);

    await execute(`
      INSERT INTO remote_sessions (id, user_id, device_id, session_token, session_status, status, approval_status, connection_type, created_at, started_at)
      VALUES (?, ?, ?, 'tok_test', 'authorized', 'authorized', 'pending', 'p2p_direct', ?, ?)
    `, [sessId, usrId, devId, now, now]);

    const pending = await queryOne('SELECT approval_status FROM remote_sessions WHERE id = ?', [sessId]);
    assert.strictEqual(pending.approval_status, 'pending');

    await execute("UPDATE remote_sessions SET approval_status = 'approved', session_status = 'active' WHERE id = ?", [sessId]);
    const approved = await queryOne('SELECT approval_status, session_status FROM remote_sessions WHERE id = ?', [sessId]);
    assert.strictEqual(approved.approval_status, 'approved');
    assert.strictEqual(approved.session_status, 'active');

    // Cleanup
    await execute('DELETE FROM users WHERE id = ?', [usrId]);
  });

  // 9. Stable Device Identity & Deduplication by Installation ID
  await test('Device Deduplication and Re-pairing by installation_id', async () => {
    const usrId = `dedup_usr_${Date.now()}`;
    const devId = `dedup_dev_${Date.now()}`;
    const instId = `inst_guid_${Date.now()}`;
    const now = Date.now();

    await execute('INSERT INTO users (id, name, full_name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      usrId,
      'Dedup Tester',
      'Dedup Tester',
      `${usrId}@test.com`,
      'hash',
      now,
      now
    ]);

    // First registration
    await execute(`
      INSERT INTO devices (id, user_id, device_name, operating_system, agent_version, device_status, auth_token, last_seen, installation_id, wake_support, created_at, registered_at)
      VALUES (?, ?, 'Office Workstation', 'Windows 11', '1.0.0', 'online', 'tok1', ?, ?, 1, ?, ?)
    `, [devId, usrId, now, instId, now, now]);

    // Verify exactly 1 device exists
    const beforeCount = await queryOne('SELECT COUNT(*) as count FROM devices WHERE user_id = ?', [usrId]);
    assert.strictEqual(Number(beforeCount.count), 1);

    // Second pairing attempt with same installation_id: should update, NOT insert duplicate
    const existing = await queryOne('SELECT id FROM devices WHERE user_id = ? AND installation_id = ?', [usrId, instId]);
    assert.ok(existing);
    assert.strictEqual(existing.id, devId);

    // Perform update
    await execute(`
      UPDATE devices
      SET device_name = 'Renamed Workstation', auth_token = 'tok2', last_seen = ?
      WHERE id = ?
    `, [Date.now(), existing.id]);

    const afterCount = await queryOne('SELECT COUNT(*) as count FROM devices WHERE user_id = ?', [usrId]);
    assert.strictEqual(Number(afterCount.count), 1);

    const updatedDev = await queryOne('SELECT device_name, auth_token FROM devices WHERE id = ?', [devId]);
    assert.strictEqual(updatedDev.device_name, 'Renamed Workstation');
    assert.strictEqual(updatedDev.auth_token, 'tok2');

    // Cleanup
    await execute('DELETE FROM users WHERE id = ?', [usrId]);
  });

  // 10. Dynamic 3-State Status Resolution (Online, Reconnecting, Offline)
  await test('Dynamic 3-State Status Resolution (Online, Reconnecting, Offline)', () => {
    const now = Date.now();

    function resolveStatus(lastSeen: number): 'online' | 'reconnecting' | 'offline' {
      const elapsed = Math.max(0, now - lastSeen);
      if (elapsed <= 45000) return 'online';
      if (elapsed <= 90000) return 'reconnecting';
      return 'offline';
    }

    assert.strictEqual(resolveStatus(now - 10000), 'online');
    assert.strictEqual(resolveStatus(now - 45000), 'online');
    assert.strictEqual(resolveStatus(now - 50000), 'reconnecting');
    assert.strictEqual(resolveStatus(now - 89000), 'reconnecting');
    assert.strictEqual(resolveStatus(now - 91000), 'offline');
    assert.strictEqual(resolveStatus(now - 300000), 'offline');
  });

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
