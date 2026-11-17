import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { getAuthInstance, getDb } from '../core/firebase.js';
import {
  createProject,
  createSecret,
  decryptSecret,
  deleteProject,
  deleteSecret,
  getCertificates,
  getPasswords,
  getProjects,
  getSSHKeys,
  getSecrets,
  getTOTPTokens,
  getVaultMeta,
  logLedgerEvent,
  restoreSecretVersion,
  updateProject,
  updateSecret,
} from '../core/firestore.js';
import { normalizeEnvironment, normalizeSecretStatus, normalizeSecretType } from '../core/constants.js';
import type {
  Environment,
  Project,
  SecretStatus,
  SecretType,
  StoredCertificate,
  StoredPassword,
  StoredSSHKey,
  StoredSecret,
  StoredTOTP,
  VaultMeta,
} from '../core/types.js';
import { unlockVault, type VaultSession } from '../core/vault-session.js';
import { createSessionFromUser, getValidSession } from '../auth/session.js';
import { clearSession, loadSession, type StoredSession } from '../auth/storage.js';
import { clearAuthState } from '../auth/persistence.js';
import { loginWithGoogleLoopback } from '../auth/loopback.js';
import { AgentClient } from '../agent/client.js';
import { loadConfig, parseDurationMs } from '../config/index.js';
import { formatEnvLine, parseEnvFile, dedupeEnvEntries } from '../utils/env.js';
import { sanitizeKeyFileName } from '../utils/sanitize.js';
import { inferServiceFromName } from '../cli/input.js';
import type { LockedSecretDraft } from './state.js';

export interface WorkspaceData {
  meta: VaultMeta | null;
  secrets: StoredSecret[];
  projects: Project[];
  passwords: StoredPassword[];
  totp: StoredTOTP[];
  ssh: StoredSSHKey[];
  certs: StoredCertificate[];
}

export interface WorkspaceLoad {
  data: WorkspaceData;
  errors: string[];
}

export interface AgentSnapshot {
  status: 'locked' | 'unlocked';
  ttlRemainingMs: number;
  pid?: number;
}

export const EMPTY_WORKSPACE: WorkspaceData = {
  meta: null,
  secrets: [],
  projects: [],
  passwords: [],
  totp: [],
  ssh: [],
  certs: [],
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T, errors: string[]): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    errors.push(`${label}: ${message(err)}`);
    return fallback;
  }
}

export async function loadWorkspace(uid: string): Promise<WorkspaceLoad> {
  const db = getDb();
  const errors: string[] = [];

  const [meta, secrets, projects, passwords, totp, ssh, certs] = await Promise.all([
    safe('vault metadata', () => getVaultMeta(uid, db), null, errors),
    safe('secrets', () => getSecrets(uid, db), [], errors),
    safe('projects', () => getProjects(uid, db), [], errors),
    safe('passwords', () => getPasswords(uid, db), [], errors),
    safe('TOTP tokens', () => getTOTPTokens(uid, db), [], errors),
    safe('SSH keys', () => getSSHKeys(uid, db), [], errors),
    safe('certificates', () => getCertificates(uid, db), [], errors),
  ]);

  return {
    data: {
      meta: meta as VaultMeta | null,
      secrets: secrets as StoredSecret[],
      projects: projects as Project[],
      passwords: passwords as StoredPassword[],
      totp: totp as StoredTOTP[],
      ssh: ssh as StoredSSHKey[],
      certs: certs as StoredCertificate[],
    },
    errors,
  };
}

export async function getCurrentSession(): Promise<StoredSession | null> {
  return getValidSession();
}

export interface AuthResult {
  uid: string;
  email: string | null;
  displayName: string | null;
  providerId: 'google.com' | 'password';
}

export async function loginWithEmail(email: string, password: string): Promise<AuthResult> {
  const auth = getAuthInstance();
  const cleanEmail = email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const session = await createSessionFromUser(cred.user, 'password');
  return {
    uid: session.uid,
    email: session.email,
    displayName: session.displayName,
    providerId: 'password',
  };
}

