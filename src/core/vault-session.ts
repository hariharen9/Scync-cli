import { getVaultMeta } from './firestore.js';
import { deriveKey, checkVerifier } from './crypto.js';
import { promptPassword } from '../cli/prompts.js';
import { VaultLockedError, CliError } from '../cli/errors.js';
import type { Firestore } from 'firebase/firestore';

export async function unlockVault(
  uid: string, 
  db?: Firestore,
  passwordOverride?: string
): Promise<{ key: CryptoKey; salt: string }> {
  const meta = await getVaultMeta(uid, db);
  if (!meta) {
    throw new CliError(
      "Vault is not initialized. Please set up your vault on the Scync web app first.",
      3
    );
  }

  const password = passwordOverride || await promptPassword('Enter vault master password: ');
  if (!password) {
    throw new VaultLockedError('Master password cannot be empty.');
  }

  const key = await deriveKey(password, uid, meta.salt);
  const isValid = await checkVerifier(key, meta.verifier);

  if (!isValid) {
    throw new VaultLockedError('Incorrect master password.');
  }

  return { key, salt: meta.salt };
}
