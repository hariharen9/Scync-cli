import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import open from 'open';

export interface OAuthTokens {
  idToken: string;
  accessToken: string;
}

export interface LoopbackOptions {
  clientId: string;
  clientSecret?: string;
  port?: number;
  openBrowser?: boolean;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scync CLI — Sign-in Complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 32px 40px; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #10b981; font-size: 20px; margin-bottom: 8px; font-weight: 600; }
    p { color: #a1a1aa; font-size: 14px; margin-bottom: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Signed In to Scync</h1>
    <p>Authentication was successful. You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;

export async function loginWithGoogleLoopback(opts: LoopbackOptions): Promise<OAuthTokens> {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const preferredPort = opts.port || 8234;

  return new Promise((resolve, reject) => {
    let server: http.Server;
    let isClosed = false;

    const safeClose = () => {
      if (!isClosed) {
        isClosed = true;
        clearTimeout(timeout);
        try {
          server.close();
        } catch (_) {}
      }
    };

    const timeout = setTimeout(() => {
      safeClose();
      reject(new Error('Authentication timed out after 120 seconds.'));
    }, 120_000);

    server = http.createServer(async (req, res) => {
      try {
        if (!req.url) return;
        const reqUrl = new URL(req.url, `http://127.0.0.1:${preferredPort}`);

        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code');
          const returnedState = reqUrl.searchParams.get('state');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(`Authentication error: ${error}`);
            safeClose();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('State mismatch error.');
            safeClose();
            reject(new Error('OAuth state mismatch. Potential CSRF detected.'));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing authorization code.');
            safeClose();
            reject(new Error('Missing authorization code in callback.'));
            return;
          }

          // Return success response to browser
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(SUCCESS_HTML);

          safeClose();

          // Exchange authorization code for tokens
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : preferredPort;
          const redirectUri = `http://127.0.0.1:${port}/callback`;

          const bodyParams: Record<string, string> = {
            code,
            client_id: opts.clientId,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier
          };

          if (opts.clientSecret) {
            bodyParams.client_secret = opts.clientSecret;
          }

          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(bodyParams).toString()
          });

          if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            reject(new Error(`Failed to exchange authorization code: ${errBody}`));
            return;
          }

          const tokenData = await tokenRes.json() as {
            id_token: string;
            access_token: string;
          };

          resolve({
            idToken: tokenData.id_token,
            accessToken: tokenData.access_token
          });
        }
      } catch (err) {
        safeClose();
        reject(err);
      }
    });

    server.listen(preferredPort, '127.0.0.1', async () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : preferredPort;
      const redirectUri = `http://127.0.0.1:${actualPort}/callback`;

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', opts.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('prompt', 'select_account');

      const urlString = authUrl.toString();

      if (opts.openBrowser !== false) {
        try {
          await open(urlString);
          console.log('Opened your browser for Google authentication.');
          console.log(`If it did not open automatically, visit:\n  ${urlString}\n`);
        } catch {
          console.log(`Please visit the following URL in your browser to sign in:\n  ${urlString}\n`);
        }
      } else {
        console.log(`Please visit the following URL in your browser to sign in:\n  ${urlString}\n`);
      }
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        // Try ephemeral port if preferred is taken
        server.listen(0, '127.0.0.1');
      } else {
        safeClose();
        reject(err);
      }
    });
  });
}
