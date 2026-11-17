import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { StoredTOTP } from '../../core/types.js';
import { getRemainingSeconds } from '../../core/totp.js';
import { matchesText, sortByName } from '../format.js';
import { clamp, displayWidth, truncate } from '../width.js';
import { drawListRow, drawPanel, drawProgressBar } from '../widgets.js';

function visibleTokens(app: TuiApp): StoredTOTP[] {
  const list = app.state.lists.totp;
  return app.state.data.totp
    .filter((token) =>
      matchesText(list.query, token.issuer, token.label, token.algorithm, String(token.digits))
    )
    .sort((a, b) =>
      `${a.issuer} ${a.label}`.localeCompare(`${b.issuer} ${b.label}`, undefined, {
        sensitivity: 'base',
      })
    );
}

export function renderTotpView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const list = state.lists.totp;
  const tokens = visibleTokens(app);
  list.selected = clamp(list.selected, 0, Math.max(0, tokens.length - 1));

  const wide = rect.w >= 96;
  const showDetail = wide || list.detail;
  const listW = showDetail && wide ? Math.max(40, Math.floor(rect.w * 0.52)) : rect.w;

  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, list.query || 'Search tokens…', {
    fg: list.query ? p.text : p.faint,
  }, Math.max(10, rect.w - 24));
  const countLabel = `${tokens.length} token(s)`;
  buf.put(rect.x + rect.w - displayWidth(countLabel) - 2, rect.y, countLabel, { fg: p.faint });

  const listRect: Rect = { x: rect.x, y: rect.y + 1, w: listW, h: rect.h - 1 };
  drawPanel(buf, theme, listRect, 'TOTP TOKENS', {
    focused: true,
    footer: 'Enter details · c copy code · s copy secret · / search',
  });

  const x = listRect.x + 2;
  const w = listRect.w - 4;
  const issuerW = Math.max(12, Math.floor(w * 0.3));
  const labelW = Math.max(12, Math.floor(w * 0.36));

  let hx = x;
  buf.put(hx, listRect.y + 1, 'ISSUER', { fg: p.faint, bold: true }, issuerW);
  hx += issuerW + 1;
  buf.put(hx, listRect.y + 1, 'ACCOUNT', { fg: p.faint, bold: true }, labelW);
  hx += labelW + 1;
  buf.put(hx, listRect.y + 1, 'STEP', { fg: p.faint, bold: true }, 6);
  buf.put(hx + 7, listRect.y + 1, 'ALGO', { fg: p.faint, bold: true }, 8);
  buf.hline(listRect.x + 1, listRect.y + 2, listRect.w - 2, { fg: p.border }, g.h);

  const top = listRect.y + 3;
  const viewport = Math.max(1, listRect.h - 4);
  const start = clamp(list.selected - viewport + 1, 0, Math.max(0, tokens.length - viewport));
  list.scroll = start;

  if (tokens.length === 0) {
    buf.put(x, top + 1, list.query ? 'No tokens match your search.' : 'No TOTP tokens in your vault.', {
      fg: p.faint,
    });
  } else {
    for (let i = 0; i < viewport; i++) {
      const token = tokens[start + i];
      if (!token) break;
      const remaining = getRemainingSeconds(token.period);
      drawListRow(buf, theme, listRect.x + 1, top + i, listRect.w - 2, start + i === list.selected, [
        { text: token.issuer || '—', style: { fg: p.text, bold: start + i === list.selected }, width: issuerW },
        { text: token.label || '—', style: { fg: p.muted }, width: labelW },
        { text: `${token.period}s`, style: { fg: p.faint }, width: 6 },
        { text: `${token.algorithm} · ${token.digits}`, style: { fg: p.faint }, width: 10 },
      ]);
      const barColor = remaining <= 5 ? p.danger : remaining <= 10 ? p.warning : p.success;
      buf.put(listRect.x + listRect.w - 8, top + i, `${String(remaining).padStart(2)}s`, { fg: barColor });
    }
  }

  if (showDetail) {
    const detailRect: Rect = wide
      ? { x: rect.x + listW + 2, y: listRect.y, w: rect.w - listW - 2, h: listRect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    renderTotpDetail(app, buf, detailRect, tokens[list.selected]);
  }
}

