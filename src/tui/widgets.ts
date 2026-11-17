import type { Buffer, Rect, Style } from './buffer.js';
import type { Theme } from './theme.js';
import type { AppState, ViewId } from './state.js';
import { VIEW_META, VIEW_ORDER } from './state.js';
import { displayWidth, padEnd, truncate } from './width.js';
import { formatCountdown, projectColorHex, projectName, plural } from './format.js';

export const HEADER_H = 1;
export const FOOTER_H = 3;

export interface Layout {
  width: number;
  height: number;
  header: Rect;
  content: Rect;
  sidebar: Rect | null;
  main: Rect;
  footer: Rect;
  dividerTop: number;
  dividerBottom: number;
}

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const sidebarWidth = w >= 112 ? 27 : w >= 88 ? 23 : 0;
  const contentY = HEADER_H + 1;
  const contentH = Math.max(1, h - contentY - FOOTER_H);
  const sidebar: Rect | null =
    sidebarWidth > 0 ? { x: 0, y: contentY, w: sidebarWidth, h: contentH } : null;
  const mainX = sidebarWidth > 0 ? sidebarWidth + 1 : 0;
  const mainW = Math.max(1, w - mainX);

  return {
    width: w,
    height: h,
    header: { x: 0, y: 0, w, h: HEADER_H },
    content: { x: 0, y: contentY, w, h: contentH },
    sidebar,
    main: { x: mainX, y: contentY, w: mainW, h: contentH },
    footer: { x: 0, y: h - FOOTER_H, w, h: FOOTER_H },
    dividerTop: HEADER_H,
    dividerBottom: h - FOOTER_H,
  };
}

export interface ChromeInfo {
  email: string | null;
  version: string;
  now: number;
  locked: boolean;
  agentStatus: 'unknown' | 'locked' | 'unlocked';
  agentTtlMs: number;
}

export function drawHeader(buf: Buffer, theme: Theme, layout: Layout, state: AppState, info: ChromeInfo): void {
  const { p, g } = theme;
  const y = layout.header.y;

  buf.fill(0, y, layout.width, 1, { bg: p.bgAlt, fg: p.text });
  buf.put(1, y, g.dot, { fg: p.accent, bold: true });
  buf.put(3, y, 'SCYNC', { fg: p.white, bold: true });
  let x = 3 + displayWidth('SCYNC');
  x = buf.put(x + 1, y, `v${info.version}`, { fg: p.faint });

  const view = VIEW_META[state.view];
  x = buf.put(x + 2, y, '/', { fg: p.borderStrong });
  x = buf.put(x + 2, y, view.label, { fg: p.text, bold: true });
  buf.put(x + 2, y, view.hint, { fg: p.faint }, Math.max(0, layout.width - x - 20));

  const lockLabel = info.locked ? ' LOCKED ' : ' UNLOCKED ';
  const lockColor = info.locked ? p.warning : p.success;
  const rightParts: Array<{ text: string; style: Style; pad?: number }> = [
    { text: lockLabel, style: { fg: p.bg, bg: lockColor, bold: true } },
  ];
  if (info.agentStatus === 'unlocked' && info.agentTtlMs > 0) {
    rightParts.push({ text: ` ${formatCountdown(info.agentTtlMs)} `, style: { fg: p.accentSoft } });
  }
  if (info.email) {
    rightParts.push({ text: `${info.email} `, style: { fg: p.muted } });
  }

  const total = rightParts.reduce((sum, part) => sum + displayWidth(part.text) + (part.pad ?? 0), 0);
  let rx = Math.max(1, layout.width - total - 1);
  for (const part of rightParts) {
    buf.put(rx, y, part.text, part.style);
    rx += displayWidth(part.text) + (part.pad ?? 0);
  }

  buf.hline(0, layout.dividerTop, layout.width, { fg: p.border }, g.h);
}

