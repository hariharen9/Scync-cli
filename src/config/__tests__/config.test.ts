import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseDurationMs,
  loadConfig,
  saveConfig,
  setConfigValue,
  getConfigValue,
  unsetConfigValue,
  getConfigPath,
} from '../index.js';

describe('CLI Configuration Layer', () => {
  const originalConfig = loadConfig();

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

  afterEach(() => {
    // Restore original config
    saveConfig(originalConfig);
  });
});
