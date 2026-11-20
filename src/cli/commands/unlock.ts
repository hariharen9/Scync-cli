import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getVaultMeta } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { AgentClient } from '../../agent/client.js';
import { promptMasterPassword } from '../prompts.js';
import { loadConfig, parseDurationMs } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { renderCard, successBanner, infoBanner, warningBanner } from '../tui.js';
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
      infoBanner('Vault is already unlocked', [
        { key: 'Agent Status', val: `${pc.green('● Active')} (PID: ${status.pid})` },
        { key: 'Idle TTL', val: `${remainingMins} minute(s) remaining` }
      ]);
      return;
    }
  }

  // Get master password
  const password = await promptMasterPassword('Enter vault master password: ');
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
      'No vault found for this account. Create one at https://scync.space/app, then run scync unlock again.',
      ExitCode.GENERAL_ERROR
    );
  }

  // Perform unlock
  await unlockVault(session.uid, db, password, {
    noAgent: options.noAgent,
    idleTimeoutMs: timeoutMs,
  });

  if (options.noAgent) {
    successBanner('Vault Master Password Verified', [
      { key: 'Session Type', val: 'In-process only (agent disabled)' },
      { key: 'Encryption', val: 'AES-256-GCM / PBKDF2' }
    ]);
  } else {
    const agentStatus = await agentClient.getStatus(1000);
    if (!agentStatus || agentStatus.status !== 'unlocked') {
      warningBanner('Key verified, but the background agent is not running.', [
        { key: 'Custody', val: 'In-process session only (key is discarded when this command exits)' },
        { key: 'Next Step', val: 'Re-run with agent support, or set SCYNC_NO_AGENT=1 to silence this' }
      ]);
      return;
    }
    renderCard({
      title: 'Scync Vault Session',
      badge: pc.green('● Unlocked'),
      rows: [
        { key: 'Status', val: `${pc.green('● Unlocked')} & Ready` },
        { key: 'Custody', val: 'Background Agent Daemon' },
        { key: 'Idle TTL', val: `${timeoutStr} (auto-locks on inactivity)` },
        { key: 'Security', val: 'AES-256-GCM (Zero-Knowledge)' }
      ],
      footer: pc.dim('Run \'scync lock\' anytime to immediately purge in-memory keys')
    });
  }
}
