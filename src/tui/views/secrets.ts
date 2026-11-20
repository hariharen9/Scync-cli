import type { Buffer, Rect, Style } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { StoredSecret } from '../../core/types.js';
import {
  daysUntil,
  envColor,
  filterSecrets,
  formatCountdown,
  formatDate,
  formatRelative,
  projectName,
  riskLabel,
  sortSecrets,
  statusColor,
} from '../format.js';
import { clamp, displayWidth, truncate, wrapText } from '../width.js';
import { drawListRow, drawPanel, drawStatusBadge } from '../widgets.js';

function visibleSecrets(app: TuiApp): StoredSecret[] {
  return sortSecrets(
    filterSecrets(app.state.data.secrets, app.state.secrets.filter),
    app.state.secrets.sort,
    app.state.secrets.sortDirection
  );
}

interface Columns {
  name: number;
  service: number;
  type: number;
  env: number;
  status: number;
  version: number;
  updated: number;
  showService: boolean;
  showType: boolean;
  showEnv: boolean;
  showStatus: boolean;
  showVersion: boolean;
  showUpdated: boolean;
}

function columnsFor(width: number): Columns {
  const showService = width >= 68;
  const showType = width >= 92;
  const showEnv = width >= 52;
  const showStatus = width >= 44;
  const showVersion = width >= 36;
  const showUpdated = width >= 86;
  const fixed =
    (showService ? 12 : 0) +
    (showType ? 14 : 0) +
    (showEnv ? 13 : 0) +
    (showStatus ? 10 : 0) +
    (showVersion ? 4 : 0) +
    (showUpdated ? 10 : 0);
  const count =
    1 +
    (showService ? 1 : 0) +
    (showType ? 1 : 0) +
    (showEnv ? 1 : 0) +
    (showStatus ? 1 : 0) +
    (showVersion ? 1 : 0) +
    (showUpdated ? 1 : 0);
  return {
    name: Math.max(10, width - fixed - count - 1),
    service: 12,
    type: 14,
    env: 13,
    status: 10,
    version: 4,
    updated: 10,
    showService,
    showType,
    showEnv,
    showStatus,
    showVersion,
    showUpdated,
  };
}

export function renderSecretsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const items = visibleSecrets(app);
  state.secrets.selected = clamp(state.secrets.selected, 0, Math.max(0, items.length - 1));

  const wide = rect.w >= 96;
  const showDetail = wide || state.secrets.detail;
  const listW = showDetail && wide ? Math.max(36, Math.floor(rect.w * 0.58)) : rect.w;
  const filterH = 2;
  const listRect: Rect = { x: rect.x, y: rect.y + filterH, w: listW, h: rect.h - filterH };

  renderFilterBar(app, buf, { x: rect.x, y: rect.y, w: rect.w, h: filterH });
  renderSecretsList(app, buf, listRect, items);

  if (showDetail) {
    const detailRect: Rect = wide
      ? { x: rect.x + listW + 2, y: listRect.y, w: rect.w - listW - 2, h: listRect.h }
      : { x: rect.x, y: rect.y + filterH, w: rect.w, h: rect.h - filterH };
    if (!wide) {
      // Narrow detail replaces the list entirely.
      buf.fill(detailRect.x, detailRect.y - filterH, detailRect.w, filterH, { bg: theme.p.bg });
    }
    const selected = items[state.secrets.selected];
    renderSecretDetail(app, buf, detailRect, selected);
  }
}

function renderFilterBar(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  buf.fill(rect.x, rect.y, rect.w, rect.h, { bg: p.bg });
  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, 'Press / to search the whole vault', { fg: p.faint }, Math.max(10, rect.w - 30));
  const right = `sort ${state.secrets.sort} ${state.secrets.sortDirection === 'asc' ? '↑' : '↓'}`;
  buf.put(Math.max(rect.x + 4, rect.x + rect.w - displayWidth(right) - 2), rect.y, right, { fg: p.faint });

  // Filter chips.
  let x = rect.x + 1;
  const chips: Array<{ label: string; active: boolean; color?: string }> = [
    {
      label: `project: ${
        state.secrets.filter.projectId
          ? projectName(state.data.projects, state.secrets.filter.projectId)
          : 'any'
      }`,
      active: Boolean(state.secrets.filter.projectId),
      color: p.purple,
    },
    { label: `env: ${state.secrets.filter.env ?? 'any'}`, active: Boolean(state.secrets.filter.env) },
    { label: `service: ${state.secrets.filter.service ?? 'any'}`, active: Boolean(state.secrets.filter.service) },
    { label: `type: ${state.secrets.filter.type ?? 'any'}`, active: Boolean(state.secrets.filter.type) },
    { label: `status: ${state.secrets.filter.status ?? 'any'}`, active: Boolean(state.secrets.filter.status) },
  ];

  for (const chip of chips) {
    if (x >= rect.x + rect.w - 8) break;
    const text = ` ${chip.label} `;
    const width = displayWidth(text);
    buf.put(x, rect.y + 1, text, {
      fg: chip.active ? p.bg : p.faint,
      bg: chip.active ? chip.color ?? p.accent : p.panel,
    }, width + 1);
    x += width + 1;
  }
  if (x < rect.x + rect.w - 6) {
    buf.put(x + 1, rect.y + 1, 'f filters · x clear', { fg: p.faint });
  }
}