export function drawSidebar(buf: Buffer, theme: Theme, layout: Layout, state: AppState): void {
  if (!layout.sidebar) return;
  const { p, g } = theme;
  const { x, y, w, h } = layout.sidebar;
  buf.fill(x, y, w, h, { bg: p.panel, fg: p.text });
  buf.vline(x + w - 1, y, h, { fg: p.border }, g.v);

  buf.put(x + 2, y, 'NAVIGATE', { fg: p.faint, bold: true });
  let row = y + 1;

  const counts: Record<ViewId, string> = {
    dashboard: '',
    secrets: String(state.data.secrets.length),
    projects: String(state.data.projects.length),
    passwords: String(state.data.passwords.length),
    totp: String(state.data.totp.length),
    ssh: String(state.data.ssh.length),
    certs: String(state.data.certs.length),
    tools: '',
    settings: '',
  };

  for (let i = 0; i < VIEW_ORDER.length; i++) {
    if (row >= y + h - 1) break;
    const view = VIEW_ORDER[i];
    const meta = VIEW_META[view];
    const active = state.view === view;
    const rowStyle: Style = active
      ? { bg: p.panelAlt, fg: p.text, bold: true }
      : { fg: p.muted };

    if (active) {
      buf.fill(x, row, w - 1, 1, { bg: p.panelAlt });
      buf.fill(x, row, 1, 1, { bg: p.accent });
    }

    buf.put(x + 2, row, String(i + 1), { fg: active ? p.accent : p.faint }, 1);
    buf.put(x + 4, row, `[${meta.tag}]`, { fg: active ? p.accentSoft : p.faint }, 4);
    buf.put(x + 9, row, meta.label, rowStyle, Math.max(0, w - 14));
    const count = counts[view];
    if (count) {
      buf.put(x + w - 1 - displayWidth(count) - 2, row, count, { fg: active ? p.text : p.faint });
    }
    row++;
  }

  row++;
  if (row < y + h - 6) {
    buf.put(x + 2, row, 'PROJECTS', { fg: p.faint, bold: true });
    row++;
    const projects = [...state.data.projects].slice(0, Math.max(0, y + h - row - 6));
    if (projects.length === 0) {
      buf.put(x + 2, row, 'No projects yet', { fg: p.faint });
      row++;
    } else {
      for (const project of projects) {
        const count = state.data.secrets.filter((secret) => secret.projectId === project.id).length;
        buf.put(x + 2, row, g.dot, { fg: projectColorHex(project.color) });
        buf.put(x + 4, row, project.name, { fg: p.muted }, Math.max(0, w - 12));
        buf.put(x + w - displayWidth(String(count)) - 3, row, String(count), { fg: p.faint });
        row++;
      }
    }
  }

  // Agent custody card at the bottom.
  const cardY = y + h - 4;
  if (cardY > row + 1) {
    buf.hline(x + 1, cardY - 1, w - 2, { fg: p.border }, g.h);
    const unlocked = state.agent.status === 'unlocked';
    const color = unlocked ? p.success : p.warning;
    const label = unlocked ? 'AGENT UNLOCKED' : state.agent.status === 'locked' ? 'AGENT LOCKED' : 'AGENT UNKNOWN';
    buf.put(x + 2, cardY, g.dot, { fg: color });
    buf.put(x + 4, cardY, label, { fg: color, bold: true }, Math.max(0, w - 8));
    const ttl =
      unlocked && state.agent.ttlRemainingMs > 0
        ? `${formatCountdown(state.agent.ttlRemainingMs)} idle TTL`
        : state.unlocked
          ? 'key held in-process'
          : 'press u to unlock';
    buf.put(x + 2, cardY + 1, ttl, { fg: p.faint }, Math.max(0, w - 4));
  }
}

export interface FooterInfo {
  hints: Array<{ key: string; label: string }>;
  statusLeft?: { text: string; type: 'info' | 'success' | 'warning' | 'error' };
  busy?: string | null;
  spinnerFrame: number;
  email: string | null;
  locked: boolean;
  now: number;
}

