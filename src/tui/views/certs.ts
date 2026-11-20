import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { StoredCertificate } from '../../core/types.js';
import { daysUntil, formatDate, sortByName } from '../format.js';
import { clamp, displayWidth, truncate, wrapText } from '../width.js';
import { drawListRow, drawPanel } from '../widgets.js';

function visibleCerts(app: TuiApp): StoredCertificate[] {
  return sortByName(app.state.data.certs);
}

export function renderCertsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const list = state.lists.certs;
  const certs = visibleCerts(app);
  list.selected = clamp(list.selected, 0, Math.max(0, certs.length - 1));

  const wide = rect.w >= 96;
  const showDetail = wide || list.detail;
  const listW = showDetail && wide ? Math.max(42, Math.floor(rect.w * 0.58)) : rect.w;

  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, 'Press / to search the whole vault', { fg: p.faint }, Math.max(10, rect.w - 24));
  const countLabel = `${certs.length} cert(s)`;
  buf.put(rect.x + rect.w - displayWidth(countLabel) - 2, rect.y, countLabel, { fg: p.faint });

  const listRect: Rect = { x: rect.x, y: rect.y + 1, w: listW, h: rect.h - 1 };
  drawPanel(buf, theme, listRect, 'CERTIFICATES', {
    focused: true,
    footer: 'Enter details · v view PEM · c copy PEM · p private key · y copy key',
  });

  const x = listRect.x + 2;
  const w = listRect.w - 4;
  const nameW = Math.max(14, Math.floor(w * 0.24));
  const subjectW = Math.max(14, Math.floor(w * 0.3));
  const issuerW = Math.max(12, Math.floor(w * 0.22));
  const expiryW = 11;

  let hx = x;
  buf.put(hx, listRect.y + 1, 'NAME', { fg: p.faint, bold: true }, nameW);
  hx += nameW + 1;
  buf.put(hx, listRect.y + 1, 'SUBJECT / HOSTS', { fg: p.faint, bold: true }, subjectW);
  hx += subjectW + 1;
  buf.put(hx, listRect.y + 1, 'ISSUER', { fg: p.faint, bold: true }, issuerW);
  hx += issuerW + 1;
  if (w > nameW + subjectW + issuerW + expiryW + 4) {
    buf.put(hx, listRect.y + 1, 'EXPIRES', { fg: p.faint, bold: true }, expiryW);
  }
  buf.hline(listRect.x + 1, listRect.y + 2, listRect.w - 2, { fg: p.border }, g.h);

  const top = listRect.y + 3;
  const viewport = Math.max(1, listRect.h - 4);
  const start = clamp(list.selected - viewport + 1, 0, Math.max(0, certs.length - viewport));
  list.scroll = start;

  if (certs.length === 0) {
    buf.put(x, top + 1, 'No certificates in your vault.', {
      fg: p.faint,
    });
  } else {
    for (let i = 0; i < viewport; i++) {
      const cert = certs[start + i];
      if (!cert) break;
      const days = daysUntil(cert.validTo);
      const expiryColor = days < 0 ? p.danger : days <= 30 ? p.warning : p.success;
      const subject = cert.hosts.length ? cert.hosts.join(', ') : cert.subject;
      const parts = [
        { text: cert.name, style: { fg: p.text, bold: start + i === list.selected }, width: nameW },
        { text: subject, style: { fg: p.muted }, width: subjectW },
        { text: cert.issuer, style: { fg: p.faint }, width: issuerW },
      ];
      if (w > nameW + subjectW + issuerW + expiryW + 4) {
        parts.push({
          text: `${formatDate(cert.validTo)}`,
          style: { fg: expiryColor },
          width: expiryW,
        });
      }
      drawListRow(buf, theme, listRect.x + 1, top + i, listRect.w - 2, start + i === list.selected, parts);
    }
  }

  if (showDetail) {
    const detailRect: Rect = wide
      ? { x: rect.x + listW + 2, y: listRect.y, w: rect.w - listW - 2, h: listRect.h }
      : { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    renderCertDetail(app, buf, detailRect, certs[list.selected]);
  }
}

function renderCertDetail(app: TuiApp, buf: Buffer, rect: Rect, cert: StoredCertificate | undefined): void {
  const { theme, state } = app;
  const { p } = theme;
  drawPanel(buf, theme, rect, 'CERTIFICATE DETAIL', {
    focused: true,
    footer: cert ? 'v PEM · c copy PEM · p private key · y copy key' : undefined,
  });

  if (!cert) {
    buf.put(rect.x + 2, rect.y + 2, 'Select a certificate to inspect it.', { fg: p.faint });
    return;
  }

  const x = rect.x + 2;
  const w = rect.w - 4;
  let y = rect.y + 2;
  buf.put(x, y, truncate(cert.name, Math.max(8, w)), { fg: p.text, bold: true }, w);
  y += 2;

  const row = (label: string, value: string, color = p.text) => {
    if (y >= rect.y + rect.h - 2) return;
    buf.put(x, y, label, { fg: p.muted }, 14);
    buf.put(x + 14, y, truncate(value, Math.max(4, w - 14)), { fg: color }, Math.max(4, w - 14));
    y++;
  };
  const days = daysUntil(cert.validTo);
  row('Subject', cert.subject, p.text);
  row('Issuer', cert.issuer, p.muted);
  row('Serial', cert.serialNumber, p.faint);
  row('Fingerprint', cert.fingerprint, p.faint);
  row('Valid from', formatDate(cert.validFrom));
  row(
    'Valid to',
    `${formatDate(cert.validTo)} (${days >= 0 ? `${days}d` : `expired ${Math.abs(days)}d`})`,
    days < 0 ? p.danger : days <= 30 ? p.warning : p.success
  );
  row('Self signed', cert.isSelfSigned ? 'Yes' : 'No', cert.isSelfSigned ? p.warning : p.muted);
  row('Private key', cert.encKeyPem ? 'Stored' : 'Not stored', cert.encKeyPem ? p.success : p.faint);
  y++;
  if (y >= rect.y + rect.h - 2) return;

  buf.put(x, y, 'HOSTS / SANs', { fg: p.accentSoft, bold: true }, w);
  y++;
  for (const line of wrapText(cert.hosts.length ? cert.hosts.join(', ') : '—', Math.max(8, w - 2))) {
    if (y >= rect.y + rect.h - 1) break;
    buf.put(x, y++, line, { fg: p.muted }, w);
  }

  if (!state.unlocked) {
    y++;
    if (y < rect.y + rect.h - 1) {
      buf.put(x, y, 'PEM and private key are encrypted — press u to unlock.', { fg: p.warning });
    }
  }
}

export function handleCertsKey(app: TuiApp, key: Key): void {
  const list = app.state.lists.certs;
  const certs = visibleCerts(app);
  const selected = certs[list.selected];

  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    list.selected = Math.max(0, list.selected - 1);
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    list.selected = Math.min(Math.max(0, certs.length - 1), list.selected + 1);
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

  if (isChar(key, 'v')) return void app.viewCertPem(selected);
  if (isChar(key, 'c')) return void app.copyCertPem(selected);
  if (isChar(key, 'p')) return void app.viewCertKey(selected);
  if (isChar(key, 'y')) return void app.copyCertKey(selected);
}
