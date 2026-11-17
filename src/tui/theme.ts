/**
 * Colour depth detection, palette and glyph set for the TUI.
 *
 * Cells store plain hex colours; the active `Colorizer` converts them to the
 * best SGR representation the terminal supports (truecolor, 256, 16 or none).
 */

export type ColorDepth = 0 | 16 | 256 | 24;

export interface Colorizer {
  depth: ColorDepth;
  fg(hex: string): string;
  bg(hex: string): string;
}

export interface Palette {
  bg: string;
  bgAlt: string;
  panel: string;
  panelAlt: string;
  elevated: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  accentDim: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  purple: string;
  pink: string;
  white: string;
}

export interface Glyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  teeL: string;
  teeR: string;
  teeT: string;
  teeB: string;
  cross: string;
  dot: string;
  circle: string;
  check: string;
  arrow: string;
  ellipsis: string;
  bar: string;
  barEmpty: string;
  pointer: string;
  search: string;
  bullet: string;
  lock: string;
  unlock: string;
  spinner: string[];
}

export interface Theme {
  p: Palette;
  g: Glyphs;
  colorizer: Colorizer;
}

export const DARK_PALETTE: Palette = {
  bg: '#07080a',
  bgAlt: '#0a0c10',
  panel: '#0d1015',
  panelAlt: '#12161d',
  elevated: '#171c24',
  border: '#222833',
  borderStrong: '#333c4a',
  text: '#eef2f7',
  muted: '#98a2b3',
  faint: '#5d6675',
  accent: '#10b981',
  accentSoft: '#34d399',
  accentDim: '#064e3b',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#38bdf8',
  purple: '#a78bfa',
  pink: '#f472b6',
  white: '#ffffff',
};

const UNICODE_GLYPHS: Glyphs = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
  teeL: '├',
  teeR: '┤',
  teeT: '┬',
  teeB: '┴',
  cross: '┼',
  dot: '●',
  circle: '○',
  check: '✓',
  arrow: '→',
  ellipsis: '…',
  bar: '█',
  barEmpty: '░',
  pointer: '▸',
  search: '⌕',
  bullet: '•',
  lock: '▪',
  unlock: '▫',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

const ASCII_GLYPHS: Glyphs = {
  tl: '+',
  tr: '+',
  bl: '+',
  br: '+',
  h: '-',
  v: '|',
  teeL: '+',
  teeR: '+',
  teeT: '+',
  teeB: '+',
  cross: '+',
  dot: '*',
  circle: 'o',
  check: 'v',
  arrow: '->',
  ellipsis: '...',
  bar: '#',
  barEmpty: '.',
  pointer: '>',
  search: '/',
  bullet: '*',
  lock: '-',
  unlock: '+',
  spinner: ['|', '/', '-', '\\'],
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return [255, 255, 255];
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

const CUBE = [0, 95, 135, 175, 215, 255];

function rgbTo256([r, g, b]: [number, number, number]): number {
  const q = (v: number) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < CUBE.length; i++) {
      const d = Math.abs(CUBE[i] - v);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const ri = q(r);
  const gi = q(g);
  const bi = q(b);
  const cubeIndex = 16 + 36 * ri + 6 * gi + bi;
  const cubeRgb: [number, number, number] = [CUBE[ri], CUBE[gi], CUBE[bi]];
  const cubeDist = (cubeRgb[0] - r) ** 2 + (cubeRgb[1] - g) ** 2 + (cubeRgb[2] - b) ** 2;

  const grayAvg = Math.round((r + g + b) / 3);
  const grayIndex = Math.max(0, Math.min(23, Math.round((grayAvg - 8) / 10)));
  const grayValue = 8 + grayIndex * 10;
  const grayDist = (grayValue - r) ** 2 + (grayValue - g) ** 2 + (grayValue - b) ** 2;

  return grayDist < cubeDist ? 232 + grayIndex : cubeIndex;
}

const ANSI16: Array<[number, number, number]> = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function rgbTo16([r, g, b]: [number, number, number]): number {
  let best = 7;
  let bestDist = Infinity;
  for (let i = 0; i < ANSI16.length; i++) {
    const [ar, ag, ab] = ANSI16[i];
    const d = (ar - r) ** 2 + (ag - g) ** 2 + (ab - b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function detectColorDepth(
  stream: NodeJS.WriteStream = process.stdout,
  override = process.env.SCYNC_TUI_COLORS
): ColorDepth {
  if (!stream.isTTY || process.env.NO_COLOR) return 0;

  if (override) {
    if (override === '0' || override === 'none' || override === 'off') return 0;
    if (override === '16') return 16;
    if (override === '256') return 256;
    if (override === '24' || override === 'truecolor') return 24;
  }

  const term = process.env.TERM || '';
  if (term === 'dumb') return 0;
  if (/truecolor|24bit/i.test(process.env.COLORTERM || '')) return 24;
  if (process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode' || process.env.TERM_PROGRAM === 'WezTerm') {
    return 24;
  }
  if (/256color/i.test(term)) return 256;

  try {
    const depth = stream.getColorDepth?.() ?? 4;
    if (depth >= 24) return 24;
    if (depth >= 8) return 256;
    return 16;
  } catch {
    return 16;
  }
}

export function createColorizer(depth: ColorDepth): Colorizer {
  const cache = new Map<string, string>();

  const resolve = (kind: 'fg' | 'bg', hex: string): string => {
    if (depth === 0) return '';
    const key = `${depth}:${kind}:${hex}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const rgb = hexToRgb(hex);
    let code: string;
    if (depth === 24) {
      code = `${kind === 'fg' ? 38 : 48};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
    } else if (depth === 256) {
      code = `${kind === 'fg' ? 38 : 48};5;${rgbTo256(rgb)}`;
    } else {
      const index = rgbTo16(rgb);
      if (kind === 'fg') {
        code = String(index < 8 ? 30 + index : 90 + (index - 8));
      } else {
        code = String(index < 8 ? 40 + index : 100 + (index - 8));
      }
    }
    cache.set(key, code);
    return code;
  };

  return {
    depth,
    fg: (hex) => resolve('fg', hex),
    bg: (hex) => resolve('bg', hex),
  };
}

export function createTheme(options: { depth?: ColorDepth; ascii?: boolean } = {}): Theme {
  const depth = options.depth ?? detectColorDepth();
  const ascii = options.ascii ?? process.env.SCYNC_TUI_ASCII === '1';
  return {
    p: DARK_PALETTE,
    g: ascii ? ASCII_GLYPHS : UNICODE_GLYPHS,
    colorizer: createColorizer(depth),
  };
}
