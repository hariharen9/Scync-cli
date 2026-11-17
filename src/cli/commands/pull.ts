import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret, resolveProjectId, logLedgerEvent } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError } from '../errors.js';
import { formatEnvLine, findEnvKeyCollisions } from '../../utils/env.js';
import { getDefaultScope } from '../../config/index.js';
import { confirmDestructive } from '../confirm.js';
import { successBanner, envBadge, warningBanner } from '../tui.js';
import pc from 'picocolors';

export interface PullOptions {
  project?: string;
  env?: string;
  output?: string;
  force?: boolean;
  yes?: boolean;
}

function checkGitIgnored(filePath: string): boolean | null {
  try {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    // Check if inside git repo
    const checkRepo = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
    if (checkRepo.status !== 0 || !checkRepo.stdout.trim().includes('true')) {
      return null; // Not in a git repo
    }
    // Check if ignored
    const checkIgnore = spawnSync('git', ['-C', dir, 'check-ignore', absPath], { encoding: 'utf8' });
    return checkIgnore.status === 0;
  } catch {
    return null;
  }
}

export async function pullCommand(fileOrOpts?: string | PullOptions, maybeOpts?: PullOptions): Promise<void> {
  let file: string | undefined;
  let options: PullOptions;
  if (typeof fileOrOpts === 'string') {
    file = fileOrOpts;
    options = maybeOpts || {};
  } else if (maybeOpts !== undefined) {
    // Commander passes (undefined, options) when no positional file is given.
    options = maybeOpts;
  } else {
    options = fileOrOpts || {};
  }

  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  let secrets = await getSecrets(session.uid, db);

  const defaults = getDefaultScope();
  const projectFilter = options.project ?? defaults.project;
  const envFilter = options.env ?? defaults.env;

  // Filter by project and environment
  if (projectFilter) {
    const resolvedProj = await resolveProjectId(session.uid, projectFilter, db);
    const p = resolvedProj.toLowerCase();
    secrets = secrets.filter(s => s.projectId?.toLowerCase() === p);
  }
  if (envFilter) {
    const e = envFilter.toLowerCase();
    secrets = secrets.filter(s => s.environment.toLowerCase() === e);
  }

  // Active status only for .env pulls
  secrets = secrets.filter(s => s.status === 'Active');

  if (secrets.length === 0) {
    console.error(pc.yellow('No active secrets found matching specified project / environment.'));
    return;
  }

  // Unlock and decrypt
  const vault = await unlockVault(session.uid, db);

  const lines: string[] = [
    `# Exported from Scync (${new Date().toISOString()})`,
    projectFilter ? `# Project: ${projectFilter}` : '',
    envFilter ? `# Environment: ${envFilter}` : '',
    ''
  ].filter(Boolean);

  // Sort alphabetically
  secrets.sort((a, b) => a.name.localeCompare(b.name));

  // Flag names that collapse to the same environment variable key, since only
  // one of them can win when the file is parsed.
  const collisions = findEnvKeyCollisions(secrets.map(s => s.name));
  for (const [normKey, originals] of collisions) {
    console.error(
      pc.yellow(
        `⚠️  Warning: ${originals.map(n => `'${n}'`).join(', ')} all map to ${normKey}; only one value will survive.`
      )
    );
  }

  for (const s of secrets) {
    const decrypted = await decryptSecret(vault, s);
    lines.push(formatEnvLine(s.name, decrypted.value));
  }

  const content = lines.join('\n') + '\n';
  const outputPath = options.output || file;

  if (!outputPath) {
    // If running in Windows PowerShell non-TTY redirection (e.g. scync pull > .env),
    // warn on stderr because PowerShell 5.1 '>' encodes as UTF-16LE, breaking .env parsers.
    if (process.platform === 'win32' && !process.stdout.isTTY) {
      console.error(
        pc.yellow(
          'Tip: PowerShell 5.1 \'>\' redirection outputs UTF-16LE. Use \'scync pull -o .env\' or \'scync pull .env\' to write UTF-8 directly.'
        )
      );
    }
    // Write directly to stdout (clean for pipes: scync pull > .env)
    process.stdout.write(content);
    return;
  }

  // Writing to a target file
  const targetPath = path.resolve(outputPath);

  if (fs.existsSync(targetPath)) {
    const confirmed = await confirmDestructive(
      options.force
        ? `--force will overwrite the existing file '${outputPath}'. Replace it?`
        : `File '${outputPath}' already exists. Overwrite it?`,
      { yes: options.yes }
    );
    if (!confirmed) {
      warningBanner('Aborted pull. Target file was not modified.');
      return;
    }
  }

  // Check git ignore safety
  const isIgnored = checkGitIgnored(targetPath);
  if (isIgnored === false) {
    console.error(
      pc.yellow(
        `\n⚠️  WARNING: '${outputPath}' is inside a Git repository and is NOT ignored by .gitignore!\n` +
        `   Plaintext secrets could be accidentally committed. Consider adding it to .gitignore.\n`
      )
    );
  }

  // Write with owner-only permissions (0600) and explicit utf8
  fs.writeFileSync(targetPath, content, { mode: 0o600, encoding: 'utf8' });
  await logLedgerEvent(session.uid, {
    action: 'env_exported',
    title: `Exported ${secrets.length} secret(s) to ${path.basename(targetPath)}`,
    details: `${envFilter || 'all environments'}${projectFilter ? ` · ${projectFilter}` : ''}`,
  }, db);
  successBanner(`Exported ${secrets.length} secret(s) to '${outputPath}'`, [
    { key: 'Environment', val: envBadge(envFilter || 'All') },
    { key: 'File Permissions', val: 'chmod 0600 (owner-only, UTF-8)' },
    { key: 'Format', val: 'POSIX Dotenv (.env)' }
  ]);
}
