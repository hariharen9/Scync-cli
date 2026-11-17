import path from 'node:path';
import os from 'node:os';

import { CliError, ExitCode } from '../cli/errors.js';
import { inferServiceFromName } from '../cli/input.js';
import { ENVIRONMENTS, SECRET_TYPES, STATUSES } from '../core/constants.js';
import { normalizeEnvironment } from '../core/constants.js';
import { generateTOTPCode, getRemainingSeconds } from '../core/totp.js';
import type {
  Project,
  StoredCertificate,
  StoredPassword,
  StoredSSHKey,
  StoredSecret,
  StoredTOTP,
} from '../core/types.js';
import { getClipboardTimeoutSecs, loadConfig, setConfigValue } from '../config/index.js';
import { parseExpirationDate } from '../utils/sanitize.js';
import { copyWithAutoClear } from '../utils/clipboard.js';

import { Buffer } from './buffer.js';
import { TextEditor } from './editor.js';
import { EMPTY_WORKSPACE, loadWorkspace, type AgentSnapshot } from './data.js';
import {
  addProject,
  buildSshConfig,
  createAgentBackedSession,
  decryptStoredField,
  decryptStoredSecret,
  editProject,
  exportSecretsToEnv,
  exportSshKey,
  getAgentSnapshot,
  getCurrentSession,
  importEnvFile,
  lockAgent,
  loginWithEmail,
  loginWithGoogle,
  logoutSession,
  normalizeDraftEnums,
  readTextFile,
  removeProject,
  removeSecret,
  restoreSecret as restoreSecretData,
  rotateSecret as rotateSecretData,
  runCommandWithSecrets,
  saveSecret,
  unlockWithPassword,
} from './data.js';
import {
  EMPTY_SECRET_FILTER,
  filterSecrets,
  formatDateTime,
  projectName,
  sortSecrets,
  type SecretFilter,
  type SecretSortKey,
} from './format.js';
import { isChar, isSpecial, type Key } from './keys.js';
import { renderModal } from './overlays.js';
import {
  initialState,
  VIEW_ORDER,
  type AppState,
  type FormState,
  type ModalState,
  type PickerItem,
  type PickerState,
  type SecretDraft,
  type ViewId,
  type ViewerState,
} from './state.js';
import { createTheme, type Theme } from './theme.js';
import { Terminal } from './terminal.js';
import { computeLayout, drawFooter, drawHeader, drawSidebar, type Layout } from './widgets.js';
import { clamp, wrapText } from './width.js';

import { handleCertsKey, renderCertsView } from './views/certs.js';
import { handleDashboardKey, renderDashboard } from './views/dashboard.js';
import { handleLoginKey, renderLogin } from './views/login.js';
import { handlePasswordsKey, renderPasswordsView } from './views/passwords.js';
import { handleProjectsKey, renderProjectsView } from './views/projects.js';
import { handleSecretsKey, renderSecretsView } from './views/secrets.js';
import { handleSettingsKey, renderSettingsView } from './views/settings.js';
import { handleSshKey, renderSshView } from './views/ssh.js';
import { handleToolsKey, renderToolsView } from './views/tools.js';
import { handleTotpKey, renderTotpView } from './views/totp.js';

const VERSION = '0.1.0';
const REVEAL_MS = 15_000;

interface PlainSecret {
  value: string;
  notes: string;
  until: number;
}

interface PlainPassword {
  password: string;
  notes: string;
  until: number;
}

export interface TuiOptions {
  noAgent?: boolean;
  ascii?: boolean;
}

export class TuiApp {
  readonly terminal = new Terminal();
  theme!: Theme;
  state: AppState = initialState(EMPTY_WORKSPACE);
  session: Awaited<ReturnType<typeof getCurrentSession>> = null;
  vault: Awaited<ReturnType<typeof unlockWithPassword>> | null = null;
  now = Date.now();
  layout: Layout = computeLayout(100, 30);
  readonly version = VERSION;

  private options: TuiOptions;
  private renderTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private resolveExit: (() => void) | null = null;
  private exiting = false;
  private agentTtlUntil = 0;
  private pendingUnlock: (() => void | Promise<void>) | null = null;
  private secretPlaintext = new Map<string, PlainSecret>();
  private passwordPlaintext = new Map<string, PlainPassword>();
  private totpSecrets = new Map<string, string>();
  private totpPending = new Set<string>();
  private viewHistory: ViewId[] = [];
  private spinnerFrame = 0;

  constructor(options: TuiOptions = {}) {
    this.options = options;
  }

  private get noAgent(): boolean {
    return this.options.noAgent === true || process.env.SCYNC_NO_AGENT === '1';
  }

  async run(): Promise<void> {
    if (!this.terminal.isTTY) {
      throw new CliError(
        'The interactive TUI needs a real terminal. Use the regular scync commands when piping or in CI.',
        ExitCode.GENERAL_ERROR
      );
    }

    this.theme = createTheme({ ascii: this.options.ascii });
    this.terminal.enter();
    this.terminal.onKey((key) => this.handleKey(key));
    this.terminal.onError((err) => {
      this.toast(messageOf(err), 'error');
      this.requestRender();
    });
    this.terminal.onResizeEvent(() => this.requestRender());

    const onSignal = () => this.shutdown();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    this.startTick();

    try {
      this.state.screen = 'starting';
      this.requestRender();
      await this.bootstrap();
      this.renderNow();

      await new Promise<void>((resolve) => {
        this.resolveExit = resolve;
      });
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      this.stopTick();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.terminal.exit();
      this.secretPlaintext.clear();
      this.passwordPlaintext.clear();
      this.totpSecrets.clear();
    }
  }

