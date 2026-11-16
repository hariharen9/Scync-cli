import { getValidSession } from '../../auth/session.js';
import { AuthRequiredError } from '../errors.js';
import { renderCard } from '../tui.js';
import pc from 'picocolors';

export interface WhoamiOptions {
  json?: boolean;
}

export async function whoamiCommand(options: WhoamiOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) {
    throw new AuthRequiredError();
  }

  if (options.json) {
    console.log(JSON.stringify({
      uid: session.uid,
      email: session.email,
      displayName: session.displayName,
      providerId: session.providerId,
      savedAt: session.savedAt,
      expiresAt: new Date(session.expiresAt).toISOString()
    }, null, 2));
    return;
  }

  const isExpired = Date.now() > session.expiresAt;
  const expiryDate = new Date(session.expiresAt).toLocaleString();
  const statusStr = isExpired
    ? pc.red('Expired')
    : pc.green('Active (Until ' + expiryDate + ')');

  renderCard({
    title: 'Scync Identity',
    badge: pc.green('● Session Valid'),
    rows: [
      { key: 'Account', val: pc.bold(session.email || session.displayName || 'Authenticated User') },
      { key: 'Firebase UID', val: pc.dim(session.uid) },
      { key: 'Auth Provider', val: pc.cyan(session.providerId || 'google.com') },
      { key: 'Session TTL', val: statusStr }
    ],
    footer: pc.dim('Zero-Knowledge Secrets Platform • Scync CLI')
  });
}
