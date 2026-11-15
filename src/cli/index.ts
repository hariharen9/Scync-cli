import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { statusCommand } from './commands/status.js';
import { lsCommand } from './commands/ls.js';
import { getCommand } from './commands/get.js';
import { showCommand } from './commands/show.js';
import { pullCommand } from './commands/pull.js';
import { CliError, ExitCode } from './errors.js';
import pc from 'picocolors';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('scync')
    .description('Zero-knowledge developer secrets manager CLI')
    .version('0.1.0');

  // --- Auth Commands ---
  program
    .command('login')
    .description('Authenticate with your Firebase account (Google or Email/Password)')
    .option('--email <email>', 'Sign in using email and password')
    .option('--no-browser', 'Do not open browser automatically')
    .option('--port <port>', 'Local port for OAuth callback redirect')
    .action(async (opts) => {
      await loginCommand(opts);
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

  // --- .env Workflows ---
  program
    .command('pull')
    .alias('export')
    .description('Export secrets to .env format (stdout or file)')
    .option('-p, --project <project>', 'Filter secrets by project')
    .option('-e, --env <environment>', 'Filter secrets by environment (e.g. Development, Production)')
    .option('-o, --output <file>', 'Write output to file (default writes to stdout)')
    .option('-f, --force', 'Overwrite target file if it already exists')
    .action(async (opts) => {
      await pullCommand(opts);
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (err: any) {
    if (err instanceof CliError) {
      console.error(pc.red(`Error: ${err.message}`));
      process.exit(err.exitCode);
    } else {
      console.error(pc.red(`Unexpected error: ${err.message || err}`));
      process.exit(ExitCode.GENERAL_ERROR);
    }
  }
}