export interface GoogleLoginOptions {
  clientId: string;
  clientSecret?: string;
  port?: number;
}

export async function loginWithGoogle(options: GoogleLoginOptions): Promise<AuthResult> {
  const auth = getAuthInstance();
  const tokens = await loginWithGoogleLoopback({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    openBrowser: true,
    port: options.port,
  });
  const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
  const cred = await signInWithCredential(auth, credential);
  const session = await createSessionFromUser(cred.user, 'google.com');
  return {
    uid: session.uid,
    email: session.email,
    displayName: session.displayName,
    providerId: 'google.com',
  };
}

export async function logoutSession(uid: string | undefined): Promise<void> {
  if (uid) {
    try {
      await new AgentClient(uid).lock();
    } catch {
      // agent may not be running
    }
  }
  try {
    await signOut(getAuthInstance());
  } catch {
    // ignore
  }
  clearSession();
  clearAuthState();
}

export function hasStoredSession(): boolean {
  return loadSession() !== null;
}

export async function getAgentSnapshot(uid: string): Promise<AgentSnapshot | null> {
  const status = await new AgentClient(uid).getStatus(500);
  if (!status) return null;
  return {
    status: status.status,
    ttlRemainingMs: status.ttlRemainingMs ?? 0,
    pid: status.pid,
  };
}

export function createAgentBackedSession(uid: string, salt: string): VaultSession {
  const client = new AgentClient(uid);
  return {
    uid,
    salt,
    isAgent: true,
    decrypt: (field) => client.decrypt(field),
    encrypt: (plaintext) => client.encrypt(plaintext),
    batchDecrypt: (fields) => client.batchDecrypt(fields),
  };
}

export async function unlockWithPassword(
  uid: string,
  password: string,
  options: { noAgent?: boolean } = {}
): Promise<VaultSession> {
  const config = loadConfig();
  const idleTimeoutMs = parseDurationMs(config['agent.timeout'] || '15m', 15 * 60 * 1000);
  return unlockVault(uid, getDb(), password, {
    noAgent: options.noAgent || process.env.SCYNC_NO_AGENT === '1',
    idleTimeoutMs,
  });
}

export async function lockAgent(uid: string | undefined): Promise<void> {
  if (!uid) return;
  try {
    await new AgentClient(uid).lock();
  } catch {
    // already locked
  }
}

export async function decryptStoredSecret(vault: VaultSession, secret: StoredSecret) {
  return decryptSecret(vault, secret);
}

export async function decryptStoredField(vault: VaultSession, field: { iv: string; ciphertext: string }) {
  return vault.decrypt(field);
}

interface SecretFormData {
  name: string;
  service: string;
  type: SecretType;
  environment: Environment;
  status: SecretStatus;
  value: string;
  notes: string;
  lastRotated: Date | null;
  expiresOn: Date | null;
  projectId: string | null;
  remainingCodes: number | null;
}

export function buildSecretFormData(draft: LockedSecretDraft): SecretFormData {
  let value = draft.value;
  let remainingCodes: number | null = null;

  if (draft.type === 'Recovery Codes') {
    try {
      const parsed = JSON.parse(value) as { codes?: Array<{ used?: boolean }> };
      if (Array.isArray(parsed.codes)) {
        remainingCodes = parsed.codes.filter((code) => !code.used).length;
      }
    } catch {
      const codes = value
        .split(/[\r\n,;\s]+/)
        .map((code) => code.trim())
        .filter(Boolean);
      value = JSON.stringify({ codes: codes.map((code) => ({ code, used: false, usedAt: null })) });
      remainingCodes = codes.length;
    }
  }

  return {
    name: draft.name.trim(),
    service: draft.service.trim() || 'Other',
    type: draft.type,
    environment: draft.environment,
    status: draft.status,
    value,
    notes: draft.notes,
    lastRotated: draft.lastRotated,
    expiresOn: draft.expiresOn,
    projectId: draft.projectId || null,
    remainingCodes,
  };
}

