import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getPasswords } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { getClipboardTimeoutSecs } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { renderTable, successBanner } from '../tui.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import pc from 'picocolors';

export interface PasswordsOptions {
  reveal?: boolean;
  copy?: boolean;
  json?: boolean;
  noAgent?: boolean;
}

export async function passwordsCommand(query?: string, options: PasswordsOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  let passwords = await getPasswords(session.uid, db);

  if (query) {
    const q = query.toLowerCase();
    passwords = passwords.filter(
      p => p.name.toLowerCase().includes(q) ||
           p.username.toLowerCase().includes(q) ||
           p.url.toLowerCase().includes(q)
    );
  }

  if (passwords.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(pc.dim(query ? `No passwords matching '${query}' found.` : 'No passwords found in your vault.'));
    return;
  }

  // If exactly one password matched and --copy was requested
  if (options.copy && passwords.length > 1) {
    throw new CliError(
      `Multiple passwords match '${query ?? ''}'. Refine the query so exactly one entry is selected before using --copy.`,
      ExitCode.AMBIGUOUS
    );
  }

  if (passwords.length === 1 && options.copy) {
    const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
    const plainPassword = await vault.decrypt(passwords[0].encPassword);
    const clipboardSecs = getClipboardTimeoutSecs();
    await copyWithAutoClear(plainPassword, clipboardSecs);
    successBanner(`Password for '${passwords[0].name}' copied to clipboard`, [
      {
        key: 'Auto-Clear',
        val: clipboardSecs > 0 ? `Clears in ${clipboardSecs} seconds` : 'Disabled'
      }
    ]);
    return;
  }

  let vault: any = null;
  if (options.reveal) {
    vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
  }

  if (options.json) {
    const result = [];
    for (const p of passwords) {
      let pass = '••••••••';
      if (options.reveal && vault) {
        pass = await vault.decrypt(p.encPassword);
      }
      result.push({
        id: p.id,
        name: p.name,
        username: p.username,
        url: p.url,
        category: p.category,
        password: pass,
      });
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const columns = [
    { header: 'TITLE', minWidth: 22 },
    { header: 'USERNAME / EMAIL', minWidth: 26 },
    { header: 'PASSWORD', minWidth: 16 },
    { header: 'TARGET URL', minWidth: 24 }
  ];

  const rows: string[][] = [];
  for (const p of passwords) {
    let pass = pc.dim('••••••••');
    if (options.reveal && vault) {
      try {
        const plain = await vault.decrypt(p.encPassword);
        pass = pc.yellow(plain);
      } catch {
        pass = pc.red('[Error]');
      }
    }
    rows.push([
      pc.bold(sanitizeTerminalOutput(p.name)),
      sanitizeTerminalOutput(p.username),
      pass,
      pc.dim(sanitizeTerminalOutput(p.url || 'None'))
    ]);
  }

  const footer = options.reveal
    ? pc.dim(`Total: ${passwords.length} password item(s)`)
    : pc.dim(`Total: ${passwords.length} password item(s) • Use -r (--reveal) to show or -c (--copy) to copy`);

  renderTable(columns, rows, { footer });
}