export function drawFooter(buf: Buffer, theme: Theme, layout: Layout, info: FooterInfo): void {
  const { p, g } = theme;
  const y = layout.dividerBottom;
  buf.hline(0, y, layout.width, { fg: p.border }, g.h);
  buf.fill(0, y + 1, layout.width, 2, { bg: p.bg });

  // Hints line.
  let x = 1;
  for (let i = 0; i < info.hints.length; i++) {
    const hint = info.hints[i];
    if (x >= layout.width - 2) break;
    x = buf.put(x, y + 1, hint.key, { fg: p.accent, bold: true }, Math.max(0, layout.width - x - 1));
    x = buf.put(x + 1, y + 1, hint.label, { fg: p.muted }, Math.max(0, layout.width - x - 2));
    if (i < info.hints.length - 1 && x < layout.width - 3) {
      x = buf.put(x + 2, y + 1, g.bullet, { fg: p.faint });
      x += 1;
    }
  }

  // Status line.
  if (info.busy) {
    const frame = g.spinner[info.spinnerFrame % g.spinner.length];
    buf.put(1, y + 2, frame, { fg: p.accent, bold: true });
    buf.put(3, y + 2, info.busy, { fg: p.accentSoft });
  } else if (info.statusLeft) {
    const color =
      info.statusLeft.type === 'success'
        ? p.success
        : info.statusLeft.type === 'warning'
          ? p.warning
          : info.statusLeft.type === 'error'
            ? p.danger
            : p.info;
    buf.put(1, y + 2, info.statusLeft.text, { fg: color }, Math.max(0, layout.width - 30));
  }

  const right = `${info.email ? `${info.email} · ` : ''}${info.locked ? 'locked' : 'unlocked'} · ${new Date(
    info.now
  ).toLocaleTimeString()}`;
  buf.put(
    Math.max(1, layout.width - displayWidth(right) - 1),
    y + 2,
    right,
    { fg: p.faint },
    layout.width
  );
}

export function drawPanel(
  buf: Buffer,
  theme: Theme,
  rect: Rect,
  title?: string,
  options: { focused?: boolean; footer?: string; background?: string } = {}
): void {
  const { p, g } = theme;
  buf.fill(rect.x, rect.y, rect.w, rect.h, {
    bg: options.background ?? p.panel,
    fg: p.text,
  });
  buf.box(
    rect,
    { fg: options.focused ? p.borderStrong : p.border, bg: options.background ?? p.panel },
    g,
    title,
    { fg: options.focused ? p.accentSoft : p.muted, bold: true }
  );
  if (options.footer && rect.h > 3) {
    const label = truncate(options.footer, Math.max(1, rect.w - 5));
    buf.put(
      rect.x + 2,
      rect.y + rect.h - 1,
      ` ${label} `,
      { fg: p.faint, bg: options.background ?? p.panel },
      Math.max(1, rect.w - 3)
    );
  }
}

export function drawStat(
  buf: Buffer,
  theme: Theme,
  rect: Rect,
  label: string,
  value: string,
  color = theme.p.text,
  sub?: string
): void {
  const { p, g } = theme;
  buf.fill(rect.x, rect.y, rect.w, rect.h, { bg: p.panel, fg: p.text });
  buf.box(rect, { fg: p.border, bg: p.panel }, g);
  buf.put(rect.x + 2, rect.y + 1, label.toUpperCase(), { fg: p.faint, bold: true }, Math.max(0, rect.w - 4));
  buf.put(rect.x + 2, rect.y + 2, value, { fg: color, bold: true }, Math.max(0, rect.w - 4));
  if (sub && rect.h > 4) {
    buf.put(rect.x + 2, rect.y + 3, sub, { fg: p.faint }, Math.max(0, rect.w - 4));
  }
}

