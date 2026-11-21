import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isGoogleLoginEnabled, getGoogleClientConfig } from '../../core/firebase.js';

/**
 * Login routing rules. The broken 0.1.0 build defaulted to Google with a Web
 * application client that Google requires a secret for, so login failed for
 * everyone who had not configured one. These tests pin the rule that Google is
 * opt-in and only offered when a client id is actually configured.
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
  it('offers Google only when a client id is configured', () => {
    expect(isGoogleLoginEnabled()).toBe(false);

    process.env.SCYNC_GOOGLE_CLIENT_ID = 'client.apps.googleusercontent.com';
    expect(isGoogleLoginEnabled()).toBe(true);
  });

  it('has no bundled Google client, so a fresh install never tries Google first', () => {
    expect(getGoogleClientConfig().clientId).toBe('');
  });

  it('treats an empty client id as disabled', () => {
    process.env.SCYNC_GOOGLE_CLIENT_ID = '';
    expect(isGoogleLoginEnabled()).toBe(false);
  });
});
