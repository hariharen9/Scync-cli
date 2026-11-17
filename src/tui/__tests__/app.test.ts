import { describe, expect, it } from 'vitest';
import { TuiApp } from '../app.js';
import { createTheme } from '../theme.js';
import { initialState } from '../state.js';
import type { Key } from '../keys.js';
import type { WorkspaceData } from '../data.js';
import type { StoredSecret } from '../../core/types.js';

const now = new Date('2026-11-17T12:00:00.000Z');
const enc = { iv: 'aXY=', ciphertext: 'Y3Q=' };

function makeData(): WorkspaceData {
  const secret: StoredSecret = {
    id: 's1',
    name: 'STRIPE_KEY',
    service: 'Stripe',
    type: 'API Key',
    environment: 'Development',
    status: 'Active',
    encValue: enc,
    encNotes: null,
    lastRotated: now,
    expiresOn: null,
    createdAt: now,
    updatedAt: now,
    projectId: 'p1',
    remainingCodes: null,
    version: 1,
    versions: [{ version: 1, encValue: enc, createdAt: now, changeType: 'created' }],
  };
  return {
    meta: { salt: 'c2FsdA==', verifier: enc, createdAt: now, biometrics: [], recovery: null },
    secrets: [secret],
    projects: [
      {
        id: 'p1',
        name: 'My App',
        color: 'green',
        icon: '',
        description: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    passwords: [],
    totp: [],
    ssh: [],
    certs: [],
  };
}

const char = (text: string): Key => ({ type: 'char', text });
const special = (name: string, extra: Partial<Key> = {}): Key => ({ type: 'special', name, ...extra });

function makeApp(): TuiApp {
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
  app.state = initialState(makeData());
  app.state.screen = 'main';
  app.now = now.getTime();
  (app as any).requestRender = () => undefined;
  return app;
}

function unlock(app: TuiApp): void {
  app.state.unlocked = true;
  (app as any).vault = {
    uid: 'uid-123',
    salt: 'c2FsdA==',
    isAgent: false,
    decrypt: async () => 'decrypted',
    encrypt: async () => enc,
    batchDecrypt: async () => ['decrypted'],
  };
}

function key(app: TuiApp, input: Key): void {
  (app as any).handleKey(input);
}

function form(app: TuiApp) {
  const modal = app.state.modal;
  if (modal?.kind !== 'form') throw new Error('expected a form modal');
  return modal.form;
}

describe('TUI key routing and interaction', () => {
  it('switches views with number keys, brackets and left/right arrows', () => {
    const app = makeApp();
    key(app, char('2'));
    expect(app.state.view).toBe('secrets');
    key(app, char(']'));
    expect(app.state.view).toBe('projects');
    key(app, char('['));
    expect(app.state.view).toBe('secrets');
    key(app, special('right'));
    expect(app.state.view).toBe('projects');
    key(app, special('left'));
    expect(app.state.view).toBe('secrets');
    key(app, char('?'));
    expect(app.state.modal?.kind).toBe('help');
    key(app, special('escape'));
    expect(app.state.modal).toBeNull();
  });

  it('drives inline search', () => {
    const app = makeApp();
    key(app, char('2'));
    key(app, char('/'));
    expect(app.state.secrets.searching).toBe(true);
    key(app, char('S'));
    key(app, char('T'));
    expect(app.state.secrets.query).toBe('ST');
    key(app, special('enter'));
    expect(app.state.secrets.searching).toBe(false);
    expect(app.state.secrets.query).toBe('ST');
    key(app, special('escape'));
    // A second Escape clears the finished search query.
    expect(app.state.secrets.query).toBe('');
  });

  it('navigates lists with arrow keys and backs out with Escape', () => {
    const app = makeApp();
    app.state.data.secrets.push({
      ...app.state.data.secrets[0],
      id: 's2',
      name: 'OPENAI_KEY',
      service: 'OpenAI',
      updatedAt: new Date('2026-11-16T12:00:00.000Z'),
    });
    key(app, char('2'));
    expect(app.state.secrets.selected).toBe(0);
    key(app, special('down'));
    expect(app.state.secrets.selected).toBe(1);
    key(app, special('up'));
    expect(app.state.secrets.selected).toBe(0);

    key(app, special('enter'));
    expect(app.state.secrets.detail).toBe(true);
    key(app, special('escape'));
    expect(app.state.secrets.detail).toBe(false);
  });

  it('uses Escape as a view-history back action', () => {
    const app = makeApp();
    key(app, char('3'));
    expect(app.state.view).toBe('projects');
    key(app, char(']'));
    expect(app.state.view).toBe('passwords');
    key(app, special('escape'));
    expect(app.state.view).toBe('projects');
    key(app, special('escape'));
    expect(app.state.view).toBe('dashboard');
  });

  it('opens the unlock prompt when a locked action is attempted', () => {
    const app = makeApp();
    key(app, char('2'));
    key(app, char('n'));
    expect(app.state.modal?.kind).toBe('form');
    expect(form(app).title).toBe('Unlock vault');
    key(app, special('escape'));
    expect(app.state.modal).toBeNull();
  });

  it('edits a new secret form with text, tabs and select cycling', () => {
    const app = makeApp();
    unlock(app);
    key(app, char('2'));
    key(app, char('n'));

    const f = form(app);
    expect(f.title).toBe('New secret');
    key(app, char('F'));
    key(app, char('O'));
    key(app, char('O'));
    expect(f.fields[0].value).toBe('FOO');

    key(app, special('tab'));
    key(app, char('A'));
    key(app, char('W'));
    key(app, char('S'));
    expect(f.fields[1].value).toBe('OtherAWS');

    key(app, special('tab'));
    expect(f.focus).toBe(2);
    expect(f.fields[2].value).toBe('API Key');
    key(app, special('right'));
    expect(f.fields[2].value).toBe('Personal Access Token');
    key(app, special('left'));
    expect(f.fields[2].value).toBe('API Key');

    key(app, special('escape'));
    expect(app.state.modal).toBeNull();
  });

  it('validates required fields before submitting', () => {
    const app = makeApp();
    unlock(app);
    key(app, char('2'));
    key(app, char('n'));
    const f = form(app);

    key(app, { type: 'char', text: 's', ctrl: true });
    expect(f.error).toBe('Name is required.');
    expect(app.state.modal?.kind).toBe('form');
  });

  it('handles project creation and navigation', () => {
    const app = makeApp();
    key(app, char('3'));
    expect(app.state.view).toBe('projects');
    key(app, char('n'));
    const f = form(app);
    expect(f.title).toBe('New project');
    key(app, char('X'));
    expect(f.fields[0].value).toBe('X');
    key(app, special('escape'));

    key(app, special('enter'));
    expect(app.state.view).toBe('secrets');
    expect(app.state.secrets.filter.projectId).toBe('p1');
  });

  it('navigates the tools menu and opens workflows', () => {
    const app = makeApp();
    unlock(app);
    key(app, char('8'));
    expect(app.state.view).toBe('tools');
    key(app, special('down'));
    expect(app.state.toolIndex).toBe(1);
    key(app, special('enter'));
    expect(app.state.modal?.kind).toBe('form');
    expect(form(app).title).toBe('Import .env');
    key(app, special('escape'));

    app.state.toolIndex = 0;
    key(app, special('enter'));
    expect(form(app).title).toBe('Export .env');
  });
});
