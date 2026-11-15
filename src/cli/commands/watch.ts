import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { subscribeToSecrets } from '../../core/firestore.js';
import { unlockVault, type VaultSession } from '../../core/vault-session.js';
import { AuthRequiredError } from '../errors.js';
import type { StoredSecret, Environment } from '../../core/types.js';
import pc from 'picocolors';

export interface WatchOptions {
  project?: string;
  env?: string;
  service?: string;
  reveal?: boolean;
  noAgent?: boolean;
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

  console.log(pc.cyan(`👀 Watching secrets for ${session.email || session.uid} (press Ctrl+C to exit)...`));
  const filterDesc = [
    options.project ? `project: ${options.project}` : null,
    options.env ? `env: ${options.env}` : null,
    options.service ? `service: ${options.service}` : null,
  ].filter(Boolean).join(', ');
  if (filterDesc) {
    console.log(pc.dim(`   Filter: ${filterDesc}`));
  }

  return new Promise((resolve) => {
    const unsubscribe = subscribeToSecrets(
      session.uid,
      async (allSecrets: StoredSecret[]) => {
        let secrets = allSecrets;
        if (options.project) {
          secrets = secrets.filter((s) => s.projectId === options.project);
        }
        if (options.env) {
          secrets = secrets.filter((s) => s.environment === (options.env as Environment));
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
          console.log(pc.dim(`[${now}] Initialized tracking: ${secrets.length} secret(s) in scope.`));
          return;
        }

        const currentMap = new Map<string, StoredSecret>(secrets.map((s) => [s.id, s]));

        // Check for added or modified
        for (const [id, current] of currentMap.entries()) {
          const old = cache.get(id);
          if (!old) {
            // Added
            console.log(
              `${pc.dim(`[${now}]`)} ${pc.green('[ADDED]')} ${pc.bold(current.name)} (v${current.version} · ${current.service} · ${current.environment})`
            );
            if (options.reveal && vault) {
              try {
                const val = await vault.decrypt(current.encValue);
                console.log(pc.dim(`         Value: `) + pc.yellow(val));
              } catch {
                console.log(pc.dim(`         Value: [Decryption failed]`));
              }
            }
          } else if (
            old.version !== current.version ||
            old.encValue !== current.encValue ||
            old.status !== current.status
          ) {
            // Modified
            console.log(
              `${pc.dim(`[${now}]`)} ${pc.yellow('[MODIFIED]')} ${pc.bold(current.name)} (v${old.version} -> v${current.version} · ${current.service} · ${current.environment})`
            );
            if (options.reveal && vault) {
              try {
                const val = await vault.decrypt(current.encValue);
                console.log(pc.dim(`         New Value: `) + pc.yellow(val));
              } catch {
                console.log(pc.dim(`         New Value: [Decryption failed]`));
              }
            }
          }
        }

        // Check for removed
        for (const [id, old] of cache.entries()) {
          if (!currentMap.has(id)) {
            console.log(
              `${pc.dim(`[${now}]`)} ${pc.red('[DELETED]')} ${pc.bold(old.name)} (${old.service} · ${old.environment})`
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
      console.log(pc.dim('\nStopped watching.'));
      resolve();
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}
