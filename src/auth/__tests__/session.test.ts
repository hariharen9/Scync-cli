import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setConfigValue } from '../../config/index.js';
import {
  sessionAuthDeadline,
  isSessionWithinMaxAge,
} from '../session.js';
import type { StoredSession } from '../storage.js';

const DAY = 24 * 60 * 60 * 1000;

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    uid: 'uid-1',
    email: 'dev@example.com',
    displayName: 'Dev',
    refreshToken: 'refresh',
    idToken: 'id',
    expiresAt: Date.now() + 3600_000,
    providerId: 'password',
    savedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Auth max age', () => {
  let testDir: string;
  let originalScyncDir: string | undefined;

  beforeEach(() => {
    originalScyncDir = process.env.SCYNC_DIR;
    testDir = path.join(os.tmpdir(), `scync-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    process.env.SCYNC_DIR = testDir;
  });

  afterEach(() => {
    if (originalScyncDir === undefined) delete process.env.SCYNC_DIR;
    else process.env.SCYNC_DIR = originalScyncDir;
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('uses the stored deadline when present', () => {
    const deadline = Date.now() + 1000;
    const s = session({ authValidUntil: deadline });
    expect(sessionAuthDeadline(s)).toBe(deadline);
    expect(isSessionWithinMaxAge(s, deadline - 1)).toBe(true);
    expect(isSessionWithinMaxAge(s, deadline)).toBe(false);
  });

  it('falls back to savedAt plus the default 30 days for legacy sessions', () => {
    const saved = '2026-01-01T00:00:00.000Z';
    const s = session({ savedAt: saved, authValidUntil: undefined });
    const expected = Date.parse(saved) + 30 * DAY;
    expect(sessionAuthDeadline(s)).toBe(expected);
    expect(isSessionWithinMaxAge(s, expected - 1)).toBe(true);
    expect(isSessionWithinMaxAge(s, expected + 1)).toBe(false);
  });

  it('honours auth.maxAge and can be disabled', () => {
    const saved = '2026-01-01T00:00:00.000Z';
    const s = session({ savedAt: saved, authValidUntil: undefined });

    setConfigValue('auth.maxAge', '7d');
    expect(sessionAuthDeadline(s)).toBe(Date.parse(saved) + 7 * DAY);

    setConfigValue('auth.maxAge', 'off');
    expect(sessionAuthDeadline(s)).toBe(Number.POSITIVE_INFINITY);
    expect(isSessionWithinMaxAge(s, Date.parse(saved) + 3650 * DAY)).toBe(true);
  });
});
