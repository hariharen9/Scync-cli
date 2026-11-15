import { getValidSession } from '../../auth/session.js';
import { getSecrets, createSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { readSecretValueInput, inferServiceFromName, type SecretInputOptions } from '../input.js';
import { promptConfirm } from '../prompts.js';
import { updateCommand } from './update.js';
import type { SecretType, Environment, SecretStatus, RecoveryCodeSet } from '../../core/types.js';
import pc from 'picocolors';

export interface SetOptions extends SecretInputOptions {
  service?: string;
  type?: string;
  env?: string;
  status?: string;
  project?: string;
  notes?: string;
  expires?: string;
  force?: boolean;
}

export async function setCommand(name: string, options: SetOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);

  const env = (options.env || 'Development') as Environment;
  const project = options.project || null;

  // Check if a secret with this exact name, environment, and project already exists
  const existing = allSecrets.find(s => 
    s.name.toLowerCase() === name.toLowerCase() &&
    s.environment.toLowerCase() === env.toLowerCase() &&
    (s.projectId || null) === project
  );

  if (existing) {
    if (!options.force) {
      const confirm = await promptConfirm(
        `Secret '${name}' already exists in ${env}${project ? ` (project: ${project})` : ''}. Update it?`,
        false
      );
      if (!confirm) {
        console.error(pc.yellow('Aborted set operation.'));
        return;
      }
    }

    // Delegate to update
    await updateCommand(name, {
      ...options,
      env,
      project: project || undefined,
      force: options.force
    });
    return;
  }

  // Creating a new secret
  const value = await readSecretValueInput(name, options, `Secret value for ${name}: `);
  if (!value) {
    throw new CliError('Secret value cannot be empty.', ExitCode.GENERAL_ERROR);
  }

  const service = options.service || inferServiceFromName(name);
  const type = (options.type || 'API Key') as SecretType;
  const status = (options.status || 'Active') as SecretStatus;
  const expiresOn = options.expires ? new Date(options.expires) : null;

  let remainingCodes: number | null = null;
  let finalValue = value;

  if (type === 'Recovery Codes') {
    try {
      // Check if already JSON
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed.codes)) {
        remainingCodes = parsed.codes.filter((c: any) => !c.used).length;
      }
    } catch {
      // Treat as comma/space/newline separated list of codes
      const rawCodes = value.split(/[\r\n,;\s]+/).map(c => c.trim()).filter(Boolean);
      const codeSet: RecoveryCodeSet = {
        codes: rawCodes.map(c => ({ code: c, used: false, usedAt: null }))
      };
      finalValue = JSON.stringify(codeSet);
      remainingCodes = rawCodes.length;
    }
  }

  const { key } = await unlockVault(session.uid, db);

  const created = await createSecret(session.uid, key, {
    name,
    service,
    type,
    environment: env,
    status,
    value: finalValue,
    notes: options.notes || '',
    lastRotated: new Date(),
    expiresOn,
    projectId: project,
    remainingCodes
  }, db);

  console.log(pc.green(`✓ Created secret '${name}' (v1 · ${service} · ${env})`));
  console.log(pc.dim(`  ID: ${created.id}`));
}
