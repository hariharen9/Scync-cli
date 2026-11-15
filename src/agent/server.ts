import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { deriveKey, checkVerifier, encrypt, decrypt } from '../core/crypto.js';
import {
  type AgentRequest,
  type AgentResponse,
  type AgentStatusData,
  getAgentEndpoint,
} from './protocol.js';

export interface AgentServerOptions {
  uid?: string;
  idleTimeoutMs?: number; // default: 15 minutes (900,000 ms)
  maxLifetimeMs?: number; // default: 8 hours (28,800,000 ms)
  endpoint?: string;
}

export class AgentServer {
  private server: net.Server | null = null;
  private endpoint: string;
  private uid: string | null = null;
  private cryptoKey: CryptoKey | null = null;
  private salt: string | null = null;
  private unlockedAt: number | null = null;
  private lastActivityAt: number | null = null;
  private idleTimeoutMs: number;
  private maxLifetimeMs: number;
  private idleTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(options: AgentServerOptions = {}) {
    this.uid = options.uid ?? null;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60 * 1000; // 15 mins
    this.maxLifetimeMs = options.maxLifetimeMs ?? 8 * 60 * 60 * 1000; // 8 hours
    this.endpoint = options.endpoint ?? getAgentEndpoint(this.uid ?? undefined);
  }

  public async start(): Promise<string> {
    // POSIX socket cleanup if stale
    if (process.platform !== 'win32' && fs.existsSync(this.endpoint)) {
      try {
        fs.unlinkSync(this.endpoint);
      } catch {
        // ignore
      }
    }

    // Ensure directory exists on POSIX with 0700 permissions
    if (process.platform !== 'win32') {
      const dir = path.dirname(this.endpoint);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        if (!this.isShuttingDown) {
          reject(err);
        }
      });

      this.server.listen(this.endpoint, () => {
        // Restrict socket file permissions on POSIX
        if (process.platform !== 'win32' && fs.existsSync(this.endpoint)) {
          try {
            fs.chmodSync(this.endpoint, 0o600);
          } catch {
            // ignore
          }
        }
        resolve(this.endpoint);
      });
    });
  }

  public stop(): Promise<void> {
    this.isShuttingDown = true;
    this.lockVault();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          if (process.platform !== 'win32' && fs.existsSync(this.endpoint)) {
            try {
              fs.unlinkSync(this.endpoint);
            } catch {
              // ignore
            }
          }
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep trailing incomplete chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const req: AgentRequest = JSON.parse(trimmed);
          const res = await this.handleRequest(req);
          if (socket.writable) {
            socket.write(JSON.stringify(res) + '\n');
          }
        } catch (err: any) {
          if (socket.writable) {
            const errRes: AgentResponse = {
              id: 'unknown',
              success: false,
              error: err?.message || 'Invalid request payload',
            };
            socket.write(JSON.stringify(errRes) + '\n');
          }
        }
      }
    });

    socket.on('error', () => {
      // client disconnected
    });
  }

  private async handleRequest(req: AgentRequest): Promise<AgentResponse> {
    switch (req.type) {
      case 'PING':
        return { id: req.id, success: true, data: { alive: true } };

      case 'STATUS': {
        const now = Date.now();
        const isUnlocked = this.cryptoKey !== null && this.lastActivityAt !== null;
        let ttlRemainingMs = 0;
        if (isUnlocked && this.lastActivityAt) {
          const elapsed = now - this.lastActivityAt;
          ttlRemainingMs = Math.max(0, this.idleTimeoutMs - elapsed);
        }

        const statusData: AgentStatusData = {
          status: isUnlocked ? 'unlocked' : 'locked',
          uid: this.uid ?? undefined,
          unlockedAt: this.unlockedAt ?? undefined,
          lastActivityAt: this.lastActivityAt ?? undefined,
          idleTimeoutMs: this.idleTimeoutMs,
          ttlRemainingMs,
          pid: process.pid,
        };
        return { id: req.id, success: true, data: statusData };
      }

      case 'UNLOCK': {
        if (!req.masterPassword) {
          return { id: req.id, success: false, error: 'Master password cannot be empty' };
        }

        try {
          const key = await deriveKey(req.masterPassword, req.uid, req.salt);
          const valid = await checkVerifier(key, req.verifier);
          if (!valid) {
            return { id: req.id, success: false, error: 'Incorrect master password' };
          }

          // Unlocked successfully
          this.cryptoKey = key;
          this.salt = req.salt;
          this.uid = req.uid;
          if (req.idleTimeoutMs && req.idleTimeoutMs > 0) {
            this.idleTimeoutMs = req.idleTimeoutMs;
          }

          this.unlockedAt = Date.now();
          this.touchActivity();
          this.startMaxLifetimeTimer();

          return { id: req.id, success: true };
        } catch (err: any) {
          return { id: req.id, success: false, error: err?.message || 'Key derivation failed' };
        }
      }

      case 'LOCK': {
        this.lockVault();
        // Give socket a moment to send response, then shut down process if running standalone
        setTimeout(() => {
          this.stop().catch(() => {});
        }, 50);
        return { id: req.id, success: true };
      }

      case 'ENCRYPT': {
        if (!this.cryptoKey) {
          return { id: req.id, success: false, error: 'Vault is locked' };
        }
        this.touchActivity();
        try {
          const ct = await encrypt(this.cryptoKey, req.plaintext);
          return { id: req.id, success: true, data: ct };
        } catch (err: any) {
          return { id: req.id, success: false, error: err?.message || 'Encryption failed' };
        }
      }

      case 'DECRYPT': {
        if (!this.cryptoKey) {
          return { id: req.id, success: false, error: 'Vault is locked' };
        }
        this.touchActivity();
        try {
          const pt = await decrypt(this.cryptoKey, req.ciphertext);
          return { id: req.id, success: true, data: pt };
        } catch (err: any) {
          return { id: req.id, success: false, error: err?.message || 'Decryption failed' };
        }
      }

      case 'BATCH_DECRYPT': {
        if (!this.cryptoKey) {
          return { id: req.id, success: false, error: 'Vault is locked' };
        }
        this.touchActivity();
        try {
          const plaintexts = await Promise.all(
            req.ciphertexts.map((ct) => decrypt(this.cryptoKey!, ct))
          );
          return { id: req.id, success: true, data: plaintexts };
        } catch (err: any) {
          return { id: req.id, success: false, error: err?.message || 'Batch decryption failed' };
        }
      }

      default:
        return { id: (req as any).id, success: false, error: 'Unknown request type' };
    }
  }

  private touchActivity(): void {
    this.lastActivityAt = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      this.lockVault();
      this.stop().catch(() => {});
    }, this.idleTimeoutMs);

    // Ensure timer doesn't keep node event loop open if everything else ends
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }

  private startMaxLifetimeTimer(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);

    this.maxTimer = setTimeout(() => {
      this.lockVault();
      this.stop().catch(() => {});
    }, this.maxLifetimeMs);

    if (this.maxTimer.unref) {
      this.maxTimer.unref();
    }
  }

  public lockVault(): void {
    // Zero out references to keys and sensitive materials
    this.cryptoKey = null;
    this.salt = null;
    this.unlockedAt = null;
    this.lastActivityAt = null;

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }

  public isUnlocked(): boolean {
    return this.cryptoKey !== null;
  }
}

export async function runAgentDaemon(options: AgentServerOptions = {}): Promise<void> {
  const server = new AgentServer(options);
  await server.start();

  const cleanup = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
