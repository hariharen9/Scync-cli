import { describe, expect, it } from 'vitest';
import { TuiApp } from '../app.js';
import { createTheme } from '../theme.js';
import { initialState } from '../state.js';
import { buildSearchRecords, rankSearch } from '../search.js';
import { handleSearchKey } from '../views/search.js';
import { displayWidth, stripAnsi } from '../width.js';
import type { WorkspaceData } from '../data.js';
import type { Key } from '../keys.js';
import type {
  Project,
  StoredCertificate,
  StoredPassword,
  StoredSSHKey,
  StoredSecret,
  StoredTOTP,
} from '../../core/types.js';

const now = new Date('2026-11-17T12:00:00.000Z');
const enc = { iv: 'aXY=', ciphertext: 'Y3Q=' };

function secret(id: string, name: string, overrides: Partial<StoredSecret> = {}): StoredSecret {
  return {
    id,
    name,
    service: 'Stripe',
    type: 'API Key',
    environment: 'Development',
    status: 'Active',
    encValue: enc,
    encNotes: null,
    lastRotated: null,
    expiresOn: null,
    createdAt: now,
    updatedAt: now,
    projectId: 'p1',
    remainingCodes: null,
    version: 1,
    ...overrides,
  };
}

function project(id: string, name: string): Project {
  return { id, name, color: 'green', icon: '', description: '', createdAt: now, updatedAt: now };
}

