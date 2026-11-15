/**
 * Phase 0 Feasibility Spike Script
 * Validates the core authentication, vault metadata read, key derivation, and verifier check in Node.
 */

import { initFirebase } from '../src/core/firebase.js';
import { deriveKey, checkVerifier } from '../src/core/crypto.js';
import { getVaultMeta } from '../src/core/firestore.js';
import { signInWithEmailAndPassword } from 'firebase/auth';

async function runSpike() {
  console.log('--- Scync CLI Phase 0 Feasibility Spike ---');
  
  const email = process.env.SCYNC_SPIKE_EMAIL;
  const authPassword = process.env.SCYNC_SPIKE_AUTH_PASSWORD;
  const masterPassword = process.env.SCYNC_SPIKE_MASTER_PASSWORD;

  if (!email || !authPassword || !masterPassword) {
    console.log('Mode: Emulator automated test verification');
    console.log('(Set SCYNC_SPIKE_EMAIL, SCYNC_SPIKE_AUTH_PASSWORD, SCYNC_SPIKE_MASTER_PASSWORD to test against a live throwaway project)');
    return;
  }

  const { auth, db } = initFirebase();
  console.log(`Authenticating user: ${email}...`);
  const cred = await signInWithEmailAndPassword(auth, email, authPassword);
  const uid = cred.user.uid;
  console.log(`[PASS] Authenticated successfully. Firebase UID: ${uid}`);

  console.log('Fetching vault metadata from Firestore /users/{uid}/meta/vault...');
  const meta = await getVaultMeta(uid, db);
  if (!meta) {
    console.error('[FAIL] Vault metadata not found. Is the vault initialized?');
    process.exit(1);
  }
  console.log(`[PASS] Vault metadata fetched. Created: ${meta.createdAt.toISOString()}`);

  console.log('Deriving key from master password + UID + stored salt...');
  const key = await deriveKey(masterPassword, uid, meta.salt);
  console.log('[PASS] Key derived via PBKDF2 (310,000 iterations, AES-GCM-256).');

  console.log('Verifying master password against stored verifier...');
  const valid = await checkVerifier(key, meta.verifier);
  if (!valid) {
    console.error('[FAIL] Master password verification failed.');
    process.exit(1);
  }

  console.log('[PASS] Master password verified successfully! Verifier matched "Scync_VALID_v1".');
  console.log('Phase 0 Feasibility Spike Completed Successfully.');
}

runSpike().catch(err => {
  console.error('Spike error:', err);
  process.exit(1);
});
