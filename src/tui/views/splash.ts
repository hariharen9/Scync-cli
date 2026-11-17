import type { Buffer } from '../buffer.js';
import type { TuiApp } from '../app.js';
import { drawWordmark, WORDMARK_HEIGHT, WORDMARK_WIDTH } from '../logo.js';
import { displayWidth, singleLine, truncate } from '../width.js';
import { formatCountdown } from '../format.js';
import { drawProgressBar } from '../widgets.js';

function centerX(width: number, text: string): number {
  return Math.max(1, Math.floor((width - displayWidth(text)) / 2));
}

function putCentered(buf: Buffer, width: number, y: number, text: string, style: any): void {
  buf.put(centerX(width, text), y, text, style);
}

export function renderSplash(app: TuiApp, buf: Buffer, width: number, height: number): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const elapsed = Math.max(0, app.now - app.splashStarted);

  buf.fill(0, 0, width, height, { bg: p.bg, fg: p.text });

  // Sparse dot texture in the side margins only, so it never shows through
  // the wordmark or status card.
  const contentWidth = Math.min(68, width - 8);
  const marginLeft = Math.floor((width - contentWidth) / 2) - 3;
  const marginRight = marginLeft + contentWidth + 6;
  for (let y = 4; y < height - 4; y += 4) {
    for (let x = 2; x < width - 2; x += 4) {
      if (x >= marginLeft && x <= marginRight) continue;
      buf.set(x, y, '·', { fg: p.border });
    }
  }

  // Top chrome.
  buf.hline(0, 0, width, { fg: p.accentDim }, g.h);
  buf.put(2, 1, g.dot, { fg: p.accent, bold: true });
  buf.put(4, 1, 'SCYNC', { fg: p.white, bold: true });
  buf.put(10, 1, `v${app.version}`, { fg: p.faint });
  const topRight = 'ZERO-KNOWLEDGE TERMINAL';
  buf.put(Math.max(2, width - displayWidth(topRight) - 2), 1, topRight, { fg: p.faint });
  buf.hline(0, 2, width, { fg: p.border }, g.h);

  // Very short terminals get a single-card layout with no box chrome.
  if (height < 22) {
    let y = 4;
    putCentered(buf, width, y, `${g.dot} SCYNC`, { fg: p.accent, bold: true });
    y += 2;
    const typed = 'ZERO-KNOWLEDGE DEVELOPER SECRETS'.slice(
      0,
      Math.min(30, Math.floor(elapsed / 22))
    );
    putCentered(buf, width, y, typed, { fg: p.muted, bold: true });
    y += 2;
    const vault = state.data.meta
      ? `${state.unlocked ? 'unlocked' : 'locked'} / initialized`
      : app.splashReady
        ? 'not initialized'
        : 'reading metadata…';
    const statusLine = `vault ${vault} · agent ${state.agent.status}`;
    buf.put(2, y, truncate(statusLine, width - 4), { fg: p.faint }, width - 4);
    y += 2;
    drawProgressBar(buf, theme, 2, y, Math.max(10, width - 4), app.splashReady ? 1 : Math.min(0.9, elapsed / 1400));
    y += 2;
    const prompt = app.splashReady
      ? app.session
        ? 'PRESS ANY KEY TO OPEN THE VAULT'
        : 'PRESS ANY KEY TO SIGN IN'
      : `${g.spinner[Math.floor(elapsed / 80) % g.spinner.length]} SECURE SESSION…`;
    putCentered(buf, width, Math.min(y, height - 3), prompt, {
      fg: app.splashReady ? p.accentSoft : p.faint,
      bold: app.splashReady,
    });
    buf.hline(0, height - 2, width, { fg: p.border }, g.h);
    putCentered(buf, width, height - 1, 'AES-256-GCM · keys stay local', { fg: p.faint });
    return;
  }

  const compact = width < WORDMARK_WIDTH + 16 || height < 30;
  const blockHeight = compact ? 16 : 23;
  let y = Math.max(4, Math.floor((height - blockHeight) / 2));

  if (compact) {
    const title = `${g.dot} SCYNC`;
    putCentered(buf, width, y, title, { fg: p.accent, bold: true });
    y += 2;
  } else {
    const logoX = Math.max(2, Math.floor((width - WORDMARK_WIDTH) / 2));
    drawWordmark(buf, theme, logoX, y);
    y += WORDMARK_HEIGHT + 2;
  }

  const tagline = 'ZERO-KNOWLEDGE DEVELOPER SECRETS';
  const typed = tagline.slice(0, Math.min(tagline.length, Math.floor(elapsed / 22)));
  putCentered(buf, width, y, typed, { fg: p.muted, bold: true });
  y += 2;

  // Secure session card.
  const boxW = Math.max(42, Math.min(68, width - 8));
  const boxH = compact ? 7 : 9;
  const boxX = Math.max(1, Math.floor((width - boxW) / 2));
  const boxY = y;
  buf.fill(boxX, boxY, boxW, boxH, { bg: p.panel, fg: p.text });
  buf.box(
    { x: boxX, y: boxY, w: boxW, h: boxH },
    { fg: p.borderStrong, bg: p.panel },
    g,
    'SECURE SESSION',
    { fg: p.accentSoft, bold: true }
  );

  const labelX = boxX + 2;
  const valueX = boxX + 15;
  const valueW = boxW - 17;
  let rowY = boxY + 2;

  const row = (label: string, value: string, color = p.text) => {
    buf.put(labelX, rowY, label, { fg: p.faint, bold: true }, 12);
    buf.put(valueX, rowY, truncate(value, valueW), { fg: color }, valueW);
    rowY++;
  };

  const identity = app.session?.email || app.session?.displayName || 'sign-in required';
  row('IDENTITY', singleLine(identity), app.session ? p.text : p.warning);

  const meta = state.data.meta;
  const vaultState = meta
    ? `${state.unlocked ? 'unlocked' : 'locked'} · initialized`
    : app.splashReady
      ? 'not initialized'
      : 'reading metadata…';
  row('VAULT', vaultState, state.unlocked ? p.success : meta ? p.warning : p.faint);

  const agent =
    state.agent.status === 'unlocked'
      ? `unlocked · ${formatCountdown(state.agent.ttlRemainingMs)} TTL`
      : state.agent.status;
  row('AGENT', agent, state.agent.status === 'unlocked' ? p.success : p.muted);

  if (!compact) {
    row('CRYPTO', 'AES-256-GCM · PBKDF2 310k', p.accentSoft);
  }

  // Progress bar.
  const progressWidth = Math.max(12, boxW - 10);
  const ratio = app.splashReady ? 1 : Math.min(0.9, elapsed / 1400);
  const barY = boxY + boxH - 2;
  drawProgressBar(buf, theme, boxX + 2, barY, progressWidth, ratio);
  const percent = `${Math.round(ratio * 100)}%`.padStart(4, ' ');
  if (boxX + 2 + progressWidth + 2 + percent.length < boxX + boxW - 1) {
    buf.put(boxX + 2 + progressWidth + 2, barY, percent, { fg: p.faint });
  }

  y = boxY + boxH + 1;

  const prompt = app.splashReady
    ? app.session
      ? 'PRESS ANY KEY TO OPEN THE VAULT'
      : 'PRESS ANY KEY TO SIGN IN'
    : `${g.spinner[Math.floor(elapsed / 80) % g.spinner.length]} ESTABLISHING SECURE SESSION…`;
  const pulse = app.splashReady && Math.floor(elapsed / 450) % 2 === 0;
  putCentered(buf, width, y, prompt, {
    fg: app.splashReady ? (pulse ? p.accentSoft : p.accent) : p.faint,
    bold: app.splashReady,
  });

  // Bottom chrome.
  buf.hline(0, height - 2, width, { fg: p.border }, g.h);
  const footer = 'AES-256-GCM · PBKDF2 310k · keys never leave this device';
  putCentered(buf, width, height - 1, footer, { fg: p.faint });
}
