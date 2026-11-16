import { getValidSession } from '../../auth/session.js';
import { AgentClient } from '../../agent/client.js';
import { successBanner, infoBanner } from '../tui.js';
import pc from 'picocolors';

export async function lockCommand(): Promise<void> {
  const session = await getValidSession();
  const agentClient = new AgentClient(session?.uid);

  try {
    await agentClient.lock();
    successBanner('Vault Locked', [
      { key: 'Key Custody', val: `${pc.green('Terminated')} (All in-memory master keys wiped)` },
      { key: 'Background Agent', val: 'Stopped' }
    ]);
  } catch {
    infoBanner('Vault is already locked. No active key custody session.');
  }
}
