import type { ServiceName, SecretType, Environment, SecretStatus, ProjectColor } from './types.js';

export const SERVICES: readonly ServiceName[] = [
  'AWS', 'Azure', 'Google', 'OpenAI', 'Anthropic', 'OpenRouter',
  'DigitalOcean', 'Vercel', 'Netlify', 'Railway',
  'Cloudflare', 'Supabase', 'Firebase', 'GitHub', 'GitLab',
  'HuggingFace', 'Stripe', 'Twilio', 'Slack', 'Other'
];

export const SECRET_TYPES: readonly SecretType[] = [
  'API Key', 'Personal Access Token', 'OAuth Token', 'OAuth Client Secret',
  'Recovery Codes', 'Secret Key', 'Webhook Secret',
  'Service Account JSON', 'Database URL', 'License Key', 'Passphrase',
  'Secret Note', 'Password', 'Other'
];

export const ENVIRONMENTS: readonly Environment[] = [
  'Personal', 'Work', 'Local', 'Development', 'Testing', 'Staging', 'Production', 'CI/CD'
];

export const STATUSES: readonly SecretStatus[] = [
  'Active', 'Rotated', 'Expired', 'Revoked'
];

export function normalizeEnvironment(input: string): Environment {
  const trimmed = input.trim();
  const match = ENVIRONMENTS.find(e => e.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    throw new Error(`Invalid environment '${input}'. Valid options: ${ENVIRONMENTS.join(', ')}`);
  }
  return match;
}

export function normalizeSecretType(input: string): SecretType {
  const trimmed = input.trim();
  const match = SECRET_TYPES.find(t => t.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    throw new Error(`Invalid secret type '${input}'. Valid options: ${SECRET_TYPES.join(', ')}`);
  }
  return match;
}

export function normalizeSecretStatus(input: string): SecretStatus {
  const trimmed = input.trim();
  const match = STATUSES.find(s => s.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    throw new Error(`Invalid secret status '${input}'. Valid options: ${STATUSES.join(', ')}`);
  }
  return match;
}

// Service accent colors (hex)
export const SERVICE_COLORS: Record<ServiceName, string> = {
  'AWS': '#f59e0b',
  'GitHub': '#f0f6fc',
  'Google': '#4285f4',
  'Stripe': '#635bff',
  'OpenAI': '#74aa9c',
  'Vercel': '#ffffff',
  'Supabase': '#3ecf8e',
  'Anthropic': '#d4a27f',
  'Cloudflare': '#f48120',
  'HuggingFace': '#ffd21e',
  'Twilio': '#f22f46',
  'Netlify': '#00c7b7',
  'Railway': '#a855f7',
  'Firebase': '#ffca28',
  'Azure': '#0089d6',
  'DigitalOcean': '#0080ff',
  'GitLab': '#fca326',
  'Slack': '#4a154b',
  'OpenRouter': '#9b6dff',
  'Other': '#10b981',
};

export const STATUS_COLORS: Record<SecretStatus, string> = {
  'Active': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Rotated': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500',
  'Expired': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'Revoked': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export const PROJECT_COLORS: Record<ProjectColor, string> = {
  'violet': 'bg-violet-500',
  'blue': 'bg-blue-500',
  'green': 'bg-emerald-500',
  'orange': 'bg-orange-500',
  'red': 'bg-rose-500',
  'pink': 'bg-pink-500',
  'yellow': 'bg-yellow-500',
  'gray': 'bg-zinc-500'
};