export function drawSectionLabel(buf: Buffer, theme: Theme, x: number, y: number, label: string, width = 200): number {
  const { p, g } = theme;
  buf.put(x, y, label.toUpperCase(), { fg: p.faint, bold: true }, width);
  const used = displayWidth(label) + 1;
  if (width > used + 2) {
    buf.hline(x + used + 1, y, Math.max(0, width - used - 1), { fg: p.border }, g.h);
  }
  return y + 1;
}

export function drawLabelValue(
  buf: Buffer,
  theme: Theme,
  x: number,
  y: number,
  label: string,
  value: string,
  width: number,
  valueColor = theme.p.text
): number {
  const labelWidth = 16;
  buf.put(x, y, label, { fg: theme.p.muted }, labelWidth);
  buf.put(x + labelWidth, y, value, { fg: valueColor }, Math.max(1, width - labelWidth));
  return y + 1;
}

export function drawStatusBadge(buf: Buffer, theme: Theme, x: number, y: number, label: string, color: string): number {
  const text = ` ${label} `;
  buf.put(x, y, text, { fg: theme.p.bg, bg: color, bold: true });
  return x + displayWidth(text);
}

export function drawEnvBadge(buf: Buffer, theme: Theme, x: number, y: number, environment: string, color: string): number {
  const text = `[${environment}]`;
  buf.put(x, y, text, { fg: color });
  return x + displayWidth(text);
}

export function drawProgressBar(
  buf: Buffer,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  ratio: number
): void {
  const { p, g } = theme;
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  buf.put(x, y, g.bar.repeat(filled), { fg: p.accent });
  buf.put(x + filled, y, g.barEmpty.repeat(Math.max(0, width - filled)), { fg: p.borderStrong });
}

export function drawListRow(
  buf: Buffer,
  theme: Theme,
  x: number,
  y: number,
  width: number,
  selected: boolean,
  content: Array<{ text: string; style?: Style; width?: number }>
): void {
  const { p } = theme;
  if (selected) {
    buf.fill(x, y, width, 1, { bg: p.panelAlt });
    buf.fill(x, y, 1, 1, { bg: p.accent });
  }
  let cx = x + 2;
  for (const part of content) {
    if (cx >= x + width) break;
    if (part.width !== undefined) {
      const text = padEnd(truncate(part.text, part.width), part.width);
      buf.put(cx, y, text, part.style ?? { fg: p.text }, part.width);
      cx += part.width + 1;
    } else {
      const max = x + width - cx - 1;
      cx = buf.put(cx, y, part.text, part.style ?? { fg: p.text }, Math.max(0, max));
      cx += 1;
    }
  }
}

export function emptyState(
  buf: Buffer,
  theme: Theme,
  rect: Rect,
  title: string,
  subtitle?: string,
  action?: string
): void {
  const { p } = theme;
  const cy = rect.y + Math.max(1, Math.floor(rect.h / 2) - 2);
  const tx = rect.x + Math.max(2, Math.floor((rect.w - displayWidth(title)) / 2));
  buf.put(tx, cy, title, { fg: p.muted, bold: true });
  if (subtitle) {
    const wrapped = truncate(subtitle, Math.max(10, rect.w - 8));
    buf.put(
      rect.x + Math.max(2, Math.floor((rect.w - displayWidth(wrapped)) / 2)),
      cy + 1,
      wrapped,
      { fg: p.faint }
    );
  }
  if (action) {
    buf.put(
      rect.x + Math.max(2, Math.floor((rect.w - displayWidth(action)) / 2)),
      cy + 3,
      action,
      { fg: p.accentSoft }
    );
  }
}

export function projectLabel(state: AppState, projectId: string | null): string {
  return projectName(state.data.projects, projectId);
}

export function secretCountLabel(count: number): string {
  return plural(count, 'secret');
}

export function pad(value: string, width: number): string {
  return padEnd(value, width);
}
