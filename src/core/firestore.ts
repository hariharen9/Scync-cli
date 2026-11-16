import { 
  collection, doc, setDoc, updateDoc, deleteDoc, 
  onSnapshot, serverTimestamp, getDoc, writeBatch, getDocs,
  query, where, runTransaction, type Firestore
} from 'firebase/firestore';
import { getDb } from './firebase.js';
import { encrypt, decrypt } from './crypto.js';
import { ConflictError } from '../cli/errors.js';
import type { 
  VaultMeta, BiometricMeta, SecretFormData, StoredSecret, DecryptedSecret, 
  Project, EncryptedField, CustomService, StoredSSHKey, StoredTOTP,
  StoredCertificate, StoredPassword, DecryptedPassword, PasswordFormData,
  SecretVersion, SecretChangeType, LedgerAction, LedgerEntry, RecoveryKitMeta
} from './types.js';

// Vault Meta
export async function setupVault(uid: string, salt: string, verifier: EncryptedField, dbOverride?: Firestore): Promise<void> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "meta", "vault");
  await setDoc(ref, {
    salt,
    verifier,
    createdAt: serverTimestamp()
  });
}

export async function getVaultMeta(uid: string, dbOverride?: Firestore): Promise<VaultMeta | null> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "meta", "vault");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    salt: data.salt,
    verifier: data.verifier,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
    biometrics: data.biometrics ?? (data.biometric ? [data.biometric] : []),
    recovery: data.recovery ? {
      salt: data.recovery.salt,
      encMasterPassword: data.recovery.encMasterPassword,
      createdAt: data.recovery.createdAt?.toDate ? data.recovery.createdAt.toDate() : (data.recovery.createdAt ? new Date(data.recovery.createdAt) : new Date())
    } : null
  };
}

export async function updateVaultBiometrics(uid: string, biometrics: BiometricMeta[] | null, dbOverride?: Firestore): Promise<void> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "meta", "vault");
  if (biometrics === null) {
    await updateDoc(ref, { biometrics: null, updatedAt: serverTimestamp() });
  } else {
    await updateDoc(ref, { biometrics, updatedAt: serverTimestamp() });
  }
}

export async function updateVaultRecovery(uid: string, recovery: Omit<RecoveryKitMeta, 'createdAt'> | null, dbOverride?: Firestore): Promise<void> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "meta", "vault");
  if (recovery === null) {
    await updateDoc(ref, { recovery: null, updatedAt: serverTimestamp() });
  } else {
    await updateDoc(ref, {
      recovery: {
        salt: recovery.salt,
        encMasterPassword: recovery.encMasterPassword,
        createdAt: serverTimestamp()
      },
      updatedAt: serverTimestamp()
    });
  }
}

