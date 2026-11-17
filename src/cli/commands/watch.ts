import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { subscribeToSecrets, resolveProjectId } from '../../core/firestore.js';
import { unlockVault, type VaultSession } from '../../core/vault-session.js';
import type { StoredSecret, EncryptedField } from '../../core/types.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import { AuthRequiredError } from '../errors.js';
import { getDefaultScope } from '../../config/index.js';
import { renderCard, envBadge } from '../tui.js';
import pc from 'picocolors';

export interface WatchOptions {
  project?: string;
  env?: string;
  service?: string;
  reveal?: boolean;
  noAgent?: boolean;
}

function isEncValueEqual(a: EncryptedField, b: EncryptedField): boolean {
  if (!a || !b) return a === b;
  return a.ciphertext === b.ciphertext && a.iv === b.iv;
}

export async function watchCommand(options: WatchOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) {
    throw new AuthRequiredError();
  }

  const db = getDb();
  let vault: VaultSession | null = null;
  if (options.reveal) {
    vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
  }

  const defaults = getDefaultScope();
  const projectFilter = options.project ?? defaults.project;
  const envFilter = options.env ?? defaults.env;
  const serviceFilter = options.service?.toLowerCase();
  const resolvedProject = projectFilter
    ? (await resolveProjectId(session.uid, projectFilter, db)).toLowerCase()
    : undefined;

  const cache = new Map<string, StoredSecret>();
  let isInitial = true;

  const filterDesc = [
    projectFilter ? `Project: ${projectFilter}` : null,
    envFilter ? `Env: ${envFilter}` : null,
    options.service ? `Service: ${options.service}` : null,
  ].filter(Boolean).join(' · ') || 'All Secrets';

  renderCard({
    title: 'Scync Vault Watcher',
    badge: pc.green('● Live Stream'),
    rows: [
      { key: 'Target', val: pc.bold(session.email || session.uid) },
      { key: 'Scope Filter', val: pc.cyan(filterDesc) },
      { key: 'Stream Security', val: 'End-to-End Encrypted (Zero-Knowledge)' }
    ],
    footer: pc.dim('Press Ctrl+C anytime to terminate watch stream')
  });

  return new Promise((resolve) => {
    const unsubscribe = subscribeToSecrets(
      session.uid,
      async (allSecrets: StoredSecret[]) => {
        let secrets = allSecrets;
        if (resolvedProject) {
          secrets = secrets.filter((s) => s.projectId?.toLowerCase() === resolvedProject);
        }
        if (envFilter) {
          secrets = secrets.filter((s) => s.environment.toLowerCase() === envFilter.toLowerCase());
        }
        if (serviceFilter) {
          secrets = secrets.filter((s) => s.service.toLowerCase() === serviceFilter);
        }

        const now = new Date().toLocaleTimeString();

        if (isInitial) {
          isInitial = false;
          for (const s of secrets) {
            cache.set(s.id, s);
          }
          console.log(pc.dim(`  [${now}] Initialized baseline: ${secrets.length} secret(s) actively tracked.`));
          return;
        }

        const currentMap = new Map<string, StoredSecret>(secrets.map((s) => [s.id, s]));

        // Check for added or modified
        for (const [id, current] of currentMap.entries()) {
          const old = cache.get(id);
          if (!old) {
            // Added
            console.log(
              `  ${pc.dim(`[${now}]`)} ${pc.green('● ADDED')}    ${pc.bold(sanitizeTerminalOutput(current.name))} (v${current.version} · ${sanitizeTerminalOutput(current.service)} · ${envBadge(sanitizeTerminalOutput(current.environment))})`
            );
            if (options.reveal && vault) {
              try {
                const val = await vault.decrypt(current.encValue);
                console.log(pc.dim(`               Value: `) + pc.yellow(val));
              } catch {
                console.log(pc.dim(`               Value: [Decryption failed]`));
              }
            }
          } else if (
            old.version !== current.version ||
            !isEncValueEqual(old.encValue, current.encValue) ||
            old.status !== current.status ||
            old.environment !== current.environment ||
            old.name !== current.name
          ) {
            // Modified
            console.log(
              `  ${pc.dim(`[${now}]`)} ${pc.yellow('● MODIFIED')} ${pc.bold(sanitizeTerminalOutput(current.name))} (${pc.dim(`v${old.version}`)} → ${pc.bold(`v${current.version}`)} · ${sanitizeTerminalOutput(current.service)} · ${envBadge(sanitizeTerminalOutput(current.environment))})`
            );
            if (options.reveal && vault) {
              try {
                const val = await vault.decrypt(current.encValue);
                console.log(pc.dim(`               New Value: `) + pc.yellow(val));
              } catch {
                console.log(pc.dim(`               New Value: [Decryption failed]`));
              }
            }
          }
        }

        // Check for removed
        for (const [id, old] of cache.entries()) {
          if (!currentMap.has(id)) {
            console.log(
              `  ${pc.dim(`[${now}]`)} ${pc.red('● DELETED')}  ${pc.bold(sanitizeTerminalOutput(old.name))} (${sanitizeTerminalOutput(old.service)} · ${envBadge(sanitizeTerminalOutput(old.environment))})`
            );
          }
        }

        // Update cache
        cache.clear();
        for (const s of secrets) {
          cache.set(s.id, s);
        }
      },
      db
    );

    const cleanup = () => {
      unsubscribe();
      console.log(pc.dim('\nStopped watching vault stream.'));
      resolve();
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}
