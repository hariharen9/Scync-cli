import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseDurationMs,
  loadConfig,
  setConfigValue,
  getConfigValue,
  unsetConfigValue,
  getClipboardTimeoutSecs,
  getDefaultScope,
  getAuthMaxAgeMs,
  parseAuthMaxAge,
} from '../index.js';

describe('CLI Configuration Layer', () => {
  let testDir: string;
  let originalScyncDir: string | undefined;

  beforeEach(() => {
    originalScyncDir = process.env.SCYNC_DIR;
    testDir = path.join(os.tmpdir(), `scync-cli-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

  it('correctly parses human-friendly duration strings', () => {
    expect(parseDurationMs('30s', 1000)).toBe(30 * 1000);
    expect(parseDurationMs('15m', 1000)).toBe(15 * 60 * 1000);
    expect(parseDurationMs('2h', 1000)).toBe(2 * 60 * 60 * 1000);
    expect(parseDurationMs('1d', 1000)).toBe(24 * 60 * 60 * 1000);
    expect(parseDurationMs('invalid', 5000)).toBe(5000);
  });

  it('sets, retrieves, and unsets configuration values', () => {
    setConfigValue('default.project', 'proj-alpha');
    expect(getConfigValue('default.project')).toBe('proj-alpha');

    setConfigValue('agent.timeout', '30m');
    expect(getConfigValue('agent.timeout')).toBe('30m');

    const removed = unsetConfigValue('default.project');
    expect(removed).toBe(true);
    expect(getConfigValue('default.project')).toBeUndefined();
  });

  it('resolves clipboard timeout from duration strings and bare seconds', () => {
    expect(getClipboardTimeoutSecs()).toBe(30);

    setConfigValue('clipboard.timeout', '45s');
    expect(getClipboardTimeoutSecs()).toBe(45);

    setConfigValue('clipboard.timeout', '15');
    expect(getClipboardTimeoutSecs()).toBe(15);

    setConfigValue('clipboard.timeout', '0');
    expect(getClipboardTimeoutSecs()).toBe(0);
  });

  it('exposes default project/environment scope', () => {
    expect(getDefaultScope()).toEqual({ project: undefined, env: undefined });

    setConfigValue('default.project', 'proj-omega');
    setConfigValue('default.env', 'Production');
    expect(getDefaultScope()).toEqual({ project: 'proj-omega', env: 'Production' });
    expect(loadConfig()).toMatchObject({ 'default.project': 'proj-omega', 'default.env': 'Production' });
  });

  it('defaults the auth max age to 30 days and honours overrides', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(parseAuthMaxAge(undefined)).toBe(30 * day);
    expect(parseAuthMaxAge('')).toBe(30 * day);
    expect(parseAuthMaxAge('7d')).toBe(7 * day);
    expect(parseAuthMaxAge('12h')).toBe(12 * 60 * 60 * 1000);
    expect(parseAuthMaxAge('14')).toBe(14 * day);
    expect(parseAuthMaxAge('0')).toBe(0);
    expect(parseAuthMaxAge('off')).toBe(0);
    expect(parseAuthMaxAge('never')).toBe(0);

    expect(getAuthMaxAgeMs()).toBe(30 * day);
    setConfigValue('auth.maxAge', '7d');
    expect(getAuthMaxAgeMs()).toBe(7 * day);
    setConfigValue('auth.maxAge', 'off');
    expect(getAuthMaxAgeMs()).toBe(0);
  });
});
