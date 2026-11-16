import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { maskSecretValue, sanitizeTerminalOutput } from '../../utils/sanitize.js';
import { renderCard, envBadge, statusBadge, successBanner, warningBanner } from '../tui.js';
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

  // 4. Handle Clipboard copy if requested
  if (options.copy) {
    const copied = copyWithAutoClear(decrypted.value, 30);
    if (copied) {
      successBanner(`Copied value of '${sanitizeTerminalOutput(target.name)}' to clipboard`, [
        { key: 'Clipboard TTL', val: 'Auto-clears in 30 seconds' },
        { key: 'Integrity', val: 'SHA-256 fingerprint verified' }
      ]);
    } else {
      warningBanner('Failed to write secret to system clipboard.');
    }
  }

  // 5. Handle JSON output
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

  // 6. Handle Pipe / Raw output
  const isPipe = !process.stdout.isTTY || options.raw;
  if (isPipe) {
    // Clean raw output with NO decoration or trailing newline for piping
    process.stdout.write(decrypted.value);
    return;
  }

  // 7. Human Terminal Output
  if (options.reveal) {
    process.stdout.write(decrypted.value + '\n');
  } else if (!options.copy) {
    const masked = maskSecretValue(decrypted.value);
    renderCard({
      title: `Secret: ${sanitizeTerminalOutput(target.name)}`,
      badge: statusBadge(target.status),
      rows: [
        { key: 'Environment', val: envBadge(target.environment) },
        { key: 'Service', val: sanitizeTerminalOutput(target.service) },
        { key: 'Type', val: sanitizeTerminalOutput(target.type) },
        { key: 'Value', val: `${pc.cyan(masked)} ${pc.dim(`(${decrypted.value.length} chars)`)}` }
      ],
      footer: pc.dim('Tip: Use -r (--reveal) to print value, or -c (--copy) to copy to clipboard')
    });
  }
}
