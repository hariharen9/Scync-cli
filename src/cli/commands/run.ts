import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getSecrets, resolveProjectId } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { loadConfig } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import type { Environment } from '../../core/types.js';
import pc from 'picocolors';

export interface RunOptions {
  project?: string;
  env?: string;
  service?: string;
  noAgent?: boolean;
}

const PROTECTED_ENV_VARS = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'SHELL',
  'TERM',
]);

function resolveBinary(binary: string): { executable: string; useShell: boolean } {
  if (process.platform !== 'win32') {
    return { executable: binary, useShell: false };
  }
  const ext = path.extname(binary).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return { executable: binary, useShell: true };
  }
  if (ext === '.exe') {
    return { executable: binary, useShell: false };
  }

  // Look up PATH and PATHEXT on Windows
  const pathExts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.toLowerCase());
  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  for (const dir of pathDirs) {
    for (const pe of pathExts) {
      const candidate = path.join(dir, binary + pe);
      try {
        if (fs.existsSync(candidate)) {
          const isShell = pe === '.cmd' || pe === '.bat';
          return { executable: candidate, useShell: isShell };
        }
      } catch {}
    }
  }
  return { executable: binary, useShell: false };
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
  const rawProject = options.project || config['default.project'];
  const env = options.env || config['default.env'];

  const db = getDb();
  let secrets = await getSecrets(session.uid, db);

  if (rawProject) {
    const resolvedProj = await resolveProjectId(session.uid, rawProject, db);
    const p = resolvedProj.toLowerCase();
    secrets = secrets.filter((s) => s.projectId?.toLowerCase() === p);
  }
  if (env) {
    secrets = secrets.filter((s) => s.environment.toLowerCase() === (env as string).toLowerCase());
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
        const val = await vault.decrypt(secret.encValue);
        const upper = secret.name.toUpperCase();
        if (PROTECTED_ENV_VARS.has(upper)) {
          console.error(pc.yellow(`⚠️  Warning: Secret '${secret.name}' collides with critical system variable '${upper}'. Skipping injection to protect environment.`));
        } else {
          injectedEnv[secret.name] = val;
        }
      } catch (err: any) {
        console.error(pc.yellow(`⚠️  Warning: Failed to decrypt secret '${secret.name}': ${err.message}`));
      }
    }
  }

  const [rawBinary, ...args] = cmdArgs;
  const { executable, useShell } = resolveBinary(rawBinary);

  // Cleanse child environment: internal Scync master password must NEVER leak to the application process
  const childEnv = { ...process.env };
  delete childEnv.SCYNC_MASTER_PASSWORD;
  Object.assign(childEnv, injectedEnv);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'inherit',
      env: childEnv,
      shell: useShell,
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
