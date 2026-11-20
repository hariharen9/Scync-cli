import type { Buffer } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import { SEARCH_KIND_META, type SearchResult } from '../search.js';
import { clamp, displayWidth, truncate } from '../width.js';
import { drawPanel } from '../widgets.js';

const BADGE_WIDTH = 8;
const BADGE_GAP = 2;

function popWord(query: string): string {
  return query.replace(/\s*\S+\s*$/, '');
}

export interface SearchRenderResult {
  cursor: { x: number; y: number } | null;
}

export function renderSearchOverlay(app: TuiApp, buf: Buffer, width: number, height: number): SearchRenderResult {
  const { theme, state } = app;
  const { p, g } = theme;
  const search = state.search;
  if (!search) return { cursor: null };

  const results = app.searchResults();
  const w = Math.max(28, Math.min(86, width - 4));
  const h = Math.max(10, Math.min(20, height - 4));
  const rect = {
    x: Math.max(0, Math.floor((width - w) / 2)),
    y: Math.max(1, Math.floor((height - h) / 2)),
    w,
    h,
  };

  buf.dimExcept(rect);
  drawPanel(buf, theme, rect, 'SEARCH', {
    focused: true,
    footer: '↑↓ move · Enter open · Esc close',
  });

  const selected = clamp(search.selected, 0, Math.max(0, results.length - 1));
  search.selected = selected;

  // Query input.
  const inputY = rect.y + 1;
  buf.fill(rect.x + 1, inputY, rect.w - 2, 1, { bg: p.panelAlt });
  buf.put(rect.x + 2, inputY, g.search, { fg: p.accent });

  const innerW = Math.max(6, rect.w - 6);
  const chars = [...search.query];
  const trimmed = chars.length > innerW ? chars.slice(chars.length - innerW) : chars;
  const shown = trimmed.join('');
  const placeholder = 'Search secrets, projects, logins, keys, certs…';
  buf.put(rect.x + 4, inputY, shown || placeholder, { fg: trimmed.length > 0 ? p.text : p.faint }, innerW);

  const countLabel = `${results.length} result${results.length === 1 ? '' : 's'}`;
  const countX = rect.x + rect.w - displayWidth(countLabel) - 2;
  if (countX > rect.x + 4 + displayWidth(shown) + 2) {
    buf.put(countX, inputY, countLabel, { fg: p.faint });
  }

  const listTop = rect.y + 2;
  const listBottom = rect.y + rect.h - 2;
  const viewport = Math.max(1, listBottom - listTop);
  const start = clamp(selected - viewport + 1, 0, Math.max(0, results.length - viewport));
  search.scroll = start;

  if (results.length === 0) {
    const message = search.query.trim()
      ? `No matches for “${truncate(search.query.trim(), 32)}”`
      : 'Your vault is empty — nothing to search yet.';
    buf.put(rect.x + 2, listTop + 1, message, { fg: p.faint }, rect.w - 4);
  }

  for (let i = 0; i < viewport; i++) {
    const result = results[start + i];
    if (!result) break;
    drawResult(buf, app, rect.x + 1, listTop + i, rect.w - 2, result, start + i === selected);
  }

  const cursorX = clamp(rect.x + 4 + displayWidth(shown), rect.x + 4, rect.x + rect.w - 2);
  return { cursor: { x: cursorX, y: inputY } };
}

function drawResult(
  buf: Buffer,
  app: TuiApp,
  x: number,
  y: number,
  width: number,
  result: SearchResult,
  selected: boolean
): void {
  const { p } = app.theme;
  if (selected) {
    buf.fill(x, y, width, 1, { bg: p.panelAlt });
    buf.fill(x, y, 1, 1, { bg: p.accent });
  }

  const meta = SEARCH_KIND_META[result.kind];
  const badgeColor = selected ? p.accentSoft : p.faint;
  buf.put(x + BADGE_GAP, y, meta.tag, { fg: badgeColor, bold: selected }, BADGE_WIDTH);

  const titleX = x + BADGE_GAP + BADGE_WIDTH + 1;
  const subtitleW = Math.min(30, Math.max(0, width - BADGE_WIDTH - 20));
  const subtitleX = x + width - subtitleW - 1;
  const titleW = Math.max(6, subtitleX - titleX - 2);

  buf.put(titleX, y, result.title, { fg: selected ? p.text : p.muted, bold: selected }, titleW);
  if (result.subtitle && subtitleW > 0) {
    buf.put(subtitleX, y, truncate(result.subtitle, subtitleW), { fg: p.faint }, subtitleW);
  }
}

export function handleSearchKey(app: TuiApp, key: Key): void {
  const search = app.state.search;
  if (!search) return;

  if (isSpecial(key, 'escape')) {
    app.closeSearch();
    return;
  }

  const results = app.searchResults();

  if (isSpecial(key, 'enter')) {
    const result = results[search.selected];
    if (result) app.openSearchResult(result);
    return;
  }

  if (isSpecial(key, 'up') || (key.ctrl && key.text === 'p')) {
    search.selected = Math.max(0, search.selected - 1);
    app.requestRender();
    return;
  }
  if (isSpecial(key, 'down') || isSpecial(key, 'tab') || (key.ctrl && key.text === 'n')) {
    search.selected = Math.min(Math.max(0, results.length - 1), search.selected + 1);
    app.requestRender();
    return;
  }
  if (isSpecial(key, 'pageup')) {
    search.selected = Math.max(0, search.selected - 10);
    app.requestRender();
    return;
  }
  if (isSpecial(key, 'pagedown')) {
    search.selected = Math.min(Math.max(0, results.length - 1), search.selected + 10);
    app.requestRender();
    return;
  }
  if (isSpecial(key, 'home')) {
    search.selected = 0;
    app.requestRender();
    return;
  }
  if (isSpecial(key, 'end')) {
    search.selected = Math.max(0, results.length - 1);
    app.requestRender();
    return;
  }

  if (isSpecial(key, 'backspace')) {
    if (key.ctrl) {
      search.query = popWord(search.query);
    } else {
      const chars = [...search.query];
      chars.pop();
      search.query = chars.join('');
    }
    search.selected = 0;
    app.requestRender();
    return;
  }
  if (key.ctrl && key.text === 'u') {
    search.query = '';
    search.selected = 0;
    app.requestRender();
    return;
  }
  if (key.ctrl && key.text === 'w') {
    search.query = popWord(search.query);
    search.selected = 0;
    app.requestRender();
    return;
  }

  if (isChar(key) && key.text) {
    search.query += key.text;
    search.selected = 0;
    app.requestRender();
  }
}
