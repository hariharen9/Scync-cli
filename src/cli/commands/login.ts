import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { getAuthInstance, getGoogleClientConfig } from '../../core/firebase.js';
import { createSessionFromUser } from '../../auth/session.js';
import { loginWithGoogleLoopback } from '../../auth/loopback.js';
import { promptPassword } from '../prompts.js';
import { CliError, ExitCode } from '../errors.js';
import { renderCard, infoBanner } from '../tui.js';
import pc from 'picocolors';

export interface LoginOptions {
  email?: string;
  google?: boolean;
  noBrowser?: boolean;
  port?: string;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const auth = getAuthInstance();
  const { clientId, clientSecret } = getGoogleClientConfig();

  // Google unless email/password was explicitly requested. The bundled desktop
  // client means this works on a fresh install with no configuration.
  const useGoogle = !options.email;

  if (useGoogle && !clientId) {
    throw new CliError(
      'Google sign-in is not configured for this install. ' +
        'Use email/password instead: scync login --email you@example.com',
      ExitCode.GENERAL_ERROR
    );
  }

  if (!useGoogle) {
    // Email / Password Flow
    const email = (options.email ?? '').trim().toLowerCase();
    if (!email) {
      throw new CliError(
        'Provide your account email: scync login --email you@example.com',
        ExitCode.GENERAL_ERROR
      );
    }
    const password = await promptPassword(`Password for ${email}: `);

    if (!password) {
      throw new CliError('Password cannot be empty.', ExitCode.GENERAL_ERROR);
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const session = await createSessionFromUser(cred.user, 'password');
      renderCard({
        title: 'Scync Authentication',
        badge: pc.green('● Authorized'),
        rows: [
          { key: 'Account', val: pc.bold(session.email || 'User') },
          { key: 'Provider', val: pc.cyan('Email / Password') },
          { key: 'Firebase UID', val: pc.dim(session.uid) }
        ],
        footer: pc.dim('Session credentials stored in global configuration')
      });
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        throw new CliError('Invalid email or password.', ExitCode.AUTH_REQUIRED);
      }
      throw new CliError(`Authentication failed: ${err.message}`, ExitCode.AUTH_REQUIRED);
    }
  } else {
    // Google OAuth Flow
    infoBanner('Initiating browser authorization...', [
      { key: 'Method', val: 'Google OAuth 2.0 PKCE' },
      { key: 'Callback', val: options.port ? `http://localhost:${options.port}/callback` : 'Auto-selected loopback port' }
    ]);

    try {
      const tokens = await loginWithGoogleLoopback({
        clientId,
        clientSecret,
        openBrowser: !options.noBrowser,
        port: options.port ? parseInt(options.port, 10) : undefined
      });

      const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
      const cred = await signInWithCredential(auth, credential);
      const session = await createSessionFromUser(cred.user, 'google.com');

      renderCard({
        title: 'Scync Authentication',
        badge: pc.green('● Authorized'),
        rows: [
          { key: 'Account', val: pc.bold(session.email || session.displayName || 'Google User') },
          { key: 'Provider', val: pc.cyan('Google (OAuth 2.0)') },
          { key: 'Firebase UID', val: pc.dim(session.uid) }
        ],
        footer: pc.dim('Zero-Knowledge Secrets Platform • Scync CLI')
      });
    } catch (err: any) {
      const detail = String(err?.message ?? err);
      if (/invalid_client|client_secret|redirect_uri_mismatch/i.test(detail)) {
        throw new CliError(
          `Google sign-in is unavailable (${detail}). Use email/password instead: scync login --email <you@example.com>`,
          ExitCode.AUTH_REQUIRED
        );
      }
      throw new CliError(`Google sign-in failed: ${detail}`, ExitCode.AUTH_REQUIRED);
    }
  }
}
