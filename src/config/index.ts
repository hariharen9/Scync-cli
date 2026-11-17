import fs from 'node:fs';
import path from 'node:path';
import { getConfigFilePath } from '../auth/storage.js';

export interface ScyncConfig {
  'default.project'?: string;
  'default.env'?: string;
  'agent.timeout'?: string; // e.g. '15m', '30m', '1h'
  'clipboard.timeout'?: string; // e.g. '30s'
  'output.format'?: 'table' | 'json' | 'plain';
  [key: string]: any;
}

export function getConfigPath(): string {
  return getConfigFilePath();
}

export function parseDurationMs(duration: string, defaultMs: number): number {
  if (!duration) return defaultMs;
  const match = duration.trim().match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return defaultMs;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return defaultMs;
  }
}

export function loadConfig(): ScyncConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(config: ScyncConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
    encoding: 'utf8',
  });
}

export function getConfigValue(key: string): any {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

export function unsetConfigValue(key: string): boolean {
  const config = loadConfig();
  if (key in config) {
    delete config[key];
    saveConfig(config);
    return true;
  }
  return false;
}

/**
 * Clipboard auto-clear timeout in seconds (default 30). `0` disables auto-clear.
 */
export function getClipboardTimeoutSecs(): number {
  const raw = loadConfig()['clipboard.timeout'];
  if (raw === undefined || raw === null || raw === '') return 30;
  // Allow a bare number of seconds in addition to duration strings ("30s", "1m").
  if (/^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  const ms = parseDurationMs(String(raw), 30_000);
  return Math.max(0, Math.round(ms / 1000));
}

/**
 * Default project/environment filters applied to bulk commands when no
 * explicit flag is supplied.
 */
export function getDefaultScope(): { project?: string; env?: string } {
  const config = loadConfig();
  return {
    project: config['default.project'] || undefined,
    env: config['default.env'] || undefined,
  };
}
