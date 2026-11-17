import { SERVICE_COLORS } from '../core/constants.js';
import type {
  Project,
  SecretStatus,
  StoredSecret,
  VaultFilter,
} from '../core/types.js';
import type { Palette, Theme } from './theme.js';

export interface SecretFilter {
  search: string;
  projectId: string | null;
  env: string | null;
  service: string | null;
  type: string | null;
  status: string | null;
}

export const EMPTY_SECRET_FILTER: SecretFilter = {
  search: '',
  projectId: null,
  env: null,
  service: null,
  type: null,
  status: null,
};

export function fromVaultFilter(filter: VaultFilter): SecretFilter {
  return {
    search: filter.search,
    projectId: filter.projectId || null,
    env: filter.environment || null,
    service: filter.service || null,
    type: filter.type || null,
    status: filter.status || null,
  };
}

export function filterSecrets(secrets: StoredSecret[], filter: SecretFilter): StoredSecret[] {
  const search = filter.search.trim().toLowerCase();

  return secrets.filter((secret) => {
    if (filter.projectId && secret.projectId !== filter.projectId) return false;
    if (filter.env && secret.environment.toLowerCase() !== filter.env.toLowerCase()) return false;
    if (filter.service && secret.service.toLowerCase() !== filter.service.toLowerCase()) return false;
    if (filter.type && secret.type.toLowerCase() !== filter.type.toLowerCase()) return false;
    if (filter.status && secret.status.toLowerCase() !== filter.status.toLowerCase()) return false;

    if (!search) return true;
    return [
      secret.name,
      secret.service,
      secret.type,
      secret.environment,
      secret.projectId ?? '',
      secret.status,
    ]
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
}

export type SecretSortKey = 'name' | 'updated' | 'created' | 'service' | 'env' | 'status' | 'version';

export function sortSecrets(
  secrets: StoredSecret[],
  key: SecretSortKey = 'updated',
  direction: 'asc' | 'desc' = 'desc'
): StoredSecret[] {
  const factor = direction === 'asc' ? 1 : -1;
  const sorted = [...secrets].sort((a, b) => {
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * factor;
      case 'service':
        return a.service.localeCompare(b.service, undefined, { sensitivity: 'base' }) * factor;
      case 'env':
        return a.environment.localeCompare(b.environment) * factor;
      case 'status':
        return a.status.localeCompare(b.status) * factor;
      case 'version':
        return ((a.version ?? 1) - (b.version ?? 1)) * factor;
      case 'created':
        return (a.createdAt.getTime() - b.createdAt.getTime()) * factor;
      case 'updated':
      default:
        return (a.updatedAt.getTime() - b.updatedAt.getTime()) * factor;
    }
  });
  return sorted;
}

export function matchesText(query: string, ...values: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export interface AttentionBuckets {
  expired: StoredSecret[];
  expiringSoon: StoredSecret[];
  rotationOverdue: StoredSecret[];
  recoveryCodesLow: StoredSecret[];
}

export function getAttentionSecrets(secrets: StoredSecret[], now = new Date()): AttentionBuckets {
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  return {
    expired: secrets.filter(
      (secret) => secret.status === 'Active' && secret.expiresOn !== null && secret.expiresOn < now
    ),
    expiringSoon: secrets.filter(
      (secret) =>
        secret.status === 'Active' &&
        secret.expiresOn !== null &&
        secret.expiresOn >= now &&
        secret.expiresOn <= thirtyDays
    ),
    rotationOverdue: secrets.filter(
      (secret) =>
        secret.status === 'Active' && secret.lastRotated !== null && secret.lastRotated < sixMonthsAgo
    ),
    recoveryCodesLow: secrets.filter(
      (secret) =>
        secret.type === 'Recovery Codes' &&
        secret.remainingCodes !== null &&
        secret.remainingCodes !== undefined &&
        secret.remainingCodes <= 2
    ),
  };
}

export function attentionCount(buckets: AttentionBuckets): number {
  return (
    buckets.expired.length +
    buckets.expiringSoon.length +
    buckets.rotationOverdue.length +
    buckets.recoveryCodesLow.length
  );
}

export function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function formatDate(date: Date | null): string {
  if (!date) return '—';
  const d = date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(date: Date | null): string {
  if (!date) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRelative(date: Date | null, now = new Date()): string {
  if (!date) return 'never';
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';

  if (abs < 45_000) return 'just now';
  if (abs < 60 * 60_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 24 * 60 * 60_000) return `${Math.round(abs / (60 * 60_000))}h ${suffix}`;
  if (abs < 30 * 24 * 60 * 60_000) return `${Math.round(abs / (24 * 60 * 60_000))}d ${suffix}`;
  if (abs < 365 * 24 * 60 * 60_000) return `${Math.round(abs / (30 * 24 * 60 * 60_000))}mo ${suffix}`;
  return `${Math.round(abs / (365 * 24 * 60 * 60_000))}y ${suffix}`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function maskValue(value: string): string {
  const chars = [...value];
  if (chars.length <= 8) return '••••••••';
  if (chars.length <= 16) return `${chars.slice(0, 2).join('')}••••••••${chars.slice(-2).join('')}`;
  return `${chars.slice(0, 3).join('')}••••••••${chars.slice(-3).join('')}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function statusColor(theme: Theme, status: SecretStatus | string): string {
  switch (status.toLowerCase()) {
    case 'active':
      return theme.p.success;
    case 'rotated':
      return theme.p.warning;
    case 'expired':
    case 'revoked':
      return theme.p.danger;
    default:
      return theme.p.muted;
  }
}

export function envColor(theme: Theme, environment: string): string {
  switch (environment.toLowerCase()) {
    case 'production':
      return theme.p.pink;
    case 'staging':
      return theme.p.warning;
    case 'development':
      return theme.p.info;
    case 'local':
      return theme.p.purple;
    case 'testing':
      return theme.p.purple;
    case 'personal':
      return theme.p.accentSoft;
    case 'work':
      return theme.p.info;
    case 'ci/cd':
      return theme.p.warning;
    default:
      return theme.p.muted;
  }
}

const PROJECT_COLOR_HEX: Record<string, string> = {
  violet: '#8b5cf6',
  blue: '#3b82f6',
  green: '#10b981',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
  yellow: '#eab308',
  gray: '#71717a',
};

export function projectColorHex(color: string): string {
  return PROJECT_COLOR_HEX[color] ?? PROJECT_COLOR_HEX.gray;
}

export function serviceColor(service: string, palette: Palette): string {
  const known = SERVICE_COLORS[service];
  return known ?? palette.accent;
}

export function projectName(projects: Project[], projectId: string | null): string {
  if (!projectId) return '—';
  return projects.find((project) => project.id === projectId)?.name ?? projectId;
}

export function riskLabel(secret: StoredSecret, now = new Date()): { label: string; color: 'danger' | 'warning' | 'muted' } | null {
  if (secret.expiresOn) {
    const days = daysUntil(secret.expiresOn, now);
    if (days < 0) return { label: `expired ${Math.abs(days)}d ago`, color: 'danger' };
    if (days <= 30) return { label: `expires in ${days}d`, color: 'warning' };
  }
  if (secret.lastRotated) {
    const days = Math.floor((now.getTime() - secret.lastRotated.getTime()) / (24 * 60 * 60 * 1000));
    if (days > 180) return { label: `rotation overdue ${days}d`, color: 'warning' };
  }
  if (
    secret.type === 'Recovery Codes' &&
    secret.remainingCodes !== null &&
    secret.remainingCodes !== undefined &&
    secret.remainingCodes <= 2
  ) {
    return { label: `${secret.remainingCodes} codes left`, color: 'danger' };
  }
  return null;
}
