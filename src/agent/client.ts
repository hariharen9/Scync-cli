import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AgentRequest,
  type AgentResponse,
  type AgentStatusData,
  getAgentEndpoint,
} from './protocol.js';
import type { EncryptedField } from '../core/types.js';
import { CliError, ExitCode } from '../cli/errors.js';

export class AgentClient {
  private endpoint: string;
  private uid?: string;

  constructor(uid?: string, endpoint?: string) {
    this.uid = uid;
    this.endpoint = endpoint ?? getAgentEndpoint(uid);
  }

  public async ping(timeoutMs = 500): Promise<boolean> {
    try {
      const res = await this.sendRequest({ id: 'ping', type: 'PING' }, timeoutMs);
      return res.success === true;
    } catch {
      return false;
    }
  }

  public async getStatus(timeoutMs = 1000): Promise<AgentStatusData | null> {
    try {
      const res = await this.sendRequest({ id: 'status', type: 'STATUS' }, timeoutMs);
      if (res.success && res.data) {
        return res.data as AgentStatusData;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async unlock(
    uid: string,
    salt: string,
    verifier: EncryptedField,
    masterPassword: string,
    idleTimeoutMs?: number
  ): Promise<void> {
    const res = await this.sendRequest({
      id: 'unlock',
      type: 'UNLOCK',
      uid,
      salt,
      verifier,
      masterPassword,
      idleTimeoutMs,
    }, 10000); // Allow sufficient time for PBKDF2 310k iterations

    if (!res.success) {
      throw new CliError(res.error || 'Failed to unlock vault via agent', ExitCode.VAULT_LOCKED);
    }
  }

  public async lock(): Promise<void> {
    try {
      await this.sendRequest({ id: 'lock', type: 'LOCK' }, 2000);
    } catch {
      // If agent is not running, lock is already satisfied
    }
  }

  public async encrypt(plaintext: string): Promise<EncryptedField> {
    const res = await this.sendRequest({
      id: `enc-${Date.now()}`,
      type: 'ENCRYPT',
      plaintext,
    });

    if (!res.success) {
      throw new CliError(res.error || 'Agent encryption failed', ExitCode.VAULT_LOCKED);
    }
    return res.data;
  }

  public async decrypt(ciphertext: EncryptedField): Promise<string> {
    const res = await this.sendRequest({
      id: `dec-${Date.now()}`,
      type: 'DECRYPT',
      ciphertext,
    });

    if (!res.success) {
      throw new CliError(res.error || 'Agent decryption failed', ExitCode.VAULT_LOCKED);
    }
    return res.data;
  }

  public async batchDecrypt(ciphertexts: EncryptedField[]): Promise<string[]> {
    if (ciphertexts.length === 0) return [];

    const res = await this.sendRequest({
      id: `bdec-${Date.now()}`,
      type: 'BATCH_DECRYPT',
      ciphertexts,
    });

    if (!res.success) {
      throw new CliError(res.error || 'Agent batch decryption failed', ExitCode.VAULT_LOCKED);
    }
    return res.data;
  }

  public async ensureRunning(idleTimeoutMs?: number): Promise<boolean> {
    const isAlive = await this.ping(400);
    if (isAlive) return true;

    // Resolve CLI binary or entrypoint script
    let entryScript = process.argv[1];
    if (!entryScript || entryScript.endsWith('vitest') || entryScript.endsWith('.bin')) {
      // Fallback for tests or runner: locate dist/cli/index.js or src/cli/index.ts
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      entryScript = path.resolve(__dirname, '../cli/index.js');
    }

    const args = [entryScript, '_agent-daemon'];
    if (this.uid) {
      args.push('--uid', this.uid);
    }
    if (idleTimeoutMs) {
      args.push('--timeout', String(idleTimeoutMs));
    }

    try {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();

      // Poll until listening or max 2s
      const startTime = Date.now();
      while (Date.now() - startTime < 2000) {
        await new Promise((r) => setTimeout(r, 100));
        if (await this.ping(200)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private sendRequest(req: AgentRequest, timeoutMs = 5000): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const socket = net.connect(this.endpoint);

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          socket.destroy();
          reject(new Error(`Agent request '${req.type}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      let buffer = '';

      socket.on('connect', () => {
        socket.write(JSON.stringify(req) + '\n');
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          clearTimeout(timer);
          if (!isSettled) {
            isSettled = true;
            socket.end();
            try {
              const parsed: AgentResponse = JSON.parse(line);
              resolve(parsed);
            } catch (err) {
              reject(err);
            }
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });
    });
  }
}