export async function changeVaultPassword(
  uid: string,
  oldKey: CryptoKey,
  newKey: CryptoKey,
  newSalt: string,
  newVerifier: EncryptedField,
  secrets: StoredSecret[],
  sshKeys: StoredSSHKey[] = [],
  totpTokens: StoredTOTP[] = [],
  certificates: StoredCertificate[] = [],
  passwords: StoredPassword[] = [],
  dbOverride?: Firestore
): Promise<void> {
  const db = dbOverride || getDb();
  const batch = writeBatch(db);

  // 1. Update Vault Meta
  const metaRef = doc(db, "users", uid, "meta", "vault");
  batch.update(metaRef, {
    salt: newSalt,
    verifier: newVerifier,
    recovery: null,
    updatedAt: serverTimestamp()
  });

  // 2. Re-encrypt all secrets
  for (const secret of secrets) {
    const secretRef = doc(db, "users", uid, "secrets", secret.id);
    const valuePlaintext = await decrypt(oldKey, secret.encValue);
    const notesPlaintext = secret.encNotes ? await decrypt(oldKey, secret.encNotes) : null;
    const newEncValue = await encrypt(newKey, valuePlaintext);
    const newEncNotes = notesPlaintext ? await encrypt(newKey, notesPlaintext) : null;
    // Re-encrypt secret versions if present
    const updateData: Record<string, any> = {
      encValue: newEncValue,
      encNotes: newEncNotes,
      updatedAt: serverTimestamp()
    };

    if (secret.versions && secret.versions.length > 0) {
      const reEncryptedVersions: SecretVersion[] = [];
      for (const v of secret.versions) {
        const vPlain = await decrypt(oldKey, v.encValue);
        const vEnc = await encrypt(newKey, vPlain);
        reEncryptedVersions.push({
          ...v,
          encValue: vEnc
        });
      }
      updateData.versions = reEncryptedVersions;
    }

    batch.update(secretRef, updateData);
  }

  // 3. Re-encrypt all SSH keys
  for (const ssh of sshKeys) {
    const sshRef = doc(db, "users", uid, "ssh_keys", ssh.id);
    const privPlaintext = await decrypt(oldKey, ssh.encPrivateKey);
    const newEncPrivateKey = await encrypt(newKey, privPlaintext);
    batch.update(sshRef, {
      encPrivateKey: newEncPrivateKey,
      updatedAt: serverTimestamp()
    });
  }

  // 4. Re-encrypt all TOTP tokens
  for (const totp of totpTokens) {
    const totpRef = doc(db, "users", uid, "totp_tokens", totp.id);
    const secretPlaintext = await decrypt(oldKey, totp.encSecret);
    const newEncSecret = await encrypt(newKey, secretPlaintext);
    batch.update(totpRef, {
      encSecret: newEncSecret,
      updatedAt: serverTimestamp()
    });
  }

  // 5. Re-encrypt all certificates
  for (const cert of certificates) {
    const certRef = doc(db, "users", uid, "certificates", cert.id);
    const certPemPlaintext = await decrypt(oldKey, cert.encCertPem);
    const newEncCertPem = await encrypt(newKey, certPemPlaintext);
    const updates: Record<string, any> = {
      encCertPem: newEncCertPem,
      updatedAt: serverTimestamp()
    };
    if (cert.encKeyPem) {
      const keyPemPlaintext = await decrypt(oldKey, cert.encKeyPem);
      updates.encKeyPem = await encrypt(newKey, keyPemPlaintext);
    }
    batch.update(certRef, updates);
  }

  // 6. Re-encrypt all passwords
  for (const p of passwords) {
    const pRef = doc(db, "users", uid, "passwords", p.id);
    const passPlaintext = await decrypt(oldKey, p.encPassword);
    const newEncPassword = await encrypt(newKey, passPlaintext);
    const updates: Record<string, any> = {
      encPassword: newEncPassword,
      updatedAt: serverTimestamp()
    };
    if (p.encNotes) {
      const notesPlaintext = await decrypt(oldKey, p.encNotes);
      updates.encNotes = await encrypt(newKey, notesPlaintext);
    }
    batch.update(pRef, updates);
  }

  await batch.commit();
}

// ─── Secrets CRUD ───

function getEncryptFn(keyOrSession: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField> }) {
  if (typeof (keyOrSession as any).encrypt === 'function') {
    return (pt: string) => (keyOrSession as any).encrypt(pt);
  }
  return (pt: string) => encrypt(keyOrSession as CryptoKey, pt);
}

function getDecryptFn(keyOrSession: CryptoKey | { decrypt: (ct: EncryptedField) => Promise<string> }) {
  if (typeof (keyOrSession as any).decrypt === 'function') {
    return (ct: EncryptedField) => (keyOrSession as any).decrypt(ct);
  }
  return (ct: EncryptedField) => decrypt(keyOrSession as CryptoKey, ct);
}

