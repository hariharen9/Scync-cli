import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { AgentServer } from '../server.js';
import { AgentClient } from '../client.js';
import { deriveKey, encrypt } from '../../core/crypto.js';

describe('Background Agent & Key Custody IPC Protocol', () => {
  const testUid = 'agent-test-user-12345';
  const testPassword = 'AgentMasterPassword99!';
  const testSalt = 'somesaltforagenttest123';
  let server: AgentServer;
  let client: AgentClient;
  let endpoint: string;
  let testVerifier: any;

  beforeAll(async () => {
    // Generate valid verifier for testing
    const key = await deriveKey(testPassword, testUid, testSalt);
    testVerifier = await encrypt(key, 'Scync_VALID_v1');

    // Create unique test endpoint
    const rand = Math.random().toString(36).slice(2, 8);
    endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\scync-agent-test-${rand}`
        : path.join(os.tmpdir(), `scync-agent-test-${rand}.sock`);

    server = new AgentServer({
      uid: testUid,
      endpoint,
      idleTimeoutMs: 60000,
    });
    await server.start();
    client = new AgentClient(testUid, endpoint);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('pings the running agent successfully', async () => {
    const alive = await client.ping();
    expect(alive).toBe(true);
  });

  it('reports locked status before unlock', async () => {
    const status = await client.getStatus();
    expect(status).not.toBeNull();
    expect(status?.status).toBe('locked');
  });

  it('rejects unlock with incorrect master password', async () => {
    await expect(
      client.unlock(testUid, testSalt, testVerifier, 'WrongPassword!')
    ).rejects.toThrow();
  });

  it('unlocks successfully with correct master password', async () => {
    await client.unlock(testUid, testSalt, testVerifier, testPassword);
    const status = await client.getStatus();
    expect(status).not.toBeNull();
    expect(status?.status).toBe('unlocked');
    expect(status?.uid).toBe(testUid);
    expect(status?.ttlRemainingMs).toBeGreaterThan(0);
  });

  it('performs encryption and decryption over IPC without exposing master key', async () => {
    const secretText = 'super-secret-token-xyz-987';
    const encrypted = await client.encrypt(secretText);

    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted.ciphertext).not.toBe(secretText);

    const decrypted = await client.decrypt(encrypted);
    expect(decrypted).toBe(secretText);
  });

  it('performs batch decryption over a single IPC roundtrip', async () => {
    const items = ['secret-one-111', 'secret-two-222', 'secret-three-333'];
    const encryptedList = await Promise.all(items.map((i) => client.encrypt(i)));

    const decryptedList = await client.batchDecrypt(encryptedList);
    expect(decryptedList).toEqual(items);
  });

  it('locks vault and terminates key custody on lock command', async () => {
    await client.lock();
    const status = await client.getStatus();
    expect(status?.status).toBe('locked');

    // Subsequent crypto requests must fail
    await expect(client.encrypt('should-fail')).rejects.toThrow();
  });
});
