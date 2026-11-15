import { signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { getAuthInstance, DEFAULT_CONFIG } from '../../core/firebase.js';
import { createSessionFromUser } from '../../auth/session.js';
import { loginWithGoogleLoopback } from '../../auth/loopback.js';
import { promptPassword, promptText } from '../prompts.js';
import { CliError, ExitCode } from '../errors.js';
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
      console.log(pc.green(`✓ Signed in successfully as ${session.email}`));
      console.log(pc.dim(`  UID: ${session.uid}`));
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        throw new CliError('Invalid email or password.', ExitCode.AUTH_REQUIRED);
      }
      throw new CliError(`Authentication failed: ${err.message}`, ExitCode.AUTH_REQUIRED);
    }
  } else {
    // Google OAuth Flow
    const clientId = process.env.SCYNC_GOOGLE_CLIENT_ID || DEFAULT_CONFIG.appId || '';
    if (!clientId) {
      console.log(pc.yellow('Notice: Google OAuth Client ID is not configured.'));
      console.log('You can sign in with Email & Password using:');
      console.log(pc.cyan('  scync login --email your-email@example.com\n'));
      
      const email = await promptText('Enter your email to sign in: ');
      if (!email) return;
      return loginCommand({ ...options, email });
    }

    console.log(pc.dim('Starting browser authentication...'));
    try {
      const tokens = await loginWithGoogleLoopback({
        clientId,
        openBrowser: !options.noBrowser,
        port: options.port ? parseInt(options.port, 10) : undefined
      });

      const credential = GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
      const cred = await signInWithCredential(auth, credential);
      const session = await createSessionFromUser(cred.user, 'google.com');

      console.log(pc.green(`✓ Signed in successfully as ${session.email || session.displayName || 'Google User'}`));
      console.log(pc.dim(`  UID: ${session.uid}`));
    } catch (err: any) {
      throw new CliError(`Google sign-in failed: ${err.message}`, ExitCode.AUTH_REQUIRED);
    }
  }
}
