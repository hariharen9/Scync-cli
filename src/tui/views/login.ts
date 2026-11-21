import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isSpecial } from '../keys.js';
import { truncate, wrapText } from '../width.js';
import { drawPanel } from '../widgets.js';
import { isGoogleLoginEnabled } from '../../core/firebase.js';
function centered(width: number, height: number, w: number, h: number): Rect {
  const rw = Math.max(30, Math.min(w, width - 6));
  const rh = Math.max(12, Math.min(h, height - 4));
  return {
    x: Math.floor((width - rw) / 2),
    y: Math.floor((height - rh) / 2),
    w: rw,
    h: rh,
  };
}

export function renderLogin(
  app: TuiApp,
  buf: Buffer,
  width: number,
  height: number
): { cursor: { x: number; y: number } | null } {
  const { theme, state } = app;
  const { p, g } = theme;
  buf.fill(0, 0, width, height, { bg: p.bg });

  // Subtle top/bottom accent bands.
  buf.fill(0, 0, width, 1, { bg: p.accentDim });
  buf.fill(0, height - 1, width, 1, { bg: p.panel });

  const rect = centered(width, height, 68, 23);
  drawPanel(buf, theme, rect, 'SIGN IN', { focused: true });

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;

  buf.put(x, y, g.dot, { fg: p.accent, bold: true });
  buf.put(x + 2, y, 'SCYNC', { fg: p.white, bold: true });
  buf.put(x + 9, y, `v${app.version}`, { fg: p.faint });
  y++;
  buf.put(x, y, 'Your secrets. Synced. Encrypted. Everywhere.', { fg: p.muted }, w);
  y++;
  buf.put(x, y, 'Sign in with the same account you use on the Scync web app.', { fg: p.faint }, w);
  y += 2;

  const inputWidth = w - 2;
  const email = state.login.email;
  const password = state.login.password;

  const drawField = (
    label: string,
    value: string,
    cursorIndex: number,
    masked: boolean,
    focused: boolean,
    placeholder: string
  ): { x: number; y: number } => {
    buf.put(x, y, label, { fg: focused ? p.accentSoft : p.muted, bold: focused }, w);
    y++;
    buf.fill(x, y, inputWidth, 1, { bg: p.panelAlt, fg: p.text });
    const display = masked ? '•'.repeat([...value].length) : value;
    const before = masked
      ? [...value.slice(0, cursorIndex)].length
      : [...value.slice(0, cursorIndex)].length;
    const chars = [...display];
    const start = Math.max(0, before - (inputWidth - 2));
    const visible = chars.slice(start, start + inputWidth - 2).join('');
    buf.put(x + 1, y, visible || '', { fg: p.text }, inputWidth - 2);
    if (!value && focused) buf.put(x + 1, y, placeholder, { fg: p.faint }, inputWidth - 2);
    const cursor = { x: x + 1 + (before - start), y };
    y += 2;
    return cursor;
  };

  const emailCursor = drawField(
    'Email',
    email,
    state.login.emailCursor,
    false,
    state.login.focus === 0,
    'you@example.com'
  );
  const passwordCursor = drawField(
    'Password',
    password,
    state.login.passwordCursor,
    true,
    state.login.focus === 1,
    'account password'
  );

  if (state.login.error) {
    const lines = truncate(state.login.error, w).split('\n');
    for (const line of lines.slice(0, 2)) {
      buf.put(x, y, line, { fg: p.danger }, w);
      y++;
    }
  } else {
    y++;
  }

  if (state.login.busy) {
    buf.put(x, y, `${g.spinner[Math.floor(app.now / 100) % g.spinner.length]} Signing in…`, {
      fg: p.accentSoft,
    });
  } else {
    buf.put(x, y, '[ Enter ]', { fg: p.bg, bg: p.accent, bold: true });
    buf.put(x + 11, y, 'Sign in', { fg: p.accent, bold: true });
    if (isGoogleLoginEnabled()) {
      buf.put(x + 22, y, '[ F2 ]', { fg: p.bg, bg: p.panelAlt, bold: true });
      buf.put(x + 29, y, 'Google', { fg: p.muted });
    }
  }
  y += 2;

  if (!isGoogleLoginEnabled()) {
    for (const line of wrapText(
      'Sign in with your Scync account email and password. No Google setup required.',
      w
    ).slice(0, 2)) {
      if (y >= rect.y + rect.h - 2) break;
      buf.put(x, y++, line, { fg: p.faint }, w);
    }
  }

  for (const line of wrapText(
    'The login only proves identity. Your vault master password is separate, never stored, and cannot be recovered if forgotten.',
    w
  ).slice(0, 3)) {
    if (y >= rect.y + rect.h - 2) break;
    buf.put(x, y++, line, { fg: p.faint }, w);
  }

  const footerY = rect.y + rect.h - 2;
  buf.fill(rect.x + 1, footerY, rect.w - 2, 1, { bg: p.panel });
  buf.put(
    rect.x + 2,
    footerY,
    ` ${truncate('Tab next field · Enter sign in · F2 Google · Ctrl+C quit', rect.w - 5)} `,
    { fg: p.faint, bg: p.panel },
    rect.w - 3
  );

  return { cursor: state.login.focus === 0 ? emailCursor : passwordCursor };
}

