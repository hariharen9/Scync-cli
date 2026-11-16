import { getValidSession } from '../../auth/session.js';
import { getSecrets, deleteSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { promptConfirm } from '../prompts.js';
import pc from 'picocolors';

export interface RmOptions {
  project?: string;
  env?: string;
  id?: string;
  force?: boolean;
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

  if (!options.force) {
    const confirmed = await promptConfirm(
      `Are you sure you want to permanently delete secret '${target.name}' (${target.service} · ${target.environment})?`,
      false
    );
    if (!confirmed) {
      console.error(pc.yellow('Aborted deletion.'));
      return;
    }
  }

  await deleteSecret(session.uid, target.id, target.name, target.service, db);
  console.log(pc.green(`✓ Deleted secret '${target.name}' (${target.id})`));
}
