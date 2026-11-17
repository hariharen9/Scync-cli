import { codepointWidth, sanitizeText, singleLine } from './width.js';
import type { Colorizer, Glyphs } from './theme.js';

/**
 * A tiny ANSI cell buffer.
 *
 * Components draw into a fixed grid of cells (with explicit styles) and the
 * buffer serialises changed rows to escape sequences. Using a cell grid gives
 * correct clipping, side-by-side layouts and modal compositing without any
 * third-party terminal library.
 */

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface Cell {
  ch: string;
  cont: boolean;
  fg?: string;
  bg?: string;
  attrs: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_INVERSE = 16;

function attrsOf(style: Style): number {
  let attrs = 0;
  if (style.bold) attrs |= ATTR_BOLD;
  if (style.dim) attrs |= ATTR_DIM;
  if (style.italic) attrs |= ATTR_ITALIC;
  if (style.underline) attrs |= ATTR_UNDERLINE;
  if (style.inverse) attrs |= ATTR_INVERSE;
  return attrs;
}

function styleKey(cell: Cell): string {
  return `${cell.fg ?? ''}\u0000${cell.bg ?? ''}\u0000${cell.attrs}`;
}

export class Buffer {
  readonly w: number;
  readonly h: number;
  readonly cells: Cell[];
  private readonly colorizer: Colorizer;
  private readonly sgrCache = new Map<string, string>();

  constructor(width: number, height: number, base: Style, colorizer: Colorizer) {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.colorizer = colorizer;
    this.cells = new Array(this.w * this.h);
    this.clear(base);
  }

  index(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  clear(style: Style = {}): void {
    const attrs = attrsOf(style);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = { ch: ' ', cont: false, fg: style.fg, bg: style.bg, attrs };
    }
  }

  set(x: number, y: number, ch: string, style: Style = {}): void {
    if (!this.inBounds(x, y)) return;
    const cell = this.cells[this.index(x, y)];
    cell.ch = ch;
    cell.cont = false;
    cell.fg = style.fg;
    cell.bg = style.bg;
    cell.attrs = attrsOf(style);
  }

  fill(x: number, y: number, w: number, h: number, style: Style = {}, ch = ' '): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        this.set(xx, yy, ch, style);
      }
    }
  }

  /**
   * Draws a single line, clipping at `maxWidth` (or the buffer edge).
   * Returns the x coordinate after the last drawn cell.
   */
  put(x: number, y: number, text: string, style: Style = {}, maxWidth = Infinity): number {
    if (y < 0 || y >= this.h) return x;
    const limit = Math.min(this.w, x + Math.max(0, maxWidth));
    let cursor = x;
    let lastCellIndex = -1;

    for (const ch of singleLine(text)) {
      const cp = ch.codePointAt(0) ?? 0;
      const width = codepointWidth(cp);

      if (width === 0) {
        if (lastCellIndex >= 0) this.cells[lastCellIndex].ch += ch;
        continue;
      }
      if (cursor + width > limit) break;

      this.set(cursor, y, ch, style);
      lastCellIndex = this.index(cursor, y);
      if (width === 2 && cursor + 1 < this.w) {
        const cont = this.cells[this.index(cursor + 1, y)];
        cont.ch = '';
        cont.cont = true;
        cont.fg = style.fg;
        cont.bg = style.bg;
        cont.attrs = attrsOf(style);
      }
      cursor += width;
    }

    return cursor;
  }

  /** Draws wrapped multi-line text and returns the number of rows used. */
  putWrapped(
    x: number,
    y: number,
    width: number,
    text: string,
    style: Style = {},
    maxRows = Infinity
  ): number {
    const rows = wrapForBuffer(text, width, maxRows);
    for (let i = 0; i < rows.length; i++) this.put(x, y + i, rows[i], style, width);
    return rows.length;
  }

  hline(x: number, y: number, width: number, style: Style = {}, glyph: string, crosses: number[] = []): void {
    for (let i = 0; i < width; i++) {
      const ch = crosses.includes(i) ? '┼' : glyph;
      this.set(x + i, y, ch, style);
    }
  }

  vline(x: number, y: number, height: number, style: Style = {}, glyph: string): void {
    for (let i = 0; i < height; i++) this.set(x, y + i, glyph, style);
  }

  box(rect: Rect, style: Style = {}, glyphs: Glyphs, title?: string, titleStyle: Style = {}): void {
    const { x, y, w, h } = rect;
    if (w < 2 || h < 2) return;

    this.set(x, y, glyphs.tl, style);
    this.set(x + w - 1, y, glyphs.tr, style);
    this.set(x, y + h - 1, glyphs.bl, style);
    this.set(x + w - 1, y + h - 1, glyphs.br, style);

    for (let i = 1; i < w - 1; i++) {
      this.set(x + i, y, glyphs.h, style);
      this.set(x + i, y + h - 1, glyphs.h, style);
    }
    for (let i = 1; i < h - 1; i++) {
      this.set(x, y + i, glyphs.v, style);
      this.set(x + w - 1, y + i, glyphs.v, style);
    }

    if (title && w > 4) {
      const label = ` ${singleLine(title)} `;
      this.put(x + 2, y, label, { ...style, ...titleStyle }, Math.max(0, w - 4));
    }
  }

  /** Applies the dim attribute to every cell outside `keep`. */
  dimExcept(keep: Rect): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (x >= keep.x && x < keep.x + keep.w && y >= keep.y && y < keep.y + keep.h) continue;
        this.cells[this.index(x, y)].attrs |= ATTR_DIM;
      }
    }
  }

  private sgrFor(cell: Cell): string {
    const key = styleKey(cell);
    const cached = this.sgrCache.get(key);
    if (cached !== undefined) return cached;

    const parts: string[] = ['0'];
    if (cell.attrs & ATTR_BOLD) parts.push('1');
    if (cell.attrs & ATTR_DIM) parts.push('2');
    if (cell.attrs & ATTR_ITALIC) parts.push('3');
    if (cell.attrs & ATTR_UNDERLINE) parts.push('4');
    if (cell.attrs & ATTR_INVERSE) parts.push('7');
    if (cell.fg) {
      const code = this.colorizer.fg(cell.fg);
      if (code) parts.push(code);
    }
    if (cell.bg) {
      const code = this.colorizer.bg(cell.bg);
      if (code) parts.push(code);
    }

    const sgr = parts.length > 1 ? `\x1b[${parts.join(';')}m` : '';
    this.sgrCache.set(key, sgr);
    return sgr;
  }

  /** Serialises the buffer to one string per row (without newlines). */
  toLines(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let line = '';
      let lastKey = '';
      for (let x = 0; x < this.w; x++) {
        const cell = this.cells[this.index(x, y)];
        if (cell.cont) continue;
        const key = styleKey(cell);
        if (key !== lastKey) {
          line += this.sgrFor(cell);
          lastKey = key;
        }
        line += cell.ch;
      }
      lines.push(line + '\x1b[0m');
    }
    return lines;
  }
}