export interface SaveSecretResult {
  id: string;
  version: number;
}

export async function saveSecret(
  uid: string,
  vault: VaultSession,
  draft: LockedSecretDraft,
  existing?: StoredSecret
): Promise<SaveSecretResult> {
  const db = getDb();
  const formData = buildSecretFormData(draft);

  if (existing) {
    const expectedVersion = existing.version ?? 1;
    await updateSecret(uid, vault, existing.id, formData, existing, 'updated', db, {
      expectedVersion,
    });
    return { id: existing.id, version: expectedVersion + 1 };
  }

  const created = await createSecret(uid, vault, formData, db);
  return { id: created.id, version: 1 };
}

export async function rotateSecret(
  uid: string,
  vault: VaultSession,
  existing: StoredSecret,
  value: string
): Promise<number> {
  const decrypted = await decryptSecret(vault, existing);
  const expectedVersion = existing.version ?? 1;

  await updateSecret(
    uid,
    vault,
    existing.id,
    {
      name: existing.name,
      service: existing.service,
      type: existing.type,
      environment: existing.environment,
      status: 'Active',
      value,
      notes: decrypted.notes,
      lastRotated: new Date(),
      expiresOn: existing.expiresOn,
      projectId: existing.projectId,
      remainingCodes: existing.remainingCodes,
    },
    existing,
    'rotated',
    getDb(),
    { expectedVersion }
  );

  return expectedVersion + 1;
}

export async function restoreSecret(
  uid: string,
  vault: VaultSession,
  existing: StoredSecret,
  version: number
): Promise<void> {
  await restoreSecretVersion(uid, vault, existing.id, version, existing, getDb());
}

export async function removeSecret(uid: string, secret: StoredSecret): Promise<void> {
  await deleteSecret(uid, secret.id, secret.name, secret.service, getDb());
}

export async function addProject(
  uid: string,
  data: { name: string; description?: string; color?: string; icon?: string }
): Promise<string> {
  return createProject(
    uid,
    {
      name: data.name.trim(),
      description: data.description?.trim() ?? '',
      color: (data.color ?? 'green') as Project['color'],
      icon: data.icon ?? '',
    },
    getDb()
  );
}

export async function editProject(
  uid: string,
  projectId: string,
  data: { name?: string; description?: string; color?: string }
): Promise<void> {
  await updateProject(
    uid,
    projectId,
    {
      name: data.name?.trim(),
      description: data.description?.trim(),
      color: data.color as Project['color'] | undefined,
    },
    getDb()
  );
}

export async function removeProject(
  uid: string,
  projectId: string,
  moveSecretsTo: string | null
): Promise<number> {
  return deleteProject(uid, projectId, moveSecretsTo, getDb());
}

export function normalizeDraftEnums(input: {
  environment?: string;
  type?: string;
  status?: string;
}): {
  environment: Environment;
  type: SecretType;
  status: SecretStatus;
} {
  return {
    environment: normalizeEnvironment(input.environment || 'Development'),
    type: normalizeSecretType(input.type || 'API Key'),
    status: normalizeSecretStatus(input.status || 'Active'),
  };
}

export interface ExportResult {
  path: string;
  count: number;
  warnings: string[];
}

function checkGitIgnored(filePath: string): boolean | null {
  try {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    const repo = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
    if (repo.status !== 0 || !repo.stdout.trim().includes('true')) return null;
    const ignored = spawnSync('git', ['-C', dir, 'check-ignore', absPath], { encoding: 'utf8' });
    return ignored.status === 0;
  } catch {
    return null;
  }
}

