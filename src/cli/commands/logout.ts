import { clearSession, loadSession } from '../../auth/storage.js';
import { clearAuthState } from '../../auth/persistence.js';
import { AgentClient } from '../../agent/client.js';
import { confirmDestructive } from '../confirm.js';
import { successBanner, infoBanner, warningBanner } from '../tui.js';
import pc from 'picocolors';

export interface LogoutOptions {
  yes?: boolean;
}

export async function logoutCommand(options: LogoutOptions = {}): Promise<void> {
  const session = loadSession();
  if (session?.uid) {
    const confirmed = await confirmDestructive(
      `Sign out ${session.email ? `'${session.email}'` : 'this account'}? Stored session credentials will be removed and the key agent locked.`,
      { yes: options.yes }
    );
    if (!confirmed) {
      warningBanner('Aborted logout. Session was not changed.');
      return;
    }

    const agentClient = new AgentClient(session.uid);
    try {
      await agentClient.lock();
    } catch {
      // ignore
    }
  }
  clearSession();
  clearAuthState();
  if (session) {
    successBanner('Logged Out Successfully', [
      { key: 'Account', val: session.email || session.uid },
      { key: 'Vault Status', val: `${pc.green('Locked')} ${pc.dim('(In-memory custody terminated)')}` }
    ]);
  } else {
    infoBanner('No active session was found.');
  }
}