export async function createSecret(
  uid: string, 
  key: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField> }, 
  formData: SecretFormData,
  dbOverride?: Firestore
): Promise<StoredSecret> {
  const db = dbOverride || getDb();
  const secretsRef = collection(db, "users", uid, "secrets");
  const newRef = doc(secretsRef);
  
  const encFn = getEncryptFn(key);
  const encValue = await encFn(formData.value);
  const encNotes = formData.notes ? await encFn(formData.notes) : null;

  const initialVersion: SecretVersion = {
    version: 1,
    encValue,
    createdAt: new Date(),
    changeType: 'created',
  };

  const storedSecret: StoredSecret = {
    id: newRef.id,
    name: formData.name,
    service: formData.service,
    type: formData.type,
    environment: formData.environment,
    status: formData.status,
    encValue,
    encNotes: encNotes ?? null,
    lastRotated: formData.lastRotated ?? null,
    expiresOn: formData.expiresOn ?? null,
    createdAt: new Date(), 
    updatedAt: new Date(),
    projectId: formData.projectId || null,
    remainingCodes: formData.remainingCodes || null,
    version: 1,
    versions: [initialVersion]
  };

  const createData: Record<string, any> = {
    ...storedSecret,
    lastRotated: formData.lastRotated ?? null,
    expiresOn: formData.expiresOn ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(newRef, createData);

  await logLedgerEvent(uid, {
    action: 'secret_created',
    title: `Created ${formData.name}`,
    details: `${formData.type} · ${formData.environment}`,
    entityId: newRef.id,
    entityName: formData.name,
    service: formData.service,
    version: 1,
  }, db);

  return storedSecret;
}

export async function updateSecret(
  uid: string, 
  key: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField> }, 
  id: string, 
  formData: SecretFormData,
  previousSecret?: StoredSecret,
  explicitChangeType?: SecretChangeType,
  dbOverride?: Firestore,
  options?: { expectedVersion?: number; force?: boolean }
): Promise<void> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "secrets", id);
  const ledgerColRef = collection(db, "users", uid, "ledger");
  const ledgerDocRef = doc(ledgerColRef);
  
  // Encrypt sensitive payloads before opening the transaction
  const encFn = getEncryptFn(key);
  const encValue = await encFn(formData.value);
  const encNotes = formData.notes ? await encFn(formData.notes) : null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error(`Secret with id '${id}' not found.`);
    }

    const currentDoc = snap.data();
    const actualVersion = currentDoc.version || 1;

    // Concurrency version check
    if (options?.expectedVersion !== undefined && !options?.force) {
      if (actualVersion !== options.expectedVersion) {
        throw new ConflictError(formData.name, options.expectedVersion, actualVersion);
      }
    }

    const currentVersion = actualVersion;
    const rawVersions = Array.isArray(currentDoc.versions) ? currentDoc.versions : (previousSecret?.versions || []);
    let versions: SecretVersion[] = rawVersions.length > 0 ? [...rawVersions] : [
      {
        version: currentVersion,
        encValue: currentDoc.encValue || encValue,
        createdAt: currentDoc.updatedAt?.toDate ? currentDoc.updatedAt.toDate() : new Date(),
        changeType: 'created',
      }
    ];

    const isRotation = explicitChangeType === 'rotated' || (
      formData.lastRotated && 
      (!previousSecret?.lastRotated || formData.lastRotated.getTime() !== previousSecret.lastRotated.getTime())
    );
    const isRestored = explicitChangeType === 'restored';
    
    let changeType: SecretChangeType = 'updated';
    if (isRestored) changeType = 'restored';
    else if (isRotation) changeType = 'rotated';

    const nextVersion = currentVersion + 1;
    versions.push({
      version: nextVersion,
      encValue,
      createdAt: new Date(),
      changeType,
    });

    if (versions.length > 10) {
      versions = versions.slice(versions.length - 10);
    }

    const cleanVersions = versions.map((v: any) => {
      const item: Record<string, any> = {
        version: v.version,
        encValue: v.encValue,
        createdAt: v.createdAt?.toDate ? v.createdAt.toDate() : (v.createdAt instanceof Date ? v.createdAt : new Date(v.createdAt)),
        changeType: v.changeType || 'updated'
      };
      if (v.note !== undefined) {
        item.note = v.note;
      }
      return item;
    });

    const updateData: Record<string, any> = {
      name: formData.name,
      service: formData.service,
      type: formData.type,
      environment: formData.environment,
      status: formData.status,
      encValue,
      encNotes: encNotes ?? null,
      lastRotated: formData.lastRotated ?? null,
      expiresOn: formData.expiresOn ?? null,
      projectId: formData.projectId || null,
      remainingCodes: formData.remainingCodes || null,
      version: nextVersion,
      versions: cleanVersions,
      updatedAt: serverTimestamp()
    };

    tx.update(ref, updateData);

    const ledgerAction: LedgerAction = changeType === 'rotated' 
      ? 'secret_rotated' 
      : changeType === 'restored' 
      ? 'secret_restored' 
      : 'secret_updated';

    const actionTitle = changeType === 'rotated'
      ? `Rotated ${formData.name}`
      : changeType === 'restored'
      ? `Restored ${formData.name} to v${nextVersion}`
      : `Updated ${formData.name}`;

    tx.set(ledgerDocRef, {
      id: ledgerDocRef.id,
      action: ledgerAction,
      title: actionTitle,
      details: `${formData.service} · v${nextVersion}`,
      entityId: id,
      entityName: formData.name,
      service: formData.service,
      version: nextVersion,
      timestamp: serverTimestamp(),
    });
  });
}

