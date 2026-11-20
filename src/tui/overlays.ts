import type { Buffer, Rect, Style } from './buffer.js';
import type { Theme } from './theme.js';
import type {
  FormField,
  FormState,
  ModalState,
  PickerState,
  ViewerState,
} from './state.js';
import { clamp, displayWidth, truncate, wrapText } from './width.js';
import { cursorInWrapped, visualLines } from './editor.js';
import { drawPanel } from './widgets.js';

export interface OverlayResult {
  cursor: { x: number; y: number } | null;
}

function centeredRect(width: number, height: number, w: number, h: number): Rect {
  const rw = Math.max(20, Math.min(w, width - 4));
  const rh = Math.max(6, Math.min(h, height - 2));
  return {
    x: Math.max(0, Math.floor((width - rw) / 2)),
    y: Math.max(0, Math.floor((height - rh) / 2)),
    w: rw,
    h: rh,
  };
}

export function renderModal(
  buf: Buffer,
  theme: Theme,
  modal: ModalState,
  width: number,
  height: number
): OverlayResult {
  switch (modal.kind) {
    case 'help':
      return renderHelp(buf, theme, width, height);
    case 'confirm':
      return renderConfirm(buf, theme, width, height, modal.title, modal.message, modal.confirmLabel, modal.danger);
    case 'form':
      return renderForm(buf, theme, width, height, modal.form);
    case 'pick':
      return renderPicker(buf, theme, width, height, modal.picker);
    case 'viewer':
      return renderViewer(buf, theme, width, height, modal.viewer);
  }
}

function dimBackground(buf: Buffer, rect: Rect): void {
  buf.dimExcept(rect);
}

function modalHint(
  buf: Buffer,
  theme: Theme,
  rect: Rect,
  hints: Array<{ key: string; label: string }>
): void {
  const { p } = theme;
  const y = rect.y + rect.h - 2;
  const limit = rect.x + rect.w - 2;
  buf.fill(rect.x + 1, y, rect.w - 2, 1, { bg: p.panel });
  let x = rect.x + 2;
  for (let i = 0; i < hints.length; i++) {
    if (x >= limit) break;
    const hint = hints[i];
    x = buf.put(x, y, hint.key, { fg: p.accent, bold: true }, Math.max(0, limit - x));
    x = buf.put(x + 1, y, hint.label, { fg: p.muted }, Math.max(0, limit - x - 1));
    if (i < hints.length - 1 && x < limit - 2) {
      x = buf.put(x + 2, y, '·', { fg: p.faint });
      x += 1;
    }
  }
}