function renderSecretsList(app: TuiApp, buf: Buffer, rect: Rect, items: StoredSecret[]): void {
  const { theme, state, now } = app;
  const { p, g } = theme;
  const focused = state.secrets.focus === 'list';
  const footer = items.length > Math.max(1, rect.h - 4)
    ? `${state.secrets.selected + 1}/${items.length} · ↑↓ move · PgUp/PgDn`
    : `${items.length} secret(s)`;
  drawPanel(buf, theme, rect, 'SECRETS', { focused, footer });

  const innerX = rect.x + 2;
  const innerW = rect.w - 4;
  const columns = columnsFor(innerW);

  // Header.
  let hx = innerX + 2;
  const header = (label: string, width: number) => {
    buf.put(hx, rect.y + 1, label.toUpperCase(), { fg: p.faint, bold: true }, width);
    hx += width + 1;
  };
  buf.put(innerX, rect.y + 1, ' ', {});
  header('NAME', columns.name);
  if (columns.showService) header('SERVICE', columns.service);
  if (columns.showType) header('TYPE', columns.type);
  if (columns.showEnv) header('ENV', columns.env);
  if (columns.showStatus) header('STATUS', columns.status);
  if (columns.showVersion) header('VER', columns.version);
  if (columns.showUpdated) header('UPDATED', columns.updated);
  buf.hline(rect.x + 1, rect.y + 2, rect.w - 2, { fg: p.border }, g.h);

  const top = rect.y + 3;
  const viewport = Math.max(1, rect.h - 4);
  const start = clamp(state.secrets.selected - viewport + 1, 0, Math.max(0, items.length - viewport));
  state.secrets.scroll = start;

  if (items.length === 0) {
    buf.put(innerX, top + 1, 'No secrets match your filters.', { fg: p.faint });
    buf.put(innerX, top + 2, 'Press n to create one, or x to clear filters.', { fg: p.faint });
    return;
  }

  for (let i = 0; i < viewport; i++) {
    const secret = items[start + i];
    if (!secret) break;
    const rowY = top + i;
    const selected = start + i === state.secrets.selected;
    const risk = riskLabel(secret, new Date(now));
    const dotColor = risk?.color === 'danger' ? p.danger : risk ? p.warning : p.borderStrong;

    const parts: Array<{ text: string; style?: Style; width?: number }> = [
      { text: risk ? g.dot : ' ', style: { fg: dotColor }, width: 1 },
      { text: secret.name, style: { fg: selected ? p.text : p.text, bold: selected }, width: columns.name },
    ];
    if (columns.showService) {
      parts.push({ text: secret.service, style: { fg: p.muted }, width: columns.service });
    }
    if (columns.showType) parts.push({ text: secret.type, style: { fg: p.faint }, width: columns.type });
    if (columns.showEnv) {
      parts.push({ text: secret.environment, style: { fg: envColor(theme, secret.environment) }, width: columns.env });
    }
    if (columns.showStatus) {
      parts.push({ text: `${g.dot} ${secret.status}`, style: { fg: statusColor(theme, secret.status) }, width: columns.status });
    }
    if (columns.showVersion) parts.push({ text: `v${secret.version ?? 1}`, style: { fg: p.faint }, width: columns.version });
    if (columns.showUpdated) {
      parts.push({ text: formatRelative(secret.updatedAt, new Date(now)), style: { fg: p.faint }, width: columns.updated });
    }

    drawListRow(buf, theme, rect.x + 1, rowY, rect.w - 2, selected, parts);
  }
}

interface BodyLine {
  segments: Array<{ text: string; style?: Style; width?: number }>;
}

