import { getValidSession } from '../../auth/session.js';
import { getVaultMeta } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AgentClient } from '../../agent/client.js';
import { AuthRequiredError } from '../errors.js';
import { renderCard, CardRow } from '../tui.js';
import { VERSION } from '../index.js';
import pc from 'picocolors';

export interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) {
    if (options.json) {
      console.log(JSON.stringify({ authenticated: false, vaultInitialized: false }));
      return;
    }
    throw new AuthRequiredError();
  }

  const db = getDb();
  const meta = await getVaultMeta(session.uid, db);
  const agentClient = new AgentClient(session.uid);
  const agentStatus = await agentClient.getStatus(500);

  if (options.json) {
    console.log(JSON.stringify({
      authenticated: true,
      uid: session.uid,
      email: session.email,
      vaultInitialized: meta !== null,
      vaultCreatedAt: meta ? meta.createdAt.toISOString() : null,
      biometricsCount: meta?.biometrics?.length || 0,
      hasRecoveryKit: !!meta?.recovery,
      agent: {
        status: agentStatus?.status || 'locked',
        ttlRemainingMs: agentStatus?.ttlRemainingMs,
        pid: agentStatus?.pid,
      }
    }, null, 2));
    return;
  }

  const rows: CardRow[] = [
    { key: 'Identity', val: `${pc.bold(session.email || session.displayName || 'User')} ${pc.dim(`(${session.uid})`)}` },
    {
      key: 'Vault State',
      val: meta
        ? `${pc.green('● Initialized')} ${pc.dim('(Zero-Knowledge AES-256-GCM)')}`
        : pc.yellow('● Not Initialized (Setup required on web)')
    }
  ];

  if (meta) {
    rows.push({ key: 'Created', val: meta.createdAt.toLocaleDateString() });
    rows.push({
      key: 'Biometrics',
      val: meta.biometrics?.length ? `${meta.biometrics.length} registered key slot(s)` : pc.dim('None')
    });
    rows.push({
      key: 'Emergency Kit',
      val: meta.recovery ? `${pc.green('● Active')} ${pc.dim('& Validated')}` : pc.dim('Not configured')
    });
  }

  if (agentStatus && agentStatus.status === 'unlocked') {
    const remainingMins = Math.ceil((agentStatus.ttlRemainingMs || 0) / 60000);
    rows.push({
      key: 'Agent Daemon',
      val: `${pc.green('● Unlocked')} ${pc.dim(`(${remainingMins}m idle TTL remaining · PID: ${agentStatus.pid})`)}`
    });
  } else {
    rows.push({
      key: 'Agent Daemon',
      val: `${pc.dim('● Locked / Inactive')} ${pc.dim('(Run \'scync unlock\' to open session)')}`
    });
  }

  renderCard({
    title: 'Scync Vault Status',
    badge: meta ? pc.green('● Healthy') : pc.yellow('● Action Required'),
    rows,
    footer: pc.dim(`Hardware Key & Biometric Auth • Scync v${VERSION}`)
  });
}
