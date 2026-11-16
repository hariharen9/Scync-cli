import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface StoredSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  providerId: 'google.com' | 'password';
  savedAt: string;
}

export interface UserConfig {
  defaultProject?: string;
  defaultEnv?: string;
  autoClearSecs?: number;
  inactivityTimeoutMins?: number;
}

export function getScyncDir(): string {
  const custom = process.env.SCYNC_DIR;
  if (custom) return custom;
  return path.join(os.homedir(), '.scync');
}

export function getSessionFilePath(): string {
  return path.join(getScyncDir(), 'session.json');
}

export function getConfigFilePath(): string {
  return path.join(getScyncDir(), 'config.json');
}

export function ensureScyncDir(): string {
  const dir = getScyncDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function loadSession(): StoredSession | null {
  try {
    const file = getSessionFilePath();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  ensureScyncDir();
  const file = getSessionFilePath();
  fs.writeFileSync(file, JSON.stringify(session, null, 2), {
    mode: 0o600
  });
}

export function clearSession(): void {
  try {
    const file = getSessionFilePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (err) {
    console.warn('Failed to remove session file:', err);
  }
}

export { loadConfig, saveConfig } from '../config/index.js';
