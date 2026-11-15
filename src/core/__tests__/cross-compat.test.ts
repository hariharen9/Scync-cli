import { describe, it, expect } from 'vitest';
import * as cliCrypto from '../crypto.js';
// Read-only import from sibling reference repo for cross-client compatibility testing
import * as refCrypto from '../../../../Scync/packages/core/src/crypto.js';

describe('Cross-Client Cryptographic Compatibility', () => {
  const password = "master_vault_password_2026";
  const uid = "usr_abc123456789";
  const salt = "s+UeDkM0R5V31kP9H1qZ2A==";

  it('derives identical CryptoKey from fixed inputs as reference implementation', async () => {
    const cliKey = await cliCrypto.deriveKey(password, uid, salt);
    const refKey = await refCrypto.deriveKey(password, uid, salt);

    const testPayload = "Confidential API Key sk_live_9988776655";
    
    // Encrypt with CLI, decrypt with Reference
    const encByCli = await cliCrypto.encrypt(cliKey, testPayload);
    const decByRef = await refCrypto.decrypt(refKey, encByCli);
    expect(decByRef).toBe(testPayload);

    // Encrypt with Reference, decrypt with CLI
    const encByRef = await refCrypto.encrypt(refKey, testPayload);
    const decByCli = await cliCrypto.decrypt(cliKey, encByRef);
    expect(decByCli).toBe(testPayload);
  });

  it('validates verifier across implementations', async () => {
    const cliKey = await cliCrypto.deriveKey(password, uid, salt);
    const refKey = await refCrypto.deriveKey(password, uid, salt);

    // Verifier created by Ref validated by CLI
    const refVerifier = await refCrypto.createVerifier(refKey);
    const validInCli = await cliCrypto.checkVerifier(cliKey, refVerifier);
    expect(validInCli).toBe(true);

    // Verifier created by CLI validated by Ref
    const cliVerifier = await cliCrypto.createVerifier(cliKey);
    const validInRef = await refCrypto.checkVerifier(refKey, cliVerifier);
    expect(validInRef).toBe(true);
  });

  it('rejects wrong password verifier across implementations', async () => {
    const cliKey = await cliCrypto.deriveKey(password, uid, salt);
    const wrongRefKey = await refCrypto.deriveKey("wrong_password", uid, salt);

    const cliVerifier = await cliCrypto.createVerifier(cliKey);
    const validInRef = await refCrypto.checkVerifier(wrongRefKey, cliVerifier);
    expect(validInRef).toBe(false);
  });
});
