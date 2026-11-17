import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { StoredSSHKey } from '../../core/types.js';
import { formatRelative, matchesText, sortByName } from '../format.js';
import { clamp, displayWidth, truncate, wrapText } from '../width.js';
import { drawListRow, drawPanel } from '../widgets.js';

function visibleKeys(app: TuiApp): StoredSSHKey[] {
  const list = app.state.lists.ssh;
  return sortByName(
    app.state.data.ssh.filter((key) =>
      matchesText(list.query, key.name, key.type, key.fingerprint, key.hosts.join(' '))
    )
  );
}

export function renderSshView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const list = state.lists.ssh;
  const keys = visibleKeys(app);
  list.selected = clamp(list.selected, 0, Math.max(0, keys.length - 1));

  const wide = rect.w >= 96;
  const showDetail = wide || list.detail;
  const listW = showDetail && wide ? Math.max(40, Math.floor(rect.w * 0.55)) : rect.w;

  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, list.query || 'Search SSH keys…', {
    fg: list.query ? p.text : p.faint,
  }, Math.max(10, rect.w - 24));
  const countLabel = `${keys.length} key(s)`;
  buf.put(rect.x + rect.w - displayWidth(countLabel) - 2, rect.y, countLabel, { fg: p.faint });

  const listRect: Rect = { x: rect.x, y: rect.y + 1, w: listW, h: rect.h - 1 };
  drawPanel(buf, theme, listRect, 'SSH KEYS', {
    focused: true,
    footer: 'Enter details · c copy public · p private · y copy private · E export · g config',
  });

  const x = listRect.x + 2;
  const w = listRect.w - 4;
  const nameW = Math.max(12, Math.floor(w * 0.26));
  const typeW = 13;
  const fpW = Math.max(14, Math.floor(w * 0.3));
  const hostsW = Math.max(8, w - nameW - typeW - fpW - 4);

  let hx = x;
  buf.put(hx, listRect.y + 1, 'KEY NAME', { fg: p.faint, bold: true }, nameW);
  hx += nameW + 1;
  buf.put(hx, listRect.y + 1, 'TYPE', { fg: p.faint, bold: true }, typeW);
  hx += typeW + 1;
  buf.put(hx, listRect.y + 1, 'FINGERPRINT', { fg: p.faint, bold: true }, fpW);
  hx += fpW + 1;
  buf.put(hx, listRect.y + 1, 'HOSTS', { fg: p.faint, bold: true }, hostsW);
  buf.hline(listRect.x + 1, listRect.y + 2, listRect.w - 2, { fg: p.border }, g.h);

  const top = listRect.y + 3;
  const viewport = Math.max(1, listRect.h - 4);
  const start = clamp(list.selected - viewport + 1, 0, Math.max(0, keys.length - viewport));
  list.scroll = start;

  if (keys.length === 0) {
    buf.put(x, top + 1, list.query ? 'No keys match your search.' : 'No SSH keys in your vault.', { fg: p.faint });
  } else {
    for (let i = 0; i < viewport; i++) {
      const key = keys[start + i];
      if (!key) break;
      drawListRow(buf, theme, listRect.x + 1, top + i, listRect.w - 2, start + i === list.selected, [
        { text: key.name, style: { fg: p.text, bold: start + i === list.selected }, width: nameW },
        { text: key.type, style: { fg: p.accentSoft }, width: typeW },
        { text: key.fingerprint, style: { fg: p.faint }, width: fpW },
        { text: key.hosts.length ? key.hosts.join(', ') : '—', style: { fg: p.muted }, width: hostsW },
      ]);
    }
  }

  if (showDetail) {
    const detailRect: Rect = wide
      ? { x: rect.x + listW + 2, y: listRect.y, w: rect.w - listW - 2, h: listRect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    renderSshDetail(app, buf, detailRect, keys[list.selected]);
  }
}

function renderSshDetail(app: TuiApp, buf: Buffer, rect: Rect, key: StoredSSHKey | undefined): void {
  const { theme, state } = app;
  const { p } = theme;
  drawPanel(buf, theme, rect, 'KEY DETAIL', {
    focused: true,
    footer: key ? 'c public · p private · y copy private · E export · g config' : undefined,
  });

  if (!key) {
    buf.put(rect.x + 2, rect.y + 2, 'Select a key to inspect it.', { fg: p.faint });
    return;
  }

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;
  buf.put(x, y, truncate(key.name, Math.max(8, w)), { fg: p.text, bold: true }, w);
  y += 2;

  const row = (label: string, value: string, color = p.text) => {
    if (y >= rect.y + rect.h - 2) return;
    buf.put(x, y, label, { fg: p.muted }, 14);
    buf.put(x + 14, y, truncate(value, Math.max(4, w - 14)), { fg: color }, Math.max(4, w - 14));
    y++;
  };
  row('Type', key.type, p.accentSoft);
  row('Fingerprint', key.fingerprint, p.text);
  row('Hosts', key.hosts.length ? key.hosts.join(', ') : '—', p.info);
  row('Created', formatRelative(key.createdAt, new Date(app.now)));
  row('Rotated', formatRelative(key.rotationDate, new Date(app.now)));
  y++;
  if (y >= rect.y + rect.h - 2) return;

  buf.put(x, y, 'PUBLIC KEY', { fg: p.accentSoft, bold: true }, w);
  y++;
  for (const line of wrapText(key.publicKey, Math.max(8, w - 2))) {
    if (y >= rect.y + rect.h - 1) break;
    buf.put(x, y++, line, { fg: p.muted }, w);
  }

  if (!state.unlocked) {
    y++;
    if (y < rect.y + rect.h - 1) {
      buf.put(x, y, 'Private key is encrypted — press u to unlock.', { fg: p.warning });
    }
  }
}

export function handleSshKey(app: TuiApp, key: Key): void {
  const list = app.state.lists.ssh;
  const keys = visibleKeys(app);
  const selected = keys[list.selected];

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
    list.selected = Math.min(Math.max(0, keys.length - 1), list.selected + 1);
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

  if (isChar(key, 'c')) return void app.copySshPublic(selected);
  if (isChar(key, 'p')) return void app.viewSshPrivate(selected);
  if (isChar(key, 'y')) return void app.copySshPrivate(selected);
  if (isChar(key, 'E')) return app.exportSshKey(selected);
  if (isChar(key, 'g')) return void app.copySshConfig();
}