  requestRender(): void {
    if (this.renderTimer || this.exiting) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      try {
        this.renderNow();
      } catch (err) {
        // Never leave the terminal in the alternate screen because a render
        // failed. Restore first, then surface the error.
        this.shutdown();
        setTimeout(() => {
          throw err;
        }, 0);
      }
    }, 16);
  }

  renderNow(): void {
    const { buf, cursor } = this.buildFrame(this.terminal.width, this.terminal.height);
    this.terminal.render(buf, cursor);
  }

  /** Builds one full frame without touching the terminal (used by tests). */
  buildFrame(terminalWidth: number, terminalHeight: number): { buf: Buffer; cursor: { x: number; y: number } | null } {
    const width = Math.max(20, terminalWidth);
    const height = Math.max(8, terminalHeight);
    this.layout = computeLayout(width, height);
    const buf = new Buffer(width, height, { bg: this.theme.p.bg, fg: this.theme.p.text }, this.theme.colorizer);

    if (width < 50 || height < 16) {
      const message = [
        'Terminal is too small',
        `Current: ${width}x${height}`,
        'Resize to at least 50x16 to use the TUI.',
      ];
      const y = Math.floor(height / 2) - 1;
      message.forEach((line, index) => {
        buf.put(Math.max(1, Math.floor((width - line.length) / 2)), y + index, line, {
          fg: index === 0 ? this.theme.p.warning : this.theme.p.faint,
          bold: index === 0,
        });
      });
      return { buf, cursor: null };
    }

    let cursor: { x: number; y: number } | null = null;

    if (this.state.screen === 'starting') {
      const msg = 'Loading vault…';
      buf.put(Math.floor((width - msg.length) / 2), Math.floor(height / 2), msg, {
        fg: this.theme.p.accentSoft,
      });
    } else if (this.state.screen === 'login' || !this.session) {
      const result = renderLogin(this, buf, width, height);
      cursor = result.cursor;
    } else {
      this.drawMain(buf);
      if (this.state.modal) {
        const result = renderModal(buf, this.theme, this.state.modal, width, height);
        cursor = result.cursor;
      }
    }

    return { buf, cursor };
  }

  // ─── Keyboard routing ───

  private handleKey(key: Key): void {
    if (key.type === 'special' && key.name === 'ctrl-c') {
      this.shutdown();
      return;
    }

    if (this.state.screen === 'login' || !this.session) {
      handleLoginKey(this, key);
      this.requestRender();
      return;
    }

    if (this.state.busy) return;

    if (this.state.modal) {
      this.handleModalKey(key).catch((err) => this.toast(messageOf(err), 'error'));
      this.requestRender();
      return;
    }

    const typing = this.isTextInputActive();

    // Global keys (never while a list search input is active).
    if (!typing) {
      if (isChar(key, '?')) {
        this.openHelp();
        return;
      }
      if (key.type === 'char' && key.text && /^[1-9]$/.test(key.text) && !key.ctrl && !key.alt) {
        const index = Number(key.text) - 1;
        if (VIEW_ORDER[index]) this.setView(VIEW_ORDER[index]);
        return;
      }
      if (isChar(key, '[')) return this.cycleView(-1);
      if (isChar(key, ']')) return this.cycleView(1);
      if (isSpecial(key, 'left')) return this.cycleView(-1);
      if (isSpecial(key, 'right')) return this.cycleView(1);
      if (isChar(key, 'U')) return this.unlockVault();
      if (isChar(key, 'L')) return void this.lockVault();
      if (key.ctrl && key.text === 'r') return void this.refresh();
      if (isChar(key, 'q')) {
        this.shutdown();
        return;
      }
    }

    switch (this.state.view) {
      case 'dashboard':
        try {
          handleDashboardKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'secrets':
        try {
          handleSecretsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'projects':
        try {
          handleProjectsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'passwords':
        try {
          handlePasswordsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'totp':
        try {
          handleTotpKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'ssh':
        try {
          handleSshKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'certs':
        try {
          handleCertsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'tools':
        try {
          handleToolsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
      case 'settings':
        try {
          handleSettingsKey(this, key);
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
        break;
    }

    this.requestRender();
  }

  private isTextInputActive(): boolean {
    if (this.state.secrets.searching) return true;
    return Object.values(this.state.lists).some((list) => list.searching);
  }

  // ─── Bootstrap, refresh, agent ───

  private async bootstrap(): Promise<void> {
    this.state.errors = [];
    let session: Awaited<ReturnType<typeof getCurrentSession>> = null;
    try {
      session = await getCurrentSession();
    } catch (err) {
      this.state.errors.push(messageOf(err));
    }

    if (!session) {
      this.session = null;
      this.state.screen = 'login';
      this.state.login.error = null;
      return;
    }

    this.session = session;
    await this.reloadWorkspace(true);
    this.state.screen = 'main';
    this.state.unlocked = false;
    this.vault = null;

    const snapshot = await getAgentSnapshot(session.uid);
    if (this.noAgent) {
      this.state.agent = { status: 'locked', ttlRemainingMs: 0, sampledAt: Date.now() };
      this.agentTtlUntil = 0;
    } else {
      this.applyAgentSnapshot(snapshot);
      if (snapshot?.status === 'unlocked' && this.state.data.meta) {
        this.vault = createAgentBackedSession(session.uid, this.state.data.meta.salt);
        this.state.unlocked = true;
      }
    }

    if (this.state.errors.length > 0) {
      this.toast(this.state.errors[0], 'warning');
    }

    if (this.state.data.meta && !this.state.unlocked) {
      // Do not block navigation with a modal. Metadata is usable while locked;
      // decrypt actions prompt for the master password on demand.
      this.toast('Vault locked · press U to unlock · metadata browsing is available', 'info');
    }
  }

  private async reloadWorkspace(resetSelection = false): Promise<void> {
    if (!this.session) return;
    const selectedId = this.state.data.secrets[this.state.secrets.selected]?.id;
    const load = await loadWorkspace(this.session.uid);
    this.state.data = load.data;
    this.state.meta = load.data.meta;
    this.state.errors = load.errors;
    this.secretPlaintext.clear();
    this.passwordPlaintext.clear();

    if (!resetSelection && selectedId) {
      const visible = sortSecrets(
        filterSecrets(this.state.data.secrets, this.state.secrets.filter),
        this.state.secrets.sort,
        this.state.secrets.sortDirection
      );
      const index = visible.findIndex((secret) => secret.id === selectedId);
      if (index >= 0) this.state.secrets.selected = index;
    }
    for (const key of Object.keys(this.state.lists) as Array<keyof AppState['lists']>) {
      const list = this.state.lists[key];
      list.selected = clamp(list.selected, 0, Math.max(0, this.dataLength(key) - 1));
    }
  }

  private dataLength(key: keyof AppState['lists']): number {
    switch (key) {
      case 'passwords':
        return this.state.data.passwords.length;
      case 'projects':
        return this.state.data.projects.length;
      case 'totp':
        return this.state.data.totp.length;
      case 'ssh':
        return this.state.data.ssh.length;
      case 'certs':
        return this.state.data.certs.length;
    }
  }

  private applyAgentSnapshot(snapshot: AgentSnapshot | null): void {
    this.now = Date.now();
    if (!snapshot) {
      this.state.agent = { status: 'locked', ttlRemainingMs: 0, sampledAt: this.now };
      this.agentTtlUntil = 0;
      return;
    }
    this.state.agent = {
      status: snapshot.status,
      ttlRemainingMs: snapshot.ttlRemainingMs,
      pid: snapshot.pid,
      sampledAt: this.now,
    };
    this.agentTtlUntil = this.now + snapshot.ttlRemainingMs;
  }

  async refresh(): Promise<void> {
    if (!this.session) return;
    this.setBusy('Refreshing vault…');
    try {
      await this.reloadWorkspace();
      const snapshot = await getAgentSnapshot(this.session.uid);
      if (this.noAgent) {
        this.state.agent = { status: 'locked', ttlRemainingMs: 0, sampledAt: Date.now() };
        this.agentTtlUntil = 0;
        if (!this.vault) this.state.unlocked = false;
      } else {
        this.applyAgentSnapshot(snapshot);
        if (snapshot?.status !== 'unlocked') {
          this.state.unlocked = false;
          this.vault = null;
          this.totpSecrets.clear();
        } else if (!this.vault && this.state.data.meta) {
          this.vault = createAgentBackedSession(this.session.uid, this.state.data.meta.salt);
          this.state.unlocked = true;
        }
      }
      this.toast('Vault refreshed', 'success');
    } catch (err) {
      this.toast(messageOf(err), 'error');
    } finally {
      this.setBusy(null);
    }
  }

  setBusy(label: string | null): void {
    this.state.busy = label;
    this.requestRender();
  }

  isWideLayout(): boolean {
    return computeLayout(this.terminal.width, this.terminal.height).main.w >= 96;
  }

  setView(view: ViewId): void {
    const previous = this.state.view;
    if (view !== previous) {
      this.viewHistory.push(previous);
      if (this.viewHistory.length > 30) this.viewHistory.shift();
    }
    this.state.view = view;
    this.state.modal = null;
    if (previous === 'totp' && view !== 'totp') {
      this.totpSecrets.clear();
      this.totpPending.clear();
    }
    this.requestRender();
  }

  /** Esc back behaviour: previous view, or dashboard. */
  goBack(): void {
    if (this.state.modal) {
      this.state.modal = null;
      this.requestRender();
      return;
    }
    if (this.state.view === 'dashboard') return;
    let previous = this.viewHistory.pop();
    while (previous === this.state.view) previous = this.viewHistory.pop();
    this.state.view = previous ?? 'dashboard';
    this.state.modal = null;
    this.requestRender();
  }

  cycleView(delta: number): void {
    const current = VIEW_ORDER.indexOf(this.state.view);
    const next = (current + delta + VIEW_ORDER.length) % VIEW_ORDER.length;
    this.setView(VIEW_ORDER[next]);
  }

  toast(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    this.state.toast = { message: text, type, until: Date.now() + 4500 };
    this.requestRender();
  }

  // ─── Modal helpers ───

  openModal(modal: ModalState | null): void {
    this.state.modal = modal;
    this.requestRender();
  }

  closeModal(): void {
    this.state.modal = null;
    this.requestRender();
  }

  openHelp(): void {
    this.openModal({ kind: 'help' });
  }

  openConfirm(
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    options: { confirmLabel?: string; danger?: boolean } = {}
  ): void {
    this.openModal({
      kind: 'confirm',
      title,
      message,
      onConfirm,
      confirmLabel: options.confirmLabel,
      danger: options.danger,
    });
  }

  openForm(form: FormState): void {
    for (const field of form.fields) {
      if (field.cursor === undefined) field.cursor = field.value.length;
    }
    this.openModal({ kind: 'form', form });
  }

  openPicker(picker: PickerState): void {
    picker.selected = clamp(picker.selected, 0, Math.max(0, picker.items.length - 1));
    picker.scroll = 0;
    this.openModal({ kind: 'pick', picker });
  }

  openViewer(viewer: ViewerState): void {
    this.openModal({ kind: 'viewer', viewer });
  }

  // ─── Unlock / lock / logout ───

  unlockVault(): void {
    if (!this.session) {
      this.toast('Sign in first.', 'warning');
      return;
    }
    if (this.state.unlocked) {
      this.toast('Vault is already unlocked.', 'info');
      return;
    }
    this.pendingUnlock = null;
    this.openUnlockModal();
  }

  private openUnlockModal(subtitle?: string): void {
    if (!this.state.data.meta) {
      this.toast('Vault is not initialized. Create it on the Scync web app first.', 'warning');
      return;
    }

    const form: FormState = {
      title: 'Unlock vault',
      subtitle:
        subtitle ??
        'Derive the AES-256-GCM key with your master password. It is never stored or logged.',
      fields: [
        {
          key: 'password',
          label: 'Master password',
          kind: 'password',
          value: '',
          required: true,
          placeholder: 'vault master password',
          help: 'PBKDF2 · SHA-256 · 310,000 iterations',
        },
      ],
      focus: 0,
      error: null,
      submitLabel: 'Unlock',
      onCancel: () => {
        this.pendingUnlock = null;
      },
      onSubmit: async (values) => {
        if (!this.session) return;
        form.busy = true;
        form.error = null;
        this.requestRender();
        try {
          const vault = await unlockWithPassword(this.session.uid, values.password, {
            noAgent: this.noAgent,
          });
          this.vault = vault;
          this.state.unlocked = true;
          this.state.modal = null;
          const snapshot = await getAgentSnapshot(this.session.uid);
          this.applyAgentSnapshot(snapshot);
          this.toast(
            snapshot?.status === 'unlocked'
              ? `Vault unlocked · key agent active`
              : 'Vault unlocked in-process (agent unavailable)',
            'success'
          );
          const pending = this.pendingUnlock;
          this.pendingUnlock = null;
          if (pending) await pending();
        } catch (err) {
          form.error = messageOf(err);
        } finally {
          form.busy = false;
          this.requestRender();
        }
      },
    };
    this.openForm(form);
  }

  async lockVault(): Promise<void> {
    if (!this.session) {
      this.toast('Sign in first.', 'warning');
      return;
    }
    this.setBusy('Locking vault…');
    try {
      await lockAgent(this.session.uid);
      this.vault = null;
      this.state.unlocked = false;
      this.state.agent = { status: 'locked', ttlRemainingMs: 0, sampledAt: Date.now() };
      this.agentTtlUntil = 0;
      this.secretPlaintext.clear();
      this.passwordPlaintext.clear();
      this.totpSecrets.clear();
      this.state.revealedUntil = {};
      this.toast('Vault locked and in-memory keys purged', 'success');
    } catch (err) {
      this.toast(messageOf(err), 'error');
    } finally {
      this.setBusy(null);
    }
  }

  logout(): void {
    this.openConfirm('Log out', 'Remove the stored session and lock the key agent?', async () => {
      try {
        await logoutSession(this.session?.uid);
      } catch (err) {
        this.toast(messageOf(err), 'warning');
      }
      this.session = null;
      this.vault = null;
      this.secretPlaintext.clear();
      this.passwordPlaintext.clear();
      this.totpSecrets.clear();
      this.state = initialState(EMPTY_WORKSPACE);
      this.state.screen = 'login';
      this.state.modal = null;
      this.state.login.error = null;
      this.toast('Signed out', 'success');
      this.requestRender();
    }, { danger: true, confirmLabel: 'Log out' });
  }

  requireUnlocked(action: () => void | Promise<void>, reason = 'do that'): void {
    if (this.state.unlocked && this.vault) {
      this.runAction(action);
      return;
    }
    this.pendingUnlock = action;
    this.openUnlockModal(`Unlock the vault to ${reason}.`);
  }

  private runAction(action: () => void | Promise<void>): void {
    try {
      const result = action();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch((err) => this.toast(messageOf(err), 'error'));
      }
    } catch (err) {
      this.toast(messageOf(err), 'error');
    }
  }

  // ─── Clipboard & reveal ───

  async copyText(text: string, label: string): Promise<void> {
    const seconds = getClipboardTimeoutSecs();
    const ok = copyWithAutoClear(text, seconds);
    if (ok) {
      this.toast(
        `${label} copied${seconds > 0 ? ` · clears in ${seconds}s` : ''}`,
        'success'
      );
    } else {
      this.toast('Could not write to the system clipboard', 'error');
    }
  }

  getRevealedSecret(id: string): { value: string; notes: string } | null {
    const entry = this.secretPlaintext.get(id);
    if (!entry || entry.until <= this.now) return null;
    return { value: entry.value, notes: entry.notes };
  }

  async revealSecret(secret: StoredSecret): Promise<void> {
    const key = `secret:${secret.id}`;
    if (this.getRevealedSecret(secret.id)) {
      this.secretPlaintext.delete(secret.id);
      delete this.state.revealedUntil[key];
      this.requestRender();
      return;
    }
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const decrypted = await decryptStoredSecret(this.vault, secret);
        this.secretPlaintext.set(secret.id, {
          value: decrypted.value,
          notes: decrypted.notes,
          until: Date.now() + REVEAL_MS,
        });
        this.state.revealedUntil[key] = Date.now() + REVEAL_MS;
        this.toast(`Value revealed for ${Math.round(REVEAL_MS / 1000)}s`, 'info');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
      this.requestRender();
    }, 'reveal this secret');
  }

  async copySecretValue(secret: StoredSecret): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const decrypted = await decryptStoredSecret(this.vault, secret);
        await this.copyText(decrypted.value, `Value of '${secret.name}'`);
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this secret');
  }

  async copySecretNotes(secret: StoredSecret): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const decrypted = await decryptStoredSecret(this.vault, secret);
        if (!decrypted.notes) {
          this.toast('This secret has no notes', 'info');
          return;
        }
        await this.copyText(decrypted.notes, `Notes of '${secret.name}'`);
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy secret notes');
  }

  async viewSecretValue(secret: StoredSecret): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const decrypted = await decryptStoredSecret(this.vault, secret);
        this.openViewer({
          title: secret.name,
          subtitle: `Value · ${secret.type} · v${secret.version ?? 1}`,
          text: decrypted.value,
          scroll: 0,
          wrap: true,
          copyLabel: 'Secret value',
        });
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'view this secret');
  }

  // ─── Secret CRUD ───

  private projectOptions(includeAny = false): Array<{ label: string; value: string }> {
    const options = this.state.data.projects.map((project) => ({
      label: project.name,
      value: project.id,
    }));
    return includeAny ? [{ label: 'No project', value: '' }, ...options] : options;
  }

  private enumOptions(values: readonly string[]): Array<{ label: string; value: string }> {
    return values.map((value) => ({ label: value, value }));
  }

  newSecret(): void {
    this.requireUnlocked(() => {
      const defaults = normalizeDraftEnums({
        environment: this.state.secrets.filter.env ?? loadConfig()['default.env'] ?? 'Development',
        type: 'API Key',
        status: 'Active',
      });
      const form = this.buildSecretForm(null, {
        name: '',
        service: 'Other',
        type: defaults.type,
        environment: defaults.environment,
        status: defaults.status,
        value: '',
        notes: '',
        projectId: this.state.secrets.filter.projectId,
        expiresOn: null,
        lastRotated: new Date(),
      });
      this.openForm(form);
    }, 'create a secret');
  }

  async editSecret(secret: StoredSecret): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const decrypted = await decryptStoredSecret(this.vault, secret);
        const form = this.buildSecretForm(secret, {
          name: secret.name,
          service: secret.service,
          type: secret.type,
          environment: secret.environment,
          status: secret.status,
          value: decrypted.value,
          notes: decrypted.notes,
          projectId: secret.projectId,
          expiresOn: secret.expiresOn,
          lastRotated: secret.lastRotated,
        });
        this.openForm(form);
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'edit this secret');
  }

  private buildSecretForm(existing: StoredSecret | null, draft: SecretDraft): FormState {
    const form: FormState = {
      title: existing ? 'Edit secret' : 'New secret',
      subtitle: existing
        ? `Updating v${existing.version ?? 1} · conflicts are detected automatically`
        : 'Values are encrypted locally with AES-256-GCM before they reach Firestore.',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', value: draft.name, required: true, placeholder: 'STRIPE_SECRET_KEY' },
        { key: 'service', label: 'Service', kind: 'text', value: draft.service, placeholder: 'Stripe, AWS, OpenAI…' },
        { key: 'type', label: 'Type', kind: 'select', value: draft.type, options: this.enumOptions(SECRET_TYPES) },
        {
          key: 'environment',
          label: 'Environment',
          kind: 'select',
          value: draft.environment,
          options: this.enumOptions(ENVIRONMENTS),
        },
        { key: 'status', label: 'Status', kind: 'select', value: draft.status, options: this.enumOptions(STATUSES) },
        { key: 'project', label: 'Project', kind: 'select', value: draft.projectId ?? '', options: this.projectOptions(true) },
        {
          key: 'expires',
          label: 'Expires on',
          kind: 'text',
          value: draft.expiresOn ? draft.expiresOn.toISOString().slice(0, 10) : '',
          placeholder: 'YYYY-MM-DD (optional)',
        },
        {
          key: 'value',
          label: 'Value',
          kind: 'textarea',
          value: draft.value,
          rows: 6,
          required: true,
          placeholder: 'Paste the secret value…',
          help: 'Multi-line values (PEM, JSON, certificates) are stored exactly as entered.',
        },
        {
          key: 'notes',
          label: 'Notes',
          kind: 'textarea',
          value: draft.notes,
          rows: 4,
          placeholder: 'Optional encrypted notes…',
        },
      ],
      focus: 0,
      error: null,
      submitLabel: existing ? 'Save changes' : 'Create secret',
      onSubmit: async (values) => {
        form.error = null;
        if (!this.vault) {
          form.error = 'Vault is locked.';
          return;
        }
        try {
          const enums = normalizeDraftEnums({
            environment: values.environment,
            type: values.type,
            status: values.status,
          });
          const expires = values.expires.trim() ? parseExpirationDate(values.expires.trim()) : null;
          const service =
            !values.service.trim() || (values.service.trim() === 'Other' && !existing)
              ? inferServiceFromName(values.name)
              : values.service;
          const nextDraft: SecretDraft = {
            name: values.name,
            service,
            type: enums.type,
            environment: enums.environment,
            status: enums.status,
            value: values.value,
            notes: values.notes,
            projectId: values.project || null,
            expiresOn: expires,
            lastRotated: existing?.lastRotated ?? new Date(),
          };
          const result = await saveSecret(this.session!.uid, this.vault, nextDraft, existing ?? undefined);
          this.state.modal = null;
          this.toast(
            existing
              ? `Updated '${nextDraft.name}' to v${result.version}`
              : `Created '${nextDraft.name}' (v1)`,
            'success'
          );
          await this.reloadWorkspace();
        } catch (err) {
          form.error = messageOf(err);
        }
      },
    };
    return form;
  }

  rotateSecret(secret: StoredSecret): void {
    this.requireUnlocked(() => {
      const form: FormState = {
        title: 'Rotate secret',
        subtitle: `'${secret.name}' is at v${secret.version ?? 1}. The old value stays in version history.`,
        fields: [
          {
            key: 'value',
            label: 'New value',
            kind: 'textarea',
            value: '',
            rows: 6,
            required: true,
            placeholder: 'Paste the new rotated value…',
          },
        ],
        focus: 0,
        error: null,
        submitLabel: 'Rotate',
        onSubmit: async (values) => {
          if (!this.vault) return;
          try {
            const version = await rotateSecretData(this.session!.uid, this.vault, secret, values.value);
            this.state.modal = null;
            this.toast(`Rotated '${secret.name}' to v${version}`, 'success');
            await this.reloadWorkspace();
          } catch (err) {
            form.error = messageOf(err);
          }
        },
      };
      this.openForm(form);
    }, 'rotate this secret');
  }

  restoreSecret(secret: StoredSecret): void {
    const versions = [...(secret.versions ?? [])].sort((a, b) => b.version - a.version);
    if (versions.length === 0) {
      this.toast('No version history is stored for this secret', 'info');
      return;
    }
    const items: PickerItem[] = versions.map((version) => ({
      label: `v${version.version}`,
      value: String(version.version),
      hint: `${version.changeType ?? 'updated'} · ${formatDateTime(version.createdAt)}`,
    }));
    this.openPicker({
      title: `Restore '${secret.name}'`,
      subtitle: 'Choose a historical version. Restoring creates a new version.',
      items,
      selected: 0,
      scroll: 0,
      query: '',
      searchable: false,
      onSelect: (value) => {
        this.requireUnlocked(async () => {
          if (!this.vault) return;
          try {
            await restoreSecretData(this.session!.uid, this.vault, secret, Number(value));
            this.toast(`Restored '${secret.name}' from v${value}`, 'success');
            await this.reloadWorkspace();
          } catch (err) {
            this.toast(messageOf(err), 'error');
          }
        }, 'restore this version');
      },
    });
  }

  deleteSecret(secret: StoredSecret): void {
    this.openConfirm(
      'Delete secret',
      `Permanently delete '${secret.name}' (${secret.service} · ${secret.environment})? This cannot be undone.`,
      async () => {
        try {
          await removeSecret(this.session!.uid, secret);
          this.toast(`Deleted '${secret.name}'`, 'success');
          await this.reloadWorkspace();
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
      },
      { danger: true, confirmLabel: 'Delete' }
    );
  }

  openSecret(secret: StoredSecret): void {
    this.setView('secrets');
    this.state.secrets.filter = { ...EMPTY_SECRET_FILTER };
    this.state.secrets.query = '';
    this.state.secrets.searching = false;
    const visible = sortSecrets(
      this.state.data.secrets,
      this.state.secrets.sort,
      this.state.secrets.sortDirection
    );
    const index = visible.findIndex((entry) => entry.id === secret.id);
    this.state.secrets.selected = Math.max(0, index);
    this.state.secrets.detail = true;
    this.state.secrets.focus = 'detail';
    this.state.secrets.detailScroll = 0;
    this.requestRender();
  }

  // ─── Filters & sorting ───

  openFilterPicker(): void {
    const filter = this.state.secrets.filter;
    const items: PickerItem[] = [
      {
        label: 'Project',
        value: 'project',
        hint: filter.projectId ? projectName(this.state.data.projects, filter.projectId) : 'any',
      },
      { label: 'Environment', value: 'env', hint: filter.env ?? 'any' },
      { label: 'Service', value: 'service', hint: filter.service ?? 'any' },
      { label: 'Type', value: 'type', hint: filter.type ?? 'any' },
      { label: 'Status', value: 'status', hint: filter.status ?? 'any' },
    ];
    this.openPicker({
      title: 'Filter secrets',
      subtitle: 'Choose a field, then pick a value.',
      items,
      selected: 0,
      scroll: 0,
      query: '',
      searchable: false,
      onSelect: (category) => this.openFilterValuePicker(category),
    });
  }

  private openFilterValuePicker(category: string): void {
    let items: PickerItem[] = [];
    switch (category) {
      case 'project':
        items = [
          { label: 'Any project', value: '' },
          ...this.state.data.projects.map((project) => ({
            label: project.name,
            value: project.id,
          })),
        ];
        break;
      case 'env':
        items = [{ label: 'Any environment', value: '' }, ...ENVIRONMENTS.map((value) => ({ label: value, value }))];
        break;
      case 'service':
        items = [
          { label: 'Any service', value: '' },
          ...[...new Set(this.state.data.secrets.map((secret) => secret.service))]
            .sort()
            .map((value) => ({ label: value, value })),
        ];
        break;
      case 'type':
        items = [{ label: 'Any type', value: '' }, ...SECRET_TYPES.map((value) => ({ label: value, value }))];
        break;
      case 'status':
        items = [{ label: 'Any status', value: '' }, ...STATUSES.map((value) => ({ label: value, value }))];
        break;
    }

    this.openPicker({
      title: `Filter by ${category}`,
      items,
      selected: 0,
      scroll: 0,
      query: '',
      searchable: items.length > 8,
      onSelect: (value) => {
        const next = value || null;
        if (category === 'project') this.state.secrets.filter.projectId = next;
        if (category === 'env') this.state.secrets.filter.env = next;
        if (category === 'service') this.state.secrets.filter.service = next;
        if (category === 'type') this.state.secrets.filter.type = next;
        if (category === 'status') this.state.secrets.filter.status = next;
        this.state.secrets.selected = 0;
        this.state.secrets.detailScroll = 0;
        this.requestRender();
      },
    });
  }

  cycleProjectFilter(): void {
    const ids = [null, ...this.state.data.projects.map((project) => project.id)];
    const current = ids.findIndex((id) => id === this.state.secrets.filter.projectId);
    const next = ids[(current + 1) % ids.length];
    this.state.secrets.filter.projectId = next;
    this.state.secrets.selected = 0;
    this.toast(`Project filter: ${next ? projectName(this.state.data.projects, next) : 'any'}`, 'info');
  }

  clearSecretFilters(): void {
    this.state.secrets.filter = { ...EMPTY_SECRET_FILTER };
    this.state.secrets.query = '';
    this.state.secrets.selected = 0;
    this.state.secrets.detailScroll = 0;
    this.toast('Filters cleared', 'info');
  }

  cycleSecretSort(): void {
    const keys: SecretSortKey[] = ['updated', 'name', 'service', 'env', 'status', 'version'];
    const index = keys.indexOf(this.state.secrets.sort);
    this.state.secrets.sort = keys[(index + 1) % keys.length];
    this.state.secrets.selected = 0;
    this.toast(`Sorted by ${this.state.secrets.sort}`, 'info');
  }

  toggleSecretSortDirection(): void {
    this.state.secrets.sortDirection = this.state.secrets.sortDirection === 'asc' ? 'desc' : 'asc';
    this.toast(`Sort ${this.state.secrets.sortDirection === 'asc' ? 'ascending' : 'descending'}`, 'info');
  }

  // ─── Projects ───

  openProject(project: Project): void {
    this.state.secrets.filter.projectId = project.id;
    this.state.secrets.query = '';
    this.state.secrets.searching = false;
    this.state.secrets.selected = 0;
    this.state.secrets.detail = false;
    this.setView('secrets');
  }

  newProject(): void {
    const form: FormState = {
      title: 'New project',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', value: '', required: true, placeholder: 'My App' },
        { key: 'description', label: 'Description', kind: 'text', value: '', placeholder: 'Optional description' },
        {
          key: 'color',
          label: 'Color',
          kind: 'select',
          value: 'green',
          options: ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'yellow', 'gray'].map((color) => ({
            label: color,
            value: color,
          })),
        },
      ],
      focus: 0,
      error: null,
      submitLabel: 'Create project',
      onSubmit: async (values) => {
        try {
          await addProject(this.session!.uid, {
            name: values.name,
            description: values.description,
            color: values.color,
          });
          this.state.modal = null;
          this.toast(`Project '${values.name}' created`, 'success');
          await this.reloadWorkspace();
        } catch (err) {
          form.error = messageOf(err);
        }
      },
    };
    this.openForm(form);
  }

  editProject(project: Project): void {
    const form: FormState = {
      title: 'Edit project',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', value: project.name, required: true },
        { key: 'description', label: 'Description', kind: 'text', value: project.description },
        {
          key: 'color',
          label: 'Color',
          kind: 'select',
          value: project.color,
          options: ['violet', 'blue', 'green', 'orange', 'red', 'pink', 'yellow', 'gray'].map((color) => ({
            label: color,
            value: color,
          })),
        },
      ],
      focus: 0,
      error: null,
      submitLabel: 'Save project',
      onSubmit: async (values) => {
        try {
          await editProject(this.session!.uid, project.id, {
            name: values.name,
            description: values.description,
            color: values.color,
          });
          this.state.modal = null;
          this.toast(`Project '${values.name}' updated`, 'success');
          await this.reloadWorkspace();
        } catch (err) {
          form.error = messageOf(err);
        }
      },
    };
    this.openForm(form);
  }

  deleteProject(project: Project): void {
    this.openConfirm(
      'Delete project',
      `Delete '${project.name}'? Secrets in this project become uncategorized; they are not deleted.`,
      async () => {
        try {
          const moved = await removeProject(this.session!.uid, project.id, null);
          if (this.state.secrets.filter.projectId === project.id) {
            this.state.secrets.filter.projectId = null;
          }
          this.toast(`Deleted project '${project.name}' (${moved} secret(s) uncategorized)`, 'success');
          await this.reloadWorkspace();
        } catch (err) {
          this.toast(messageOf(err), 'error');
        }
      },
      { danger: true, confirmLabel: 'Delete' }
    );
  }

  // ─── Passwords ───

  getRevealedPassword(id: string): { password: string; notes: string } | null {
    const entry = this.passwordPlaintext.get(id);
    if (!entry || entry.until <= this.now) return null;
    return { password: entry.password, notes: entry.notes };
  }

  revealPassword(entry: StoredPassword): void {
    if (this.getRevealedPassword(entry.id)) {
      this.passwordPlaintext.delete(entry.id);
      this.requestRender();
      return;
    }
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const password = await decryptStoredField(this.vault, entry.encPassword);
        const notes = entry.encNotes ? await decryptStoredField(this.vault, entry.encNotes) : '';
        this.passwordPlaintext.set(entry.id, {
          password,
          notes,
          until: Date.now() + REVEAL_MS,
        });
        this.toast(`Password revealed for ${Math.round(REVEAL_MS / 1000)}s`, 'info');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
      this.requestRender();
    }, 'reveal this password');
  }

  async copyPassword(entry: StoredPassword): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const password = await decryptStoredField(this.vault, entry.encPassword);
        await this.copyText(password, `Password for '${entry.name}'`);
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this password');
  }

  async copyUsername(entry: StoredPassword): Promise<void> {
    if (!entry.username) {
      this.toast('This login has no username', 'info');
      return;
    }
    await this.copyText(entry.username, 'Username');
  }

  async copyPasswordField(entry: StoredPassword, field: 'url' | 'notes'): Promise<void> {
    if (field === 'url') {
      if (!entry.url) {
        this.toast('This login has no URL', 'info');
        return;
      }
      await this.copyText(entry.url, 'URL');
      return;
    }
    this.requireUnlocked(async () => {
      if (!this.vault || !entry.encNotes) {
        this.toast('This login has no notes', 'info');
        return;
      }
      try {
        const notes = await decryptStoredField(this.vault, entry.encNotes);
        await this.copyText(notes, 'Notes');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy these notes');
  }

  async viewPasswordNotes(entry: StoredPassword): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      if (!entry.encNotes) {
        this.toast('This login has no notes', 'info');
        return;
      }
      try {
        const notes = await decryptStoredField(this.vault, entry.encNotes);
        this.openViewer({
          title: `Notes: ${entry.name}`,
          text: notes,
          scroll: 0,
          wrap: true,
          copyLabel: 'Notes',
        });
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'view these notes');
  }

  // ─── TOTP ───

  ensureTotpSecret(token: StoredTOTP, force = false): void {
    void this.ensureTotpSecretNow(token, force);
  }

  private async ensureTotpSecretNow(token: StoredTOTP, force = false): Promise<void> {
    if (!this.state.unlocked || !this.vault) return;
    if (!force && this.totpSecrets.has(token.id)) return;
    if (this.totpPending.has(token.id)) return;
    this.totpPending.add(token.id);
    try {
      const secret = await decryptStoredField(this.vault, token.encSecret);
      this.totpSecrets.set(token.id, secret);
      this.requestRender();
    } catch (err) {
      this.toast(messageOf(err), 'error');
    } finally {
      this.totpPending.delete(token.id);
    }
  }

  getTotpCode(token: StoredTOTP): { code: string; remaining: number; period: number } | null {
    const secret = this.totpSecrets.get(token.id);
    if (!secret) return null;
    try {
      const code = generateTOTPCode({
        issuer: token.issuer,
        label: token.label,
        secret,
        algorithm: token.algorithm,
        digits: token.digits,
        period: token.period,
      });
      return { code, remaining: getRemainingSeconds(token.period), period: token.period };
    } catch {
      return null;
    }
  }

  async copyTotpCode(token: StoredTOTP): Promise<void> {
    this.requireUnlocked(async () => {
      await this.ensureTotpSecretNow(token);
      const result = this.getTotpCode(token);
      if (!result) {
        this.toast('Could not generate a code yet', 'warning');
        return;
      }
      await this.copyText(result.code, 'TOTP code');
    }, 'generate this TOTP code');
  }

  async copyTotpSecret(token: StoredTOTP): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const secret = await decryptStoredField(this.vault, token.encSecret);
        await this.copyText(secret, 'TOTP base32 secret');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this TOTP secret');
  }

  // ─── SSH ───

  async copySshPublic(key: StoredSSHKey): Promise<void> {
    await this.copyText(key.publicKey, 'Public key');
  }

  async viewSshPrivate(key: StoredSSHKey): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const privateKey = await decryptStoredField(this.vault, key.encPrivateKey);
        this.openViewer({
          title: `Private key: ${key.name}`,
          subtitle: `${key.type} · ${key.fingerprint}`,
          text: privateKey,
          scroll: 0,
          wrap: true,
          copyLabel: 'Private key',
        });
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'view this private key');
  }

  async copySshPrivate(key: StoredSSHKey): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const privateKey = await decryptStoredField(this.vault, key.encPrivateKey);
        await this.copyText(privateKey, 'Private key');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this private key');
  }

  async copySshConfig(): Promise<void> {
    const config = buildSshConfig(this.state.data.ssh);
    await this.copyText(config, 'SSH config');
  }

  exportSshKey(key: StoredSSHKey): void {
    this.requireUnlocked(() => {
      const form: FormState = {
        title: 'Export SSH key',
        subtitle: `Writes the private key with mode 0600 and the public key with 0644.`,
        fields: [
          {
            key: 'dir',
            label: 'Target directory',
            kind: 'text',
            value: path.join(os.homedir(), '.ssh'),
            required: true,
          },
          { key: 'overwrite', label: 'Overwrite existing files', kind: 'boolean', value: 'false' },
        ],
        focus: 0,
        error: null,
        submitLabel: 'Export',
        onSubmit: async (values) => {
          if (!this.vault) return;
          try {
            const privateKey = await decryptStoredField(this.vault, key.encPrivateKey);
            const result = exportSshKey(key, privateKey, values.dir, values.overwrite === 'true');
            this.state.modal = null;
            this.toast(`Exported to ${result.privatePath}`, 'success');
          } catch (err) {
            form.error = messageOf(err);
          }
        },
      };
      this.openForm(form);
    }, 'export this SSH key');
  }

  // ─── Certificates ───

  async viewCertPem(cert: StoredCertificate): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const pem = await decryptStoredField(this.vault, cert.encCertPem);
        this.openViewer({
          title: `Certificate: ${cert.name}`,
          subtitle: cert.subject,
          text: pem,
          scroll: 0,
          wrap: true,
          copyLabel: 'Certificate PEM',
        });
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'view this certificate');
  }

  async copyCertPem(cert: StoredCertificate): Promise<void> {
    this.requireUnlocked(async () => {
      if (!this.vault) return;
      try {
        const pem = await decryptStoredField(this.vault, cert.encCertPem);
        await this.copyText(pem, 'Certificate PEM');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this certificate');
  }

  async viewCertKey(cert: StoredCertificate): Promise<void> {
    if (!cert.encKeyPem) {
      this.toast('No private key is stored for this certificate', 'info');
      return;
    }
    this.requireUnlocked(async () => {
      if (!this.vault || !cert.encKeyPem) return;
      try {
        const keyPem = await decryptStoredField(this.vault, cert.encKeyPem);
        this.openViewer({
          title: `Private key: ${cert.name}`,
          subtitle: cert.subject,
          text: keyPem,
          scroll: 0,
          wrap: true,
          copyLabel: 'Private key PEM',
        });
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'view this private key');
  }

  async copyCertKey(cert: StoredCertificate): Promise<void> {
    if (!cert.encKeyPem) {
      this.toast('No private key is stored for this certificate', 'info');
      return;
    }
    this.requireUnlocked(async () => {
      if (!this.vault || !cert.encKeyPem) return;
      try {
        const keyPem = await decryptStoredField(this.vault, cert.encKeyPem);
        await this.copyText(keyPem, 'Private key PEM');
      } catch (err) {
        this.toast(messageOf(err), 'error');
      }
    }, 'copy this private key');
  }

  // ─── Tools ───

  openExportForm(): void {
    this.requireUnlocked(() => {
      const filter = this.state.secrets.filter;
      const form: FormState = {
        title: 'Export .env',
        subtitle: 'Active secrets are decrypted locally and written with owner-only permissions.',
        fields: [
          { key: 'path', label: 'Output file', kind: 'text', value: '.env', required: true },
          {
            key: 'project',
            label: 'Project',
            kind: 'select',
            value: filter.projectId ?? '',
            options: this.projectOptions(true),
          },
          {
            key: 'env',
            label: 'Environment',
            kind: 'select',
            value: filter.env ?? '',
            options: [{ label: 'All environments', value: '' }, ...this.enumOptions(ENVIRONMENTS)],
          },
          { key: 'overwrite', label: 'Overwrite existing file', kind: 'boolean', value: 'false' },
        ],
        focus: 0,
        error: null,
        submitLabel: 'Export',
        onSubmit: async (values) => {
          if (!this.vault) return;
          try {
            const scope: SecretFilter = {
              ...this.state.secrets.filter,
              projectId: values.project || null,
              env: values.env || null,
              search: '',
            };
            const secrets = filterSecrets(this.state.data.secrets, scope);
            const result = await exportSecretsToEnv(
              this.session!.uid,
              this.vault,
              secrets,
              values.path,
              {
                project: values.project ? projectName(this.state.data.projects, values.project) : undefined,
                env: values.env || undefined,
              },
              values.overwrite === 'true'
            );
            this.state.modal = null;
            this.toast(`Exported ${result.count} secret(s) to ${result.path}`, 'success');
            if (result.warnings.length > 0) {
              this.openViewer({
                title: 'Export warnings',
                text: result.warnings.join('\n'),
                scroll: 0,
                wrap: true,
                copyLabel: 'Warnings',
              });
            }
          } catch (err) {
            form.error = messageOf(err);
          }
        },
      };
      this.openForm(form);
    }, 'export secrets');
  }

  openImportForm(): void {
    this.requireUnlocked(() => {
      const form: FormState = {
        title: 'Import .env',
        subtitle: 'Duplicate keys collapse with last-value-wins. Existing secrets are skipped unless overwrite is on.',
        fields: [
          { key: 'path', label: 'Input file', kind: 'text', value: '.env', required: true },
          {
            key: 'env',
            label: 'Target environment',
            kind: 'select',
            value: loadConfig()['default.env'] ?? 'Development',
            options: this.enumOptions(ENVIRONMENTS),
          },
          {
            key: 'project',
            label: 'Project',
            kind: 'select',
            value: this.state.secrets.filter.projectId ?? '',
            options: this.projectOptions(true),
          },
          { key: 'overwrite', label: 'Overwrite existing secrets', kind: 'boolean', value: 'false' },
          { key: 'force', label: 'Bypass conflict checks', kind: 'boolean', value: 'false' },
        ],
        focus: 0,
        error: null,
        submitLabel: 'Import',
        onSubmit: async (values) => {
          if (!this.vault) return;
          try {
            const content = readTextFile(values.path);
            const result = await importEnvFile({
              uid: this.session!.uid,
              vault: this.vault,
              content,
              environment: normalizeEnvironment(values.env),
              projectId: values.project || null,
              overwrite: values.overwrite === 'true',
              force: values.force === 'true',
            });
            this.state.modal = null;
            this.toast(
              `Import complete · ${result.created} created · ${result.updated} updated · ${result.skipped} skipped`,
              result.failed.length > 0 ? 'warning' : 'success'
            );
            if (result.failed.length > 0 || result.duplicates > 0) {
              const lines = [
                result.duplicates > 0 ? `${result.duplicates} duplicate key(s) collapsed` : '',
                ...result.failed.map((failure) => `${failure.key}: ${failure.error}`),
              ].filter(Boolean);
              this.openViewer({
                title: 'Import report',
                text: lines.join('\n'),
                scroll: 0,
                wrap: true,
              });
            }
            await this.reloadWorkspace();
          } catch (err) {
            form.error = messageOf(err);
          }
        },
      };
      this.openForm(form);
    }, 'import secrets');
  }

  openRunForm(): void {
    this.requireUnlocked(() => {
      const filter = this.state.secrets.filter;
      const form: FormState = {
        title: 'Run with secrets',
        subtitle: 'The child process inherits this terminal. No plaintext file is written.',
        fields: [
          {
            key: 'command',
            label: 'Command',
            kind: 'text',
            value: '',
            required: true,
            placeholder: 'npm run dev',
            help: 'Runs through your system shell with secrets injected into the environment.',
          },
          {
            key: 'project',
            label: 'Project',
            kind: 'select',
            value: filter.projectId ?? '',
            options: this.projectOptions(true),
          },
          {
            key: 'env',
            label: 'Environment',
            kind: 'select',
            value: filter.env ?? '',
            options: [{ label: 'All environments', value: '' }, ...this.enumOptions(ENVIRONMENTS)],
          },
        ],
        focus: 0,
        error: null,
        submitLabel: 'Run',
        onSubmit: async (values) => {
          if (!this.vault) return;
          const scope: SecretFilter = {
            ...this.state.secrets.filter,
            projectId: values.project || null,
            env: values.env || null,
            search: '',
          };
          const secrets = filterSecrets(this.state.data.secrets, scope);
          this.state.modal = null;
          let summary = 'Command finished';
          let warning: string | null = null;
          let ok = true;
          try {
            await this.terminal.suspend(async () => {
              const result = await runCommandWithSecrets(this.vault!, secrets, values.command);
              ok = result.code === 0;
              summary = `Command exited with code ${result.code ?? 'unknown'}`;
              if (result.warnings.length > 0) warning = result.warnings[0];
            });
          } catch (err) {
            ok = false;
            summary = messageOf(err);
          }
          this.toast(warning ? `${summary} · ${warning}` : summary, ok ? 'success' : 'warning');
          this.requestRender();
        },
      };
      this.openForm(form);
    }, 'run a command');
  }

  // ─── Config ───

  openConfigPicker(): void {
    const config = loadConfig();
    const keys = [
      'default.project',
      'default.env',
      'agent.timeout',
      'clipboard.timeout',
      'output.format',
    ];
    this.openPicker({
      title: 'Edit configuration',
      subtitle: 'Stored in ~/.scync/config.json',
      items: keys.map((key) => ({
        label: key,
        value: key,
        hint: config[key] === undefined ? 'not set' : String(config[key]),
      })),
      selected: 0,
      scroll: 0,
      query: '',
      searchable: false,
      onSelect: (key) => {
        const form: FormState = {
          title: `Set ${key}`,
          fields: [
            {
              key: 'value',
              label: 'Value',
              kind: 'text',
              value: config[key] === undefined ? '' : String(config[key]),
              required: key !== 'default.project' && key !== 'default.env',
              placeholder: 'e.g. 15m, 30s, Production, project-id',
            },
          ],
          focus: 0,
          error: null,
          submitLabel: 'Save',
          onSubmit: async (values) => {
            setConfigValue(key, values.value);
            this.state.modal = null;
            this.toast(`${key} = ${values.value || '(unset)'}`, 'success');
          },
        };
        this.openForm(form);
      },
    });
  }

  // ─── Login ───

  async submitLogin(): Promise<void> {
    const login = this.state.login;
    if (login.busy) return;
    if (!login.email.trim() || !login.password) {
      login.error = 'Email and password are required.';
      return;
    }
    login.busy = true;
    login.error = null;
    this.requestRender();
    try {
      await loginWithEmail(login.email, login.password);
      await this.bootstrap();
      this.state.login.password = '';
      this.state.login.passwordCursor = 0;
      this.toast('Signed in', 'success');
    } catch (err) {
      login.error = messageOf(err);
    } finally {
      login.busy = false;
      this.requestRender();
    }
  }

  async startGoogleLogin(): Promise<void> {
    const clientId = process.env.SCYNC_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.SCYNC_GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET || '';
    if (!clientId) {
      this.state.login.error =
        'Google sign-in needs SCYNC_GOOGLE_CLIENT_ID in ~/.scync/.env. Use email/password instead.';
      return;
    }
    this.state.login.busy = true;
    this.state.login.error = null;
    this.requestRender();
    try {
      await this.terminal.suspend(async () => {
        await loginWithGoogle({ clientId, clientSecret });
      });
      await this.bootstrap();
      this.toast('Signed in with Google', 'success');
    } catch (err) {
      this.state.login.error = messageOf(err);
    } finally {
      this.state.login.busy = false;
      this.requestRender();
    }
  }

  // ─── Modal key handling ───

  private async handleModalKey(key: Key): Promise<void> {
    const modal = this.state.modal;
    if (!modal) return;

    if (modal.kind === 'help') {
      if (isSpecial(key, 'escape') || isChar(key, '?')) this.state.modal = null;
      return;
    }

    if (modal.kind === 'viewer') {
      const viewer = modal.viewer;
      const textWidth = Math.max(20, this.layout.width - 10);
      const lines = viewer.wrap ? wrapText(viewer.text, textWidth) : viewer.text.split('\n');
      const viewport = Math.max(1, this.layout.height - 11);
      const maxScroll = Math.max(0, lines.length - viewport);
      if (isSpecial(key, 'up') || isChar(key, 'k')) viewer.scroll = Math.max(0, viewer.scroll - 1);
      else if (isSpecial(key, 'down') || isChar(key, 'j')) viewer.scroll = Math.min(maxScroll, viewer.scroll + 1);
      else if (isSpecial(key, 'pageup')) viewer.scroll = Math.max(0, viewer.scroll - viewport);
      else if (isSpecial(key, 'pagedown')) viewer.scroll = Math.min(maxScroll, viewer.scroll + viewport);
      else if (isSpecial(key, 'home')) viewer.scroll = 0;
      else if (isSpecial(key, 'end')) viewer.scroll = maxScroll;
      else if (isChar(key, 'c')) await this.copyText(viewer.text, viewer.copyLabel ?? 'Content');
      else if (isSpecial(key, 'escape') || isChar(key, 'q')) this.state.modal = null;
      return;
    }

    if (modal.kind === 'confirm') {
      if (isSpecial(key, 'escape') || isChar(key, 'n') || isChar(key, 'q')) {
        this.state.modal = null;
        return;
      }
      if (isSpecial(key, 'enter') || isChar(key, 'y')) {
        this.setBusy('Working…');
        try {
          await modal.onConfirm();
          this.state.modal = null;
        } catch (err) {
          this.toast(messageOf(err), 'error');
        } finally {
          this.setBusy(null);
        }
      }
      return;
    }

    if (modal.kind === 'pick') {
      const picker = modal.picker;
      if (picker.searchable && key.type === 'char' && key.text && !key.ctrl && !key.alt) {
        picker.query += key.text;
        picker.selected = 0;
        return;
      }
      if (picker.searchable && isSpecial(key, 'backspace')) {
        picker.query = [...picker.query].slice(0, -1).join('');
        picker.selected = 0;
        return;
      }
      const filtered = picker.query.trim()
        ? picker.items.filter((item) =>
            `${item.label} ${item.value} ${item.hint ?? ''}`.toLowerCase().includes(picker.query.trim().toLowerCase())
          )
        : picker.items;
      if (isSpecial(key, 'up') || isChar(key, 'k')) picker.selected = Math.max(0, picker.selected - 1);
      else if (isSpecial(key, 'down') || isChar(key, 'j')) {
        picker.selected = Math.min(Math.max(0, filtered.length - 1), picker.selected + 1);
      } else if (isSpecial(key, 'pageup')) picker.selected = Math.max(0, picker.selected - 8);
      else if (isSpecial(key, 'pagedown')) picker.selected = Math.min(Math.max(0, filtered.length - 1), picker.selected + 8);
      else if (isSpecial(key, 'escape')) this.state.modal = null;
      else if (isSpecial(key, 'enter')) {
        const item = filtered[picker.selected];
        if (item) {
          this.state.modal = null;
          try {
            await picker.onSelect(item.value);
          } catch (err) {
            this.toast(messageOf(err), 'error');
          }
        }
      }
      return;
    }

    if (modal.kind === 'form') {
      await this.handleFormKey(modal.form, key);
    }
  }

  private async handleFormKey(form: FormState, key: Key): Promise<void> {
    if (form.busy) return;

    if (isSpecial(key, 'escape')) {
      form.onCancel?.();
      this.state.modal = null;
      return;
    }
    if (isSpecial(key, 'tab')) {
      const direction = key.shift ? -1 : 1;
      form.focus = (form.focus + direction + form.fields.length) % form.fields.length;
      return;
    }
    if (key.ctrl && key.text === 's') {
      await this.submitForm(form);
      return;
    }

    const field = form.fields[form.focus];
    if (!field) return;
    if (form.fields.length === 0) return;

    if (field.kind === 'select') {
      const options = field.options ?? [];
      const index = options.findIndex((option) => option.value === field.value);
      if (isSpecial(key, 'left') || isChar(key, 'h')) {
        field.value = options[(index - 1 + options.length) % options.length]?.value ?? field.value;
        return;
      }
      if (isSpecial(key, 'right') || isChar(key, 'l')) {
        field.value = options[(index + 1) % options.length]?.value ?? field.value;
        return;
      }
      if (isSpecial(key, 'enter')) {
        await this.submitForm(form);
        return;
      }
      if (isSpecial(key, 'up') || isSpecial(key, 'down')) {
        const direction = isSpecial(key, 'up') ? -1 : 1;
        form.focus = (form.focus + direction + form.fields.length) % form.fields.length;
        return;
      }
      return;
    }

    if (field.kind === 'boolean') {
      if (key.type === 'char' && key.text === ' ') {
        field.value = field.value === 'true' ? 'false' : 'true';
        return;
      }
      if (isSpecial(key, 'enter')) {
        await this.submitForm(form);
        return;
      }
      if (isSpecial(key, 'left') || isSpecial(key, 'right') || isChar(key, ' ')) {
        field.value = field.value === 'true' ? 'false' : 'true';
        return;
      }
      if (isSpecial(key, 'up') || isSpecial(key, 'down')) {
        const direction = isSpecial(key, 'up') ? -1 : 1;
        form.focus = (form.focus + direction + form.fields.length) % form.fields.length;
        return;
      }
      return;
    }

    // Text-like fields.
    if (isSpecial(key, 'enter')) {
      if (field.kind === 'textarea') {
        const editor = new TextEditor(field.value);
        editor.cursor = field.cursor ?? field.value.length;
        editor.insert('\n');
        field.value = editor.value;
        field.cursor = editor.cursor;
        return;
      }
      await this.submitForm(form);
      return;
    }

    const editor = new TextEditor(field.value);
    editor.cursor = field.cursor ?? field.value.length;
    const textareaWidth = Math.max(20, Math.min(84, this.terminal.width - 4) - 6);

    if (isSpecial(key, 'backspace')) editor.backspace();
    else if (isSpecial(key, 'delete')) editor.del();
    else if (isSpecial(key, 'left')) editor.left();
    else if (isSpecial(key, 'right')) editor.right();
    else if (isSpecial(key, 'home')) editor.home();
    else if (isSpecial(key, 'end')) editor.end();
    else if (isSpecial(key, 'up')) {
      if (field.kind === 'textarea') editor.up(textareaWidth);
      else {
        form.focus = (form.focus - 1 + form.fields.length) % form.fields.length;
        return;
      }
    } else if (isSpecial(key, 'down')) {
      if (field.kind === 'textarea') editor.down(textareaWidth);
      else {
        form.focus = (form.focus + 1) % form.fields.length;
        return;
      }
    } else if (key.ctrl && key.text === 'u') {
      editor.clearBefore();
    } else if (key.ctrl && key.text === 'w') {
      editor.deleteWordBefore();
    } else if (key.type === 'paste' && key.text) {
      editor.insert(key.text);
    } else if (key.type === 'char' && key.text && !key.ctrl && !key.alt) {
      editor.insert(key.text);
    } else {
      return;
    }

    if (field.maxLength && editor.value.length > field.maxLength) {
      editor.set(editor.value.slice(0, field.maxLength));
    }
    field.value = editor.value;
    field.cursor = editor.cursor;
  }

  private async submitForm(form: FormState): Promise<void> {
    const missing = form.fields.find((field) => field.required && !field.value.trim());
    if (missing) {
      form.error = `${missing.label} is required.`;
      return;
    }
    form.error = null;
    form.busy = true;
    this.requestRender();
    try {
      const values = Object.fromEntries(form.fields.map((field) => [field.key, field.value]));
      await form.onSubmit(values);
      const current = this.state.modal;
      if (current?.kind === 'form' && current.form === form) form.busy = false;
    } catch (err) {
      form.error = messageOf(err);
      form.busy = false;
      if (this.state.modal?.kind !== 'form') {
        this.toast(form.error, 'error');
      }
    }
    this.requestRender();
  }

  // ─── Rendering ───

  private drawMain(buf: Buffer): void {
    const info = {
      email: this.session?.email ?? null,
      version: this.version,
      now: this.now,
      locked: !this.state.unlocked,
      agentStatus: this.state.agent.status,
      agentTtlMs: this.state.agent.ttlRemainingMs,
    };
    drawHeader(buf, this.theme, this.layout, this.state, info);
    drawSidebar(buf, this.theme, this.layout, this.state);

    const main = this.layout.main;
    switch (this.state.view) {
      case 'dashboard':
        renderDashboard(this, buf, main);
        break;
      case 'secrets':
        renderSecretsView(this, buf, main);
        break;
      case 'projects':
        renderProjectsView(this, buf, main);
        break;
      case 'passwords':
        renderPasswordsView(this, buf, main);
        break;
      case 'totp':
        renderTotpView(this, buf, main);
        break;
      case 'ssh':
        renderSshView(this, buf, main);
        break;
      case 'certs':
        renderCertsView(this, buf, main);
        break;
      case 'tools':
        renderToolsView(this, buf, main);
        break;
      case 'settings':
        renderSettingsView(this, buf, main);
        break;
    }

    const toastActive = this.state.toast && this.state.toast.until > this.now ? this.state.toast : null;
    const statusLeft = toastActive
      ? { text: toastActive.message, type: toastActive.type }
      : this.state.errors.length > 0
        ? { text: this.state.errors[0], type: 'warning' as const }
        : undefined;

    drawFooter(buf, this.theme, this.layout, {
      hints: this.hintsForView(),
      statusLeft,
      busy: this.state.busy,
      spinnerFrame: this.spinnerFrame,
      email: this.session?.email ?? null,
      locked: !this.state.unlocked,
      now: this.now,
    });
  }

  private hintsForView(): Array<{ key: string; label: string }> {
    if (this.state.modal) {
      return [
        { key: 'Tab', label: 'next' },
        { key: 'Enter', label: 'confirm' },
        { key: 'Esc', label: 'close' },
      ];
    }
    const common = [
      { key: this.state.unlocked ? 'L' : 'U', label: this.state.unlocked ? 'lock' : 'unlock' },
      { key: '←→', label: 'views' },
      { key: '1-9', label: 'jump' },
      { key: '?', label: 'help' },
      { key: 'q', label: 'quit' },
    ];
    const byView: Record<ViewId, Array<{ key: string; label: string }>> = {
      dashboard: [
        { key: 'n', label: 'new secret' },
        { key: 'a', label: 'attention' },
        { key: 'U', label: 'unlock' },
        { key: 't', label: 'tools' },
      ],
      secrets: this.state.secrets.searching
        ? [
            { key: 'Enter', label: 'finish search' },
            { key: 'Esc', label: 'finish' },
          ]
        : [
            { key: '↑↓', label: 'move' },
            { key: 'Enter', label: 'detail' },
            { key: 'r', label: 'reveal' },
            { key: 'c', label: 'copy' },
            { key: 'e', label: 'edit' },
            { key: 'n', label: 'new' },
            { key: '/', label: 'search' },
            { key: 'f', label: 'filters' },
          ],
      projects: [
        { key: 'Enter', label: 'filter' },
        { key: 'n', label: 'new' },
        { key: 'e', label: 'edit' },
        { key: 'd', label: 'delete' },
        { key: '/', label: 'search' },
      ],
      passwords: [
        { key: 'r', label: 'reveal' },
        { key: 'c', label: 'password' },
        { key: 'u', label: 'username' },
        { key: 'l', label: 'URL' },
        { key: '/', label: 'search' },
      ],
      totp: [
        { key: 'c', label: 'copy code' },
        { key: 's', label: 'copy secret' },
        { key: 'r', label: 'retry' },
      ],
      ssh: [
        { key: 'c', label: 'public' },
        { key: 'p', label: 'private' },
        { key: 'y', label: 'copy private' },
        { key: 'E', label: 'export' },
        { key: 'g', label: 'config' },
      ],
      certs: [
        { key: 'v', label: 'PEM' },
        { key: 'c', label: 'copy PEM' },
        { key: 'p', label: 'private' },
        { key: 'y', label: 'copy key' },
      ],
      tools: [
        { key: '↑↓', label: 'select' },
        { key: 'Enter', label: 'run' },
      ],
      settings: [
        { key: 'U', label: 'unlock' },
        { key: 'L', label: 'lock' },
        { key: 'o', label: 'logout' },
        { key: 'c', label: 'config' },
      ],
    };
    return [...(byView[this.state.view] ?? []), ...common];
  }

  // ─── Tick & shutdown ───

  private startTick(): void {
    this.tickTimer = setInterval(() => {
      this.now = Date.now();
      this.spinnerFrame++;
      let changed = false;

      for (const [id, entry] of this.secretPlaintext) {
        if (entry.until <= this.now) {
          this.secretPlaintext.delete(id);
          delete this.state.revealedUntil[`secret:${id}`];
          changed = true;
        }
      }
      for (const [id, entry] of this.passwordPlaintext) {
        if (entry.until <= this.now) {
          this.passwordPlaintext.delete(id);
          changed = true;
        }
      }
      if (this.state.toast && this.state.toast.until <= this.now) {
        this.state.toast = null;
        changed = true;
      }

      if (this.state.agent.status === 'unlocked') {
        const remaining = Math.max(0, this.agentTtlUntil - this.now);
        if (remaining !== this.state.agent.ttlRemainingMs) {
          this.state.agent.ttlRemainingMs = remaining;
          changed = true;
        }
        if (remaining === 0) {
          this.state.agent.status = 'locked';
          this.state.unlocked = false;
          this.vault = null;
          this.totpSecrets.clear();
          this.secretPlaintext.clear();
          this.passwordPlaintext.clear();
          this.toast('Key agent idle timeout elapsed — vault locked', 'warning');
          changed = true;
        }
      }

      if (this.state.view === 'totp') {
        const tokens = this.state.data.totp;
        const list = this.state.lists.totp;
        const selected = tokens[list.selected];
        if (selected && this.state.unlocked && !this.totpSecrets.has(selected.id)) {
          this.ensureTotpSecret(selected);
        }
        changed = true; // countdown needs repainting
      }

      if (changed || this.state.busy) this.requestRender();
    }, 1000);
    if (typeof this.tickTimer.unref === 'function') this.tickTimer.unref();
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private shutdown(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.stopTick();
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.terminal.exit();
    this.resolveExit?.();
    this.resolveExit = null;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
