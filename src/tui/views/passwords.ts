import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { StoredPassword } from '../../core/types.js';
import { formatRelative, sortByName } from '../format.js';
import { clamp, displayWidth, truncate, wrapText } from '../width.js';
import { drawListRow, drawPanel } from '../widgets.js';

function visiblePasswords(app: TuiApp): StoredPassword[] {
  return sortByName(app.state.data.passwords);
}

export function renderPasswordsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const list = state.lists.passwords;
  const passwords = visiblePasswords(app);
  list.selected = clamp(list.selected, 0, Math.max(0, passwords.length - 1));

  const wide = rect.w >= 96;
  const showDetail = wide || list.detail;
  const listW = showDetail && wide ? Math.max(38, Math.floor(rect.w * 0.56)) : rect.w;

  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, 'Press / to search the whole vault', { fg: p.faint }, Math.max(10, rect.w - 24));
  const countLabel = `${passwords.length} login(s)`;
  buf.put(rect.x + rect.w - displayWidth(countLabel) - 2, rect.y, countLabel, { fg: p.faint });

  const listRect: Rect = { x: rect.x, y: rect.y + 1, w: listW, h: rect.h - 1 };
  drawPanel(buf, theme, listRect, 'PASSWORDS', {
    focused: true,
    footer: 'Enter details · r reveal · c copy password · u copy username · / search',
  });

  const x = listRect.x + 2;
  const w = listRect.w - 4;
  const nameW = Math.max(14, Math.floor(w * 0.3));
  const userW = Math.max(12, Math.floor(w * 0.3));
  const passW = 12;
  const urlW = Math.max(8, w - nameW - userW - passW - 4);

  let hx = x;
  buf.put(hx, listRect.y + 1, 'TITLE', { fg: p.faint, bold: true }, nameW);
  hx += nameW + 1;
  buf.put(hx, listRect.y + 1, 'USERNAME', { fg: p.faint, bold: true }, userW);
  hx += userW + 1;
  buf.put(hx, listRect.y + 1, 'PASSWORD', { fg: p.faint, bold: true }, passW);
  hx += passW + 1;
  if (w > nameW + userW + passW + 10) {
    buf.put(hx, listRect.y + 1, 'URL', { fg: p.faint, bold: true }, urlW);
  }
  buf.hline(listRect.x + 1, listRect.y + 2, listRect.w - 2, { fg: p.border }, g.h);

  const top = listRect.y + 3;
  const viewport = Math.max(1, listRect.h - 4);
  const start = clamp(list.selected - viewport + 1, 0, Math.max(0, passwords.length - viewport));
  list.scroll = start;

  if (passwords.length === 0) {
    buf.put(x, top + 1, 'No passwords in your vault yet.', {
      fg: p.faint,
    });
  } else {
    for (let i = 0; i < viewport; i++) {
      const entry = passwords[start + i];
      if (!entry) break;
      const parts = [
        { text: entry.name, style: { fg: p.text, bold: start + i === list.selected }, width: nameW },
        { text: entry.username || '—', style: { fg: p.muted }, width: userW },
        { text: '••••••••', style: { fg: p.faint }, width: passW },
      ];
      if (w > nameW + userW + passW + 10) {
        parts.push({ text: entry.url || '—', style: { fg: p.faint }, width: urlW });
      }
      drawListRow(buf, theme, listRect.x + 1, top + i, listRect.w - 2, start + i === list.selected, parts);
    }
  }

  if (showDetail) {
    const detailRect: Rect = wide
      ? { x: rect.x + listW + 2, y: listRect.y, w: rect.w - listW - 2, h: listRect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    renderPasswordDetail(app, buf, detailRect, passwords[list.selected]);
  }
}

function renderPasswordDetail(app: TuiApp, buf: Buffer, rect: Rect, entry: StoredPassword | undefined): void {
  const { theme } = app;
  const { p, g } = theme;
  const revealed = entry ? app.getRevealedPassword(entry.id) : null;
  drawPanel(buf, theme, rect, 'LOGIN DETAIL', {
    focused: true,
    footer: entry ? 'r reveal · c copy password · u username · l URL · y notes · v view notes' : undefined,
  });

  if (!entry) {
    buf.put(rect.x + 2, rect.y + 2, 'Select a login to inspect it.', { fg: p.faint });
    return;
  }

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;
  buf.put(x, y, truncate(entry.name, Math.max(8, w)), { fg: p.text, bold: true }, w);
  y += 2;

  const row = (label: string, value: string, color = p.text) => {
    if (y >= rect.y + rect.h - 2) return;
    buf.put(x, y, label, { fg: p.muted }, 14);
    buf.put(x + 14, y, truncate(value, Math.max(4, w - 14)), { fg: color }, Math.max(4, w - 14));
    y++;
  };
  row('Username', entry.username || '—', p.text);
  row('Category', entry.category || 'General', p.purple);
  row('URL', entry.url || '—', p.info);
  row('Created', formatRelative(entry.createdAt, new Date(app.now)));
  row('Updated', formatRelative(entry.updatedAt, new Date(app.now)));
  y++;
  if (y >= rect.y + rect.h - 2) return;

  buf.put(x, y, 'PASSWORD', { fg: p.accentSoft, bold: true }, w);
  y++;
  if (revealed) {
    for (const line of wrapText(revealed.password, Math.max(8, w - 2))) {
      buf.put(x, y++, line, { fg: p.text }, w);
    }
  } else {
    buf.put(x, y++, `${g.dot.repeat(8)}  press r to reveal`, { fg: p.faint }, w);
  }
  y++;

  buf.put(x, y, 'NOTES', { fg: p.accentSoft, bold: true }, w);
  y++;
  if (revealed?.notes) {
    for (const line of wrapText(revealed.notes, Math.max(8, w - 2))) {
      if (y >= rect.y + rect.h - 1) break;
      buf.put(x, y++, line, { fg: p.muted }, w);
    }
  } else {
    buf.put(x, y, revealed ? 'No notes' : 'Press r to reveal notes', { fg: p.faint }, w);
  }
}

export function handlePasswordsKey(app: TuiApp, key: Key): void {
  const list = app.state.lists.passwords;
  const passwords = visiblePasswords(app);
  const selected = passwords[list.selected];

  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    list.selected = Math.max(0, list.selected - 1);
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    list.selected = Math.min(Math.max(0, passwords.length - 1), list.selected + 1);
    return;
  }
  if (isSpecial(key, 'tab') || isSpecial(key, 'enter')) {
    list.detail = !list.detail;
    return;
  }
  if (isSpecial(key, 'escape')) {
    if (list.detail) list.detail = false;
    else app.goBack();
    return;
  }
  if (!selected) return;

  if (isChar(key, 'r')) return void app.revealPassword(selected);
  if (isChar(key, 'c')) return void app.copyPassword(selected);
  if (isChar(key, 'u')) return void app.copyUsername(selected);
  if (isChar(key, 'l')) return void app.copyPasswordField(selected, 'url');
  if (isChar(key, 'y')) return void app.copyPasswordField(selected, 'notes');
  if (isChar(key, 'v')) return void app.viewPasswordNotes(selected);
}