export function renderSecretDetail(app: TuiApp, buf: Buffer, rect: Rect, secret: StoredSecret | undefined): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const focused = state.secrets.focus === 'detail';
  const revealedNow = secret ? app.getRevealedSecret(secret.id) : null;
  drawPanel(buf, theme, rect, 'DETAIL', {
    focused,
    footer: !secret
      ? undefined
      : revealedNow
        ? 'r hide · c copy · e edit · v versions · d delete'
        : state.unlocked
          ? 'r reveal · c copy · e edit · v versions · d delete'
          : 'u unlock to reveal · e edit · v versions · d delete',
  });

  if (!secret) {
    buf.put(rect.x + 2, rect.y + 2, 'Select a secret to inspect it.', { fg: p.faint });
    return;
  }

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;

  buf.put(x, y, truncate(secret.name, Math.max(8, w - 18)), { fg: p.text, bold: true }, Math.max(8, w - 18));
  drawStatusBadge(buf, theme, x + w - displayWidth(secret.status) - 2, y, secret.status, statusColor(theme, secret.status));
  y += 2;

  const metaRow = (label: string, value: string, color?: string) => {
    if (y >= rect.y + rect.h - 2) return;
    buf.put(x, y, label, { fg: p.muted }, 14);
    buf.put(x + 14, y, truncate(value, Math.max(4, w - 14)), { fg: color ?? p.text }, Math.max(4, w - 14));
    y++;
  };

  metaRow('Service', secret.service, p.text);
  metaRow('Type', secret.type, p.text);
  metaRow('Environment', secret.environment, envColor(theme, secret.environment));
  metaRow('Project', projectName(state.data.projects, secret.projectId), p.purple);
  metaRow('Version', `v${secret.version ?? 1}`, p.accentSoft);
  metaRow('Created', formatDate(secret.createdAt));
  metaRow('Updated', formatRelative(secret.updatedAt, new Date(app.now)));
  metaRow('Last rotated', formatRelative(secret.lastRotated, new Date(app.now)));
  if (secret.expiresOn) {
    const days = daysUntil(secret.expiresOn);
    metaRow('Expires', `${formatDate(secret.expiresOn)} (${days >= 0 ? `${days}d` : `expired ${Math.abs(days)}d`})`, days < 0 ? p.danger : days <= 30 ? p.warning : p.text);
  }
  const risk = riskLabel(secret, new Date(app.now));
  if (risk) {
    buf.put(x, y, 'Risk', { fg: p.muted }, 14);
    buf.put(x + 14, y, risk.label, { fg: risk.color === 'danger' ? p.danger : p.warning }, Math.max(4, w - 14));
    y++;
  }

  y++;
  const bodyTop = y;
  if (bodyTop >= rect.y + rect.h - 2) return;
  const bodyBottom = rect.y + rect.h - 1;
  const viewport = Math.max(1, bodyBottom - bodyTop);
  const body: BodyLine[] = [];
  const push = (text: string, style?: Style) => body.push({ segments: [{ text, style }] });
  const section = (label: string) => {
    if (body.length > 0) push('');
    push(label.toUpperCase(), { fg: p.accentSoft, bold: true });
  };

  const revealed = app.getRevealedSecret(secret.id);
  section('Value');
  if (revealed) {
    const lines = wrapText(revealed.value, Math.max(8, w - 2));
    for (const line of lines) push(line, { fg: p.text });
  } else {
    push(`${g.dot.repeat(8)}  press r to reveal`, { fg: p.faint });
  }

  if (revealed || secret.encNotes) {
    section('Notes');
    if (revealed?.notes) {
      for (const line of wrapText(revealed.notes, Math.max(8, w - 2))) push(line, { fg: p.muted });
    } else if (revealed) {
      push('No notes', { fg: p.faint });
    } else {
      push('Press r to reveal notes', { fg: p.faint });
    }
  }

  if (secret.type === 'Recovery Codes') {
    section('Recovery codes');
    if (revealed) {
      try {
        const parsed = JSON.parse(revealed.value) as {
          codes?: Array<{ code: string; used?: boolean; usedAt?: string | null }>;
        };
        const codes = parsed.codes ?? [];
        codes.forEach((code, index) => {
          const used = Boolean(code.used);
          body.push({
            segments: [
              { text: `${String(index + 1).padStart(2, ' ')}. `, style: { fg: p.faint }, width: 4 },
              { text: `${code.code}`, style: { fg: used ? p.faint : p.text, bold: !used }, width: Math.max(10, w - 12) },
              { text: used ? 'USED' : 'UNUSED', style: { fg: used ? p.faint : p.success }, width: 6 },
            ],
          });
        });
        push(`${secret.remainingCodes ?? 0} code(s) remaining`, { fg: p.faint });
      } catch {
        push('Could not parse recovery code set.', { fg: p.danger });
      }
    } else {
      push(`${secret.remainingCodes ?? 0} code(s) remaining · press r to reveal`, { fg: p.faint });
    }
  }

  section('Version history');
  const versions = [...(secret.versions ?? [])].sort((a, b) => b.version - a.version);
  if (versions.length === 0) {
    push(`v${secret.version ?? 1} · current`, { fg: p.muted });
  } else {
    for (const version of versions.slice(0, 10)) {
      const typeColor =
        version.changeType === 'created'
          ? p.success
          : version.changeType === 'rotated'
            ? p.warning
            : version.changeType === 'restored'
              ? p.info
              : p.muted;
      body.push({
        segments: [
          { text: `v${version.version}`.padEnd(5), style: { fg: version.version === secret.version ? p.accentSoft : p.faint }, width: 5 },
          { text: `${version.changeType ?? 'updated'}`.padEnd(10), style: { fg: typeColor }, width: 10 },
          { text: formatRelative(version.createdAt, new Date(app.now)), style: { fg: p.faint }, width: 14 },
        ],
      });
    }
  }

  const maxScroll = Math.max(0, body.length - viewport);
  state.secrets.detailScroll = clamp(state.secrets.detailScroll, 0, maxScroll);
  const start = state.secrets.detailScroll;

  for (let i = 0; i < viewport; i++) {
    const line = body[start + i];
    if (!line) break;
    let lx = x;
    for (const segment of line.segments) {
      if (lx >= x + w) break;
      lx = buf.put(lx, bodyTop + i, segment.text, segment.style ?? { fg: p.text }, segment.width ?? x + w - lx);
      lx += 1;
    }
  }
}

