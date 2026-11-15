import path from 'node:path';
import os from 'node:os';
import type { EncryptedField } from '../core/types.js';

export interface PingRequest {
  id: string;
  type: 'PING';
}

export interface StatusRequest {
  id: string;
  type: 'STATUS';
}

export interface UnlockRequest {
  id: string;
  type: 'UNLOCK';
  uid: string;
  salt: string;
  verifier: EncryptedField;
  masterPassword: string;
  idleTimeoutMs?: number;
}

export interface LockRequest {
  id: string;
  type: 'LOCK';
}

export interface EncryptRequest {
  id: string;
  type: 'ENCRYPT';
  plaintext: string;
}

export interface DecryptRequest {
  id: string;
  type: 'DECRYPT';
  ciphertext: EncryptedField;
}

export interface BatchDecryptRequest {
  id: string;
  type: 'BATCH_DECRYPT';
  ciphertexts: EncryptedField[];
}

export type AgentRequest =
  | PingRequest
  | StatusRequest
  | UnlockRequest
  | LockRequest
  | EncryptRequest
  | DecryptRequest
  | BatchDecryptRequest;

export interface AgentSuccessResponse<T = any> {
  id: string;
  success: true;
  data?: T;
}

export interface AgentErrorResponse {
  id: string;
  success: false;
  error: string;
  code?: string;
}

export type AgentResponse<T = any> = AgentSuccessResponse<T> | AgentErrorResponse;

export interface AgentStatusData {
  status: 'locked' | 'unlocked';
  uid?: string;
  unlockedAt?: number;
  lastActivityAt?: number;
  idleTimeoutMs?: number;
  ttlRemainingMs?: number;
  pid?: number;
}

/**
 * Returns OS-appropriate IPC endpoint:
 * - Windows: \\.\pipe\scync-agent-<uid or user>
 * - POSIX: ~/.scync/agent-<uid>.sock
 */
export function getAgentEndpoint(uid?: string): string {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER || 'default';
    const id = uid ? `-${uid.slice(0, 10)}` : `-${user}`;
    return `\\\\.\\pipe\\scync-agent${id}`;
  } else {
    const homedir = os.homedir();
    const scyncDir = path.join(homedir, '.scync');
    const id = uid ? `-${uid.slice(0, 10)}` : '';
    return path.join(scyncDir, `agent${id}.sock`);
  }
}
