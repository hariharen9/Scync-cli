/**
 * Width, truncation and sanitisation helpers for the terminal UI.
 *
 * Everything rendered by the TUI passes through this module so untrusted vault
 * metadata (names, notes, hosts, URLs) cannot inject terminal control
 * sequences, and so wide/combining characters are laid out correctly.
 */

const ANSI_REGEX =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const CONTROL_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, '');
}

/**
 * Removes ANSI/OSC escape sequences and unsupported control characters.
 * Newlines and tabs are preserved for multi-line rendering; callers that need
 * a single line should use `singleLine`.
 */
export function sanitizeText(value: string): string {
  if (!value) return '';
  return stripAnsi(value).replace(/\r\n?/g, '\n').replace(CONTROL_REGEX, '');
}

export function singleLine(value: string): string {
  return sanitizeText(value).replace(/[\n\t]+/g, ' ');
}

function isFullWidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f004 && cp <= 0x1f004) ||
    (cp >= 0x1f0cf && cp <= 0x1f0cf) ||
    (cp >= 0x1f18e && cp <= 0x1f18e) ||
    (cp >= 0x1f191 && cp <= 0x1f19a) ||
    (cp >= 0x1f200 && cp <= 0x1f320) ||
    (cp >= 0x1f32d && cp <= 0x1f3fa) ||
    (cp >= 0x1f400 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff)
  );
}

/** Approximate wcwidth for a single code point. */
export function codepointWidth(cp: number): number {
  if (cp === 0) return 0;
  // Combining marks, zero-width spaces/joiners, variation selectors.
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  if (cp >= 0x0483 && cp <= 0x0489) return 0;
  if (cp >= 0x0591 && cp <= 0x05bd) return 0;
  if (cp >= 0x0610 && cp <= 0x061a) return 0;
  if (cp >= 0x064b && cp <= 0x065f) return 0;
  if (cp >= 0x0670 && cp <= 0x0670) return 0;
  if (cp >= 0x06d6 && cp <= 0x06dc) return 0;
  if (cp >= 0x0e31 && cp <= 0x0e31) return 0;
  if (cp >= 0x0e34 && cp <= 0x0e3a) return 0;
  if (cp >= 0x0e47 && cp <= 0x0e4e) return 0;
  if (cp >= 0x1ab0 && cp <= 0x1aff) return 0;
  if (cp >= 0x1dc0 && cp <= 0x1dff) return 0;
  if (cp >= 0x200b && cp <= 0x200f) return 0;
  if (cp >= 0x202a && cp <= 0x202e) return 0;
  if (cp >= 0x2060 && cp <= 0x2064) return 0;
  if (cp >= 0x20d0 && cp <= 0x20ff) return 0;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0;
  if (cp >= 0xfe20 && cp <= 0xfe2f) return 0;
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return 0;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return 0;

  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp === 0x200d) return 0; // zero-width joiner

  return isFullWidth(cp) ? 2 : 1;
}

export function displayWidth(value: string): number {
  let width = 0;
  for (const ch of stripAnsi(value)) width += codepointWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** Truncates by display width, appending a single-width ellipsis when needed. */
export function truncate(value: string, maxWidth: number, ellipsis = '…'): string {
  const text = singleLine(value);
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;

  const budget = Math.max(0, maxWidth - displayWidth(ellipsis));
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = codepointWidth(ch.codePointAt(0) ?? 0);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out + ellipsis;
}

export function padEnd(value: string, width: number): string {
  const pad = width - displayWidth(value);
  return pad > 0 ? value + ' '.repeat(pad) : value;
}

export function padStart(value: string, width: number): string {
  const pad = width - displayWidth(value);
  return pad > 0 ? ' '.repeat(pad) + value : value;
}

/** Wraps text to `width`, preserving explicit newlines. */
export function wrapText(value: string, width: number): string[] {
  const clean = sanitizeText(value);
  if (width <= 0) return [];
  const result: string[] = [];

  for (const logical of clean.split('\n')) {
    const expanded = logical.replace(/\t/g, '    ');
    if (expanded === '') {
      result.push('');
      continue;
    }

    let line = '';
    let used = 0;
    const words = expanded.split(/ +/);

    const pushLine = () => {
      result.push(line);
      line = '';
      used = 0;
    };

    for (const word of words) {
      const wordWidth = displayWidth(word);
      const separator = line.length > 0 ? 1 : 0;

      if (used + separator + wordWidth <= width) {
        line += (separator ? ' ' : '') + word;
        used += separator + wordWidth;
        continue;
      }

      if (line.length > 0) pushLine();

      if (wordWidth <= width) {
        line = word;
        used = wordWidth;
        continue;
      }

      // Hard-break a word that is wider than the whole line.
      let chunk = '';
      let chunkWidth = 0;
      for (const ch of word) {
        const w = codepointWidth(ch.codePointAt(0) ?? 0);
        if (chunkWidth + w > width) {
          result.push(chunk);
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

    result.push(line);
  }

  return result;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Returns the visible window start so `selected` stays in view. */
export function scrollWindow(total: number, selected: number, viewport: number): number {
  if (viewport <= 0 || total <= viewport) return 0;
  if (selected < viewport) return 0;
  const desired = selected - viewport + 1;
  return clamp(desired, 0, Math.max(0, total - viewport));
}
