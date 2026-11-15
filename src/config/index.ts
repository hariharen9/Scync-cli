import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ScyncConfig {
  'default.project'?: string;
  'default.env'?: string;
  'agent.timeout'?: string; // e.g. '15m', '30m', '1h'
  'clipboard.timeout'?: string; // e.g. '30s'
  'output.format'?: 'table' | 'json' | 'plain';
  [key: string]: any;
}

export function getConfigPath(): string {
  const scyncDir = path.join(os.homedir(), '.scync');
  return path.join(scyncDir, 'config.json');
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