function codepointPrev(value: string, index: number): number {
  if (index <= 0) return 0;
  const cp = value.codePointAt(index - 2);
  return cp !== undefined && cp > 0xffff ? index - 2 : index - 1;
}

function codepointNext(value: string, index: number): number {
  if (index >= value.length) return value.length;
  const cp = value.codePointAt(index);
  return index + (cp !== undefined && cp > 0xffff ? 2 : 1);
}

export function handleLoginKey(app: TuiApp, key: Key): void {
  const login = app.state.login;
  if (login.busy) return;

  if (isSpecial(key, 'tab') || isSpecial(key, 'up') || isSpecial(key, 'down')) {
    login.focus = login.focus === 0 ? 1 : 0;
    return;
  }
  if (isSpecial(key, 'enter')) {
    void app.submitLogin();
    return;
  }
  if (isSpecial(key, 'f2')) {
    void app.startGoogleLogin();
    return;
  }
  if (isSpecial(key, 'escape')) {
    login.error = null;
    return;
  }

  const isEmail = login.focus === 0;
  let value = isEmail ? login.email : login.password;
  let cursor = isEmail ? login.emailCursor : login.passwordCursor;
  const apply = (nextValue: string, nextCursor: number) => {
    if (isEmail) {
      login.email = nextValue;
      login.emailCursor = nextCursor;
    } else {
      login.password = nextValue;
      login.passwordCursor = nextCursor;
    }
  };

  if (isSpecial(key, 'backspace')) {
    if (cursor === 0) return;
    const prev = codepointPrev(value, cursor);
    apply(value.slice(0, prev) + value.slice(cursor), prev);
    return;
  }
  if (isSpecial(key, 'delete')) {
    const next = codepointNext(value, cursor);
    apply(value.slice(0, cursor) + value.slice(next), cursor);
    return;
  }
  if (isSpecial(key, 'left')) {
    apply(value, codepointPrev(value, cursor));
    return;
  }
  if (isSpecial(key, 'right')) {
    apply(value, codepointNext(value, cursor));
    return;
  }
  if (isSpecial(key, 'home')) {
    apply(value, 0);
    return;
  }
  if (isSpecial(key, 'end')) {
    apply(value, value.length);
    return;
  }
  if (key.ctrl && key.text === 'u') {
    apply('', 0);
    return;
  }
  if (key.type === 'paste' && key.text) {
    const text = key.text.replace(/\r?\n/g, ' ');
    apply(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
    return;
  }
  if (key.type === 'char' && key.text && !key.ctrl && !key.alt) {
    apply(value.slice(0, cursor) + key.text + value.slice(cursor), cursor + key.text.length);
  }
}
