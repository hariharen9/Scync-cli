import { getValidSession } from '../../auth/session.js';
import { AgentClient } from '../../agent/client.js';
import { successBanner, infoBanner } from '../tui.js';
import pc from 'picocolors';

export async function lockCommand(): Promise<void> {
  const session = await getValidSession();
  const agentClient = new AgentClient(session?.uid);

  const status = await agentClient.getStatus(600);
  if (!status) {
    infoBanner('Vault is already locked. No active key custody session.');
    return;
  }
  if (status.status === 'locked') {
    infoBanner('Key custody is already empty; stopping the idle agent daemon.');
  }

  await agentClient.lock();
  successBanner('Vault Locked', [
    { key: 'Key Custody', val: `${pc.green('Terminated')} (All in-memory master keys wiped)` },
    { key: 'Background Agent', val: 'Stopped' }
  ]);
}