/**
 * Wrap helper shared by Buffer.putWrapped. Kept here to avoid importing the
 * full wrapText (which preserves empty lines differently) in hot paths.
 */
function wrapForBuffer(text: string, width: number, maxRows: number): string[] {
  if (width <= 0) return [];
  const clean = sanitizeText(text).replace(/\t/g, '    ');
  const out: string[] = [];

  for (const logical of clean.split('\n')) {
    if (out.length >= maxRows) break;
    if (logical === '') {
      out.push('');
      continue;
    }

    let line = '';
    let used = 0;

    for (const word of logical.split(/ +/)) {
      const wordWidth = [...word].reduce((sum, ch) => sum + codepointWidth(ch.codePointAt(0) ?? 0), 0);
      const separator = line.length > 0 ? 1 : 0;

      if (used + separator + wordWidth <= width) {
        line += (separator ? ' ' : '') + word;
        used += separator + wordWidth;
        continue;
      }

      if (line) {
        out.push(line);
        if (out.length >= maxRows) return out;
        line = '';
        used = 0;
      }

      if (wordWidth <= width) {
        line = word;
        used = wordWidth;
        continue;
      }

      let chunk = '';
      let chunkWidth = 0;
      for (const ch of word) {
        const w = codepointWidth(ch.codePointAt(0) ?? 0);
        if (chunkWidth + w > width) {
          out.push(chunk);
          if (out.length >= maxRows) return out;
          chunk = '';
          chunkWidth = 0;
        }
        chunk += ch;
        chunkWidth += w;
      }
      if (chunk) {
        line = chunk;
        used = chunkWidth;
      }
    }

    if (line) out.push(line);
    if (out.length >= maxRows) return out;
  }

  return out;
}
