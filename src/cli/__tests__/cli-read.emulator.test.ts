import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { initFirebase } from '../../core/firebase.js';
import { generateSalt, deriveKey, createVerifier } from '../../core/crypto.js';
import { setupVault, createSecret } from '../../core/firestore.js';
import { saveSession, clearSession } from '../../auth/storage.js';
import { createProgram } from '../index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Phase 1 CLI Read Commands & Workflows (Emulator Integration)', () => {
  const email = `cli_user_${Date.now()}@example.local`;
  const authPassword = 'Password123!';
  const masterPassword = 'correct_master_password_456!';
  let uid: string;
  let dbInstance: any;
  let testScyncDir: string;

  beforeAll(async () => {
    // Isolate test session in a temporary SCYNC_DIR
    testScyncDir = path.join(os.tmpdir(), `scync-cli-test-${Date.now()}`);
    process.env.SCYNC_DIR = testScyncDir;
    process.env.SCYNC_MASTER_PASSWORD = masterPassword;

    const { auth, db } = initFirebase({
      projectId: 'demo-scync',
      useEmulators: true,
      authEmulatorUrl: 'http://127.0.0.1:9099',
      firestoreEmulatorHost: '127.0.0.1',
      firestoreEmulatorPort: 8080
    });
    dbInstance = db;

    // 1. Create User
    const cred = await createUserWithEmailAndPassword(auth, email, authPassword);
    uid = cred.user.uid;

    // 2. Setup Vault
    const salt = generateSalt();
    const key = await deriveKey(masterPassword, uid, salt);
    const verifier = await createVerifier(key);
    await setupVault(uid, salt, verifier, db);

    // 3. Save active CLI session
    saveSession({
      uid,
      email,
      displayName: 'Test Dev',
      refreshToken: 'mock-refresh-token',
      idToken: await cred.user.getIdToken(),
      expiresAt: Date.now() + 3600_000,
      providerId: 'password',
      savedAt: new Date().toISOString()
    });

    // 4. Seed test secrets
    await createSecret(uid, key, {
      name: 'DATABASE_URL',
      service: 'Supabase',
      type: 'Database URL',
      environment: 'Development',
      status: 'Active',
      value: 'postgres://postgres:secret123@db.supabase.co:5432/main',
      notes: 'Main dev database url',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: 'myapp',
      remainingCodes: null
    }, db);

    await createSecret(uid, key, {
      name: 'STRIPE_SECRET_KEY',
      service: 'Stripe',
      type: 'API Key',
      environment: 'Development',
      status: 'Active',
      value: 'sk_test_51MockStripeSecretKey9988',
      notes: 'Stripe test payment key',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: 'myapp',
      remainingCodes: null
    }, db);

    // Duplicate name in different environment for ambiguity test
    await createSecret(uid, key, {
      name: 'STRIPE_SECRET_KEY',
      service: 'Stripe',
      type: 'API Key',
      environment: 'Production',
      status: 'Active',
      value: 'sk_live_51MockStripeLiveKey1122',
      notes: 'Stripe production payment key',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: 'myapp',
      remainingCodes: null
    }, db);
  });

  afterAll(() => {
    delete process.env.SCYNC_MASTER_PASSWORD;
    try {
      if (fs.existsSync(testScyncDir)) {
        fs.rmSync(testScyncDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('whoami outputs active user session identity', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'whoami', '--json']);
      const output = JSON.parse(logs.join(''));
      expect(output.uid).toBe(uid);
      expect(output.email).toBe(email);
    } finally {
      console.log = origLog;
    }
  });

  it('ls lists seeded secrets without decrypting', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'ls', '--json']);
      const output = JSON.parse(logs.join(''));
      expect(output).toHaveLength(3);
      expect(output.some((s: any) => s.name === 'DATABASE_URL')).toBe(true);
      expect(output.every((s: any) => s.value === undefined)).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it('ls filters by environment and project correctly', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'ls', '-e', 'Production', '--json']);
      const output = JSON.parse(logs.join(''));
      expect(output).toHaveLength(1);
      expect(output[0].name).toBe('STRIPE_SECRET_KEY');
      expect(output[0].environment).toBe('Production');
    } finally {
      console.log = origLog;
    }
  });

  it('get decrypts single unique secret', async () => {
    let stdoutData = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'get', 'DATABASE_URL', '--reveal']);
      expect(stdoutData).toContain('postgres://postgres:secret123@db.supabase.co:5432/main');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('get throws AmbiguousSecretError when name matches multiple secrets', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'scync', 'get', 'STRIPE_SECRET_KEY'])
    ).rejects.toThrow(/Multiple secrets found matching/);
  });

  it('get disambiguates by --env correctly', async () => {
    let stdoutData = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      stdoutData += chunk.toString();
      return true;
    };

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'get', 'STRIPE_SECRET_KEY', '-e', 'Development', '--reveal']);
      expect(stdoutData).toContain('sk_test_51MockStripeSecretKey9988');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('show displays secret details, notes, and version counter', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'scync', 'show', 'DATABASE_URL', '--json', '--reveal']);
      const data = JSON.parse(logs.join(''));
      expect(data.name).toBe('DATABASE_URL');
      expect(data.service).toBe('Supabase');
      expect(data.value).toBe('postgres://postgres:secret123@db.supabase.co:5432/main');
      expect(data.notes).toBe('Main dev database url');
      expect(data.version).toBe(1);
    } finally {
      console.log = origLog;
    }
  });

  it('pull exports filtered secrets to .env file', async () => {
    const outPath = path.join(testScyncDir, 'exported.env');
    const program = createProgram();
    await program.parseAsync(['node', 'scync', 'pull', '-p', 'myapp', '-e', 'Development', '-o', outPath]);

    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('DATABASE_URL=postgres://postgres:secret123@db.supabase.co:5432/main');
    expect(content).toContain('STRIPE_SECRET_KEY=sk_test_51MockStripeSecretKey9988');
    // Production stripe key should NOT be included
    expect(content).not.toContain('sk_live_51MockStripeLiveKey1122');
  });
});
