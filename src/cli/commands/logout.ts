import { clearSession, loadSession } from '../../auth/storage.js';
import pc from 'picocolors';

export async function logoutCommand(): Promise<void> {
  const session = loadSession();
  clearSession();
  if (session) {
    console.log(pc.green(`✓ Successfully logged out from ${session.email || session.uid}.`));
  } else {
    console.log(pc.dim('No active session was found.'));
  }
}
