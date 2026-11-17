import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import {
  attentionCount,
  formatRelative,
  getAttentionSecrets,
  projectColorHex,
} from '../format.js';
import { displayWidth, truncate } from '../width.js';
import { drawListRow, drawPanel, drawStat } from '../widgets.js';

interface AttentionItem {
  id: string;
  name: string;
  reasons: string[];
  color: string;
}

function attentionItems(app: TuiApp): AttentionItem[] {
  const buckets = getAttentionSecrets(app.state.data.secrets);
  const map = new Map<string, AttentionItem>();
  const add = (secretId: string, name: string, reason: string, color: string) => {
    const existing = map.get(secretId);
    if (existing) existing.reasons.push(reason);
    else map.set(secretId, { id: secretId, name, reasons: [reason], color });
  };

  for (const secret of buckets.expired) add(secret.id, secret.name, 'expired', app.theme.p.danger);
  for (const secret of buckets.expiringSoon) add(secret.id, secret.name, 'expiring soon', app.theme.p.warning);
  for (const secret of buckets.rotationOverdue) add(secret.id, secret.name, 'rotation overdue', app.theme.p.warning);
  for (const secret of buckets.recoveryCodesLow) {
    add(secret.id, secret.name, `${secret.remainingCodes ?? 0} recovery codes left`, app.theme.p.danger);
  }

  return [...map.values()];
}

export function renderDashboard(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state, now } = app;
  const { p } = theme;
  const secrets = state.data.secrets;
  const buckets = getAttentionSecrets(secrets, new Date(now));
  const attention = attentionItems(app);
  const active = secrets.filter((secret) => secret.status === 'Active').length;
  const locked = !state.unlocked;

  const gap = 2;
  const cols = rect.w >= 104 ? 4 : rect.w >= 74 ? 3 : 2;
  const tileW = Math.max(14, Math.floor((rect.w - gap * (cols - 1)) / cols));
  const tileH = 4;
  const tiles: Array<{ label: string; value: string; color: string; sub: string }> = [
    {
      label: 'Secrets',
      value: String(secrets.length),
      color: p.text,
      sub: `${active} active · ${secrets.length - active} other`,
    },
    {
      label: 'Attention',
      value: String(attentionCount(buckets)),
      color: attentionCount(buckets) > 0 ? p.warning : p.success,
      sub: attentionCount(buckets) > 0 ? 'review required' : 'all clear',
    },
    {
      label: 'Projects',
      value: String(state.data.projects.length),
      color: p.purple,
      sub: 'organise your vault',
    },
    {
      label: 'Agent',
      value: locked ? 'Locked' : 'Unlocked',
      color: locked ? p.warning : p.success,
      sub: locked ? 'press u to unlock' : 'key in memory',
    },
    {
      label: 'Passwords',
      value: String(state.data.passwords.length),
      color: p.info,
      sub: 'website logins',
    },
    {
      label: 'TOTP',
      value: String(state.data.totp.length),
      color: p.accentSoft,
      sub: '2FA tokens',
    },
    {
      label: 'SSH keys',
      value: String(state.data.ssh.length),
      color: p.accent,
      sub: 'key pairs',
    },
    {
      label: 'Certificates',
      value: String(state.data.certs.length),
      color: p.pink,
      sub: 'X.509 certs',
    },
  ];

  let y = rect.y;
  for (let i = 0; i < tiles.length; i += cols) {
    if (y + tileH > rect.y + rect.h) break;
    for (let c = 0; c < cols; c++) {
      const tile = tiles[i + c];
      if (!tile) break;
      drawStat(
        buf,
        theme,
        { x: rect.x + c * (tileW + gap), y, w: tileW, h: tileH },
        tile.label,
        tile.value,
        tile.color,
        tile.sub
      );
    }
    y += tileH + 1;
  }

  const remaining = rect.y + rect.h - y;
  if (remaining < 5) return;

  const side = rect.w >= 96;
  const leftW = side ? Math.floor((rect.w - 2) * 0.58) : rect.w;
  const rightW = side ? rect.w - leftW - 2 : rect.w;
  const sectionH = side ? Math.min(remaining, 14) : Math.min(remaining, 10);

  // Attention list.
  const attentionRect: Rect = { x: rect.x, y, w: leftW, h: sectionH };
  drawPanel(buf, theme, attentionRect, 'NEEDS ATTENTION', {
    footer: attention.length > 0 ? `${attention.length} item(s) · press a to open` : undefined,
  });
  let row = attentionRect.y + 2;
  if (attention.length === 0) {
    buf.put(attentionRect.x + 2, row, `${theme.g.check} All clear — nothing needs attention`, {
      fg: p.success,
    });
  } else {
    const viewport = attentionRect.h - 4;
    const reasonW = Math.min(30, Math.max(14, Math.floor(leftW * 0.34)));
    const nameW = Math.max(8, leftW - reasonW - 7);
    for (const item of attention.slice(0, viewport)) {
      buf.fill(attentionRect.x + 1, row, attentionRect.w - 2, 1, { bg: p.panel });
      buf.put(attentionRect.x + 2, row, theme.g.dot, { fg: item.color });
      buf.put(attentionRect.x + 4, row, truncate(item.name, nameW), { fg: p.text, bold: true }, nameW);
      buf.put(
        attentionRect.x + leftW - reasonW - 2,
        row,
        truncate(item.reasons.join(' · '), reasonW),
        { fg: item.color },
        reasonW
      );
      row++;
    }
  }

  // Recently updated.
  const recentRect: Rect = side
    ? { x: rect.x + leftW + 2, y, w: rightW, h: sectionH }
    : { x: rect.x, y: y + sectionH + 1, w: rect.w, h: Math.max(4, rect.y + rect.h - (y + sectionH + 1)) };
  drawPanel(buf, theme, recentRect, 'RECENTLY UPDATED');
  const recent = [...secrets].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 8);
  row = recentRect.y + 2;
  if (recent.length === 0) {
    buf.put(recentRect.x + 2, row, 'No secrets yet — press n to create one', { fg: p.faint });
  } else {
    const viewport = recentRect.h - 4;
    for (const secret of recent.slice(0, viewport)) {
      drawListRow(buf, theme, recentRect.x + 1, row, recentRect.w - 2, false, [
        { text: secret.name, style: { fg: p.text, bold: true }, width: Math.max(8, recentRect.w - 20) },
        { text: `v${secret.version ?? 1}`, style: { fg: p.faint }, width: 3 },
        { text: formatRelative(secret.updatedAt, new Date(now)), style: { fg: p.faint }, width: 9 },
      ]);
      row++;
    }
  }

  // Project breakdown when there is room (side-by-side layout only; the
  // stacked layout already gives the remaining height to recent updates).
  if (side && y + sectionH + 5 < rect.y + rect.h) {
    const projectRect: Rect = {
      x: rect.x,
      y: y + sectionH + 1,
      w: rect.w,
      h: Math.min(8, rect.y + rect.h - (y + sectionH + 1)),
    };
    renderProjectsMini(app, buf, projectRect);
  }
}