function renderTotpDetail(app: TuiApp, buf: Buffer, rect: Rect, token: StoredTOTP | undefined): void {
  const { theme, state } = app;
  const { p, g } = theme;
  drawPanel(buf, theme, rect, 'AUTHENTICATOR', {
    focused: true,
    footer: token ? 'c copy code · s copy base32 secret · r retry decrypt' : undefined,
  });

  if (!token) {
    buf.put(rect.x + 2, rect.y + 2, 'Select a token to generate a code.', { fg: p.faint });
    return;
  }

  if (!state.unlocked) {
    buf.put(rect.x + 2, rect.y + 2, 'Vault is locked.', { fg: p.warning, bold: true });
    buf.put(rect.x + 2, rect.y + 3, 'Press u to unlock, then codes appear here.', { fg: p.faint });
    return;
  }

  const result = app.getTotpCode(token);
  if (!result) {
    app.ensureTotpSecret(token);
    buf.put(rect.x + 2, rect.y + 2, 'Decrypting token…', { fg: p.faint });
    return;
  }

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;

  buf.put(x, y, truncate(token.issuer || 'Authenticator', Math.max(8, w)), { fg: p.text, bold: true }, w);
  y++;
  buf.put(x, y, truncate(token.label, Math.max(8, w)), { fg: p.muted }, w);
  y += 2;

  const padded = result.code.length === 6 ? `${result.code.slice(0, 3)}  ${result.code.slice(3)}` : result.code;
  const codeY = y + 1;
  buf.put(x + Math.max(0, Math.floor((w - displayWidth(padded)) / 2)), codeY, padded, {
    fg: result.remaining <= 5 ? p.danger : p.accentSoft,
    bold: true,
  });
  y = codeY + 2;

  drawProgressBar(buf, theme, x, y, Math.max(10, w - 2), result.remaining / result.period);
  y++;
  buf.put(
    x,
    y,
    `${result.remaining}s remaining · ${token.algorithm} · ${token.digits} digits · ${token.period}s step`,
    { fg: p.faint },
    w
  );
  y += 2;

  buf.put(x, y, 'SECRET', { fg: p.accentSoft, bold: true }, w);
  y++;
  buf.put(x, y, `${g.dot.repeat(8)}  press s to copy the base32 secret`, { fg: p.faint }, w);
}

export function handleTotpKey(app: TuiApp, key: Key): void {
  const list = app.state.lists.totp;
  const tokens = visibleTokens(app);
  const selected = tokens[list.selected];

  if (list.searching) {
    if (isSpecial(key, 'enter') || isSpecial(key, 'escape')) {
      list.searching = false;
      return;
    }
    if (isSpecial(key, 'backspace')) {
      list.query = [...list.query].slice(0, -1).join('');
      list.selected = 0;
      return;
    }
    if (key.type === 'char' && key.text && !key.ctrl && !key.alt) {
      list.query += key.text;
      list.selected = 0;
    }
    return;
  }

  if (isChar(key, '/')) return void (list.searching = true);
  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    list.selected = Math.max(0, list.selected - 1);
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    list.selected = Math.min(Math.max(0, tokens.length - 1), list.selected + 1);
    return;
  }
  if (isSpecial(key, 'tab') || isSpecial(key, 'enter')) {
    list.detail = !list.detail;
    return;
  }
  if (isSpecial(key, 'escape')) {
    if (list.detail) list.detail = false;
    else if (list.query) {
      list.query = '';
      list.selected = 0;
    } else app.goBack();
    return;
  }
  if (!selected) return;

  if (isChar(key, 'c')) return void app.copyTotpCode(selected);
  if (isChar(key, 's')) return void app.copyTotpSecret(selected);
  if (isChar(key, 'r')) {
    app.ensureTotpSecret(selected, true);
  }
}
