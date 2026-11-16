import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { subscribeToSecrets, resolveProjectId } from '../../core/firestore.js';
import { unlockVault, type VaultSession } from '../../core/vault-session.js';
import type { StoredSecret, EncryptedValue } from '../../core/types.js';
import { AuthRequiredError } from '../errors.js';
import { renderCard, envBadge } from '../tui.js';
import pc from 'picocolors';

export interface WatchOptions {
  project?: string;
  env?: string;
  service?: string;
  reveal?: boolean;
  noAgent?: boolean;
}

function isEncValueEqual(a: EncryptedValue, b: EncryptedValue): boolean {
  if (!a || !b) return a === b;
  return a.ciphertext === b.ciphertext && a.nonce === b.nonce;
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

  const cache = new Map<string, StoredSecret>();
  let isInitial = true;

  const filterDesc = [
    options.project ? `Project: ${options.project}` : null,
    options.env ? `Env: ${options.env}` : null,
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
        if (options.project) {
          const resolvedProj = await resolveProjectId(session.uid, options.project, db);
          const p = resolvedProj.toLowerCase();
          secrets = secrets.filter((s) => s.projectId?.toLowerCase() === p);
        }
        if (options.env) {
          secrets = secrets.filter((s) => s.environment.toLowerCase() === (options.env as string).toLowerCase());
        }
        if (options.service) {
          secrets = secrets.filter((s) => s.service.toLowerCase() === options.service!.toLowerCase());
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
              `  ${pc.dim(`[${now}]`)} ${pc.green('● ADDED')}    ${pc.bold(current.name)} (v${current.version} · ${current.service} · ${envBadge(current.environment)})`
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
              `  ${pc.dim(`[${now}]`)} ${pc.yellow('● MODIFIED')} ${pc.bold(current.name)} (${pc.dim(`v${old.version}`)} → ${pc.bold(`v${current.version}`)} · ${current.service} · ${envBadge(current.environment)})`
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
              `  ${pc.dim(`[${now}]`)} ${pc.red('● DELETED')}  ${pc.bold(old.name)} (${old.service} · ${envBadge(old.environment)})`
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
