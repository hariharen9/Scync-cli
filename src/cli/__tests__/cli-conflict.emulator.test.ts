import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initFirebase } from '../../core/firebase.js';
import { generateSalt, deriveKey, createVerifier, encrypt, decrypt } from '../../core/crypto.js';
import { setupVault, createSecret, getSecrets } from '../../core/firestore.js';
import { saveSession } from '../../auth/storage.js';
import { createProgram } from '../index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('Optimistic Concurrency Conflict Detection (Emulator Integration)', () => {
  const email = `conflict_user_${Date.now()}@example.local`;
  const authPassword = 'Password123!';
  const masterPassword = 'conflict_password_999!';
  let uid: string;
  let dbInstance: any;
  let testScyncDir: string;
  let derivedKey: CryptoKey;
  let secretId: string;

  beforeAll(async () => {
    testScyncDir = path.join(os.tmpdir(), `scync-cli-conflict-${Date.now()}`);
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

    // Create user
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
      displayName: 'Conflict Test',
      refreshToken: 'mock-refresh-token',
      idToken: await cred.user.getIdToken(),
      expiresAt: Date.now() + 3600_000,
      providerId: 'password',
      savedAt: new Date().toISOString()
    });

    // Create secret at v1
    const created = await createSecret(uid, derivedKey, {
      name: 'SHARED_PROD_KEY',
      service: 'Stripe',
      type: 'API Key',
      environment: 'Production',
      status: 'Active',
      value: 'original-v1-value',
      notes: 'Initial v1 note',
      lastRotated: new Date(),
      expiresOn: null,
      projectId: null,
      remainingCodes: null
    }, db);
    secretId = created.id;
  });

  afterAll(() => {
    delete process.env.SCYNC_MASTER_PASSWORD;
    try {
      if (fs.existsSync(testScyncDir)) {
        fs.rmSync(testScyncDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('detects concurrent edits and aborts with ConflictError (exit code 6)', async () => {
    // 1. Simulate concurrent edit from the Web App directly in Firestore:
    // Update secret directly to version 2
    const secretRef = doc(dbInstance, 'users', uid, 'secrets', secretId);
    const concurrentEncValue = await encrypt(derivedKey, 'concurrent-web-edit-v2');
    
    await updateDoc(secretRef, {
      value: 'concurrent-web-edit-v2',
      encValue: concurrentEncValue,
      version: 2,
      updatedAt: serverTimestamp()
    });

    // 2. Now CLI tries to update, but the CLI previously read version 1.
    // We pass expectedVersion: 1 to simulate a CLI invocation where version changed in the background
    const { updateSecret: updateWithExpected } = await import('../../core/firestore.js');
    
    await expect(
      updateWithExpected(
        uid,
        derivedKey,
        secretId,
        {
          name: 'SHARED_PROD_KEY',
          service: 'Stripe',
          type: 'API Key',
          environment: 'Production',
          status: 'Active',
          value: 'cli-conflicting-value',
          notes: '',
          lastRotated: null,
          expiresOn: null
        },
        undefined,
        'updated',
        dbInstance,
        { expectedVersion: 1, force: false }
      )
    ).rejects.toThrow(/Conflict detected on 'SHARED_PROD_KEY'/);

    // Verify Firestore was NOT overwritten by the conflicting edit
    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.id === secretId);
    expect(found!.version).toBe(2);
    const decrypted = await decrypt(derivedKey, found!.encValue);
    expect(decrypted).toBe('concurrent-web-edit-v2');
  });

  it('allows forced override with --force after explicit --yes confirmation', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'scync', 'update', 'SHARED_PROD_KEY',
      '-v', 'cli-forced-override-v3',
      '--force',
      '--yes'
    ]);

    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.id === secretId);
    expect(found!.version).toBe(3);

    const decrypted = await decrypt(derivedKey, found!.encValue);
    expect(decrypted).toBe('cli-forced-override-v3');
  });
});
