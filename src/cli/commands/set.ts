import { getValidSession } from '../../auth/session.js';
import { getSecrets, createSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { readSecretValueInput, inferServiceFromName, type SecretInputOptions } from '../input.js';
import { confirmDestructive } from '../confirm.js';
import { updateCommand } from './update.js';
import { normalizeEnvironment, normalizeSecretType, normalizeSecretStatus } from '../../core/constants.js';
import { parseExpirationDate } from '../../utils/sanitize.js';
import { successBanner, envBadge, warningBanner } from '../tui.js';
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
  yes?: boolean;
}

export async function setCommand(name: string, options: SetOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);

  const env = options.env ? normalizeEnvironment(options.env) : 'Development';
  const project = options.project ? await resolveProjectId(session.uid, options.project, db) : null;

  // Check if a secret with this exact name, environment, and project already exists
  const existing = allSecrets.find(s => 
    s.name.toLowerCase() === name.toLowerCase() &&
    s.environment.toLowerCase() === env.toLowerCase() &&
    (s.projectId || null) === project
  );

  if (existing) {
    const confirmed = await confirmDestructive(
      `Secret '${name}' already exists in ${env}${project ? ` (project: ${project})` : ''}. Update it?${
        options.force ? ' --force will bypass version checks.' : ''
      }`,
      { yes: options.yes }
    );
    if (!confirmed) {
      warningBanner('Aborted set operation. Secret was not modified.');
      return;
    }

    // The overwrite intent has just been confirmed; do not prompt twice in
    // update when --force was combined with the confirmation.
    await updateCommand(name, {
      ...options,
      env,
      project: project || undefined,
      yes: true,
    });
    return;
  }

  // Creating a new secret
  const value = await readSecretValueInput(name, options, `Secret value for ${name}: `);
  if (!value) {
    throw new CliError('Secret value cannot be empty.', ExitCode.GENERAL_ERROR);
  }

  const service = options.service || inferServiceFromName(name);
  const type = options.type ? normalizeSecretType(options.type) : 'API Key';
  const status = options.status ? normalizeSecretStatus(options.status) : 'Active';
  const expiresOn = options.expires ? parseExpirationDate(options.expires) : null;

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

  const vault = await unlockVault(session.uid, db);

  const created = await createSecret(session.uid, vault, {
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

  successBanner(`Created secret '${name}'`, [
    { key: 'Environment', val: envBadge(env) },
    { key: 'Service', val: service },
    { key: 'Type', val: type },
    { key: 'Version', val: pc.dim('v1') },
    { key: 'Vault ID', val: pc.dim(created.id) }
  ]);
}
