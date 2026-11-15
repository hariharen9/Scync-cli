import { clearSession, loadSession } from '../../auth/storage.js';
import { clearAuthState } from '../../auth/persistence.js';
import { AgentClient } from '../../agent/client.js';
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
    console.log(pc.green(`✓ Successfully logged out from ${session.email || session.uid}. Vault locked.`));
  } else {
    console.log(pc.dim('No active session was found.'));
  }
}
