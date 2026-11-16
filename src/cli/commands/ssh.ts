import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getSSHKeys } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { sanitizeKeyFileName } from '../../utils/sanitize.js';
import { renderTable, successBanner, warningBanner } from '../tui.js';
import pc from 'picocolors';

export interface SSHOptions {
  private?: boolean;
  dir?: string;
  json?: boolean;
  noAgent?: boolean;
  force?: boolean;
}

export async function sshCommand(action = 'ls', name?: string, options: SSHOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const keys = await getSSHKeys(session.uid, db);

  switch (action.toLowerCase()) {
    case 'ls':
    case 'list': {
      if (options.json) {
        console.log(JSON.stringify(keys.map(k => ({
          id: k.id,
          name: k.name,
          type: k.type,
          fingerprint: k.fingerprint,
          hosts: k.hosts,
        })), null, 2));
        return;
      }

      if (keys.length === 0) {
        console.log(pc.dim('No SSH keys found in your vault.'));
        return;
      }

      const columns = [
        { header: 'KEY NAME', minWidth: 20 },
        { header: 'KEY TYPE', minWidth: 14 },
        { header: 'FINGERPRINT (SHA256)', minWidth: 36 },
        { header: 'MAPPED HOSTS', minWidth: 20 }
      ];

      const rows = keys.map(k => [
        pc.bold(k.name),
        pc.cyan(k.type),
        pc.dim(k.fingerprint),
        k.hosts.length > 0 ? k.hosts.join(', ') : pc.dim('none')
      ]);

      const footer = pc.dim(`Total: ${keys.length} SSH key(s) • Use 'scync ssh export <name>' to write keys`);
      renderTable(columns, rows, { footer });
      break;
    }

    case 'get': {
      if (!name) {
        throw new CliError('Please specify key name: scync ssh get <name> [--private]', ExitCode.GENERAL_ERROR);
      }
      const match = keys.find(k => k.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        throw new CliError(`SSH key '${name}' not found.`, ExitCode.NOT_FOUND);
      }

      if (options.private) {
        const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
        const privateKey = await vault.decrypt(match.encPrivateKey);
        process.stdout.write(privateKey + (privateKey.endsWith('\n') ? '' : '\n'));
      } else {
        process.stdout.write(match.publicKey + (match.publicKey.endsWith('\n') ? '' : '\n'));
      }
      break;
    }

    case 'export': {
      if (!name) {
        throw new CliError('Please specify key name: scync ssh export <name> [--dir ~/.ssh]', ExitCode.GENERAL_ERROR);
      }
      const match = keys.find(k => k.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        throw new CliError(`SSH key '${name}' not found.`, ExitCode.NOT_FOUND);
      }

      const targetDir = path.resolve(options.dir || path.join(os.homedir(), '.ssh'));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      } else if (process.platform !== 'win32') {
        try {
          const stat = fs.statSync(targetDir);
          if ((stat.mode & 0o077) !== 0) {
            warningBanner(`Target SSH directory '${targetDir}' has open permissions (0${(stat.mode & 0o777).toString(8)}). Recommended: 0700.`);
          }
        } catch {}
      }

      const safeBaseName = sanitizeKeyFileName(match.name);
      const isEd25519 = match.type === 'ssh-ed25519';
      const privFileName = safeBaseName ? (isEd25519 ? `id_ed25519_${safeBaseName}` : `id_rsa_${safeBaseName}`) : (isEd25519 ? 'id_ed25519' : 'id_rsa');
      const pubFileName = `${privFileName}.pub`;

      const privPath = path.join(targetDir, privFileName);
      const pubPath = path.join(targetDir, pubFileName);

      if ((fs.existsSync(privPath) || fs.existsSync(pubPath)) && !options.force) {
        throw new CliError(
          `Target key file(s) already exist at '${privPath}'. Use --force to overwrite.`,
          ExitCode.GENERAL_ERROR
        );
      }

      const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
      const privateKey = await vault.decrypt(match.encPrivateKey);

      fs.writeFileSync(privPath, privateKey.replace(/\r?\n$/, '') + '\n', { mode: 0o600, encoding: 'utf8' });
      fs.writeFileSync(pubPath, match.publicKey.replace(/\r?\n$/, '') + '\n', { mode: 0o644, encoding: 'utf8' });

      successBanner(`Exported SSH key pair '${match.name}'`, [
        { key: 'Private Key', val: `${privPath} ${pc.dim('(chmod 0600)')}` },
        { key: 'Public Key', val: `${pubPath} ${pc.dim('(chmod 0644)')}` }
      ]);
      break;
    }

    case 'config': {
      console.log('# --- Generated by Scync (add to ~/.ssh/config) ---');
      let count = 0;
      for (const k of keys) {
        if (k.hosts && k.hosts.length > 0) {
          count++;
          const safeBaseName = sanitizeKeyFileName(k.name);
          const privFileName = k.type === 'ssh-ed25519' ? `id_ed25519_${safeBaseName}` : `id_rsa_${safeBaseName}`;
          console.log(`Host ${k.hosts.join(' ')}`);
          console.log(`  IdentityFile ~/.ssh/${privFileName}`);
          console.log(`  IdentitiesOnly yes\n`);
        }
      }
      if (count === 0) {
        console.log('# No keys with mapped hosts found in vault.');
      }
      break;
    }

    default:
      throw new CliError(
        `Unknown ssh action '${action}'. Valid actions: ls, get, export, config`,
        ExitCode.GENERAL_ERROR
      );
  }
}
