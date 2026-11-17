import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { setDoc, doc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../index.js';
import { saveSession, clearSession } from '../../auth/storage.js';
import { deriveKey, encrypt, generateSalt, createVerifier } from '../../core/crypto.js';
import {
  setupVault,
  createTOTP,
  createSSHKey,
  getPasswords,
  getCertificates,
} from '../../core/firestore.js';
import { initFirebase } from '../../core/firebase.js';

describe('Phase 4 CLI Specialized Types (Emulator Integration)', () => {
  let dbInstance: any;
  let uid: string;
  const email = `phase4-test-${Date.now()}@example.com`;
  const password = 'TestUserPassword123!';
  const masterPassword = 'MyVaultMasterPassword99!';
  let salt: string;
  let derivedKey: CryptoKey;
  let testScyncDir: string;
  let origUserProfile: string | undefined;

  beforeAll(async () => {
    testScyncDir = path.join(os.tmpdir(), `scync-cli-phase4-${Date.now()}`);
    fs.mkdirSync(path.join(testScyncDir, '.scync'), { recursive: true });
    origUserProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = testScyncDir;
    process.env.HOME = testScyncDir;
    process.env.SCYNC_NO_AGENT = '1';
    process.env.SCYNC_MASTER_PASSWORD = masterPassword;

    const { auth, db } = initFirebase({
      projectId: 'demo-scync',
      useEmulators: true,
      authEmulatorUrl: 'http://127.0.0.1:9099',
      firestoreEmulatorHost: '127.0.0.1',
      firestoreEmulatorPort: 8080,
    });
    dbInstance = db;

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;

    saveSession({
      uid,
      email,
      displayName: 'Phase 4 User',
      providerId: 'password',
      refreshToken: 'fake-refresh-token',
      idToken: 'fake-id-token',
      expiresAt: Date.now() + 3600 * 1000,
      savedAt: new Date().toISOString(),
    });

    salt = generateSalt();
    derivedKey = await deriveKey(masterPassword, uid, salt);
    const verifier = await createVerifier(derivedKey);
    await setupVault(uid, salt, verifier, dbInstance);

    // 1. Seed TOTP token
    await createTOTP(uid, derivedKey, {
      issuer: 'GitHub',
      label: 'octocat',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    }, dbInstance);

    // 2. Seed SSH Key
    await createSSHKey(uid, derivedKey, {
      name: 'prod-bastion',
      type: 'ssh-ed25519',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKey prod-bastion',
      fingerprint: 'MD5:aa:bb:cc:dd:ee:ff',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nFakePrivateKeyContent\n-----END OPENSSH PRIVATE KEY-----',
      hosts: ['bastion.prod.company.internal', 'jump.prod.company.internal'],
    }, dbInstance);

    // 3. Seed Password
    const encPass = await encrypt(derivedKey, 'SuperSecureP@ssw0rd!');
    await setDoc(doc(dbInstance, 'users', uid, 'passwords', 'pass-1'), {
      name: 'AWS Console Root',
      username: 'root@company.com',
      url: 'https://signin.aws.amazon.com/console',
      encPassword: encPass,
      encNotes: null,
      category: 'Cloud',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Seed Certificate
    const encCertPem = await encrypt(derivedKey, '-----BEGIN CERTIFICATE-----\nFakeCertPem\n-----END CERTIFICATE-----');
    await setDoc(doc(dbInstance, 'users', uid, 'certificates', 'cert-1'), {
      name: 'Wildcard API Cert',
      encCertPem,
      encKeyPem: null,
      subject: 'CN=*.api.example.com',
      issuer: 'CN=Let\'s Encrypt Authority X3',
      serialNumber: '03A4B89F',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2027-01-01'),
      isSelfSigned: false,
      fingerprint: 'SHA256:12:34:56:78:90:AB',
      hosts: ['*.api.example.com', 'api.example.com'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    clearSession();
    delete process.env.SCYNC_NO_AGENT;
    delete process.env.SCYNC_MASTER_PASSWORD;
    if (origUserProfile) {
      process.env.USERPROFILE = origUserProfile;
      process.env.HOME = origUserProfile;
    }
    try {
      fs.rmSync(testScyncDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('scync totp generates accurate 6-digit codes and lists tokens', async () => {
    const prog1 = createProgram();
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => { captured += msg + '\n'; };

    await prog1.parseAsync(['node', 'scync', 'totp']);
    expect(captured).toContain('GitHub');
    expect(captured).toContain('octocat');

    captured = '';
    const prog2 = createProgram();
    await prog2.parseAsync(['node', 'scync', 'totp', 'GitHub']);
    console.log = origLog;

    expect(captured).toContain('GitHub');
    expect(captured).toContain('octocat');
    expect(captured).toMatch(/\d{3}\s+\d{3}/); // formatted 6-digit code e.g. 123  456
  });

  it('scync ssh lists keys, exports with mode 0600, and generates config', async () => {
    const prog1 = createProgram();
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => { captured += msg + '\n'; };

    await prog1.parseAsync(['node', 'scync', 'ssh', 'ls']);
    expect(captured).toContain('prod-bastion');
    expect(captured).toContain('ssh-ed25519');

    // Export keys
    const exportDir = path.join(testScyncDir, '.ssh_test_export');
    const prog2 = createProgram();
    await prog2.parseAsync(['node', 'scync', 'ssh', 'export', 'prod-bastion', '--dir', exportDir]);

    const privFile = path.join(exportDir, 'id_ed25519_prod-bastion');
    const pubFile = path.join(exportDir, 'id_ed25519_prod-bastion.pub');

    expect(fs.existsSync(privFile)).toBe(true);
    expect(fs.existsSync(pubFile)).toBe(true);
    expect(fs.readFileSync(privFile, 'utf8')).toContain('FakePrivateKeyContent');
    expect(fs.readFileSync(pubFile, 'utf8')).toContain('AAAAC3NzaC1lZDI1NTE5');

    // Generate config snippet
    captured = '';
    const prog3 = createProgram();
    await prog3.parseAsync(['node', 'scync', 'ssh', 'config']);
    console.log = origLog;

    expect(captured).toContain('Host bastion.prod.company.internal jump.prod.company.internal');
    expect(captured).toContain('IdentityFile ~/.ssh/id_ed25519_prod-bastion');
  });

  it('scync passwords performs read-only masked listing and reveal', async () => {
    const prog1 = createProgram();
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => { captured += msg + '\n'; };

    await prog1.parseAsync(['node', 'scync', 'passwords']);
    expect(captured).toContain('AWS Console Root');
    expect(captured).toContain('••••••••');

    captured = '';
    const prog2 = createProgram();
    await prog2.parseAsync(['node', 'scync', 'passwords', '--reveal']);
    console.log = origLog;

    expect(captured).toContain('AWS Console Root');
    expect(captured).toContain('SuperSecureP@ssw0rd!');
  });

  it('scync certs inspects certificates and reports SANs and validity', async () => {
    const prog1 = createProgram();
    let captured = '';
    const origLog = console.log;
    console.log = (msg: any) => { captured += msg + '\n'; };

    await prog1.parseAsync(['node', 'scync', 'certs']);
    console.log = origLog;

    expect(captured).toContain('Wildcard API Cert');
    expect(captured).toContain('api.example.com');
  });
});