function sampleData(): WorkspaceData {
  const passwords: StoredPassword[] = [
    {
      id: 'pw1',
      name: 'GitHub',
      username: 'dev@example.com',
      encPassword: enc,
      url: 'https://github.com',
      encNotes: null,
      category: 'Work',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const totp: StoredTOTP[] = [
    {
      id: 'otp1',
      issuer: 'GitHub',
      label: 'octocat',
      encSecret: enc,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      icon: '',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const ssh: StoredSSHKey[] = [
    {
      id: 'ssh1',
      name: 'prod-bastion',
      type: 'ssh-ed25519',
      publicKey: 'ssh-ed25519 AAAA prod-bastion',
      fingerprint: 'MD5:aa',
      encPrivateKey: enc,
      hosts: ['bastion.example.com'],
      createdAt: now,
      updatedAt: now,
      rotationDate: null,
    },
  ];
  const certs: StoredCertificate[] = [
    {
      id: 'cert1',
      name: 'wildcard-example',
      encCertPem: enc,
      encKeyPem: null,
      subject: 'CN=*.example.com',
      issuer: 'CN=Example CA',
      serialNumber: '01',
      validFrom: now,
      validTo: now,
      isSelfSigned: false,
      fingerprint: 'sha256:ab',
      hosts: ['*.example.com'],
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    meta: null,
    secrets: [
      secret('s1', 'AWS_PROD_KEY', { service: 'AWS', projectId: 'p1' }),
      secret('s2', 'AWS_NOTES', { service: 'AWS', projectId: 'p1' }),
      secret('s3', 'OPENAI_API_KEY', { service: 'OpenAI', projectId: 'p1' }),
    ],
    projects: [project('p1', 'My App'), project('p2', 'Infra')],
    passwords,
    totp,
    ssh,
    certs,
  };
}

function makeApp(data = sampleData()): TuiApp {
  const app = new TuiApp();
  app.theme = createTheme({ depth: 0 });
  app.session = {
    uid: 'uid-123',
    email: 'dev@example.com',
    displayName: 'Dev',
    refreshToken: 'r',
    idToken: 'i',
    expiresAt: Date.now() + 3_600_000,
    providerId: 'password',
    savedAt: now.toISOString(),
  };
  app.state = initialState(data);
  app.state.screen = 'main';
  (app as any).requestRender = () => undefined;
  return app;
}

const key = (app: TuiApp, event: Key): void => (app as any).handleKey(event);
const char = (text: string): Key => ({ type: 'char', text });
const special = (name: string, extra: Partial<Key> = {}): Key => ({ type: 'special', name, ...extra });

describe('global search index', () => {
  it('indexes every vault collection', () => {
    const records = buildSearchRecords(sampleData());
    const kinds = new Set(records.map((record) => record.kind));
    expect(kinds).toEqual(new Set(['secret', 'project', 'password', 'totp', 'ssh', 'cert']));
  });

  it('matches every token and ranks title prefixes first', () => {
    const records = buildSearchRecords(sampleData());

    const github = rankSearch(records, 'github');
    expect(github.map((hit) => hit.kind)).toEqual(['password', 'totp']);
    expect(github.every((hit) => hit.title.toLowerCase().includes('github'))).toBe(true);

    const aws = rankSearch(records, 'aws');
    expect(aws[0].title).toBe('AWS_NOTES');

    const multi = rankSearch(records, 'github dev');
    expect(multi).toHaveLength(1);
    expect(multi[0].kind).toBe('password');
    expect(rankSearch(records, 'github nomatch')).toHaveLength(0);
  });

  it('returns the full index grouped when the query is empty', () => {
    const records = buildSearchRecords(sampleData());
    const all = rankSearch(records, '   ');
    expect(all).toHaveLength(records.length);
    expect(all[0].kind).toBe('secret');
  });
});

describe('global search overlay', () => {
  it('opens from any view with /', () => {
    const app = makeApp();
    app.state.view = 'settings';

    key(app, char('/'));
    expect(app.state.search).not.toBeNull();
    expect(app.state.search?.query).toBe('');
  });

  it('filters as you type and opens the selected hit with Enter', () => {
    const app = makeApp();
    key(app, char('/'));
    for (const letter of 'bastion') key(app, char(letter));

    const results = app.searchResults();
    expect(results[0]?.kind).toBe('ssh');
    expect(results[0]?.title).toBe('prod-bastion');

    key(app, special('enter'));
    expect(app.state.search).toBeNull();
    expect(app.state.view).toBe('ssh');
    expect(app.state.lists.ssh.selected).toBe(0);
  });

  it('moves through results with arrows and closes with Escape', () => {
    const app = makeApp();
    key(app, char('/'));
    expect(app.state.search?.selected).toBe(0);

    key(app, special('down'));
    key(app, special('down'));
    expect(app.state.search?.selected).toBe(2);

    key(app, special('up'));
    expect(app.state.search?.selected).toBe(1);

    key(app, char('a'));
    expect(app.state.search?.query).toBe('a');
    expect(app.state.search?.selected).toBe(0);

    key(app, special('escape'));
    expect(app.state.search).toBeNull();
  });

  it('supports backspace, word delete and ctrl+u', () => {
    const app = makeApp();
    app.openSearch('aws prod');
    handleSearchKey(app, { type: 'special', name: 'backspace' });
    expect(app.state.search?.query).toBe('aws pro');

    handleSearchKey(app, { type: 'special', name: 'backspace', ctrl: true });
    expect(app.state.search?.query).toBe('aws');

    handleSearchKey(app, { type: 'char', text: 'u', ctrl: true });
    expect(app.state.search?.query).toBe('');
  });

  it('renders the query, a result count and matching rows without overflow', () => {
    const app = makeApp();
    app.openSearch('aws');

    const { buf, cursor } = app.buildFrame(120, 40);
    const lines = buf.toLines();
    for (const line of lines) {
      expect(displayWidth(stripAnsi(line))).toBe(120);
    }

    const frame = lines.map((line) => stripAnsi(line)).join('\n');
    expect(frame).toContain('SEARCH');
    expect(frame).toContain('aws');
    expect(frame).toContain('2 results');
    expect(frame).toContain('AWS_PROD_KEY');
    expect(frame).toContain('AWS_NOTES');
    expect(cursor).not.toBeNull();
  });

  it('does not let a stray Enter open a result when nothing matches', () => {
    const app = makeApp();
    app.openSearch('zzzz-no-match');
    key(app, special('enter'));
    expect(app.state.search).not.toBeNull();
    expect(app.state.view).toBe('dashboard');
  });
});
