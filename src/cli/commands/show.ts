import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, SecretNotFoundError, AmbiguousSecretError } from '../errors.js';
import { maskSecretValue, sanitizeTerminalOutput } from '../../utils/sanitize.js';
import type { RecoveryCodeSet } from '../../core/types.js';
import pc from 'picocolors';

export interface ShowOptions {
  reveal?: boolean;
  json?: boolean;
  history?: boolean;
  project?: string;
  env?: string;
  id?: string;
}

export async function showCommand(name: string, options: ShowOptions): Promise<void> {
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

  // Unlock and decrypt
  const { key } = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(key, target);

  if (options.json) {
    console.log(JSON.stringify({
      id: decrypted.id,
      name: decrypted.name,
      service: decrypted.service,
      environment: decrypted.environment,
      type: decrypted.type,
      status: decrypted.status,
      projectId: decrypted.projectId,
      remainingCodes: decrypted.remainingCodes,
      version: decrypted.version || 1,
      createdAt: decrypted.createdAt.toISOString(),
      updatedAt: decrypted.updatedAt.toISOString(),
      lastRotated: decrypted.lastRotated ? decrypted.lastRotated.toISOString() : null,
      expiresOn: decrypted.expiresOn ? decrypted.expiresOn.toISOString() : null,
      value: decrypted.value,
      notes: decrypted.notes || null,
      versions: decrypted.versions?.map(v => ({
        version: v.version,
        changeType: v.changeType,
        createdAt: v.createdAt.toISOString(),
        note: v.note
      })) || []
    }, null, 2));
    return;
  }

  // Display human-formatted details
  console.log(pc.bold(`--- Secret Details: ${sanitizeTerminalOutput(target.name)} ---`));
  console.log(`${pc.dim('ID:')}             ${target.id}`);
  console.log(`${pc.dim('Service:')}        ${sanitizeTerminalOutput(target.service)}`);
  console.log(`${pc.dim('Type:')}           ${sanitizeTerminalOutput(target.type)}`);
  console.log(`${pc.dim('Environment:')}    ${sanitizeTerminalOutput(target.environment)}`);
  console.log(`${pc.dim('Status:')}         ${target.status === 'Active' ? pc.green(target.status) : pc.yellow(target.status)}`);
  if (target.projectId) {
    console.log(`${pc.dim('Project:')}        ${sanitizeTerminalOutput(target.projectId)}`);
  }
  console.log(`${pc.dim('Version:')}        v${target.version || 1}`);
  console.log(`${pc.dim('Created:')}        ${target.createdAt.toLocaleString()}`);
  console.log(`${pc.dim('Updated:')}        ${target.updatedAt.toLocaleString()}`);
  if (target.lastRotated) {
    console.log(`${pc.dim('Last Rotated:')}   ${target.lastRotated.toLocaleString()}`);
  }
  if (target.expiresOn) {
    console.log(`${pc.dim('Expires On:')}     ${target.expiresOn.toLocaleString()}`);
  }

  // Value display (check for Recovery Codes JSON structure)
  console.log(pc.dim('─'.repeat(50)));
  if (target.type === 'Recovery Codes') {
    try {
      const codeSet = JSON.parse(decrypted.value) as RecoveryCodeSet;
      console.log(pc.bold('Recovery Codes:'));
      codeSet.codes.forEach((c, idx) => {
        const statusLabel = c.used ? pc.dim('[USED]') : pc.green('[UNUSED]');
        const codeDisplay = options.reveal ? c.code : maskSecretValue(c.code);
        console.log(`  ${idx + 1}. ${codeDisplay} ${statusLabel}`);
      });
      console.log(pc.dim(`Remaining unused codes: ${target.remainingCodes ?? 'N/A'}`));
    } catch {
      console.log(`${pc.bold('Value:')}           ${options.reveal ? decrypted.value : maskSecretValue(decrypted.value)}`);
    }
  } else {
    console.log(`${pc.bold('Value:')}           ${options.reveal ? decrypted.value : maskSecretValue(decrypted.value)}`);
  }

  if (decrypted.notes) {
    console.log(`${pc.bold('Notes:')}           ${sanitizeTerminalOutput(decrypted.notes)}`);
  }

  // Version history
  if (target.versions && target.versions.length > 0) {
    console.log(pc.dim('─'.repeat(50)));
    console.log(pc.bold('Version History:'));
    target.versions.forEach(v => {
      console.log(
        `  v${v.version} - ${pc.cyan(v.changeType || 'updated')} on ${v.createdAt.toLocaleDateString()} ${v.note ? `(${v.note})` : ''}`
      );
    });
  }
}