export function handleSecretsKey(app: TuiApp, key: Key): void {
  const state = app.state.secrets;
  const items = visibleSecrets(app);
  const selected = items[state.selected];
  if (isChar(key, 'n')) return app.newSecret();
  if (isChar(key, 'f')) return app.openFilterPicker();
  if (isChar(key, 'x')) {
    app.clearSecretFilters();
    return;
  }
  if (isChar(key, 'o')) {
    app.cycleSecretSort();
    return;
  }
  if (isChar(key, 'O')) {
    app.toggleSecretSortDirection();
    return;
  }
  if (isChar(key, 'p')) {
    app.cycleProjectFilter();
    return;
  }

  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    if (state.focus === 'detail') {
      state.detailScroll = Math.max(0, state.detailScroll - 1);
    } else {
      state.selected = Math.max(0, state.selected - 1);
      state.detailScroll = 0;
    }
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    if (state.focus === 'detail') {
      state.detailScroll++;
    } else {
      state.selected = Math.min(Math.max(0, items.length - 1), state.selected + 1);
      state.detailScroll = 0;
    }
    return;
  }
  if (isSpecial(key, 'pageup')) {
    if (state.focus === 'detail') state.detailScroll = Math.max(0, state.detailScroll - 6);
    else state.selected = Math.max(0, state.selected - 8);
    return;
  }
  if (isSpecial(key, 'pagedown')) {
    if (state.focus === 'detail') state.detailScroll += 6;
    else state.selected = Math.min(Math.max(0, items.length - 1), state.selected + 8);
    return;
  }
  if (isSpecial(key, 'home')) {
    if (state.focus === 'detail') state.detailScroll = 0;
    else state.selected = 0;
    return;
  }
  if (isSpecial(key, 'end')) {
    if (state.focus === 'detail') state.detailScroll = 9999;
    else state.selected = Math.max(0, items.length - 1);
    return;
  }

  if (isSpecial(key, 'tab')) {
    if (!app.isWideLayout()) {
      state.detail = !state.detail;
      state.focus = state.detail ? 'detail' : 'list';
    } else {
      state.focus = state.focus === 'list' ? 'detail' : 'list';
    }
    return;
  }

  if (isSpecial(key, 'enter')) {
    if (!app.isWideLayout()) {
      state.detail = true;
      state.focus = 'detail';
    } else {
      state.focus = 'detail';
    }
    return;
  }

  if (isSpecial(key, 'escape')) {
    if (state.detail) state.detail = false;
    else if (state.focus === 'detail') state.focus = 'list';
    else if (hasFilters(state.filter)) app.clearSecretFilters();
    else app.goBack();
    return;
  }

  if (!selected) return;

  if (isChar(key, 'r')) return void app.revealSecret(selected);
  if (isChar(key, 'c')) return void app.copySecretValue(selected);
  if (isChar(key, 'y')) return void app.copySecretNotes(selected);
  if (isChar(key, 's')) return void app.viewSecretValue(selected);
  if (isChar(key, 'e')) return void app.editSecret(selected);
  if (isChar(key, 'R')) return app.rotateSecret(selected);
  if (isChar(key, 'v')) return app.restoreSecret(selected);
  if (isChar(key, 'd')) return app.deleteSecret(selected);
}

function hasFilters(filter: TuiApp['state']['secrets']['filter']): boolean {
  return Boolean(filter.projectId || filter.env || filter.service || filter.type || filter.status || filter.search);
}
