import type { WorkspaceData } from './data.js';
import { projectName } from './format.js';

export type SearchKind = 'secret' | 'project' | 'password' | 'totp' | 'ssh' | 'cert';

export interface SearchRecord {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  haystack: string;
}

export interface SearchResult extends SearchRecord {
  score: number;
}

export const SEARCH_KIND_ORDER: SearchKind[] = [
  'secret',
  'project',
  'password',
  'totp',
  'ssh',
  'cert',
];

export const SEARCH_KIND_META: Record<SearchKind, { label: string; tag: string }> = {
  secret: { label: 'Secrets', tag: 'SECRET' },
  project: { label: 'Projects', tag: 'PROJECT' },
  password: { label: 'Passwords', tag: 'LOGIN' },
  totp: { label: 'TOTP', tag: 'TOTP' },
  ssh: { label: 'SSH Keys', tag: 'SSH' },
  cert: { label: 'Certificates', tag: 'CERT' },
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function toRecord(
  kind: SearchKind,
  id: string,
  title: string,
  subtitle: string,
  keywords: Array<string | null | undefined>
): SearchRecord {
  const cleanTitle = title.trim() || '(untitled)';
  return {
    kind,
    id,
    title: cleanTitle,
    subtitle: subtitle.trim(),
    haystack: normalize([cleanTitle, subtitle, ...keywords.filter(Boolean).join(' ')].join(' ')),
  };
}

/** Flattens every searchable vault item into one index. */
export function buildSearchRecords(data: WorkspaceData): SearchRecord[] {
  const records: SearchRecord[] = [];

  for (const secret of data.secrets) {
    const project = secret.projectId ? projectName(data.projects, secret.projectId) : '';
    records.push(
      toRecord(
        'secret',
        secret.id,
        secret.name,
        [secret.service, secret.type, secret.environment, project].filter(Boolean).join(' · '),
        [secret.service, secret.type, secret.environment, secret.status, project]
      )
    );
  }

  for (const project of data.projects) {
    records.push(
      toRecord('project', project.id, project.name, project.description, [project.color])
    );
  }

  for (const password of data.passwords) {
    records.push(
      toRecord('password', password.id, password.name, [password.username, password.url].filter(Boolean).join(' · '), [
        password.username,
        password.url,
        password.category,
      ])
    );
  }

  for (const token of data.totp) {
    const title = [token.issuer, token.label].filter(Boolean).join(' · ') || token.label;
    records.push(
      toRecord('totp', token.id, title, `TOTP · ${token.algorithm} ${token.digits} digits`, [
        token.issuer,
        token.label,
        token.algorithm,
      ])
    );
  }

  for (const key of data.ssh) {
    records.push(
      toRecord('ssh', key.id, key.name, [key.type, key.hosts.join(', ')].filter(Boolean).join(' · '), [
        key.type,
        key.fingerprint,
        key.hosts.join(' '),
      ])
    );
  }

  for (const cert of data.certs) {
    records.push(
      toRecord('cert', cert.id, cert.name, [cert.subject, cert.issuer].filter(Boolean).join(' · '), [
        cert.subject,
        cert.issuer,
        cert.fingerprint,
        cert.hosts.join(' '),
      ])
    );
  }

  return records;
}

const WORD_BREAK = /[\s·.,:/()[\]_-]+/;

function tokenScore(token: string, record: SearchRecord): number | null {
  const title = normalize(record.title);
  if (!record.haystack.includes(token)) return null;
  if (title === token) return 100;
  if (title.startsWith(token)) return 80;

  const words = title.split(WORD_BREAK).filter(Boolean);
  if (words.some((word) => word.startsWith(token))) return 60;
  if (title.includes(token)) return 40;
  return 15;
}

/**
 * Ranked search. Every whitespace-separated token must match somewhere, so
 * "aws prod" narrows instead of widening. Results are grouped by kind order.
 */
export function rankSearch(records: SearchRecord[], query: string, limit = 100): SearchResult[] {
  const tokens = normalize(query).split(' ').filter(Boolean);

  const results: SearchResult[] = [];
  for (const record of records) {
    if (tokens.length === 0) {
      results.push({ ...record, score: 0 });
      continue;
    }

    let total = 0;
    let rejected = false;
    for (const token of tokens) {
      const score = tokenScore(token, record);
      if (score === null) {
        rejected = true;
        break;
      }
      total += score;
    }
    if (rejected) continue;

    results.push({ ...record, score: total });
  }

  results.sort((a, b) => {
    const groupA = SEARCH_KIND_ORDER.indexOf(a.kind);
    const groupB = SEARCH_KIND_ORDER.indexOf(b.kind);
    if (groupA !== groupB) return groupA - groupB;
    if (a.score !== b.score) return b.score - a.score;
    if (a.title.length !== b.title.length) return a.title.length - b.title.length;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });

  return results.slice(0, limit);
}

/** Builds a search record list straight from workspace data and ranks it. */
export function searchWorkspace(data: WorkspaceData, query: string, limit = 100): SearchResult[] {
  return rankSearch(buildSearchRecords(data), query, limit);
}
