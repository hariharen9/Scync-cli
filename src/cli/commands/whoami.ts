import { getValidSession } from '../../auth/session.js';
import { AuthRequiredError } from '../errors.js';
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

  console.log(`${pc.bold('Signed in as:')}  ${session.email || session.displayName || 'User'}`);
  console.log(`${pc.bold('Firebase UID:')}  ${session.uid}`);
  console.log(`${pc.bold('Auth Provider:')} ${session.providerId}`);
  console.log(`${pc.bold('Session Valid:')} Until ${new Date(session.expiresAt).toLocaleString()}`);
}
