import type { Buffer } from './buffer.js';
import type { Theme } from './theme.js';

const GLYPHS: Record<string, string[]> = {
  S: ['██████', '█     ', '█████ ', '     █', '██████'],
  C: ['██████', '█     ', '█     ', '█     ', '██████'],
  Y: ['█   █ ', ' █ █  ', '  █   ', '  █   ', '  █   '],
  N: ['█   █ ', '██  █ ', '█ █ █ ', '█  ██ ', '█   █ '],
};

/** 5-row block wordmark for "SCYNC" (34 columns). */
const WORDMARK: string[] = Array.from({ length: 5 }, (_, row) =>
  ['S', 'C', 'Y', 'N', 'C'].map((letter) => GLYPHS[letter][row]).join(' ')
);

export const WORDMARK_WIDTH = WORDMARK[0].length;
export const WORDMARK_HEIGHT = WORDMARK.length;

const ROW_COLORS = ['accentSoft', 'accent', 'accent', 'accentSoft', 'accent'] as const;

export function drawWordmark(
  buf: Buffer,
  theme: Theme,
  x: number,
  y: number
): void {
  const { p } = theme;
  const ascii = theme.g.v === '|';
  const rows = ascii ? WORDMARK.map((line) => line.replace(/█/g, '#')) : WORDMARK;
  const underline = ascii ? '-' : '─';
  const sweepGlyph = ascii ? '#' : '━';

  // Soft depth shadow (skip the final row so it does not dirty the underline).
  for (let row = 0; row < rows.length - 1; row++) {
    buf.put(x + 1, y + row + 1, rows[row], { fg: p.accentDim }, WORDMARK_WIDTH);
  }

  for (let row = 0; row < rows.length; row++) {
    const color = p[ROW_COLORS[row]];
    buf.put(x, y + row, rows[row], { fg: color, bold: true }, WORDMARK_WIDTH);
  }

  buf.hline(x, y + WORDMARK.length, WORDMARK_WIDTH, { fg: p.accentDim }, underline);
  const sweep = sweepGlyph.repeat(8);
  const travel = Math.max(1, WORDMARK_WIDTH - sweep.length);
  const offset = Math.floor((Date.now() / 40) % travel);
  buf.put(x + offset, y + WORDMARK.length, sweep, { fg: p.accentSoft, bold: true }, sweep.length);
}

export function wordmarkLines(): string[] {
  return [...WORDMARK];
}
