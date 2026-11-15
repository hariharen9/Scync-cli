import { getValidSession } from '../../auth/session.js';
import { getVaultMeta } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
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

  if (options.json) {
    console.log(JSON.stringify({
      authenticated: true,
      uid: session.uid,
      email: session.email,
      vaultInitialized: meta !== null,
      vaultCreatedAt: meta ? meta.createdAt.toISOString() : null,
      biometricsCount: meta?.biometrics?.length || 0,
      hasRecoveryKit: !!meta?.recovery
    }, null, 2));
    return;
  }

  console.log(pc.bold('--- Scync Vault Status ---'));
  console.log(`Identity:         ${session.email || session.displayName} (${session.uid})`);
  console.log(`Vault Initialized: ${meta ? pc.green('Yes') : pc.yellow('No (setup required on web)')}`);
  if (meta) {
    console.log(`Created:          ${meta.createdAt.toLocaleDateString()}`);
    console.log(`Biometric Devices:${meta.biometrics?.length ? ` ${meta.biometrics.length} registered` : ' None'}`);
    console.log(`Emergency Kit:    ${meta.recovery ? pc.green('Active') : pc.dim('Not configured')}`);
  }
}
