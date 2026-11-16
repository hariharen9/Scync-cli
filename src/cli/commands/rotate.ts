import { getValidSession } from '../../auth/session.js';
import { getSecrets, updateSecret, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { readSecretValueInput, type SecretInputOptions } from '../input.js';
import { successBanner, envBadge } from '../tui.js';
import pc from 'picocolors';

export interface RotateOptions extends SecretInputOptions {
  project?: string;
  env?: string;
  id?: string;
  force?: boolean;
}

export async function rotateCommand(name: string, options: RotateOptions): Promise<void> {
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
  const newValue = await readSecretValueInput(name, options, `Enter new rotated value for ${name}: `);
  if (!newValue) {
    throw new CliError('Rotated secret value cannot be empty.', ExitCode.GENERAL_ERROR);
  }

  const vault = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(vault, target);

  const rotationDate = new Date();
  const expectedVersion = target.version || 1;

  await updateSecret(
    session.uid,
    vault,
    target.id,
    {
      name: target.name,
      service: target.service,
      type: target.type,
      environment: target.environment,
      status: 'Active',
      value: newValue,
      notes: decrypted.notes,
      lastRotated: rotationDate,
      expiresOn: target.expiresOn,
      projectId: target.projectId,
      remainingCodes: target.remainingCodes
    },
    target,
    'rotated',
    db,
    { expectedVersion, force: options.force }
  );

  successBanner(`Successfully rotated '${target.name}'`, [
    { key: 'Version', val: `${pc.dim(`v${expectedVersion}`)} → ${pc.bold(`v${expectedVersion + 1}`)}` },
    { key: 'Environment', val: envBadge(target.environment) },
    { key: 'Rotated At', val: rotationDate.toLocaleString() }
  ]);
}
