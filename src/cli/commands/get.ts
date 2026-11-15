import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, SecretNotFoundError, AmbiguousSecretError } from '../errors.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { maskSecretValue, sanitizeTerminalOutput } from '../../utils/sanitize.js';
import pc from 'picocolors';

export interface GetOptions {
  reveal?: boolean;
  copy?: boolean;
  raw?: boolean;
  json?: boolean;
  project?: string;
  env?: string;
  id?: string;
}

export async function getCommand(name: string, options: GetOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const allSecrets = await getSecrets(session.uid, db);

  // 1. Resolve matching secrets
  let matches = allSecrets.filter(s => s.name.toLowerCase() === name.toLowerCase());

  // If specific ID was provided, filter by ID
  if (options.id) {
    matches = matches.filter(s => s.id === options.id);
  }
  // If specific project was provided
  if (options.project) {
    matches = matches.filter(s => s.projectId?.toLowerCase() === options.project!.toLowerCase());
  }
  // If specific env was provided
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

  // 2. Unlock vault and decrypt
  const vault = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(vault, target);

  // 3. Handle Pipe / Raw output
  const isPipe = !process.stdout.isTTY || options.raw;

  if (options.json) {
    console.log(JSON.stringify({
      id: decrypted.id,
      name: decrypted.name,
      service: decrypted.service,
      environment: decrypted.environment,
      type: decrypted.type,
      status: decrypted.status,
      value: decrypted.value,
      notes: decrypted.notes || null,
      version: decrypted.version || 1
    }, null, 2));
    return;
  }

  if (isPipe) {
    // Clean raw output with NO decoration or trailing newline
    process.stdout.write(decrypted.value);
    return;
  }

  // 4. Handle Clipboard copy
  if (options.copy) {
    const copied = copyWithAutoClear(decrypted.value, 30);
    if (copied) {
      console.error(pc.green(`✓ Copied '${sanitizeTerminalOutput(target.name)}' to clipboard. Clipboard will auto-clear in 30s.`));
    } else {
      console.error(pc.yellow('Failed to write to system clipboard.'));
    }
  }

  // 5. Human Terminal Output
  if (options.reveal) {
    console.log(decrypted.value);
  } else if (!options.copy) {
    const masked = maskSecretValue(decrypted.value);
    console.log(`${pc.bold(sanitizeTerminalOutput(target.name))}: ${pc.cyan(masked)}`);
    console.log(pc.dim('Use --reveal (-r) to show full value, or --copy (-c) to copy to clipboard.'));
  }
}
