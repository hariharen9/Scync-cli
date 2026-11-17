import { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Only load configuration from user's global ~/.scync/.env (or SCYNC_DIR).
// NEVER load untrusted .env / .env.local from current working directory to prevent configuration hijacking.
const scyncDir = process.env.SCYNC_DIR || path.join(os.homedir(), '.scync');
const userGlobalEnv = path.join(scyncDir, '.env');
if (fs.existsSync(userGlobalEnv)) {
  dotenv.config({ path: userGlobalEnv });
}

import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { statusCommand } from './commands/status.js';
import { unlockCommand } from './commands/unlock.js';
import { lockCommand } from './commands/lock.js';
import { lsCommand } from './commands/ls.js';
import { getCommand } from './commands/get.js';
import { showCommand } from './commands/show.js';
import { pullCommand } from './commands/pull.js';
import { projectsCommand } from './commands/projects.js';
import { setCommand } from './commands/set.js';
import { updateCommand } from './commands/update.js';
import { rotateCommand } from './commands/rotate.js';
import { restoreCommand } from './commands/restore.js';
import { rmCommand } from './commands/rm.js';
import { pushCommand } from './commands/push.js';
import { runCommand } from './commands/run.js';
import { watchCommand } from './commands/watch.js';
import { configCommand } from './commands/config.js';
import { completionCommand } from './commands/completion.js';
import { totpCommand } from './commands/totp.js';
import { sshCommand } from './commands/ssh.js';
import { passwordsCommand } from './commands/passwords.js';
import { certsCommand } from './commands/certs.js';
import { runAgentDaemon } from '../agent/server.js';
import { closeFirebase } from '../core/firebase.js';
import { CliError, ExitCode } from './errors.js';
import pc from 'picocolors';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('scync')
    .description('Zero-knowledge developer secrets manager CLI')
    .version('0.1.0')
    .enablePositionalOptions();

  // --- Auth Commands ---
  program
    .command('login')
    .description('Authenticate with your Firebase account (Google or Email/Password)')
    .option('--email <email>', 'Sign in using email and password')
    .option('--no-browser', 'Do not open browser automatically')
    .option('--port <port>', 'Local port for OAuth callback redirect')
    .action(async (opts) => {
      await loginCommand({ ...opts, noBrowser: opts.browser === false });
    });

  program
    .command('logout')
    .description('Sign out and remove stored session credentials')
    .action(async () => {
      await logoutCommand();
    });

  program
    .command('whoami')
    .description('Display currently authenticated identity')
    .option('--json', 'Output details as JSON')
    .action(async (opts) => {
      await whoamiCommand(opts);
    });

  program
    .command('status')
    .description('Show vault initialization, identity, and security configuration')
    .option('--json', 'Output details as JSON')
    .action(async (opts) => {
      await statusCommand(opts);
    });

  // --- Key Custody & Agent ---
  program
    .command('unlock')
    .description('Unlock vault with master password and start background key agent')
    .option('--timeout <duration>', 'Idle timeout duration (e.g. 15m, 1h, default: 15m)')
    .option('--no-agent', 'Verify password in-process without launching background agent')
    .action(async (opts) => {
      await unlockCommand({ ...opts, noAgent: opts.agent === false });
    });

  program
    .command('lock')
    .description('Lock vault and terminate background agent key custody')
    .action(async () => {
      await lockCommand();
    });

  // --- Secret Read Commands ---
  program
    .command('ls')
    .description('List secrets with optional filtering by project, environment, or service')
    .option('-p, --project <project>', 'Filter by project ID')
    .option('-e, --env <environment>', 'Filter by environment (Development, Production, etc.)')
    .option('-s, --service <service>', 'Filter by service (AWS, Stripe, OpenAI, etc.)')
    .option('-t, --type <type>', 'Filter by secret type')
    .option('--status <status>', 'Filter by status (Active, Rotated, Expired, Revoked)')
    .option('-q, --search <term>', 'Search by secret name or service')
    .option('--json', 'Output list as JSON')
    .action(async (opts) => {
      await lsCommand(opts);
    });

  program
    .command('get <name>')
    .description('Get and decrypt a secret value by name')
    .option('-r, --reveal', 'Print plain text value to terminal (masked by default)')
    .option('-c, --copy', 'Copy value to clipboard with 30s auto-clear')
    .option('--raw', 'Print raw secret value with no decoration or newlines (for piping)')
    .option('-p, --project <project>', 'Disambiguate matching secrets by project')
    .option('-e, --env <environment>', 'Disambiguate matching secrets by environment')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .option('--json', 'Output secret as JSON')
    .action(async (name, opts) => {
      await getCommand(name, opts);
    });

  program
    .command('show <name>')
    .description('Show secret metadata, status, notes, and version history')
    .option('-r, --reveal', 'Reveal decrypted value and notes')
    .option('-p, --project <project>', 'Disambiguate matching secrets by project')
    .option('-e, --env <environment>', 'Disambiguate matching secrets by environment')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .option('--json', 'Output details as JSON')
    .action(async (name, opts) => {
      await showCommand(name, opts);
    });

  // --- Secret Write Commands ---
  program
    .command('set <name>')
    .description('Create a new secret (or update if already exists)')
    .option('-v, --value <value>', 'Secret value (warning: leaks to process list; prefer stdin/prompt)')
    .option('-F, --file <file>', 'Read secret value from file')
    .option('-s, --service <service>', 'Service name (AWS, Stripe, OpenAI, etc.)')
    .option('-t, --type <type>', 'Secret type (API Key, Database URL, etc.)')
    .option('-e, --env <environment>', 'Environment (default: Development)')
    .option('--status <status>', 'Secret status (default: Active)')
    .option('-p, --project <project>', 'Associated project ID')
    .option('--notes <notes>', 'Optional plaintext note')
    .option('--expires <date>', 'Expiry date (YYYY-MM-DD)')
    .option('-f, --force', 'Force overwrite and bypass concurrency conflict safety')
    .option('-y, --yes', 'Skip confirmation prompt if secret already exists (preserves concurrency safety)')
    .action(async (name, opts) => {
      await setCommand(name, opts);
    });

  program
    .command('update <name>')
    .alias('edit')
    .description('Update secret value and/or metadata of an existing secret')
    .option('-v, --value <value>', 'New secret value')
    .option('-F, --file <file>', 'Read new secret value from file')
    .option('-s, --service <service>', 'Update service name')
    .option('-t, --type <type>', 'Update secret type')
    .option('-e, --env <environment>', 'Target environment')
    .option('--status <status>', 'Update status (Active, Rotated, Expired, Revoked)')
    .option('-p, --project <project>', 'Target project ID')
    .option('--notes <notes>', 'Update note')
    .option('--expires <date>', 'Update expiry date')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .option('-f, --force', 'Override optimistic concurrency check')
    .action(async (name, opts) => {
      await updateCommand(name, opts);
    });

  program
    .command('rotate <name>')
    .description('Rotate a secret with a new value and record rotation timestamp')
    .option('-v, --value <value>', 'New rotated secret value')
    .option('-F, --file <file>', 'Read new rotated secret value from file')
    .option('-p, --project <project>', 'Disambiguate matching secrets by project')
    .option('-e, --env <environment>', 'Disambiguate matching secrets by environment')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .option('-f, --force', 'Override optimistic concurrency check')
    .action(async (name, opts) => {
      await rotateCommand(name, opts);
    });

  program
    .command('restore <name> <version>')
    .description('Restore a secret to a previous version from its history')
    .option('-p, --project <project>', 'Disambiguate matching secrets by project')
    .option('-e, --env <environment>', 'Disambiguate matching secrets by environment')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .action(async (name, version, opts) => {
      await restoreCommand(name, version, opts);
    });

  program
    .command('rm <name>')
    .alias('delete')
    .description('Delete a secret from the vault')
    .option('-p, --project <project>', 'Disambiguate matching secrets by project')
    .option('-e, --env <environment>', 'Disambiguate matching secrets by environment')
    .option('--id <id>', 'Disambiguate matching secrets by exact document ID')
    .option('-f, --force', 'Skip delete confirmation prompt')
    .action(async (name, opts) => {
      await rmCommand(name, opts);
    });

  // --- .env Workflows ---
  program
    .command('pull [file]')
    .alias('export')
    .description('Export secrets to .env format (stdout or file)')
    .option('-p, --project <project>', 'Filter secrets by project')
    .option('-e, --env <environment>', 'Filter secrets by environment (e.g. Development, Production)')
    .option('-o, --output <file>', 'Write output to file (default writes to stdout)')
    .option('-f, --force', 'Overwrite target file if it already exists')
    .action(async (file, opts) => {
      await pullCommand(file, opts);
    });

  program
    .command('projects')
    .description('List all available vault projects with secret counts')
    .option('--json', 'Output projects as JSON')
    .action(async (opts) => {
      await projectsCommand(opts);
    });

  program
    .command('push [file]')
    .alias('import')
    .description('Import secrets from a .env file into the vault')
    .option('-p, --project <project>', 'Assign imported secrets to project')
    .option('-e, --env <environment>', 'Target environment (default: Development)')
    .option('-s, --service <service>', 'Override service name for all imported secrets')
    .option('-t, --type <type>', 'Secret type (default: Secret Key)')
    .option('--overwrite', 'Overwrite existing secrets with matching names in target environment')
    .option('--dry-run', 'Preview changes without modifying the vault')
    .option('-f, --force', 'Bypass optimistic concurrency checks when overwriting')
    .action(async (file, opts) => {
      await pushCommand(file, opts);
    });

  // --- Process & Sync Workflows ---
  program
    .command('run [cmd...]')
    .description('Run a command with secrets injected into its environment without writing to disk')
    .option('-p, --project <project>', 'Filter secrets by project')
    .option('-e, --env <environment>', 'Filter secrets by environment (Development, Staging, Production, Testing)')
    .option('--service <service>', 'Filter secrets by service')
    .option('--no-agent', 'Do not use background agent for key custody')
    .passThroughOptions()
    .action(async (cmd, opts) => {
      await runCommand(cmd, { ...opts, noAgent: opts.agent === false });
    });

  program
    .command('watch')
    .description('Stream real-time updates when secrets are added, modified, or removed')
    .option('-p, --project <project>', 'Filter by project')
    .option('-e, --env <environment>', 'Filter by environment')
    .option('--service <service>', 'Filter by service')
    .option('--reveal', 'Decrypt and show plaintext values on change')
    .option('--no-agent', 'Do not use background agent')
    .action(async (opts) => {
      await watchCommand({ ...opts, noAgent: opts.agent === false });
    });

  // --- Configuration & Shell ---
  program
    .command('config [action] [key] [value]')
    .description('Manage local CLI configuration (list, get, set, unset)')
    .action(async (action, key, value) => {
      await configCommand(action, key, value);
    });

  program
    .command('completion [shell]')
    .description('Generate shell autocompletion script (bash, zsh, fish, powershell)')
    .action(async (shell) => {
      await completionCommand(shell);
    });

  // --- Specialized Secret Types ---
  program
    .command('totp [name]')
    .description('Generate or list TOTP two-factor authentication codes')
    .option('-c, --copy', 'Copy generated code to clipboard (auto-clears in 30s)')
    .option('--json', 'Output details as JSON')
    .option('--no-agent', 'Do not use background agent')
    .action(async (name, opts) => {
      await totpCommand(name, { ...opts, noAgent: opts.agent === false });
    });

  program
    .command('ssh [action] [name]')
    .description('Manage vaulted SSH keys (ls, get, export, config)')
    .option('--private', 'Retrieve or print private key')
    .option('--dir <directory>', 'Target directory for exported keys (default: ~/.ssh)')
    .option('--json', 'Output details as JSON')
    .option('--no-agent', 'Do not use background agent')
    .action(async (action, name, opts) => {
      await sshCommand(action, name, { ...opts, noAgent: opts.agent === false });
    });

  program
    .command('passwords [query]')
    .alias('pass')
    .description('Search and look up stored passwords (read-only)')
    .option('-r, --reveal', 'Display plaintext password')
    .option('-c, --copy', 'Copy password to clipboard (auto-clears in 30s)')
    .option('--json', 'Output details as JSON')
    .option('--no-agent', 'Do not use background agent')
    .action(async (query, opts) => {
      await passwordsCommand(query, { ...opts, noAgent: opts.agent === false });
    });

  program
    .command('certs [query]')
    .alias('certificates')
    .description('Inspect vaulted SSL/TLS certificates (read-only)')
    .option('--reveal-key', 'Decrypt and display private key PEM if stored')
    .option('--json', 'Output details as JSON')
    .option('--no-agent', 'Do not use background agent')
    .action(async (query, opts) => {
      await certsCommand(query, { ...opts, noAgent: opts.agent === false });
    });

  // --- Internal Daemon ---
  program
    .command('_agent-daemon', { hidden: true })
    .option('--uid <uid>', 'User ID')
    .option('--timeout <ms>', 'Idle timeout ms')
    .action(async (opts) => {
      await runAgentDaemon({
        uid: opts.uid,
        idleTimeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
      });
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);

    // One-shot commands terminate background Firestore streams and exit cleanly
    const cmd = argv[2];
    if (!cmd || !['watch', '_agent-daemon'].includes(cmd)) {
      await closeFirebase();
    }
  } catch (err: any) {
    try {
      await closeFirebase();
    } catch (_) {}
    if (err instanceof CliError) {
      console.error(`${pc.red('✖ Error:')} ${err.message}`);
      process.exit(err.exitCode);
    } else {
      console.error(`${pc.red('✖ Unexpected error:')} ${err.message || err}`);
      process.exit(ExitCode.GENERAL_ERROR);
    }
  }
}