export async function restoreSecretVersion(
  uid: string,
  key: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField>; decrypt: (ct: EncryptedField) => Promise<string> },
  secretId: string,
  targetVersionNumber: number,
  storedSecret: StoredSecret,
  dbOverride?: Firestore
): Promise<void> {
  const targetVer = storedSecret.versions?.find(v => v.version === targetVersionNumber);
  if (!targetVer) throw new Error(`Version ${targetVersionNumber} not found`);

  const decFn = getDecryptFn(key);
  const plainValue = await decFn(targetVer.encValue);
  const plainNotes = storedSecret.encNotes ? await decFn(storedSecret.encNotes) : "";

  const formData: SecretFormData = {
    name: storedSecret.name,
    service: storedSecret.service,
    type: storedSecret.type,
    environment: storedSecret.environment,
    status: 'Active',
    value: plainValue,
    notes: plainNotes,
    lastRotated: new Date(),
    expiresOn: storedSecret.expiresOn,
    projectId: storedSecret.projectId,
    remainingCodes: storedSecret.remainingCodes,
  };

  await updateSecret(uid, key, secretId, formData, storedSecret, 'restored', dbOverride);
}

export async function deleteSecret(
  uid: string, 
  id: string, 
  secretName?: string, 
  service?: string,
  dbOverride?: Firestore
): Promise<void> {
  const db = dbOverride || getDb();
  const ref = doc(db, "users", uid, "secrets", id);
  await deleteDoc(ref);
  await logLedgerEvent(uid, {
    action: 'secret_deleted',
    title: `Deleted ${secretName || 'secret'}`,
    details: service || '',
    entityId: id,
    entityName: secretName,
    service: service,
  }, db);
}

export async function getSecrets(uid: string, dbOverride?: Firestore): Promise<StoredSecret[]> {
  const db = dbOverride || getDb();
  const secretsRef = collection(db, "users", uid, "secrets");
  const snapshot = await getDocs(secretsRef);
  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    const rawVersions = Array.isArray(data.versions) ? data.versions : [];
    const versions: SecretVersion[] = rawVersions.map((v: any) => ({
      version: v.version || 1,
      encValue: v.encValue,
      createdAt: v.createdAt?.toDate ? v.createdAt.toDate() : (v.createdAt ? new Date(v.createdAt) : new Date()),
      changeType: v.changeType || 'updated',
      note: v.note || undefined,
    }));

    return {
      ...data,
      id: docSnap.id,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
      lastRotated: data.lastRotated?.toDate ? data.lastRotated.toDate() : (data.lastRotated ? new Date(data.lastRotated) : null),
      expiresOn: data.expiresOn?.toDate ? data.expiresOn.toDate() : (data.expiresOn ? new Date(data.expiresOn) : null),
      remainingCodes: data.remainingCodes ?? null,
      version: data.version || (versions.length > 0 ? versions[versions.length - 1].version : 1),
      versions: versions.length > 0 ? versions : undefined,
    } as StoredSecret;
  });
}

