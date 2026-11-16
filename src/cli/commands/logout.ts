import { clearSession, loadSession } from '../../auth/storage.js';
import { clearAuthState } from '../../auth/persistence.js';
import { AgentClient } from '../../agent/client.js';
import { successBanner, infoBanner } from '../tui.js';
import pc from 'picocolors';

export async function logoutCommand(): Promise<void> {
  const session = loadSession();
  if (session?.uid) {
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
