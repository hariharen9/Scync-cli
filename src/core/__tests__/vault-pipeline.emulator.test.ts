import { describe, it, expect, beforeAll } from 'vitest';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import { initFirebase } from '../firebase.js';
import { 
  generateSalt, 
  deriveKey, 
  createVerifier, 
  checkVerifier 
} from '../crypto.js';
import { 
  setupVault, 
  getVaultMeta, 
  createSecret, 
  getSecrets, 
  updateSecret, 
  decryptSecret 
} from '../firestore.js';

describe('End-to-End Vault Pipeline (Auth + Firestore + Crypto)', () => {
  const email = `testuser_${Date.now()}@example.local`;
  const authPassword = 'Password123!';
  const masterPassword = 'super_secure_vault_master_key_123';
  let uid: string;
  let authInstance: any;
  let dbInstance: any;

  beforeAll(async () => {
    const { auth, db } = initFirebase({
      projectId: 'demo-scync',
      useEmulators: true,
      authEmulatorUrl: 'http://127.0.0.1:9099',
      firestoreEmulatorHost: '127.0.0.1',
      firestoreEmulatorPort: 8080
    });
    authInstance = auth;
    dbInstance = db;

    // 1. Authenticate (Create User in Auth Emulator)
    const userCredential = await createUserWithEmailAndPassword(auth, email, authPassword);
    expect(userCredential.user).toBeDefined();
    expect(userCredential.user.uid).toBeDefined();
    uid = userCredential.user.uid;
  });

  it('proves auth session persistence and sign-in yields identical UID', async () => {
    await signOut(authInstance);
    const reAuth = await signInWithEmailAndPassword(authInstance, email, authPassword);
    expect(reAuth.user.uid).toBe(uid);
  });

  it('sets up vault, reads metadata, derives key, and verifies verifier', async () => {
    // 2. Setup Vault
    const salt = generateSalt();
    const key = await deriveKey(masterPassword, uid, salt);
    const verifier = await createVerifier(key);

    await setupVault(uid, salt, verifier, dbInstance);

    // 3. Read Vault Meta
    const meta = await getVaultMeta(uid, dbInstance);
    expect(meta).not.toBeNull();
    expect(meta!.salt).toBe(salt);
    expect(meta!.verifier).toEqual(verifier);

    // 4. Derive key from stored salt and verify
    const derivedKey = await deriveKey(masterPassword, uid, meta!.salt);
    const isValid = await checkVerifier(derivedKey, meta!.verifier);
    expect(isValid).toBe(true);

    // Wrong password check
    const wrongKey = await deriveKey('wrong_master_password', uid, meta!.salt);
    const isWrongValid = await checkVerifier(wrongKey, meta!.verifier);
    expect(isWrongValid).toBe(false);
  });

  it('creates, encrypts, persists, updates, and decrypts secrets with versioning', async () => {
    const meta = await getVaultMeta(uid, dbInstance);
    expect(meta).not.toBeNull();
    const key = await deriveKey(masterPassword, uid, meta!.salt);

    // Create Secret
    const secretName = 'STRIPE_TEST_KEY';
    const secretPlaintext = 'sk_test_51Abcdef1234567890';
    const secretNotes = 'Test API key for development';

    const created = await createSecret(uid, key, {
      name: secretName,
      service: 'Stripe',
      type: 'API Key',
      environment: 'Development',
      status: 'Active',
      value: secretPlaintext,
      notes: secretNotes,
      lastRotated: new Date(),
      expiresOn: null,
      projectId: null,
      remainingCodes: null
    }, dbInstance);

    expect(created.id).toBeDefined();
    expect(created.version).toBe(1);
    expect(created.versions).toHaveLength(1);

    // Fetch secrets from Firestore
    const secrets = await getSecrets(uid, dbInstance);
    const found = secrets.find(s => s.id === created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe(secretName);
    expect(found!.encValue.ciphertext).not.toContain(secretPlaintext);

    // Decrypt Secret
    const decrypted = await decryptSecret(key, found!);
    expect(decrypted.value).toBe(secretPlaintext);
    expect(decrypted.notes).toBe(secretNotes);

    // Update Secret (Rotated)
    const newSecretValue = 'sk_test_99UpdatedSecretValue!';
    await updateSecret(uid, key, found!.id, {
      name: secretName,
      service: 'Stripe',
      type: 'API Key',
      environment: 'Development',
      status: 'Rotated',
      value: newSecretValue,
      notes: secretNotes,
      lastRotated: new Date(),
      expiresOn: null,
      projectId: null,
      remainingCodes: null
    }, found, 'rotated', dbInstance);

    // Fetch and check updated versions
    const updatedSecrets = await getSecrets(uid, dbInstance);
    const updatedFound = updatedSecrets.find(s => s.id === created.id);
    expect(updatedFound!.version).toBe(2);
    expect(updatedFound!.versions).toHaveLength(2);
    expect(updatedFound!.versions![1].changeType).toBe('rotated');

    const decryptedUpdated = await decryptSecret(key, updatedFound!);
    expect(decryptedUpdated.value).toBe(newSecretValue);
  });
});
