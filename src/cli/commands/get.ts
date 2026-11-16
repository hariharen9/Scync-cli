import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
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

  // 1. Resolve project ID if provided
  const projectId = options.project ? await resolveProjectId(session.uid, options.project, db) : undefined;

  // 2. Resolve matching secret
  const target = resolveSingleSecret(allSecrets, name, {
    id: options.id,
    project: projectId,
    env: options.env
  });

  // 3. Unlock vault and decrypt
  const vault = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(vault, target);

  // 3. Handle Clipboard copy if requested
  if (options.copy) {
    const copied = copyWithAutoClear(decrypted.value, 30);
    if (copied) {
      console.error(pc.green(`✓ Copied value of '${sanitizeTerminalOutput(target.name)}' to clipboard. Clipboard will auto-clear in 30s.`));
    } else {
      console.error(pc.yellow('Failed to write to system clipboard.'));
    }
  }

  // 4. Handle JSON output
  if (options.json) {
    console.log(JSON.stringify({
      id: decrypted.id,
      name: decrypted.name,
      service: decrypted.service,
      environment: decrypted.environment,
      type: decrypted.type,
      status: decrypted.status,
      value: options.reveal ? decrypted.value : maskSecretValue(decrypted.value),
      notes: decrypted.notes || null,
      version: decrypted.version || 1
    }, null, 2));
    return;
  }

  // 5. Handle Pipe / Raw output
  const isPipe = !process.stdout.isTTY || options.raw;
  if (isPipe) {
    // Clean raw output with NO decoration or trailing newline
    process.stdout.write(decrypted.value);
    return;
  }

  // 6. Human Terminal Output
  if (options.reveal) {
    process.stdout.write(decrypted.value + '\n');
  } else if (!options.copy) {
    const masked = maskSecretValue(decrypted.value);
    console.log(`${pc.bold(sanitizeTerminalOutput(target.name))}: ${pc.cyan(masked)}`);
    console.log(pc.dim('Use --reveal (-r) to show full value, or --copy (-c) to copy to clipboard.'));
  }
}
