import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isGoogleLoginEnabled, getGoogleClientConfig } from '../../core/firebase.js';
import {
  BUNDLED_GOOGLE_CLIENT_ID,
  BUNDLED_GOOGLE_CLIENT_SECRET,
} from '../../generated/google-client.js';

/**
 * Login routing rules. Releases ship a bundled Google Desktop app client so
 * `scync login` works on a fresh install; a source checkout without the build
 * secrets simply leaves Google unavailable and email/password usable.
 */
const ENV_KEYS = [
  'SCYNC_GOOGLE_CLIENT_ID',
  'SCYNC_GOOGLE_CLIENT_SECRET',
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

describe('login routing', () => {
  it('enables Google on a fresh install when a client is bundled', () => {
    expect(isGoogleLoginEnabled()).toBe(BUNDLED_GOOGLE_CLIENT_ID.length > 0);
  });

  it('lets a self-hoster override the bundled client', () => {
    process.env.SCYNC_GOOGLE_CLIENT_ID = 'client.apps.googleusercontent.com';
    process.env.SCYNC_GOOGLE_CLIENT_SECRET = 'self-secret';
    expect(getGoogleClientConfig()).toEqual({
      clientId: 'client.apps.googleusercontent.com',
      clientSecret: 'self-secret',
    });
    expect(isGoogleLoginEnabled()).toBe(true);
  });

  it('reports Google as available exactly when a bundled client exists', () => {
    expect(isGoogleLoginEnabled()).toBe(BUNDLED_GOOGLE_CLIENT_ID.length > 0);
  });

  it('falls back to the bundled client when no env values are set', () => {
    process.env.SCYNC_GOOGLE_CLIENT_ID = '';
    process.env.SCYNC_GOOGLE_CLIENT_SECRET = '';
    expect(getGoogleClientConfig()).toEqual({
      clientId: BUNDLED_GOOGLE_CLIENT_ID,
      clientSecret: BUNDLED_GOOGLE_CLIENT_SECRET,
    });
  });
});