export function subscribeToSecrets(
  uid: string, 
  callback: (secrets: StoredSecret[]) => void,
  dbOverride?: Firestore
): () => void {
  const db = dbOverride || getDb();
  const secretsRef = collection(db, "users", uid, "secrets");
  
  return onSnapshot(secretsRef, (snapshot) => {
    const secrets = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      const rawVersions = Array.isArray(data.versions) ? data.versions : [];
      const versions: SecretVersion[] = rawVersions.map((v: any) => ({
        version: v.version || 1,
        encValue: v.encValue,
        createdAt: v.createdAt?.toDate ? v.createdAt.toDate() : (v.createdAt ? new Date(v.createdAt) : new Date()),
        changeType: v.changeType || 'updated',
        note: v.note || undefined,
      }));

      return {
        ...data,
        id: docSnap.id,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
        lastRotated: data.lastRotated?.toDate ? data.lastRotated.toDate() : (data.lastRotated ? new Date(data.lastRotated) : null),
        expiresOn: data.expiresOn?.toDate ? data.expiresOn.toDate() : (data.expiresOn ? new Date(data.expiresOn) : null),
        remainingCodes: data.remainingCodes ?? null,
        version: data.version || (versions.length > 0 ? versions[versions.length - 1].version : 1),
        versions: versions.length > 0 ? versions : undefined,
      } as StoredSecret;
    });
    callback(secrets);
  });
}

export async function decryptSecret(
  keyOrSession: CryptoKey | { decrypt: (ct: EncryptedField) => Promise<string> }, 
  stored: StoredSecret
): Promise<DecryptedSecret> {
  const decFn = getDecryptFn(keyOrSession);

  const value = await decFn(stored.encValue);
  const notes = stored.encNotes ? await decFn(stored.encNotes) : "";
  
  const { encValue, encNotes, ...rest } = stored;
  
  return {
    ...rest,
    value,
    notes
  };
}

// ─── Vault Activity Ledger ───

export async function logLedgerEvent(
  uid: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp'>,
  dbOverride?: Firestore
): Promise<void> {
  try {
    const db = dbOverride || getDb();
    const colRef = collection(db, "users", uid, "ledger");
    const newRef = doc(colRef);
    await setDoc(newRef, {
      id: newRef.id,
      action: entry.action,
      title: entry.title,
      details: entry.details || '',
      entityId: entry.entityId || '',
      entityName: entry.entityName || '',
      service: entry.service || '',
      version: entry.version ?? null,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn("Failed to write to ledger:", err);
  }
}

export function subscribeToLedger(
  uid: string,
  onUpdate: (entries: LedgerEntry[]) => void,
  dbOverride?: Firestore
): () => void {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "ledger");
  return onSnapshot(colRef, (snapshot) => {
    const entries: LedgerEntry[] = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      entries.push({
        id: data.id || docSnap.id,
        action: data.action,
        title: data.title || '',
        details: data.details || '',
        entityId: data.entityId || '',
        entityName: data.entityName || '',
        service: data.service || '',
        version: data.version ?? undefined,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : new Date()),
      });
    });
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    onUpdate(entries);
  });
}

// ─── SSH Keys ───

export async function getSSHKeys(uid: string, dbOverride?: Firestore): Promise<StoredSSHKey[]> {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "ssh_keys");
  const snap = await getDocs(colRef);
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      type: data.type || 'ssh-rsa',
      publicKey: data.publicKey,
      fingerprint: data.fingerprint,
      encPrivateKey: data.encPrivateKey,
      hosts: Array.isArray(data.hosts) ? data.hosts : [],
      rotationDate: data.rotationDate?.toDate ? data.rotationDate.toDate() : (data.rotationDate ? new Date(data.rotationDate) : null),
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
    } as StoredSSHKey;
  });
}

export async function createSSHKey(
  uid: string,
  keyOrSession: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField> },
  data: {
    name: string;
    type: string;
    publicKey: string;
    fingerprint: string;
    privateKey: string;
    hosts?: string[];
  },
  dbOverride?: Firestore
): Promise<string> {
  const db = dbOverride || getDb();
  const keysRef = collection(db, "users", uid, "ssh_keys");
  const newRef = doc(keysRef);

  const encFn = getEncryptFn(keyOrSession);
  const encPrivateKey = await encFn(data.privateKey);

  await setDoc(newRef, {
    id: newRef.id,
    name: data.name,
    type: data.type,
    publicKey: data.publicKey,
    fingerprint: data.fingerprint,
    encPrivateKey,
    hosts: data.hosts || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    rotationDate: null,
  });

  return newRef.id;
}

