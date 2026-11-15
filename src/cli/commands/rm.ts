import { getValidSession } from '../../auth/session.js';
import { getSecrets, deleteSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError, SecretNotFoundError, AmbiguousSecretError } from '../errors.js';
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

  let matches = allSecrets.filter(s => s.name.toLowerCase() === name.toLowerCase());

  if (options.id) {
    matches = matches.filter(s => s.id === options.id);
  }
  if (options.project) {
    matches = matches.filter(s => s.projectId?.toLowerCase() === options.project!.toLowerCase());
  }
  if (options.env) {
    matches = matches.filter(s => s.environment.toLowerCase() === options.env!.toLowerCase());
  }

  if (matches.length === 0) {
    throw new SecretNotFoundError(name);
  }

  if (matches.length > 1) {
    throw new AmbiguousSecretError(
      name,
      matches.map(m => ({
        id: m.id,
        service: m.service,
        environment: m.environment,
        projectId: m.projectId
      }))
    );
  }

  const target = matches[0];

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
