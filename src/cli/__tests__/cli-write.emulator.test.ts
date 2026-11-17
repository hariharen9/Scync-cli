import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { initFirebase } from '../../core/firebase.js';
import { generateSalt, deriveKey, createVerifier, decrypt } from '../../core/crypto.js';
import { setupVault, getSecrets, getProjects } from '../../core/firestore.js';
import { saveSession } from '../../auth/storage.js';
import { createProgram } from '../index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Phase 2 CLI Write Commands & Workflows (Emulator Integration)', () => {
  const email = `writer_${Date.now()}@example.local`;
  const authPassword = 'Password123!';
  const masterPassword = 'writer_master_password_789!';
  let uid: string;
  let dbInstance: any;
  let testScyncDir: string;
  let derivedKey: CryptoKey;

  beforeAll(async () => {
    testScyncDir = path.join(os.tmpdir(), `scync-cli-write-${Date.now()}`);
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

    // Create user in Auth Emulator
    const cred = await createUserWithEmailAndPassword(auth, email, authPassword);
    uid = cred.user.uid;

    // Setup vault
    const salt = generateSalt();
    derivedKey = await deriveKey(masterPassword, uid, salt);
    const verifier = await createVerifier(derivedKey);
    await setupVault(uid, salt, verifier, db);

    // Save session
    saveSession({
      uid,
      email,
      displayName: 'Writer Test',
      refreshToken: 'mock-refresh-token',
      idToken: await cred.user.getIdToken(),
      expiresAt: Date.now() + 3600_000,
      providerId: 'password',
      savedAt: new Date().toISOString()
    });
  });

  afterAll(() => {
    delete process.env.SCYNC_MASTER_PASSWORD;
    try {
      if (fs.existsSync(testScyncDir)) {
        fs.rmSync(testScyncDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('scync set creates a new secret with version 1 and activity ledger record', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'set', 'OPENAI_API_KEY',
      '-v', 'sk-proj-openai-test-key-12345678',
      '-s', 'OpenAI',
      '-t', 'API Key',
      '-e', 'Development',
      '--notes', 'Primary AI key'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'OPENAI_API_KEY');
    expect(found).toBeDefined();
    expect(found!.service).toBe('OpenAI');
    expect(found!.environment).toBe('Development');
    expect(found!.version).toBe(1);
    expect(found!.versions).toHaveLength(1);
    expect(found!.versions![0].changeType).toBe('created');

    // Decrypt and verify
    const plainVal = await decrypt(derivedKey, found!.encValue);
    expect(plainVal).toBe('sk-proj-openai-test-key-12345678');
    const plainNotes = await decrypt(derivedKey, found!.encNotes!);
    expect(plainNotes).toBe('Primary AI key');

    // Verify Ledger event
    const ledgerSnap = await getDocs(collection(dbInstance, 'users', uid, 'ledger'));
    const ledgerDocs = ledgerSnap.docs.map(d => d.data());
    const createdEvent = ledgerDocs.find(e => e.action === 'secret_created' && e.entityName === 'OPENAI_API_KEY');
    expect(createdEvent).toBeDefined();
    expect(createdEvent!.service).toBe('OpenAI');
    expect(createdEvent!.version).toBe(1);
  });

  it('scync set supports Recovery Codes type with structured JSON and remainingCodes', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'set', 'GITHUB_RECOVERY_CODES',
      '-v', 'RC-1111, RC-2222, RC-3333',
      '-s', 'GitHub',
      '-t', 'Recovery Codes',
      '-e', 'Personal'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'GITHUB_RECOVERY_CODES');
    expect(found).toBeDefined();
    expect(found!.type).toBe('Recovery Codes');
    expect(found!.remainingCodes).toBe(3);

    const decrypted = await decrypt(derivedKey, found!.encValue);
    const parsed = JSON.parse(decrypted);
    expect(parsed.codes).toHaveLength(3);
    expect(parsed.codes[0].code).toBe('RC-1111');
    expect(parsed.codes[0].used).toBe(false);
  });

  it('scync update modifies secret and increments version to v2', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'update', 'OPENAI_API_KEY',
      '-v', 'sk-proj-openai-updated-value-999',
      '--notes', 'Updated note'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'OPENAI_API_KEY');
    expect(found!.version).toBe(2);
    expect(found!.versions).toHaveLength(2);
    expect(found!.versions![1].changeType).toBe('updated');

    const decrypted = await decrypt(derivedKey, found!.encValue);
    expect(decrypted).toBe('sk-proj-openai-updated-value-999');
  });

  it('scync rotate records rotation timestamp and sets status to Active', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'rotate', 'OPENAI_API_KEY',
      '-v', 'sk-proj-openai-rotated-value-v3'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'OPENAI_API_KEY');
    expect(found!.version).toBe(3);
    expect(found!.status).toBe('Active');
    expect(found!.lastRotated).not.toBeNull();
    expect(found!.versions![2].changeType).toBe('rotated');

    // Verify Ledger event
    const ledgerSnap = await getDocs(collection(dbInstance, 'users', uid, 'ledger'));
    const ledgerDocs = ledgerSnap.docs.map(d => d.data());
    const rotateEvent = ledgerDocs.find(e => e.action === 'secret_rotated' && e.entityName === 'OPENAI_API_KEY');
    expect(rotateEvent).toBeDefined();
    expect(rotateEvent!.version).toBe(3);
  });

  it('scync restore recovers an earlier version', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'restore', 'OPENAI_API_KEY', '1'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'OPENAI_API_KEY');
    expect(found!.version).toBe(4);

    const decrypted = await decrypt(derivedKey, found!.encValue);
    // Version 1 value was sk-proj-openai-test-key-12345678
    expect(decrypted).toBe('sk-proj-openai-test-key-12345678');
  });

  it('scync push imports a .env file with dry-run and overwrite', async () => {
    const envFile = path.join(testScyncDir, 'import-test.env');
    fs.writeFileSync(envFile, `
STRIPE_WEBHOOK_SECRET=whsec_abc123xyz
DATABASE_URL="postgres://user:pass@localhost:5432/testdb"
export AWS_KEY="AKIAIOSFODNN7EXAMPLE"
`);

    // Dry-run first
    const prog1 = createProgram();
    await prog1.parseAsync([
      'node', 'scync', 'push', envFile, '--dry-run', '-e', 'Testing'
    ]);

    // Real import
    const prog2 = createProgram();
    await prog2.parseAsync([
      'node', 'scync', 'push', envFile, '-e', 'Testing'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const stripeSec = secrets.find(s => s.name === 'STRIPE_WEBHOOK_SECRET');
    const dbSec = secrets.find(s => s.name === 'DATABASE_URL' && s.environment === 'Testing');
    const awsSec = secrets.find(s => s.name === 'AWS_KEY');

    expect(stripeSec).toBeDefined();
    expect(stripeSec!.service).toBe('Stripe');
    expect(dbSec).toBeDefined();
    expect(awsSec).toBeDefined();
    expect(awsSec!.service).toBe('AWS');

    const decryptedAws = await decrypt(derivedKey, awsSec!.encValue);
    expect(decryptedAws).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('scync projects supports create, update and delete', async () => {
    const capture = async (argv: string[]) => {
      let output = '';
      const original = console.log;
      console.log = (...args: any[]) => {
        output += args.join(' ');
      };
      try {
        const program = createProgram();
        await program.parseAsync(['node', 'scync', ...argv]);
      } finally {
        console.log = original;
      }
      return output;
    };

    const createdJson = await capture([
      'projects', 'create', 'CLI PROJECT',
      '--description', 'Created from the CLI',
      '--color', 'blue',
      '--json',
    ]);
    const created = JSON.parse(createdJson);
    expect(created.name).toBe('CLI PROJECT');
    expect(created.color).toBe('blue');
    expect(created.id).toBeTruthy();

    const updatedJson = await capture([
      'projects', 'update', created.id,
      '--name', 'CLI PROJECT RENAMED',
      '--color', 'red',
      '--json',
    ]);
    const updated = JSON.parse(updatedJson);
    expect(updated.name).toBe('CLI PROJECT RENAMED');
    expect(updated.color).toBe('red');

    const listed = await getProjects(uid, dbInstance);
    expect(listed.find((project) => project.id === created.id)?.name).toBe('CLI PROJECT RENAMED');

    const deletedJson = await capture([
      'projects', 'delete', created.id,
      '--yes',
      '--json',
    ]);
    const deleted = JSON.parse(deletedJson);
    expect(deleted.deleted).toBe(true);
    expect(deleted.movedSecrets).toBe(0);

    const after = await getProjects(uid, dbInstance);
    expect(after.some((project) => project.id === created.id)).toBe(false);
  });

  it('scync rm deletes a secret and logs secret_deleted in activity ledger', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'rm', 'GITHUB_RECOVERY_CODES', '--yes'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.name === 'GITHUB_RECOVERY_CODES');
    expect(found).toBeUndefined();

    // Verify deletion recorded in ledger
    const ledgerSnap = await getDocs(collection(dbInstance, 'users', uid, 'ledger'));
    const ledgerDocs = ledgerSnap.docs.map(d => d.data());
    const deleteEvent = ledgerDocs.find(e => e.action === 'secret_deleted' && e.entityName === 'GITHUB_RECOVERY_CODES');
    expect(deleteEvent).toBeDefined();
  });
});