export async function exportSecretsToEnv(
  uid: string,
  vault: VaultSession,
  secrets: StoredSecret[],
  outputPath: string,
  label: { project?: string | null; env?: string | null },
  overwrite: boolean
): Promise<ExportResult> {
  const target = path.resolve(outputPath);
  if (fs.existsSync(target) && !overwrite) {
    throw new Error(`'${outputPath}' already exists. Enable overwrite to replace it.`);
  }

  const active = secrets.filter((secret) => secret.status === 'Active');
  const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name));

  const warnings: string[] = [];
  const normalizedKeys = new Map<string, string[]>();
  for (const secret of sorted) {
    const norm = secret.name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const group = normalizedKeys.get(norm);
    if (group) group.push(secret.name);
    else normalizedKeys.set(norm, [secret.name]);
  }
  for (const [norm, names] of normalizedKeys) {
    if (names.length > 1) warnings.push(`${names.join(', ')} all map to ${norm}`);
  }

  const lines = [
    `# Exported from Scync (${new Date().toISOString()})`,
    label.project ? `# Project: ${label.project}` : '',
    label.env ? `# Environment: ${label.env}` : '',
    '',
  ].filter(Boolean);

  for (const secret of sorted) {
    const decrypted = await decryptSecret(vault, secret);
    lines.push(formatEnvLine(secret.name, decrypted.value));
  }

  fs.writeFileSync(target, lines.join('\n') + '\n', { mode: 0o600, encoding: 'utf8' });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // best-effort; mode was requested above
    }
  }

  if (checkGitIgnored(target) === false) {
    warnings.push(`'${outputPath}' is inside a Git repo and is not ignored`);
  }

  await logLedgerEvent(
    uid,
    {
      action: 'env_exported',
      title: `Exported ${sorted.length} secret(s) to ${path.basename(target)}`,
      details: `${label.env || 'all environments'}${label.project ? ` · ${label.project}` : ''}`,
    },
    getDb()
  );

  return { path: target, count: sorted.length, warnings };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ key: string; error: string }>;
  duplicates: number;
}

export async function importEnvFile(input: {
  uid: string;
  vault: VaultSession;
  content: string;
  environment: Environment;
  projectId: string | null;
  overwrite: boolean;
  force?: boolean;
  type?: SecretType;
}): Promise<ImportResult> {
  const parsed = parseEnvFile(input.content);
  const { entries, duplicates } = dedupeEnvEntries(parsed);
  const db = getDb();
  const existing = await getSecrets(input.uid, db);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failed: Array<{ key: string; error: string }> = [];

  for (const entry of entries) {
    const match = existing.find(
      (secret) =>
        secret.name.toLowerCase() === entry.key.toLowerCase() &&
        secret.environment.toLowerCase() === input.environment.toLowerCase() &&
        (secret.projectId || null) === (input.projectId || null)
    );

    try {
      if (!match) {
        const newSecret = await createSecret(
          input.uid,
          input.vault,
          {
            name: entry.key,
            service: inferServiceFromName(entry.key),
            type: input.type || 'Secret Key',
            environment: input.environment,
            status: 'Active',
            value: entry.value,
            notes: 'Imported via Scync TUI',
            lastRotated: new Date(),
            expiresOn: null,
            projectId: input.projectId,
            remainingCodes: null,
          },
          db
        );
        existing.push({ ...newSecret, versions: newSecret.versions ?? [] });
        created++;
      } else if (input.overwrite) {
        let notes = '';
        try {
          notes = (await decryptSecret(input.vault, match)).notes;
        } catch {
          notes = '';
        }
        await updateSecret(
          input.uid,
          input.vault,
          match.id,
          {
            name: match.name,
            service: match.service,
            type: match.type,
            environment: match.environment,
            status: match.status,
            value: entry.value,
            notes,
            lastRotated: match.lastRotated,
            expiresOn: match.expiresOn,
            projectId: match.projectId,
            remainingCodes: match.remainingCodes,
          },
          match,
          'updated',
          db,
          { force: input.force }
        );
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed.push({ key: entry.key, error: message(err) });
    }
  }

  await logLedgerEvent(
    input.uid,
    {
      action: 'env_imported',
      title: `Imported ${entries.length} variables to ${input.environment}`,
      details: `${created} created, ${updated} updated, ${skipped} skipped`,
    },
    db
  );

  return { created, updated, skipped, failed, duplicates };
}

function resolveBinary(command: string): { executable: string; useShell: boolean } {
  // A full command line typed in the TUI is intentionally interpreted by the
  // user's shell (pipes, &&, environment expansion).
  return { executable: command, useShell: true };
}

const PROTECTED_ENV_VARS = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'SHELL',
  'TERM',
]);

