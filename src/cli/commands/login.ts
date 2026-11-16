import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { getAuthInstance, DEFAULT_CONFIG } from '../../core/firebase.js';
import { createSessionFromUser } from '../../auth/session.js';
import { loginWithGoogleLoopback } from '../../auth/loopback.js';
import { promptPassword, promptText } from '../prompts.js';
import { CliError, ExitCode } from '../errors.js';
import { renderCard, infoBanner } from '../tui.js';
import pc from 'picocolors';

export interface LoginOptions {
  email?: string;
  noBrowser?: boolean;
  port?: string;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const auth = getAuthInstance();

  if (options.email) {
    // Email / Password Flow
    const email = options.email.trim().toLowerCase();
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
    const clientId = process.env.SCYNC_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.SCYNC_GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET || '';
    if (!clientId) {
      console.log(pc.yellow('Notice: Google OAuth Client ID is not configured.'));
      console.log('For Google browser sign-in, add your OAuth 2.0 Client ID (from Google Cloud Console > Credentials) to .env.local:');
      console.log(pc.dim('  SCYNC_GOOGLE_CLIENT_ID=xxxxxx.apps.googleusercontent.com\n'));
      console.log('Alternatively, sign in with Email & Password:');
      console.log(pc.cyan('  node bin/scync.js login --email <your-email>\n'));
      
      const email = await promptText('Enter your email to sign in: ');
      if (!email) return;
      return loginCommand({ ...options, email });
    }

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
      throw new CliError(`Google sign-in failed: ${err.message}`, ExitCode.AUTH_REQUIRED);
    }
  }
}
