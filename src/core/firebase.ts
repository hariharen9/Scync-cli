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
    apiKey: process.env.SCYNC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'demo-scync-key',
    authDomain: process.env.SCYNC_FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-scync.firebaseapp.com',
    projectId: process.env.SCYNC_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-scync',
    storageBucket: process.env.SCYNC_FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-scync.appspot.com',
    messagingSenderId: process.env.SCYNC_FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
    appId: process.env.SCYNC_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '1:1234567890:web:abcdef',
    useEmulators: process.env.SCYNC_USE_EMULATORS === 'true' || process.env.VITE_USE_EMULATORS === 'true',
    authEmulatorUrl: process.env.SCYNC_AUTH_EMULATOR_URL || 'http://127.0.0.1:9099',
    firestoreEmulatorHost: process.env.SCYNC_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
    firestoreEmulatorPort: Number(process.env.SCYNC_FIRESTORE_EMULATOR_PORT || 8080)
  };
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
