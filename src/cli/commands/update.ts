import { getValidSession } from '../../auth/session.js';
import { getSecrets, updateSecret, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { readSecretValueInput, type SecretInputOptions } from '../input.js';
import { normalizeEnvironment, normalizeSecretType, normalizeSecretStatus } from '../../core/constants.js';
import { parseExpirationDate } from '../../utils/sanitize.js';
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

  const filterProjectId = options.project ? await resolveProjectId(session.uid, options.project, db) : undefined;
  const target = resolveSingleSecret(allSecrets, name, {
    id: options.id,
    project: filterProjectId,
    env: options.env
  });
  const vault = await unlockVault(session.uid, db);

  // Determine new value:
  // 1. Explicit --value or --file options
  // 2. Explicitly piped non-empty stdin
  // 3. Otherwise, retain existing secret value (e.g. metadata-only update like --status)
  let value: string;
  let hasNewValue = false;

  if (options.value !== undefined || options.file !== undefined) {
    value = await readSecretValueInput(name, options, `New secret value for ${name}: `);
    if (value === undefined || value.length === 0) {
      throw new CliError('Secret value cannot be empty.', ExitCode.GENERAL_ERROR);
    }
    hasNewValue = true;
  } else if (!process.stdin.isTTY) {
    // Check if piped stdin has data
    const pipedData = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => { resolve(data.replace(/\r?\n$/, '')); });
      process.stdin.on('error', () => { resolve(''); });
      if (process.stdin.readableEnded) {
        resolve(data.replace(/\r?\n$/, ''));
      }
    });

    if (pipedData.length > 0) {
      value = pipedData;
      hasNewValue = true;
    } else {
      // Non-TTY with empty stdin (e.g. script updating --status or --notes): preserve existing value
      const dec = await decryptSecret(vault, target);
      value = dec.value;
    }
  } else {
    // Interactive TTY with no --value or --file: preserve existing value
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
  const type = options.type ? normalizeSecretType(options.type) : target.type;
  const env = options.env ? normalizeEnvironment(options.env) : target.environment;
  const status = options.status ? normalizeSecretStatus(options.status) : target.status;
  const expiresOn = options.expires ? parseExpirationDate(options.expires) : target.expiresOn;
  const projectId = options.project !== undefined
    ? (options.project ? await resolveProjectId(session.uid, options.project, db) : null)
    : target.projectId;

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