function renderHelp(buf: Buffer, theme: Theme, width: number, height: number): OverlayResult {
  const { p } = theme;
  const rect = centeredRect(width, height, Math.min(82, width - 4), Math.min(30, height - 2));
  dimBackground(buf, rect);
  drawPanel(buf, theme, rect, 'Help & Keyboard', { focused: true });

  const sections: Array<{ title: string; lines: Array<[string, string]> }> = [
    {
      title: 'Global',
      lines: [
        ['/', 'Search everything in the vault'],
        ['1 … 9', 'Jump to a view'],
        ['[ / ]', 'Previous / next view'],
        ['r', 'Refresh vault data'],
        ['u', 'Unlock vault'],
        ['L', 'Lock vault'],
        ['?', 'Toggle this help'],
        ['q', 'Quit'],
        ['Ctrl+C', 'Quit immediately'],
      ],
    },
    {
      title: 'Navigation',
      lines: [
        ['↑ ↓', 'Move selection'],
        ['Tab / Shift+Tab', 'Move focus between panes'],
        ['Enter', 'Open / confirm'],
        ['Esc', 'Back / clear search'],
        ['/', 'Search current list'],
        ['PgUp / PgDn', 'Scroll'],
      ],
    },
    {
      title: 'Secrets',
      lines: [
        ['n', 'New secret'],
        ['e', 'Edit selected secret'],
        ['R', 'Rotate selected secret'],
        ['v', 'Versions / restore'],
        ['d', 'Delete selected secret'],
        ['r', 'Reveal / hide value'],
        ['c', 'Copy value (auto-clears)'],
        ['f', 'Filters'],
        ['o', 'Cycle sort order'],
        ['x', 'Clear filters'],
      ],
    },
    {
      title: 'Other views',
      lines: [
        ['p', 'Cycle project filter'],
        ['c', 'Copy field (passwords/SSH/certs)'],
        ['y', 'Copy secondary field'],
        ['s', 'Copy TOTP secret'],
        ['E', 'Export SSH key'],
        ['g', 'Copy SSH config'],
        ['t', 'Tools menu'],
      ],
    },
  ];

  const columnWidth = Math.floor((rect.w - 6) / 2);
  sections.forEach((section, index) => {
    const col = index % 2;
    const rowGroup = Math.floor(index / 2);
    const x = rect.x + 2 + col * (columnWidth + 2);
    const y = rect.y + 2 + rowGroup * 9;
    if (y >= rect.y + rect.h - 2) return;
    buf.put(x, y, section.title.toUpperCase(), { fg: p.accentSoft, bold: true }, columnWidth);
    section.lines.forEach(([key, label], lineIndex) => {
      const lineY = y + 1 + lineIndex;
      if (lineY >= rect.y + rect.h - 2) return;
      buf.put(x, lineY, key, { fg: p.accent }, Math.min(18, columnWidth));
      buf.put(x + 18, lineY, label, { fg: p.muted }, Math.max(0, columnWidth - 18));
    });
  });

  modalHint(buf, theme, rect, [{ key: '?', label: 'toggle help' }, { key: 'Esc', label: 'close' }]);
  return { cursor: null };
}

function renderConfirm(
  buf: Buffer,
  theme: Theme,
  width: number,
  height: number,
  title: string,
  message: string,
  confirmLabel = 'Confirm',
  danger = false
): OverlayResult {
  const { p } = theme;
  const messageLines = wrapText(message, Math.min(58, width - 10));
  const rect = centeredRect(width, height, Math.min(66, width - 4), messageLines.length + 8);
  dimBackground(buf, rect);
  drawPanel(buf, theme, rect, title, { focused: true });

  buf.put(rect.x + 2, rect.y + 2, messageLines[0] ?? '', { fg: p.text }, rect.w - 4);
  for (let i = 1; i < messageLines.length; i++) {
    buf.put(rect.x + 2, rect.y + 2 + i, messageLines[i], { fg: p.muted }, rect.w - 4);
  }

  const y = rect.y + rect.h - 3;
  const confirmColor = danger ? p.danger : p.accent;
  buf.put(rect.x + 2, y, '[ Enter ]', { fg: p.bg, bg: confirmColor, bold: true });
  buf.put(rect.x + 13, y, confirmLabel, { fg: confirmColor, bold: true });
  buf.put(rect.x + 13 + displayWidth(confirmLabel) + 3, y, '[ Esc ] Cancel', { fg: p.muted });
  return { cursor: null };
}