function renderProjectsMini(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p } = theme;
  drawPanel(buf, theme, rect, 'PROJECT BREAKDOWN');
  const projects = state.data.projects.slice(0, Math.max(1, rect.h - 3));
  let row = rect.y + 2;
  if (projects.length === 0) {
    buf.put(rect.x + 2, row, 'No projects — press 3 to create one', { fg: p.faint });
    return;
  }
  const max = Math.max(1, ...projects.map((project) =>
    state.data.secrets.filter((secret) => secret.projectId === project.id).length
  ));
  for (const project of projects) {
    const count = state.data.secrets.filter((secret) => secret.projectId === project.id).length;
    const barW = Math.max(6, Math.floor(rect.w * 0.28));
    const filled = Math.max(1, Math.round((count / max) * barW));
    buf.put(rect.x + 2, row, theme.g.dot, { fg: projectColorHex(project.color) });
    buf.put(rect.x + 4, row, truncate(project.name, 20), { fg: p.muted }, 20);
    buf.put(rect.x + 26, row, theme.g.bar.repeat(filled), { fg: projectColorHex(project.color) });
    buf.put(rect.x + 26 + filled + 1, row, String(count), { fg: p.faint });
    row++;
  }
}

export function handleDashboardKey(app: TuiApp, key: Key): void {
  if (isChar(key, 'a')) {
    const items = attentionItems(app);
    if (items.length === 0) {
      app.toast('Nothing needs attention', 'success');
      return;
    }
    app.openPicker({
      title: 'Needs attention',
      items: items.map((item) => ({ label: item.name, value: item.id, hint: item.reasons.join(', '), color: item.color })),
      selected: 0,
      scroll: 0,
      query: '',
      searchable: true,
      onSelect: (id) => {
        const secret = app.state.data.secrets.find((entry) => entry.id === id);
        if (secret) app.openSecret(secret);
      },
    });
    return;
  }
  if (isChar(key, 'n')) return app.newSecret();
  if (isChar(key, 'U')) return app.unlockVault();
  if (isChar(key, 'L')) return void app.lockVault();
  if (isChar(key, 't')) return app.setView('tools');
  if (isSpecial(key, 'enter')) {
    const first = app.state.data.secrets
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (first) app.openSecret(first);
  }
}
