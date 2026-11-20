import { getValidSession, sessionAuthDeadline } from '../../auth/session.js';
import { AuthRequiredError } from '../errors.js';
import { renderCard } from '../tui.js';
import pc from 'picocolors';

export interface WhoamiOptions {
  json?: boolean;
}

function formatAuthValidUntil(deadline: number): string {
  if (!Number.isFinite(deadline)) return 'no limit';
  return new Date(deadline).toLocaleString();
}

export async function whoamiCommand(options: WhoamiOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) {
    throw new AuthRequiredError();
  }

  const authDeadline = sessionAuthDeadline(session);

  if (options.json) {
    console.log(JSON.stringify({
      uid: session.uid,
      email: session.email,
      displayName: session.displayName,
      providerId: session.providerId,
      savedAt: session.savedAt,
      expiresAt: new Date(session.expiresAt).toISOString(),
      loginValidUntil: Number.isFinite(authDeadline) ? new Date(authDeadline).toISOString() : null
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
    badge: isExpired ? pc.red('● Session Expired') : pc.green('● Session Valid'),
    rows: [
      { key: 'Account', val: pc.bold(session.email || session.displayName || 'Authenticated User') },
      { key: 'Firebase UID', val: pc.dim(session.uid) },
      { key: 'Auth Provider', val: pc.cyan(session.providerId || 'google.com') },
      { key: 'Session TTL', val: statusStr },
      { key: 'Login Valid Until', val: pc.dim(formatAuthValidUntil(authDeadline)) }
    ],
    footer: pc.dim('Zero-Knowledge Secrets Platform • Scync CLI')
  });
}
