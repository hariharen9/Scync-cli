import { describe, expect, it } from 'vitest';
import { TuiApp } from '../app.js';
import { createTheme } from '../theme.js';
import { initialState, type FormState } from '../state.js';
import { displayWidth, stripAnsi } from '../width.js';
import type { WorkspaceData } from '../data.js';
import type { StoredCertificate, StoredPassword, StoredSecret, StoredSSHKey, StoredTOTP } from '../../core/types.js';

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
    encNotes: enc,
    lastRotated: new Date('2025-01-01T00:00:00.000Z'),
    expiresOn: null,
    createdAt: now,
    updatedAt: now,
    projectId: 'p1',
    remainingCodes: null,
    version: 2,
    versions: [
      { version: 1, encValue: enc, createdAt: now, changeType: 'created' },
      { version: 2, encValue: enc, createdAt: now, changeType: 'updated' },
    ],
    ...overrides,
  };
}

function sampleData(): WorkspaceData {
  const passwords: StoredPassword[] = [
    {
      id: 'pw1',
      name: 'GitHub',
      username: 'dev@example.com',
      encPassword: enc,
      url: 'https://github.com',
      encNotes: enc,
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
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample prod-bastion',
      fingerprint: 'MD5:aa:bb:cc:dd',
      encPrivateKey: enc,
      hosts: ['bastion.example.com'],
      createdAt: now,
      updatedAt: now,
      rotationDate: now,
    },
  ];
  const certs: StoredCertificate[] = [
    {
      id: 'cert1',
      name: 'Wildcard',
      encCertPem: enc,
      encKeyPem: enc,
      subject: 'CN=*.example.com',
      issuer: 'CN=Example CA',
      serialNumber: '03A4B89F',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2027-01-01T00:00:00.000Z'),
      isSelfSigned: false,
      fingerprint: 'SHA256:12:34',
      hosts: ['*.example.com'],
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    meta: {
      salt: 'c2FsdA==',
      verifier: enc,
      createdAt: now,
      biometrics: [],
      recovery: null,
    },
    secrets: [
      secret('s1', 'STRIPE_SECRET_KEY'),
      secret('s2', 'OPENAI_API_KEY', {
        service: 'OpenAI',
        environment: 'Production',
        expiresOn: new Date('2026-11-01T00:00:00.000Z'),
      }),
      secret('s3', 'GITHUB_RECOVERY_CODES', {
        service: 'GitHub',
        type: 'Recovery Codes',
        remainingCodes: 1,
        projectId: null,
      }),
      secret('s4', 'DATABASE_URL', {
        service: 'Supabase',
        type: 'Database URL',
        status: 'Rotated',
        environment: 'Production',
      }),
    ],
    projects: [
      {
        id: 'p1',
        name: 'My App',
        color: 'green',
        icon: '',
        description: 'Main application',
        createdAt: now,
        updatedAt: now,
      },
    ],
    passwords,
    totp,
    ssh,
    certs,
  };
}

function makeApp(): TuiApp {
  const app = new TuiApp();
  app.theme = createTheme({ depth: 0 });
  app.session = {
    uid: 'uid-123',
    email: 'dev@example.com',
    displayName: 'Dev',
    refreshToken: 'refresh',
    idToken: 'id',
    expiresAt: Date.now() + 3_600_000,
    providerId: 'password',
    savedAt: now.toISOString(),
  };
  app.state = initialState(sampleData());
  app.state.screen = 'main';
  app.now = now.getTime();
  return app;
}

function assertFrame(app: TuiApp, width: number, height: number): string[] {
  const { buf } = app.buildFrame(width, height);
  const lines = buf.toLines();
  expect(lines).toHaveLength(height);
  for (const line of lines) {
    expect(displayWidth(stripAnsi(line))).toBe(width);
  }
  return lines.map((line) => stripAnsi(line));
}

describe('TUI views render without overflowing', () => {
  const views = [
    'dashboard',
    'secrets',
    'projects',
    'passwords',
    'totp',
    'ssh',
    'certs',
    'tools',
    'settings',
  ] as const;

  for (const view of views) {
    it(`renders ${view} at wide and compact sizes`, () => {
      const app = makeApp();
      app.state.view = view;
      assertFrame(app, 140, 42);
      assertFrame(app, 100, 32);
      assertFrame(app, 70, 24);
    });
  }

  it('renders the secrets detail pane and narrow detail mode', () => {
    const app = makeApp();
    app.state.view = 'secrets';
    app.state.secrets.detail = true;
    app.state.secrets.focus = 'detail';
    app.state.secrets.selected = 1;
    const wide = assertFrame(app, 150, 40).join('\n');
    expect(wide).toContain('DETAIL');
    expect(wide).toContain('OPENAI_API_KEY');

    const narrow = assertFrame(app, 70, 26).join('\n');
    expect(narrow).toContain('DETAIL');
  });

  it('renders the login screen', () => {
    const app = makeApp();
    app.state.screen = 'login';
    app.session = null;
    app.state.login.email = 'dev@example.com';
    app.state.login.focus = 1;
    const frame = assertFrame(app, 100, 30).join('\n');
    expect(frame).toContain('SIGN IN');
    expect(frame).toContain('dev@example.com');
    expect(frame).toContain('Google');
  });

  it('shows a clear message when the terminal is too small', () => {
    const app = makeApp();
    const frame = assertFrame(app, 40, 12).join('\n');
    expect(frame).toContain('Terminal is too small');
  });
});

describe('TUI overlays render', () => {
  it('renders help, confirm and viewer modals', () => {
    const app = makeApp();

    app.state.modal = { kind: 'help' };
    assertFrame(app, 120, 36);

    app.state.modal = {
      kind: 'confirm',
      title: 'Delete secret',
      message: 'Permanently delete this secret? This cannot be undone.',
      onConfirm: () => undefined,
      danger: true,
    };
    assertFrame(app, 100, 30);

    app.state.modal = {
      kind: 'viewer',
      viewer: {
        title: 'Private key',
        text: 'line one\nline two\nline three',
        scroll: 0,
        wrap: false,
        copyLabel: 'Private key',
      },
    };
    const viewer = assertFrame(app, 100, 30).join('\n');
    expect(viewer).toContain('Private key');
    expect(viewer).toContain('line one');
  });

  it('renders a form with text, password, textarea and select fields', () => {
    const app = makeApp();
    const form: FormState = {
      title: 'Edit secret',
      subtitle: 'Values are encrypted locally.',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', value: 'STRIPE_KEY', required: true },
        { key: 'password', label: 'Password', kind: 'password', value: 'secret', cursor: 3 },
        {
          key: 'type',
          label: 'Type',
          kind: 'select',
          value: 'API Key',
          options: [{ label: 'API Key', value: 'API Key' }],
        },
        { key: 'overwrite', label: 'Overwrite', kind: 'boolean', value: 'true' },
        { key: 'value', label: 'Value', kind: 'textarea', value: 'line\nline two', rows: 5 },
      ],
      focus: 4,
      error: null,
      onSubmit: () => undefined,
    };
    app.state.modal = { kind: 'form', form };
    const frame = assertFrame(app, 120, 40).join('\n');
    expect(frame).toContain('Edit secret');
    expect(frame).toContain('line two');
  });

  it('renders a searchable picker', () => {
    const app = makeApp();
    app.state.modal = {
      kind: 'pick',
      picker: {
        title: 'Filter secrets',
        subtitle: 'Choose a field',
        items: [
          { label: 'Project', value: 'project', hint: 'My App' },
          { label: 'Environment', value: 'env', hint: 'Development' },
        ],
        selected: 0,
        scroll: 0,
        query: 'env',
        searchable: true,
        onSelect: () => undefined,
      },
    };
    const frame = assertFrame(app, 100, 30).join('\n');
    expect(frame).toContain('Filter secrets');
    expect(frame).toContain('Environment');
  });
});
