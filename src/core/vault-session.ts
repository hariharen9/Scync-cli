import { getVaultMeta } from './firestore.js';
import { deriveKey, checkVerifier, encrypt, decrypt } from './crypto.js';
import { promptPassword } from '../cli/prompts.js';
import { VaultLockedError, CliError } from '../cli/errors.js';
import { AgentClient } from '../agent/client.js';
import { loadConfig, parseDurationMs } from '../config/index.js';
import type { EncryptedField } from './types.js';
import type { Firestore } from 'firebase/firestore';

export interface VaultSession {
  uid: string;
  salt: string;
  isAgent: boolean;
  key?: CryptoKey;
  decrypt(ciphertext: EncryptedField): Promise<string>;
  encrypt(plaintext: string): Promise<EncryptedField>;
  batchDecrypt(ciphertexts: EncryptedField[]): Promise<string[]>;
}

export interface UnlockVaultOptions {
  noAgent?: boolean;
  passwordOverride?: string;
  idleTimeoutMs?: number;
}

export async function unlockVault(
  uid: string,
  db?: Firestore,
  passwordOverride?: string,
  options: UnlockVaultOptions = {}
): Promise<VaultSession> {
  const meta = await getVaultMeta(uid, db);
  if (!meta) {
    throw new CliError(
      'Vault is not initialized. Please set up your vault on the Scync web app first.',
      3
    );
  }

  const noAgent = options.noAgent || process.env.SCYNC_NO_AGENT === '1';
  const agentClient = new AgentClient(uid);

  // 1. Try checking unlocked agent if not explicitly disabled
  if (!noAgent) {
    const status = await agentClient.getStatus(400);
    if (status && status.status === 'unlocked') {
      return {
        uid,
        salt: meta.salt,
        isAgent: true,
        decrypt: (ct) => agentClient.decrypt(ct),
        encrypt: (pt) => agentClient.encrypt(pt),
        batchDecrypt: (cts) => agentClient.batchDecrypt(cts),
      };
    }
  }

  // 2. Need master password to unlock
  const password =
    options.passwordOverride ||
    passwordOverride ||
    (await promptPassword('Enter vault master password: '));

  if (!password) {
    throw new VaultLockedError('Master password cannot be empty.');
  }

  const key = await deriveKey(password, uid, meta.salt);
  const isValid = await checkVerifier(key, meta.verifier);

  if (!isValid) {
    throw new VaultLockedError('Incorrect master password.');
  }

  // 3. If agent is enabled, start agent in background and unlock it for subsequent commands
  if (!noAgent) {
    try {
      const config = loadConfig();
      const timeoutMs =
        options.idleTimeoutMs ||
        parseDurationMs(config['agent.timeout'] || '15m', 15 * 60 * 1000);

      const isRunning = await agentClient.ensureRunning(timeoutMs);
      if (isRunning) {
        await agentClient.unlock(uid, meta.salt, meta.verifier, password, timeoutMs);
      }
    } catch {
      // Background agent start failure is non-fatal; fallback to in-process session
    }
  }

  // 4. Return in-process session (with key)
  return {
    uid,
    salt: meta.salt,
    isAgent: false,
    key,
    decrypt: (ct) => decrypt(key, ct),
    encrypt: (pt) => encrypt(key, pt),
    batchDecrypt: (cts) => Promise.all(cts.map((ct) => decrypt(key, ct))),
  };
}