export async function deleteSSHKey(uid: string, id: string, dbOverride?: Firestore): Promise<void> {
  const db = dbOverride || getDb();
  await deleteDoc(doc(db, "users", uid, "ssh_keys", id));
}

// ─── TOTP Tokens ───

export async function getTOTPTokens(uid: string, dbOverride?: Firestore): Promise<StoredTOTP[]> {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "totp_tokens");
  const snap = await getDocs(colRef);
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      issuer: data.issuer || '',
      label: data.label || '',
      encSecret: data.encSecret,
      algorithm: data.algorithm || 'SHA1',
      digits: data.digits || 6,
      period: data.period || 30,
      icon: data.icon || '',
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
    } as StoredTOTP;
  });
}

export async function createTOTP(
  uid: string,
  keyOrSession: CryptoKey | { encrypt: (pt: string) => Promise<EncryptedField> },
  data: {
    issuer: string;
    label: string;
    secret: string;
    algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
    digits?: 6 | 8;
    period?: 30 | 60;
  },
  dbOverride?: Firestore
): Promise<string> {
  const db = dbOverride || getDb();
  const tokensRef = collection(db, "users", uid, "totp_tokens");
  const newRef = doc(tokensRef);

  const encFn = getEncryptFn(keyOrSession);
  const encSecret = await encFn(data.secret);

  await setDoc(newRef, {
    id: newRef.id,
    issuer: data.issuer,
    label: data.label,
    encSecret,
    algorithm: data.algorithm || 'SHA1',
    digits: data.digits || 6,
    period: data.period || 30,
    icon: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return newRef.id;
}

export async function deleteTOTP(uid: string, id: string, dbOverride?: Firestore): Promise<void> {
  const db = dbOverride || getDb();
  await deleteDoc(doc(db, "users", uid, "totp_tokens", id));
}

// ─── Passwords ───

export async function getPasswords(uid: string, dbOverride?: Firestore): Promise<StoredPassword[]> {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "passwords");
  const snap = await getDocs(colRef);
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || data.title || '',
      username: data.username || '',
      url: data.url || '',
      encPassword: data.encPassword,
      encNotes: data.encNotes ?? null,
      category: data.category || 'General',
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
    } as StoredPassword;
  });
}

// ─── Certificates ───

export async function getCertificates(uid: string, dbOverride?: Firestore): Promise<StoredCertificate[]> {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "certificates");
  const snap = await getDocs(colRef);
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || '',
      encCertPem: data.encCertPem,
      encKeyPem: data.encKeyPem ?? null,
      subject: data.subject || '',
      issuer: data.issuer || '',
      serialNumber: data.serialNumber || '',
      validFrom: data.validFrom?.toDate ? data.validFrom.toDate() : (data.validFrom ? new Date(data.validFrom) : new Date()),
      validTo: data.validTo?.toDate ? data.validTo.toDate() : (data.validTo ? new Date(data.validTo) : new Date()),
      isSelfSigned: !!data.isSelfSigned,
      fingerprint: data.fingerprint || '',
      hosts: Array.isArray(data.hosts) ? data.hosts : [],
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
    } as StoredCertificate;
  });
}

// ─── Projects ───

export async function getProjects(uid: string, dbOverride?: Firestore): Promise<Project[]> {
  const db = dbOverride || getDb();
  const colRef = collection(db, "users", uid, "projects");
  const snap = await getDocs(colRef);
  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || '',
      description: data.description || '',
      color: data.color || 'blue',
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date()),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : new Date()),
    } as Project;
  });
}

export async function resolveProjectId(
  uid: string,
  projectNameOrId: string,
  dbOverride?: Firestore
): Promise<string> {
  if (!projectNameOrId) return projectNameOrId;
  try {
    const projects = await getProjects(uid, dbOverride);
    const match = projects.find(
      p => p.id === projectNameOrId || p.name.toLowerCase() === projectNameOrId.toLowerCase()
    );
    if (match) {
      return match.id;
    }
  } catch {
    // If fetching projects fails, return the original string
  }
  return projectNameOrId;
}
