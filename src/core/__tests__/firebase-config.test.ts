import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  HOSTED_CONFIG,
  getDefaultConfig,
  getGoogleClientConfig,
  isGoogleLoginEnabled,
  isHostedBackend,
} from '../firebase.js';

const ENV_KEYS = [
  'SCYNC_FIREBASE_API_KEY',
  'SCYNC_FIREBASE_AUTH_DOMAIN',
  'SCYNC_FIREBASE_PROJECT_ID',
  'SCYNC_FIREBASE_STORAGE_BUCKET',
  'SCYNC_FIREBASE_MESSAGING_SENDER_ID',
  'SCYNC_FIREBASE_APP_ID',
  'SCYNC_USE_EMULATORS',
  'SCYNC_GOOGLE_CLIENT_ID',
  'SCYNC_GOOGLE_CLIENT_SECRET',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_USE_EMULATORS',
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_GOOGLE_CLIENT_SECRET',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('hosted backend defaults', () => {
  it('works out of the box against the hosted Scync project', () => {
    const config = getDefaultConfig();
    expect(config).toMatchObject(HOSTED_CONFIG);
    expect(config.useEmulators).toBe(false);
    expect(isHostedBackend(config)).toBe(true);
  });

  it('never defaults to the emulator or a demo project', () => {
    const config = getDefaultConfig();
    expect(config.projectId).not.toBe('demo-scync');
    expect(config.apiKey).not.toContain('demo');
  });

  it('does not bundle a Google client, since the hosted one needs a secret', () => {
    expect(getGoogleClientConfig()).toEqual({ clientId: '', clientSecret: '' });
    expect(isGoogleLoginEnabled()).toBe(false);
  });
});

describe('self-hosting overrides', () => {
  it('lets SCYNC_* variables replace every field', () => {
    process.env.SCYNC_FIREBASE_API_KEY = 'self-key';
    process.env.SCYNC_FIREBASE_AUTH_DOMAIN = 'self.example.com';
    process.env.SCYNC_FIREBASE_PROJECT_ID = 'self-project';
    process.env.SCYNC_FIREBASE_STORAGE_BUCKET = 'self-project.appspot.com';
    process.env.SCYNC_FIREBASE_MESSAGING_SENDER_ID = '42';
    process.env.SCYNC_FIREBASE_APP_ID = '1:42:web:self';

    const config = getDefaultConfig();
    expect(config).toMatchObject({
      apiKey: 'self-key',
      authDomain: 'self.example.com',
      projectId: 'self-project',
      storageBucket: 'self-project.appspot.com',
      messagingSenderId: '42',
      appId: '1:42:web:self',
    });
    expect(isHostedBackend(config)).toBe(false);
  });

  it('accepts VITE_* variables as a development fallback', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'vite-project';
    process.env.VITE_FIREBASE_API_KEY = 'vite-key';
    expect(getDefaultConfig()).toMatchObject({ projectId: 'vite-project', apiKey: 'vite-key' });
  });

  it('prefers SCYNC_* over VITE_* when both are set', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'vite-project';
    process.env.SCYNC_FIREBASE_PROJECT_ID = 'scync-project';
    expect(getDefaultConfig().projectId).toBe('scync-project');
  });

  it('overrides the Google client for self-hosted OAuth', () => {
    process.env.SCYNC_GOOGLE_CLIENT_ID = 'self-client';
    process.env.SCYNC_GOOGLE_CLIENT_SECRET = 'self-secret';
    expect(getGoogleClientConfig()).toEqual({ clientId: 'self-client', clientSecret: 'self-secret' });
    expect(isGoogleLoginEnabled()).toBe(true);
  });

  it('keeps emulator mode opt-in only', () => {
    expect(getDefaultConfig().useEmulators).toBe(false);
    process.env.SCYNC_USE_EMULATORS = 'true';
    expect(getDefaultConfig().useEmulators).toBe(true);
  });
});
