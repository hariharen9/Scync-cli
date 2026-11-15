import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getVaultMeta } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { AgentClient } from '../../agent/client.js';
import { promptPassword } from '../prompts.js';
import { loadConfig, parseDurationMs } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import pc from 'picocolors';

export interface UnlockOptions {
  timeout?: string;
  noAgent?: boolean;
}

export async function unlockCommand(options: UnlockOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) {
    throw new AuthRequiredError();
  }

  const agentClient = new AgentClient(session.uid);

  // Check if agent is already running and unlocked
  if (!options.noAgent) {
    const status = await agentClient.getStatus();
    if (status && status.status === 'unlocked') {
      const remainingMins = Math.ceil((status.ttlRemainingMs || 0) / 60000);
      console.log(
        pc.green(`✓ Vault is already unlocked. Agent active (${remainingMins}m idle TTL remaining).`)
      );
      return;
    }
  }

  // Get master password
  const password = await promptPassword('Enter vault master password: ');
  if (!password) {
    throw new CliError('Master password cannot be empty.', ExitCode.VAULT_LOCKED);
  }

  const config = loadConfig();
  const timeoutStr = options.timeout || config['agent.timeout'] || '15m';
  const timeoutMs = parseDurationMs(timeoutStr, 15 * 60 * 1000);

  const db = getDb();
  const meta = await getVaultMeta(session.uid, db);
  if (!meta) {
    throw new CliError(
      'Vault is not initialized. Please set up your vault on the Scync web app first.',
      ExitCode.GENERAL_ERROR
    );
  }

  // Perform unlock
  await unlockVault(session.uid, db, password, {
    noAgent: options.noAgent,
    idleTimeoutMs: timeoutMs,
  });

  if (options.noAgent) {
    console.log(pc.green('✓ Vault master password verified (in-process only, agent disabled).'));
  } else {
    console.log(
      pc.green(`✓ Vault unlocked. Background agent active (idle timeout: ${timeoutStr}).`)
    );
  }
}
