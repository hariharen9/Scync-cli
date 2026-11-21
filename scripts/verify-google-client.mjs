/**
 * Fails when a release build is about to ship without the Google OAuth client.
 *
 * The client cannot live in the repo (GitHub push protection blocks it), so it
 * is injected from repository secrets. A missing secret would silently publish
 * a CLI where Google sign-in does not work.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.resolve(here, '../src/generated/google-client.ts');

if (!fs.existsSync(generated)) {
  console.error('[verify-google-client] src/generated/google-client.ts is missing. Run the build first.');
  process.exit(1);
}

const source = fs.readFileSync(generated, 'utf8');
const idMatch = source.match(/BUNDLED_GOOGLE_CLIENT_ID = (".*")/);
const secretMatch = source.match(/BUNDLED_GOOGLE_CLIENT_SECRET = (".*")/);

const clientId = idMatch ? JSON.parse(idMatch[1]) : '';
const clientSecret = secretMatch ? JSON.parse(secretMatch[1]) : '';

if (!clientId || !clientSecret) {
  console.error(
    '[verify-google-client] The bundled Google client is empty. Set the SCYNC_GOOGLE_CLIENT_ID and ' +
      'SCYNC_GOOGLE_CLIENT_SECRET repository secrets before publishing.'
  );
  process.exit(1);
}

console.log('[verify-google-client] Bundled Google client present.');
