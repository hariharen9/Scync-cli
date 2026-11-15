import { getValidSession } from '../../auth/session.js';
import { getSecrets, updateSecret, decryptSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, SecretNotFoundError, AmbiguousSecretError } from '../errors.js';
import { readSecretValueInput, type SecretInputOptions } from '../input.js';
import type { SecretType, Environment, SecretStatus, RecoveryCodeSet } from '../../core/types.js';
import pc from 'picocolors';

export interface UpdateOptions extends SecretInputOptions {
  service?: string;
  type?: string;
  env?: string;
  status?: string;
  project?: string;
  notes?: string;
  expires?: string;
  id?: string;
  force?: boolean;
}

export async function updateCommand(name: string, options: UpdateOptions): Promise<void> {
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
  const vault = await unlockVault(session.uid, db);

  // Determine new value: if passed or piped, use it; otherwise decrypt existing
  let value: string;
  const hasNewValue = options.value !== undefined || options.file !== undefined || !process.stdin.isTTY;

  if (hasNewValue) {
    value = await readSecretValueInput(name, options, `New secret value for ${name}: `);
  } else {
    const dec = await decryptSecret(vault, target);
    value = dec.value;
  }

  // Determine notes: if specified, use it; otherwise decrypt existing
  let notes: string;
  if (options.notes !== undefined) {
    notes = options.notes;
  } else if (target.encNotes) {
    const dec = await decryptSecret(vault, target);
    notes = dec.notes;
  } else {
    notes = '';
  }

  const service = options.service || target.service;
  const type = (options.type || target.type) as SecretType;
  const env = (options.env || target.environment) as Environment;
  const status = (options.status || target.status) as SecretStatus;
  const expiresOn = options.expires ? new Date(options.expires) : target.expiresOn;
  const projectId = options.project !== undefined ? (options.project || null) : target.projectId;

  let remainingCodes = target.remainingCodes;
  let finalValue = value;

  if (type === 'Recovery Codes' && hasNewValue) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed.codes)) {
        remainingCodes = parsed.codes.filter((c: any) => !c.used).length;
      }
    } catch {
      const rawCodes = value.split(/[\r\n,;\s]+/).map(c => c.trim()).filter(Boolean);
      const codeSet: RecoveryCodeSet = {
        codes: rawCodes.map(c => ({ code: c, used: false, usedAt: null }))
      };
      finalValue = JSON.stringify(codeSet);
      remainingCodes = rawCodes.length;
    }
  }

  const expectedVersion = target.version || 1;

  await updateSecret(
    session.uid,
    vault,
    target.id,
    {
      name: target.name,
      service,
      type,
      environment: env,
      status,
      value: finalValue,
      notes,
      lastRotated: target.lastRotated,
      expiresOn,
      projectId,
      remainingCodes
    },
    target,
    'updated',
    db,
    { expectedVersion, force: options.force }
  );

  console.log(pc.green(`✓ Updated secret '${target.name}' to v${expectedVersion + 1}`));
}
