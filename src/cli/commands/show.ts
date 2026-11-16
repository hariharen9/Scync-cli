import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError } from '../errors.js';
import { resolveSingleSecret } from '../resolve.js';
import { maskSecretValue, sanitizeTerminalOutput } from '../../utils/sanitize.js';
import { renderCard, CardRow, CardSection, envBadge, statusBadge } from '../tui.js';
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
  const projectId = options.project ? await resolveProjectId(session.uid, options.project, db) : undefined;
  const target = resolveSingleSecret(allSecrets, name, {
    id: options.id,
    project: projectId,
    env: options.env
  });

  // Unlock and decrypt
  const vault = await unlockVault(session.uid, db);
  const decrypted = await decryptSecret(vault, target);

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
      value: options.reveal ? decrypted.value : maskSecretValue(decrypted.value),
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

  // Build Metadata Rows
  const rows: CardRow[] = [
    { key: 'ID', val: pc.dim(target.id) },
    { key: 'Service', val: sanitizeTerminalOutput(target.service) },
    { key: 'Type', val: sanitizeTerminalOutput(target.type) },
    { key: 'Environment', val: envBadge(sanitizeTerminalOutput(target.environment)) },
    { key: 'Status', val: statusBadge(target.status) },
  ];

  if (target.projectId) {
    rows.push({ key: 'Project', val: pc.bold(sanitizeTerminalOutput(target.projectId)) });
  }

  rows.push({ key: 'Version', val: pc.dim(`v${target.version || 1}`) });
  rows.push({ key: 'Created', val: target.createdAt.toLocaleString() });
  rows.push({ key: 'Updated', val: target.updatedAt.toLocaleString() });

  if (target.lastRotated) {
    rows.push({ key: 'Last Rotated', val: target.lastRotated.toLocaleString() });
  }
  if (target.expiresOn) {
    rows.push({ key: 'Expires On', val: target.expiresOn.toLocaleString() });
  }

  const sections: CardSection[] = [];

  // Value Section
  if (target.type === 'Recovery Codes') {
    try {
      const codeSet = JSON.parse(decrypted.value) as RecoveryCodeSet;
      const codeLines: string[] = [];
      codeSet.codes.forEach((c, idx) => {
        const statusLabel = c.used ? pc.dim('[USED]') : pc.green('[UNUSED]');
        const codeDisplay = options.reveal ? pc.bold(c.code) : pc.cyan(maskSecretValue(c.code));
        codeLines.push(`${pc.dim(`${String(idx + 1).padStart(2, ' ')}.`)} ${codeDisplay}  ${statusLabel}`);
      });
      codeLines.push(pc.dim(`Remaining unused codes: ${target.remainingCodes ?? 'N/A'}`));
      sections.push({ title: 'Recovery Codes', lines: codeLines });
    } catch {
      const valDisplay = options.reveal ? pc.bold(decrypted.value) : pc.cyan(maskSecretValue(decrypted.value));
      sections.push({ title: 'Value', lines: [valDisplay] });
    }
  } else {
    const valDisplay = options.reveal ? pc.bold(decrypted.value) : `${pc.cyan(maskSecretValue(decrypted.value))} ${pc.dim(`(${decrypted.value.length} chars)`)}`;
    sections.push({ title: 'Value', lines: [valDisplay] });
  }

  if (decrypted.notes) {
    sections.push({ title: 'Notes', lines: [sanitizeTerminalOutput(decrypted.notes)] });
  }

  // Version History Section
  if (target.versions && target.versions.length > 0) {
    const historyLines = target.versions.map(v => {
      const action = pc.cyan(v.changeType || 'updated');
      const date = pc.dim(v.createdAt.toLocaleDateString());
      const note = v.note ? pc.dim(`· ${v.note}`) : '';
      return `${pc.dim('○')} ${pc.bold(`v${v.version}`)}  ${action} on ${date} ${note}`;
    });
    sections.push({ title: 'Version History', lines: historyLines });
  }

  renderCard({
    title: `Secret: ${sanitizeTerminalOutput(target.name)}`,
    badge: statusBadge(target.status),
    rows,
    sections,
    footer: options.reveal ? undefined : pc.dim('Tip: Use -r (--reveal) to print plaintext value')
  });
}
