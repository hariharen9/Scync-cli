import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, type Firestore, connectFirestoreEmulator } from 'firebase/firestore';
import { FilePersistence } from '../auth/persistence.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Only load configuration from user's global ~/.scync/.env (or SCYNC_DIR).
// NEVER load untrusted .env / .env.local from current working directory to prevent configuration hijacking.
const scyncDir = process.env.SCYNC_DIR || path.join(os.homedir(), '.scync');
const userGlobalEnv = path.join(scyncDir, '.env');
if (fs.existsSync(userGlobalEnv)) {
  dotenv.config({ path: userGlobalEnv });
}

/**
 * Public configuration for the hosted Scync backend.
 *
 * Firebase web config is not a secret — it ships in every browser that loads
 * the web app. It identifies the project; it does not grant access. Real
 * authorization comes from Firebase Auth, and real confidentiality comes from
 * the zero-knowledge vault encryption.
 *
 * Self-hosters override any field with `SCYNC_FIREBASE_*` variables (see
 * `getDefaultConfig`) without editing code.
 */
export const HOSTED_CONFIG = {
  apiKey: 'AIzaSyDubqBg3OWE9uwTKZI_tQpVF7CK7J3d2xo',
  authDomain: 'scync-app.firebaseapp.com',
  projectId: 'scync-app',
  storageBucket: 'scync-app.firebasestorage.app',
  messagingSenderId: '989519172211',
  appId: '1:989519172211:web:bfd70bddc93b0705991006',
} as const;

/**
 * Google OAuth client used for the loopback (PKCE) sign-in flow. This is a
 * public client identifier, not a secret. No client secret is bundled: the
 * flow uses PKCE and loopback redirects, which native/desktop clients support.
 */
export const HOSTED_GOOGLE_CLIENT_ID =
  '989519172211-88ofu9b12okrf7q01d59v245vq9pit5b.apps.googleusercontent.com';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  useEmulators?: boolean;
  authEmulatorUrl?: string;
  firestoreEmulatorHost?: string;
  firestoreEmulatorPort?: number;
}

export function getDefaultConfig(): FirebaseClientConfig {
  return {
    apiKey: process.env.SCYNC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || HOSTED_CONFIG.apiKey,
    authDomain:
      process.env.SCYNC_FIREBASE_AUTH_DOMAIN ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      HOSTED_CONFIG.authDomain,
    projectId:
      process.env.SCYNC_FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      HOSTED_CONFIG.projectId,
    storageBucket:
      process.env.SCYNC_FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      HOSTED_CONFIG.storageBucket,
    messagingSenderId:
      process.env.SCYNC_FIREBASE_MESSAGING_SENDER_ID ||
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      HOSTED_CONFIG.messagingSenderId,
    appId: process.env.SCYNC_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || HOSTED_CONFIG.appId,
    useEmulators: process.env.SCYNC_USE_EMULATORS === 'true' || process.env.VITE_USE_EMULATORS === 'true',
    authEmulatorUrl: process.env.SCYNC_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099',
    firestoreEmulatorHost: process.env.SCYNC_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
    firestoreEmulatorPort: Number(process.env.SCYNC_FIRESTORE_EMULATOR_PORT || 8080)
  };
}

export function getGoogleClientConfig(): { clientId: string; clientSecret: string } {
  return {
    clientId:
      process.env.SCYNC_GOOGLE_CLIENT_ID ||
      process.env.VITE_GOOGLE_CLIENT_ID ||
      HOSTED_GOOGLE_CLIENT_ID,
    clientSecret: process.env.SCYNC_GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET || '',
  };
}

/** True when talking to the shared hosted Scync project rather than a self-host. */
export function isHostedBackend(config: FirebaseClientConfig = getDefaultConfig()): boolean {
  return config.projectId === HOSTED_CONFIG.projectId;
}

export const DEFAULT_CONFIG: FirebaseClientConfig = getDefaultConfig();

let currentApp: FirebaseApp | null = null;
let currentAuth: Auth | null = null;
let currentDb: Firestore | null = null;

export function initFirebase(config: Partial<FirebaseClientConfig> = {}): {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
} {
  const merged = { ...getDefaultConfig(), ...config };
  
  const app = getApps().length === 0
    ? initializeApp({
        apiKey: merged.apiKey,
        authDomain: merged.authDomain,
        projectId: merged.projectId,
        storageBucket: merged.storageBucket,
        messagingSenderId: merged.messagingSenderId,
        appId: merged.appId
      })
    : getApp();

  let auth: Auth;
  try {
    auth = initializeAuth(app, {
      persistence: [FilePersistence as any]
    });
  } catch (_) {
    auth = getAuth(app);
  }

  const db = getFirestore(app);

  if (merged.useEmulators) {
    try {
      connectAuthEmulator(auth, merged.authEmulatorUrl || 'http://127.0.0.1:9099', { disableWarnings: true });
    } catch (_) {
      // already connected
    }
    try {
      connectFirestoreEmulator(db, merged.firestoreEmulatorHost || '127.0.0.1', merged.firestoreEmulatorPort || 8080);
    } catch (_) {
      // already connected
    }
  }

  currentApp = app;
  currentAuth = auth;
  currentDb = db;

  return { app, auth, db };
}

export function getDb(): Firestore {
  if (!currentDb) {
    return initFirebase().db;
  }
  return currentDb;
}

export function getAuthInstance(): Auth {
  if (!currentAuth) {
    return initFirebase().auth;
  }
  return currentAuth;
}

export async function ensureAuthReady(): Promise<Auth> {
  const auth = getAuthInstance();
  if (typeof (auth as any).authStateReady === 'function') {
    await (auth as any).authStateReady();
  }
  return auth;
}

export async function closeFirebase(): Promise<void> {
  if (currentDb) {
    try {
      const { terminate } = await import('firebase/firestore');
      await terminate(currentDb);
    } catch (_) {}
    currentDb = null;
  }
}
