import { getValidSession } from '../../auth/session.js';
import { getSecrets, updateSecret, decryptSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, SecretNotFoundError, AmbiguousSecretError, CliError, ExitCode } from '../errors.js';
import { readSecretValueInput, type SecretInputOptions } from '../input.js';
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
  const newValue = await readSecretValueInput(name, options, `Enter new rotated value for ${name}: `);
  if (!newValue) {
    throw new CliError('Rotated secret value cannot be empty.', ExitCode.GENERAL_ERROR);
  }

  const { key } = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(key, target);

  const rotationDate = new Date();
  const expectedVersion = target.version || 1;

  await updateSecret(
    session.uid,
    key,
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

  console.log(pc.green(`✓ Successfully rotated '${target.name}' to v${expectedVersion + 1}`));
  console.log(pc.dim(`  Rotation recorded at: ${rotationDate.toLocaleString()}`));
}
