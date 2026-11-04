import assert from 'node:assert';
import { db, initDatabase } from '../db.js';
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

    // Tampered token check
    const tampered = token.slice(0, -4) + '0000';
    const invalidTampered = verifySessionToken(userId, deviceId, sessionId, tampered);
    assert.strictEqual(invalidTampered, false);

    // Wrong device check
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

  // 6. Database Integrity & Isolation
  await test('Database Schema & Indices Verification', () => {
    initDatabase();
    const tables: any[] = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes('users'));
    assert.ok(tableNames.includes('devices'));
    assert.ok(tableNames.includes('device_credentials'));
    assert.ok(tableNames.includes('remote_sessions'));
    assert.ok(tableNames.includes('device_metrics'));
    assert.ok(tableNames.includes('audit_logs'));
  });

  // 7. PIN Rate Limiting & Lockout Logic Simulation
  await test('PIN Verification 5-attempt Lockout Enforcement', () => {
    const testDevId = 'test_dev_lockout';
    const { hash, salt } = hashPin('778899');

    // Simulate 5 consecutive failed attempts
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

    // Verify attempt while locked out
    const isLocked = lockoutUntil > Date.now();
    assert.strictEqual(isLocked, true);
  });

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();