export async function runCommandWithSecrets(
  vault: VaultSession,
  secrets: StoredSecret[],
  command: string,
  cwd = process.cwd()
): Promise<{ code: number | null; warnings: string[] }> {
  const injected: Record<string, string> = {};
  const warnings: string[] = [];

  for (const secret of secrets) {
    if (secret.status !== 'Active') continue;
    try {
      const value = await vault.decrypt(secret.encValue);
      if (PROTECTED_ENV_VARS.has(secret.name.toUpperCase())) {
        warnings.push(`Skipped '${secret.name}' (protected system variable)`);
      } else {
        injected[secret.name] = value;
      }
    } catch (err) {
      warnings.push(`Failed to decrypt '${secret.name}': ${message(err)}`);
    }
  }

  const childEnv = { ...process.env, ...injected };
  delete childEnv.SCYNC_MASTER_PASSWORD;

  const { executable, useShell } = resolveBinary(command);

  return new Promise((resolve) => {
    const child = spawn(executable, [], {
      shell: useShell,
      stdio: 'inherit',
      env: childEnv,
      cwd,
    });
    child.on('error', (err) => {
      warnings.push(message(err));
      resolve({ code: 1, warnings });
    });
    child.on('close', (code) => resolve({ code, warnings }));
  });
}

export interface SshExportResult {
  privatePath: string;
  publicPath: string;
}

export function exportSshKey(
  key: StoredSSHKey,
  privateKey: string,
  targetDir: string,
  overwrite: boolean
): SshExportResult {
  const dir = path.resolve(targetDir || path.join(os.homedir(), '.ssh'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const safe = sanitizeKeyFileName(key.name);
  const isEd25519 = key.type === 'ssh-ed25519';
  const base = safe
    ? `${isEd25519 ? 'id_ed25519' : 'id_rsa'}_${safe}`
    : isEd25519
      ? 'id_ed25519'
      : 'id_rsa';

  const privatePath = path.join(dir, base);
  const publicPath = path.join(dir, `${base}.pub`);

  if (!overwrite && (fs.existsSync(privatePath) || fs.existsSync(publicPath))) {
    throw new Error(`Key file(s) already exist at '${privatePath}'. Enable overwrite to replace them.`);
  }

  fs.writeFileSync(privatePath, privateKey.replace(/\r?\n$/, '') + '\n', { mode: 0o600, encoding: 'utf8' });
  fs.writeFileSync(publicPath, key.publicKey.replace(/\r?\n$/, '') + '\n', { mode: 0o644, encoding: 'utf8' });

  return { privatePath, publicPath };
}

export function buildSshConfig(keys: StoredSSHKey[]): string {
  const lines = ['# --- Generated by Scync (add to ~/.ssh/config) ---'];
  let count = 0;
  for (const key of keys) {
    if (!key.hosts || key.hosts.length === 0) continue;
    count++;
    const safe = sanitizeKeyFileName(key.name);
    const file = key.type === 'ssh-ed25519' ? `id_ed25519_${safe}` : `id_rsa_${safe}`;
    lines.push(`Host ${key.hosts.join(' ')}`);
    lines.push(`  IdentityFile ~/.ssh/${file}`);
    lines.push('  IdentitiesOnly yes');
    lines.push('');
  }
  if (count === 0) lines.push('# No keys with mapped hosts found in vault.');
  return lines.join('\n');
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}
