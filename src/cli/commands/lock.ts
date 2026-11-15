import { getValidSession } from '../../auth/session.js';
import { AgentClient } from '../../agent/client.js';
import pc from 'picocolors';

export async function lockCommand(): Promise<void> {
  const session = await getValidSession();
  const agentClient = new AgentClient(session?.uid);

  try {
    await agentClient.lock();
    console.log(pc.green('✓ Vault locked. Key custody terminated.'));
  } catch {
    console.log(pc.dim('Vault is already locked.'));
  }
}
