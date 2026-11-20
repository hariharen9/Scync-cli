import { describe, it, expect } from 'vitest';
import * as cliCrypto from '../crypto.js';

/**
 * Cross-client compatibility is pinned to ciphertext produced by the Scync web
 * core with the same password/uid/salt. If the KDF or envelope format changes,
 * regenerate these fixtures from the web implementation so both clients stay
 * interoperable. Keeping them inline makes this suite portable to standalone
 * clones and CI, which do not have the web repo checked out.
 */
const PASSWORD = 'master_vault_password_2026';
const UID = 'usr_abc123456789';
const SALT = 's+UeDkM0R5V31kP9H1qZ2A==';
const PAYLOAD = 'Confidential API Key sk_live_9988776655';

const REFERENCE_ENCRYPTED = {
  iv: 'RocoA+7KUSm9PngE',
  ciphertext: 'kfGL3vXmC3uQnRt33tdPkzZJK0V8TxizdrdtSEAqXKWUVMz/f/X+OUuDWDKni/bUwRDldNvaUg==',
};

const REFERENCE_VERIFIER = {
  iv: 'TbmUWEXaC+oqsII0',
  ciphertext: 'PmRPQYMEyVrpVgyiwf8FABRjyVXcHtu55Ly2wvxd',
};

describe('Cross-Client Cryptographic Compatibility', () => {
  it('derives the same key as the reference implementation', async () => {
    const key = await cliCrypto.deriveKey(PASSWORD, UID, SALT);
    await expect(cliCrypto.decrypt(key, REFERENCE_ENCRYPTED)).resolves.toBe(PAYLOAD);
  });

  it('accepts a verifier created by the reference implementation', async () => {
    const key = await cliCrypto.deriveKey(PASSWORD, UID, SALT);
    await expect(cliCrypto.checkVerifier(key, REFERENCE_VERIFIER)).resolves.toBe(true);
  });

  it('rejects the reference verifier with a different password', async () => {
    const wrongKey = await cliCrypto.deriveKey('wrong_password', UID, SALT);
    await expect(cliCrypto.checkVerifier(wrongKey, REFERENCE_VERIFIER)).resolves.toBe(false);
  });

  it('produces verifiers the same format expects', async () => {
    const key = await cliCrypto.deriveKey(PASSWORD, UID, SALT);
    const verifier = await cliCrypto.createVerifier(key);
    await expect(cliCrypto.checkVerifier(key, verifier)).resolves.toBe(true);
    await expect(cliCrypto.decrypt(key, verifier)).resolves.toBe('Scync_VALID_v1');
  });
});
