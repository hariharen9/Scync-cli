import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getPasswords } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
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

  // If exact query matches 1 and --copy is requested
  if (passwords.length === 1 && options.copy) {
    const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
    const plainPassword = await vault.decrypt(passwords[0].encPassword);
    await copyWithAutoClear(plainPassword, 30);
    console.error(pc.green(`✓ Password for '${passwords[0].name}' copied to clipboard (auto-clears in 30s).`));
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

  console.log(pc.bold('--- Stored Passwords (Read-Only) ---'));
  console.log(
    `${pc.dim('TITLE'.padEnd(20))} ${pc.dim('USERNAME'.padEnd(25))} ${pc.dim('PASSWORD'.padEnd(16))} ${pc.dim('URL')}`
  );
  console.log('─'.repeat(80));

  for (const p of passwords) {
    let pass = pc.dim('••••••••');
    if (options.reveal && vault) {
      try {
        const plain = await vault.decrypt(p.encPassword);
        pass = pc.yellow(plain);
      } catch {
        pass = pc.red('[Decryption error]');
      }
    }
    console.log(
      `${pc.cyan(p.name.padEnd(20))} ${p.username.padEnd(25)} ${pass.padEnd(16)} ${pc.dim(p.url || 'none')}`
    );
  }

  if (!options.reveal) {
    console.log(pc.dim('\nUse --reveal to display plaintext passwords or --copy to copy to clipboard.'));
  }
}
