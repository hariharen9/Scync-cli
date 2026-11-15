import { spawn } from 'node:child_process';
import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getSecrets } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { loadConfig } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import type { Environment } from '../../core/types.js';

export interface RunOptions {
  project?: string;
  env?: string;
  service?: string;
  noAgent?: boolean;
}

export async function runCommand(cmdArgs: string[], options: RunOptions = {}): Promise<void> {
  if (!cmdArgs || cmdArgs.length === 0) {
    throw new CliError(
      'Usage: scync run [options] -- <command> [args...]\nExample: scync run -e Production -- npm start',
      ExitCode.GENERAL_ERROR
    );
  }

  const session = await getValidSession();
  if (!session) {
    throw new AuthRequiredError();
  }

  const config = loadConfig();
  const project = options.project || config['default.project'];
  const env = options.env || config['default.env'];

  const db = getDb();
  let secrets = await getSecrets(session.uid, db);
  if (project) {
    secrets = secrets.filter((s) => s.projectId === project);
  }
  if (env) {
    secrets = secrets.filter((s) => s.environment === (env as Environment));
  }
  if (options.service) {
    secrets = secrets.filter((s) => s.service.toLowerCase() === options.service!.toLowerCase());
  }

  // Unlock vault (via agent if unlocked, or prompting)
  const vault = await unlockVault(session.uid, db, undefined, {
    noAgent: options.noAgent,
  });

  // Decrypt active secrets
  const injectedEnv: Record<string, string> = {};
  for (const secret of secrets) {
    if (secret.status === 'Active') {
      try {
        injectedEnv[secret.name] = await vault.decrypt(secret.encValue);
      } catch {
        // Skip un-decryptable or corrupted items
      }
    }
  }

  const [binary, ...args] = cmdArgs;
  const isCmdOrBat = typeof binary === 'string' && (binary.endsWith('.cmd') || binary.endsWith('.bat'));

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...injectedEnv,
      },
      shell: isCmdOrBat,
    });

    const forwardSigint = () => {
      try { child.kill('SIGINT'); } catch { /* ignore */ }
    };
    const forwardSigterm = () => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    };

    process.on('SIGINT', forwardSigint);
    process.on('SIGTERM', forwardSigterm);

    child.on('error', (err) => {
      process.removeListener('SIGINT', forwardSigint);
      process.removeListener('SIGTERM', forwardSigterm);
      reject(new CliError(`Failed to execute '${binary}': ${err.message}`, ExitCode.GENERAL_ERROR));
    });

    child.on('close', (code, signal) => {
      process.removeListener('SIGINT', forwardSigint);
      process.removeListener('SIGTERM', forwardSigterm);
      if (code !== null && code !== undefined) {
        process.exitCode = code;
      } else if (signal) {
        process.exitCode = 1;
      }
      resolve();
    });
  });
}
