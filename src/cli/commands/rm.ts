import { getValidSession } from '../../auth/session.js';
import { getSecrets, deleteSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { confirmDestructive } from '../confirm.js';
import { successBanner, warningBanner, envBadge } from '../tui.js';
import pc from 'picocolors';

export interface RmOptions {
  project?: string;
  env?: string;
  id?: string;
  yes?: boolean;
}

export async function rmCommand(name: string, options: RmOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);
  const projectId = options.project ? await resolveProjectId(session.uid, options.project, db) : undefined;
  const target = resolveSingleSecret(allSecrets, name, {
    id: options.id,
    project: projectId,
    env: options.env
  });

  const confirmed = await confirmDestructive(
    `Permanently delete secret '${target.name}' (${target.service} · ${target.environment})?`,
    { yes: options.yes }
  );
  if (!confirmed) {
    warningBanner('Aborted deletion. Secret was not removed.');
    return;
  }

  await deleteSecret(session.uid, target.id, target.name, target.service, db);
  successBanner(`Deleted secret '${target.name}'`, [
    { key: 'Vault ID', val: pc.dim(target.id) },
    { key: 'Environment', val: envBadge(target.environment) },
    { key: 'Service', val: target.service }
  ]);
}
