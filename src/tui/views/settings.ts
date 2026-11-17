import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import { getScyncDir } from '../../auth/storage.js';
import { loadConfig } from '../../config/index.js';
import { formatCountdown, formatDate, formatRelative } from '../format.js';
import { drawLabelValue, drawPanel } from '../widgets.js';

export function renderSettingsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state, session } = app;
  const { p } = theme;

  const wide = rect.w >= 100;
  const columnW = wide ? Math.floor((rect.w - 2) / 2) : rect.w;
  const leftRect: Rect = { x: rect.x, y: rect.y, w: columnW, h: rect.h };
  const rightRect: Rect = wide
    ? { x: rect.x + columnW + 2, y: rect.y, w: rect.w - columnW - 2, h: rect.h }
    : { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

  // Identity + vault in the left column.
  let y = rect.y;
  const identityH = Math.min(10, rect.h);
  drawPanel(buf, theme, { x: leftRect.x, y, w: leftRect.w, h: identityH }, 'IDENTITY');
  let ly = y + 2;
  const x = leftRect.x + 2;
  const w = leftRect.w - 4;
  buf.put(x, ly, session?.email || 'Not signed in', { fg: p.text, bold: true }, w);
  ly++;
  buf.put(x, ly, session?.uid ?? '—', { fg: p.faint }, w);
  ly++;
  buf.put(x, ly, `${session?.providerId ?? '—'}`, { fg: p.info }, w);
  ly += 2;
  if (session) {
    drawLabelValue(buf, theme, x, ly, 'Session saved', formatRelative(new Date(session.savedAt), new Date(app.now)), w);
    ly++;
    drawLabelValue(buf, theme, x, ly, 'Token expiry', new Date(session.expiresAt).toLocaleString(), w);
    ly++;
  }
  drawLabelValue(buf, theme, x, ly, 'Login', session ? 'Active' : 'Sign in required', w, session ? p.success : p.warning);

  y += identityH + 1;
  const vaultH = Math.max(8, Math.min(13, rect.y + rect.h - y));
  drawPanel(buf, theme, { x: leftRect.x, y, w: leftRect.w, h: vaultH }, 'VAULT');
  ly = y + 2;
  if (state.data.meta) {
    drawLabelValue(buf, theme, x, ly, 'State', state.data.meta ? 'Initialized' : 'Not initialized', w, p.success);
    ly++;
    drawLabelValue(buf, theme, x, ly, 'Created', formatDate(state.data.meta.createdAt), w);
    ly++;
    drawLabelValue(buf, theme, x, ly, 'Biometrics', String(state.data.meta.biometrics?.length ?? 0), w);
    ly++;
    drawLabelValue(buf, theme, x, ly, 'Recovery kit', state.data.meta.recovery ? 'Configured' : 'Not configured', w, state.data.meta.recovery ? p.success : p.muted);
    ly++;
  } else {
    buf.put(x, ly, 'Vault has not been initialized on the web app.', { fg: p.warning }, w);
    ly += 2;
  }
  drawLabelValue(
    buf,
    theme,
    x,
    ly,
    'Master key',
    state.unlocked ? 'Held in memory' : 'Locked',
    w,
    state.unlocked ? p.success : p.warning
  );
  ly++;
  drawLabelValue(
    buf,
    theme,
    x,
    ly,
    'Agent',
    state.agent.status === 'unlocked'
      ? `Unlocked · ${formatCountdown(state.agent.ttlRemainingMs)} TTL`
      : state.agent.status,
    w,
    state.agent.status === 'unlocked' ? p.success : p.muted
  );

  if (!wide) {
    y += vaultH + 1;
  }

  // Right column: config + about.
  const rightTop = wide ? rightRect.y : y;
  const rightRemaining = rect.y + rect.h - rightTop;
  if (rightRemaining < 5) return;

  const config = loadConfig();
  const configEntries = Object.entries(config).sort(([a], [b]) => a.localeCompare(b));
  const configH = wide ? Math.max(8, Math.min(14, Math.floor(rightRemaining * 0.6))) : rightRemaining;
  drawPanel(buf, theme, { x: rightRect.x, y: rightTop, w: rightRect.w, h: configH }, 'CONFIGURATION', {
    footer: 'c edit a setting',
  });
  let ry = rightTop + 2;
  const rx = rightRect.x + 2;
  const rw = rightRect.w - 4;
  if (configEntries.length === 0) {
    buf.put(rx, ry, 'No overrides — defaults are in use.', { fg: p.faint }, rw);
  } else {
    for (const [key, value] of configEntries) {
      if (ry >= rightTop + configH - 1) break;
      drawLabelValue(buf, theme, rx, ry, key, String(value), rw, p.accentSoft);
      ry++;
    }
  }

  if (wide) {
    const aboutY = rightTop + configH + 1;
    const aboutH = rect.y + rect.h - aboutY;
    if (aboutH >= 5) {
      drawPanel(buf, theme, { x: rightRect.x, y: aboutY, w: rightRect.w, h: aboutH }, 'ABOUT');
      let ay = aboutY + 2;
      drawLabelValue(buf, theme, rx, ay++, 'Version', app.version, rw);
      drawLabelValue(buf, theme, rx, ay++, 'Config dir', getScyncDir(), rw);
      drawLabelValue(buf, theme, rx, ay++, 'Encryption', 'AES-256-GCM · PBKDF2 310k', rw);
      drawLabelValue(buf, theme, rx, ay++, 'Custody', 'Local key agent / in-process', rw);
      if (ay < aboutY + aboutH - 1) {
        buf.put(rx, ay++, 'U unlock · L lock · o logout · r refresh', { fg: p.faint }, rw);
      }
    }
  }
}

export function handleSettingsKey(app: TuiApp, key: Key): void {
  if (isSpecial(key, 'escape')) return app.goBack();
  if (isChar(key, 'U')) return app.unlockVault();
  if (isChar(key, 'L')) return void app.lockVault();
  if (isChar(key, 'o')) return app.logout();
  if (isChar(key, 'c')) return app.openConfigPicker();
  if (isChar(key, 'r')) return void app.refresh();
}