function renderForm(
  buf: Buffer,
  theme: Theme,
  width: number,
  height: number,
  form: FormState
): OverlayResult {
  const { p } = theme;
  const rect = centeredRect(width, height, Math.min(84, width - 4), Math.min(32, height - 2));
  dimBackground(buf, rect);
  drawPanel(buf, theme, rect, form.title, { focused: true });

  const contentX = rect.x + 2;
  const contentW = rect.w - 4;
  const top = rect.y + 2;
  const bottom = rect.y + rect.h - 3;

  let y = top;
  if (form.subtitle) {
    const lines = wrapText(form.subtitle, contentW);
    for (const line of lines.slice(0, 2)) {
      buf.put(contentX, y, line, { fg: p.faint }, contentW);
      y++;
    }
    y++;
  }

  // Measure blocks so focus can be scrolled into view.
  const blocks = form.fields.map((field) => ({
    field,
    height: fieldHeight(field),
  }));

  const viewport = Math.max(4, bottom - y);
  const total = blocks.reduce((sum, block) => sum + block.height, 0);
  let scroll = form.scroll ?? 0;

  const focusTop = blocks.slice(0, form.focus).reduce((sum, block) => sum + block.height, 0);
  const focusHeight = blocks[form.focus]?.height ?? 1;
  if (focusTop < scroll) scroll = focusTop;
  if (focusTop + focusHeight > scroll + viewport) scroll = focusTop + focusHeight - viewport;
  scroll = clamp(scroll, 0, Math.max(0, total - viewport));
  form.scroll = scroll;

  let relY = 0;
  let cursor: { x: number; y: number } | null = null;

  blocks.forEach((block, index) => {
    const fieldY = y + relY - scroll;
    relY += block.height;

    const visible = fieldY + block.height > y && fieldY < bottom;
    if (!visible) return;

    const focused = index === form.focus;
    cursor = drawField(buf, theme, {
      x: contentX,
      y: fieldY,
      w: contentW,
      bottom,
      field: block.field,
      focused,
    }) ?? cursor;
  });

  if (form.error) {
    const errorLines = wrapText(form.error, contentW);
    const start = Math.max(rect.y + 2, rect.y + rect.h - 4 - errorLines.length);
    errorLines.forEach((line, i) => {
      buf.put(rect.x + 2, start + i, line, { fg: p.danger }, contentW);
    });
  }

  modalHint(buf, theme, rect, [
    { key: 'Tab', label: 'next field' },
    { key: 'Shift+Tab', label: 'previous' },
    { key: 'Enter', label: form.fields[form.focus]?.kind === 'textarea' ? 'newline' : 'submit' },
    { key: 'Ctrl+S', label: 'save' },
    { key: 'Esc', label: 'cancel' },
  ]);

  return { cursor };
}

function fieldHeight(field: FormField): number {
  switch (field.kind) {
    case 'textarea':
      return (field.rows ?? 5) + 3;
    case 'text':
    case 'password':
      return field.help ? 4 : 3;
    case 'select':
      return 3;
    case 'boolean':
      return 2;
    default:
      return 3;
  }
}

