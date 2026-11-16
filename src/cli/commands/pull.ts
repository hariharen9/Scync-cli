import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getValidSession } from '../../auth/session.js';
import { getSecrets, decryptSecret, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError } from '../errors.js';
import { formatEnvLine } from '../../utils/env.js';
import { promptConfirm } from '../prompts.js';
import pc from 'picocolors';

export interface PullOptions {
  project?: string;
  env?: string;
  output?: string;
  force?: boolean;
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
  } else {
    options = fileOrOpts || {};
  }

  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  let secrets = await getSecrets(session.uid, db);

  // Filter by project and environment
  if (options.project) {
    const resolvedProj = await resolveProjectId(session.uid, options.project, db);
    const p = resolvedProj.toLowerCase();
    secrets = secrets.filter(s => s.projectId?.toLowerCase() === p);
  }
  if (options.env) {
    const e = options.env.toLowerCase();
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
    options.project ? `# Project: ${options.project}` : '',
    options.env ? `# Environment: ${options.env}` : '',
    ''
  ].filter(Boolean);

  // Sort alphabetically
  secrets.sort((a, b) => a.name.localeCompare(b.name));

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

  if (fs.existsSync(targetPath) && !options.force) {
    const overwrite = await promptConfirm(`File '${outputPath}' already exists. Overwrite?`, false);
    if (!overwrite) {
      console.error(pc.yellow('Aborted pull. Target file was not modified.'));
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
  console.error(pc.green(`✓ Exported ${secrets.length} secrets to '${outputPath}' (mode: 0600, UTF-8)`));
}
