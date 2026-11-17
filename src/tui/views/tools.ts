import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import { projectName } from '../format.js';
import { displayWidth, truncate } from '../width.js';
import { drawPanel } from '../widgets.js';

interface ToolItem {
  label: string;
  description: string;
  badge: string;
  color: 'accent' | 'info' | 'warning' | 'danger' | 'purple';
  action: (app: TuiApp) => void;
}

const TOOLS: ToolItem[] = [
  {
    label: 'Export .env',
    description: 'Decrypt active secrets to a dotenv file with owner-only permissions',
    badge: 'EXPORT',
    color: 'accent',
    action: (app) => app.openExportForm(),
  },
  {
    label: 'Import .env',
    description: 'Create or update secrets from a dotenv file with per-item reporting',
    badge: 'IMPORT',
    color: 'info',
    action: (app) => app.openImportForm(),
  },
  {
    label: 'Run command with secrets',
    description: 'Inject active secrets into a child process without writing them to disk',
    badge: 'RUN',
    color: 'purple',
    action: (app) => app.openRunForm(),
  },
  {
    label: 'Unlock vault',
    description: 'Derive the master key and start the short-lived key agent',
    badge: 'UNLOCK',
    color: 'accent',
    action: (app) => app.unlockVault(),
  },
  {
    label: 'Lock vault',
    description: 'Purge in-memory keys and terminate the agent immediately',
    badge: 'LOCK',
    color: 'warning',
    action: (app) => void app.lockVault(),
  },
  {
    label: 'Settings',
    description: 'Identity, vault metadata, agent custody and local configuration',
    badge: 'SETTINGS',
    color: 'info',
    action: (app) => app.setView('settings'),
  },
  {
    label: 'Log out',
    description: 'Remove stored credentials and return to the sign-in screen',
    badge: 'LOGOUT',
    color: 'danger',
    action: (app) => app.logout(),
  },
];

export function renderToolsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p } = theme;
  state.toolIndex = Math.max(0, Math.min(TOOLS.length - 1, state.toolIndex));

  const wide = rect.w >= 96;
  const menuW = wide ? Math.max(44, Math.floor(rect.w * 0.6)) : rect.w;
  const menuRect: Rect = { x: rect.x, y: rect.y, w: menuW, h: rect.h };
  drawPanel(buf, theme, menuRect, 'WORKFLOWS & TOOLS', {
    focused: true,
    footer: '↑↓ select · Enter run · 1-9 switch views',
  });

  const x = menuRect.x + 2;
  const w = menuRect.w - 4;
  let y = menuRect.y + 2;
  const viewport = Math.max(1, menuRect.h - 4);

  TOOLS.forEach((tool, index) => {
    if (index >= viewport) return;
    const selected = index === state.toolIndex;
    const rowY = y + index;
    if (selected) {
      buf.fill(menuRect.x + 1, rowY, menuRect.w - 2, 1, { bg: p.panelAlt });
      buf.fill(menuRect.x + 1, rowY, 1, 1, { bg: p.accent });
    }
    const badgeColor =
      tool.color === 'accent'
        ? p.accent
        : tool.color === 'info'
          ? p.info
          : tool.color === 'warning'
            ? p.warning
            : tool.color === 'danger'
              ? p.danger
              : p.purple;
    const badge = ` ${tool.badge} `;
    buf.put(x, rowY, badge, { fg: p.bg, bg: badgeColor, bold: true });
    buf.put(x + displayWidth(badge) + 2, rowY, tool.label, { fg: selected ? p.text : p.muted, bold: selected }, Math.max(8, w - displayWidth(badge) - 4));
    buf.put(x + 2, rowY + 1, truncate(tool.description, Math.max(8, w - 4)), { fg: p.faint });
    y++;
  });

  if (wide) {
    const sideRect: Rect = { x: rect.x + menuW + 2, y: rect.y, w: rect.w - menuW - 2, h: rect.h };
    renderScopePanel(app, buf, sideRect);
  }
}

function renderScopePanel(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  drawPanel(buf, theme, rect, 'CURRENT SCOPE');

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;
  const row = (label: string, value: string, color = p.text) => {
    buf.put(x, y, label, { fg: p.muted }, 14);
    buf.put(x + 14, y, truncate(value, Math.max(4, w - 14)), { fg: color }, Math.max(4, w - 14));
    y++;
  };

  row('Project', state.secrets.filter.projectId ? projectName(state.data.projects, state.secrets.filter.projectId) : 'Any project', p.purple);
  row('Environment', state.secrets.filter.env ?? 'Any environment', p.info);
  row('Service', state.secrets.filter.service ?? 'Any service');
  row('Type', state.secrets.filter.type ?? 'Any type');
  row('Status', state.secrets.filter.status ?? 'Active + other', p.muted);
  y++;

  const active = state.data.secrets.filter((secret) => secret.status === 'Active').length;
  buf.put(x, y, 'READY TO EXPORT', { fg: p.accentSoft, bold: true }, w);
  y++;
  buf.put(x, y++, truncate(`${active} active secret(s) in the current scope`, Math.max(8, w - 2)), { fg: p.text }, w);
  y++;

  buf.put(x, y, 'WORKFLOW TIPS', { fg: p.accentSoft, bold: true }, w);
  y++;
  const tips = [
    `${g.bullet} Export writes mode 0600 and warns about Git tracking`,
    `${g.bullet} Import previews create/update/skip counts before writing`,
    `${g.bullet} Run inherits your terminal and never writes secrets to disk`,
    `${g.bullet} Imported values are encrypted with fresh AES-GCM IVs`,
  ];
  for (const tip of tips) {
    if (y >= rect.y + rect.h - 1) return;
    buf.put(x, y++, truncate(tip, Math.max(8, w - 2)), { fg: p.faint }, w);
  }
}

export function handleToolsKey(app: TuiApp, key: Key): void {
  if (isSpecial(key, 'escape')) {
    app.goBack();
    return;
  }
  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    app.state.toolIndex = Math.max(0, app.state.toolIndex - 1);
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    app.state.toolIndex = Math.min(TOOLS.length - 1, app.state.toolIndex + 1);
    return;
  }
  if (isSpecial(key, 'enter')) {
    TOOLS[app.state.toolIndex]?.action(app);
  }
}