function drawField(
  buf: Buffer,
  theme: Theme,
  opts: { x: number; y: number; w: number; bottom: number; field: FormField; focused: boolean }
): { x: number; y: number } | null {
  const { p } = theme;
  const { x, y, w, field, focused } = opts;
  if (y >= opts.bottom) return null;

  const labelStyle: Style = focused ? { fg: p.accentSoft, bold: true } : { fg: p.muted };
  buf.put(x, y, field.label, labelStyle, w);
  if (field.required) {
    buf.put(x + displayWidth(field.label) + 1, y, '*', { fg: p.danger });
  }

  if (field.kind === 'boolean') {
    const on = field.value === 'true';
    const box = on ? '[x]' : '[ ]';
    buf.put(x + 2, y + 1, box, { fg: on ? p.accent : p.faint, bold: on }, 3);
    buf.put(x + 6, y + 1, on ? 'Enabled' : 'Disabled', { fg: focused ? p.text : p.muted });
    return focused ? { x: x + 7, y: y + 1 } : null;
  }

  if (field.kind === 'select') {
    const selected = field.options?.find((option) => option.value === field.value);
    const label = selected?.label ?? field.value ?? '—';
    buf.fill(x, y + 1, w, 1, { bg: p.panelAlt, fg: p.text });
    buf.put(x + 1, y + 1, '‹', { fg: focused ? p.accent : p.faint });
    buf.put(x + 3, y + 1, label, { fg: focused ? p.text : p.muted, bold: focused }, Math.max(0, w - 6));
    buf.put(x + w - 2, y + 1, '›', { fg: focused ? p.accent : p.faint });
    if (selected?.hint) buf.put(x + 2, y + 2, selected.hint, { fg: p.faint }, w - 2);
    return null;
  }

  if (field.kind === 'textarea') {
    const rows = field.rows ?? 5;
    const boxW = w;
    const boxH = rows + 2;
    buf.box({ x, y: y + 1, w: boxW, h: boxH }, { fg: focused ? p.borderStrong : p.border, bg: p.panel }, theme.g);
    buf.fill(x + 1, y + 2, boxW - 2, rows, { bg: p.panelAlt, fg: p.text });

    const innerW = Math.max(1, boxW - 4);
    const value = field.value;
    const cursorIndex = field.cursor ?? value.length;
    const lines = visualLines(value || ' ', innerW);
    const cursorPos = cursorInWrapped(value, cursorIndex, innerW);
    const start = clamp(cursorPos.line - rows + 1, 0, Math.max(0, lines.length - rows));

    for (let i = 0; i < rows; i++) {
      const line = lines[start + i];
      if (!line) break;
      buf.put(x + 2, y + 2 + i, line.text, { fg: p.text }, innerW);
    }

    if (!value && focused) {
      buf.put(x + 2, y + 2, field.placeholder ?? '', { fg: p.faint }, innerW);
    }

    if (field.help) buf.put(x + 1, y + boxH + 1, field.help, { fg: p.faint }, w - 2);
    return focused
      ? { x: x + 2 + Math.min(innerW - 1, cursorPos.column), y: y + 2 + (cursorPos.line - start) }
      : null;
  }

  // Single-line text/password.
  buf.fill(x, y + 1, w, 1, { bg: p.panelAlt, fg: p.text });
  const cursorIndex = field.cursor ?? field.value.length;
  const displayValue = field.kind === 'password' ? '•'.repeat([...field.value].length) : field.value.replace(/\n/g, ' ');
  const chars = [...displayValue];
  const beforeCount = field.kind === 'password'
    ? [...field.value.slice(0, cursorIndex)].length
    : [...field.value.slice(0, cursorIndex).replace(/\n/g, ' ')].length;
  const innerW = Math.max(1, w - 2);
  const start = Math.max(0, beforeCount - (innerW - 1));
  const visible = chars.slice(start, start + innerW).join('');
  const text = visible || '';
  buf.put(x + 1, y + 1, text, { fg: p.text }, innerW);
  if (!field.value && focused) {
    buf.put(x + 1, y + 1, field.placeholder ?? '', { fg: p.faint }, innerW);
  }
  if (field.help) buf.put(x + 1, y + 2, field.help, { fg: p.faint }, w - 2);

  return focused ? { x: x + 1 + (beforeCount - start), y: y + 1 } : null;
}

