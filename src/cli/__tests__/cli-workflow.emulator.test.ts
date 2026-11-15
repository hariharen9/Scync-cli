import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../index.js';
import { saveSession, clearSession } from '../../auth/storage.js';
import { deriveKey, generateSalt, createVerifier } from '../../core/crypto.js';
import { createSecret, setupVault } from '../../core/firestore.js';
import { setConfigValue, unsetConfigValue } from '../../config/index.js';
import { initFirebase } from '../../core/firebase.js';

describe('Phase 3 CLI Workflows: Run, Config, and Agent (Emulator Integration)', () => {
  let dbInstance: any;
  let uid: string;
  const email = `phase3-test-${Date.now()}@example.com`;
  const password = 'TestUserPassword123!';
  const masterPassword = 'MyVaultMasterPassword99!';
  let salt: string;
  let derivedKey: CryptoKey;
  let testScyncDir: string;
  let origUserProfile: string | undefined;

  beforeAll(async () => {
    // Isolate config and session directory
    testScyncDir = path.join(os.tmpdir(), `scync-cli-phase3-${Date.now()}`);
    fs.mkdirSync(path.join(testScyncDir, '.scync'), { recursive: true });
    origUserProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = testScyncDir;
    process.env.HOME = testScyncDir;
    // Tell vault-session not to start real detached daemons during emulator runner
    process.env.SCYNC_NO_AGENT = '1';

    const { auth, db } = initFirebase({
      projectId: 'demo-scync',
      useEmulators: true,
      authEmulatorUrl: 'http://127.0.0.1:9099',
      firestoreEmulatorHost: '127.0.0.1',
      firestoreEmulatorPort: 8080,
    });
    dbInstance = db;

    // Register test user
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;

    // Save session
    saveSession({
      uid,
      email,
      displayName: 'Test User',
      providerId: 'password',
      refreshToken: 'fake-refresh-token',
      idToken: 'fake-id-token',
      expiresAt: Date.now() + 3600 * 1000,
      savedAt: new Date().toISOString(),
    });

    // Derive key & initialize vault metadata
    salt = generateSalt();
    derivedKey = await deriveKey(masterPassword, uid, salt);
    const verifier = await createVerifier(derivedKey);

    await setupVault(uid, salt, verifier, dbInstance);
    process.env.SCYNC_MASTER_PASSWORD = masterPassword;

    // Seed test secrets
    await createSecret(uid, derivedKey, {
      name: 'PHASE3_API_KEY',
      service: 'Stripe',
      type: 'API Key',
      environment: 'Production',
      status: 'Active',
      value: 'sk_live_phase3_stripe_secret_abc123',
      notes: 'Phase 3 integration key',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: 'proj-omega',
      remainingCodes: null,
    }, dbInstance);

    await createSecret(uid, derivedKey, {
      name: 'PHASE3_DB_URL',
      service: 'Other',
      type: 'Other',
      environment: 'Production',
      status: 'Active',
      value: 'postgres://omega_user:pass@db.example.com:5432/omega',
      notes: '',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: 'proj-omega',
      remainingCodes: null,
    }, dbInstance);
  });

  afterAll(async () => {
    clearSession();
    unsetConfigValue('default.project');
    unsetConfigValue('default.env');
    if (origUserProfile) {
      process.env.USERPROFILE = origUserProfile;
      process.env.HOME = origUserProfile;
    }
    delete process.env.SCYNC_NO_AGENT;
    delete process.env.SCYNC_MASTER_PASSWORD;
    try {
      fs.rmSync(testScyncDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('scync config manages preferences', async () => {
    const prog1 = createProgram();
    await prog1.parseAsync(['node', 'scync', 'config', 'set', 'default.project', 'proj-omega']);

    const prog2 = createProgram();
    await prog2.parseAsync(['node', 'scync', 'config', 'set', 'default.env', 'Production']);

    const prog3 = createProgram();
    let capturedOutput = '';
    const origLog = console.log;
    console.log = (msg: any) => { capturedOutput += msg + '\n'; };

    await prog3.parseAsync(['node', 'scync', 'config', 'list']);
    console.log = origLog;

    expect(capturedOutput).toContain('default.project');
    expect(capturedOutput).toContain('proj-omega');
    expect(capturedOutput).toContain('default.env');
    expect(capturedOutput).toContain('Production');
  });

  it('scync run injects decrypted secrets into child process environment without writing to disk', async () => {
    const tempOutputFile = path.join(testScyncDir, 'child-output.json');
    const childRunner = path.join(testScyncDir, 'child-runner.cjs');
    fs.writeFileSync(
      childRunner,
      `const fs = require('fs');
fs.writeFileSync(${JSON.stringify(tempOutputFile)}, JSON.stringify({
  apiKey: process.env.PHASE3_API_KEY,
  dbUrl: process.env.PHASE3_DB_URL,
}));
`
    );

    const prog = createProgram();

    await prog.parseAsync([
      'node', 'scync', 'run',
      '-p', 'proj-omega',
      '-e', 'Production',
      '--',
      process.execPath, childRunner
    ]);

    expect(fs.existsSync(tempOutputFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(tempOutputFile, 'utf8'));

    expect(content.apiKey).toBe('sk_live_phase3_stripe_secret_abc123');
    expect(content.dbUrl).toBe('postgres://omega_user:pass@db.example.com:5432/omega');
  });
});