function renderPicker(
  buf: Buffer,
  theme: Theme,
  width: number,
  height: number,
  picker: PickerState
): OverlayResult {
  const { p, g } = theme;
  const rect = centeredRect(width, height, Math.min(70, width - 4), Math.min(24, height - 4));
  dimBackground(buf, rect);
  drawPanel(buf, theme, rect, picker.title, { focused: true });

  let y = rect.y + 2;
  if (picker.subtitle) {
    buf.put(rect.x + 2, y, picker.subtitle, { fg: p.faint }, rect.w - 4);
    y++;
  }

  const query = picker.query.trim().toLowerCase();
  const items = query
    ? picker.items.filter((item) =>
        `${item.label} ${item.value} ${item.hint ?? ''}`.toLowerCase().includes(query)
      )
    : picker.items;

  picker.selected = clamp(picker.selected, 0, Math.max(0, items.length - 1));

  if (picker.searchable) {
    buf.fill(rect.x + 1, y, rect.w - 2, 1, { bg: p.panelAlt });
    buf.put(rect.x + 2, y, picker.query || 'Type to filter…', {
      fg: picker.query ? p.text : p.faint,
    });
    y++;
  }

  const listTop = y + 1;
  const listBottom = rect.y + rect.h - 3;
  const viewport = Math.max(1, listBottom - listTop);
  const scroll = clamp(picker.selected - viewport + 1, 0, Math.max(0, items.length - viewport));
  picker.scroll = scroll;

  if (items.length === 0) {
    buf.put(rect.x + 2, listTop, 'No matches', { fg: p.faint });
  }

  for (let i = 0; i < viewport; i++) {
    const item = items[scroll + i];
    if (!item) break;
    const rowY = listTop + i;
    const selected = scroll + i === picker.selected;
    if (selected) {
      buf.fill(rect.x + 1, rowY, rect.w - 2, 1, { bg: p.panelAlt });
      buf.fill(rect.x + 1, rowY, 1, 1, { bg: p.accent });
    }
    if (item.color) {
      buf.put(rect.x + 3, rowY, g.dot, { fg: item.color });
    }
    buf.put(rect.x + 5, rowY, item.label, {
      fg: selected ? p.text : p.muted,
      bold: selected,
    }, Math.max(0, rect.w - 24));
    if (item.hint) {
      buf.put(
        rect.x + rect.w - displayWidth(item.hint) - 2,
        rowY,
        item.hint,
        { fg: p.faint },
        displayWidth(item.hint) + 1
      );
    }
  }

  modalHint(buf, theme, rect, [
    { key: '↑↓', label: 'move' },
    { key: 'Enter', label: 'select' },
    { key: 'Esc', label: 'cancel' },
  ]);

  return picker.searchable
    ? {
        cursor: {
          x: rect.x + 2 + displayWidth(picker.query),
          y: rect.y + (picker.subtitle ? 3 : 2),
        },
      }
    : { cursor: null };
}

function renderViewer(
  buf: Buffer,
  theme: Theme,
  width: number,
  height: number,
  viewer: ViewerState
): OverlayResult {
  const { p } = theme;
  const rect = centeredRect(width, height, width - 6, height - 4);
  dimBackground(buf, rect);
  drawPanel(buf, theme, rect, viewer.title, { focused: true });

  const contentW = rect.w - 4;
  const top = rect.y + 2;
  const bottom = rect.y + rect.h - 3;
  const viewport = Math.max(1, bottom - top);

  const lines = viewer.wrap
    ? wrapText(viewer.text, contentW)
    : viewer.text.split('\n').map((line) => truncate(line, contentW, ''));

  const maxScroll = Math.max(0, lines.length - viewport);
  viewer.scroll = clamp(viewer.scroll, 0, maxScroll);

  for (let i = 0; i < viewport; i++) {
    const line = lines[viewer.scroll + i];
    if (line === undefined) break;
    buf.put(rect.x + 2, top + i, line, { fg: p.text }, contentW);
  }

  // Scrollbar.
  if (lines.length > viewport) {
    const barHeight = Math.max(1, Math.round((viewport * viewport) / lines.length));
    const barTop = top + Math.round((viewer.scroll / lines.length) * viewport);
    for (let i = 0; i < viewport; i++) {
      const isBar = i >= barTop - top && i < barTop - top + barHeight;
      buf.put(rect.x + rect.w - 2, top + i, isBar ? '█' : '│', {
        fg: isBar ? p.accent : p.border,
      });
    }
  }

  if (viewer.subtitle) {
    const y = rect.y + rect.h - 2;
    buf.fill(rect.x + 1, y, rect.w - 2, 1, { bg: p.panel });
    buf.put(rect.x + 2, y, viewer.subtitle, { fg: p.faint }, rect.w - 4);
  } else {
    modalHint(buf, theme, rect, [
      { key: '↑↓', label: 'scroll' },
      { key: 'PgUp/PgDn', label: 'page' },
      { key: 'c', label: 'copy' },
      { key: 'Esc', label: 'close' },
    ]);
  }

  return { cursor: null };
}
