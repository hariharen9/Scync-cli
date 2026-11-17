/**
 * Raw terminal key parser.
 *
 * Turns arbitrary stdin chunks into semantic keys, including CSI/SS3 arrows,
 * function keys, modifiers, control characters and bracketed paste. Partial
 * escape sequences are buffered until complete.
 */

export interface Key {
  type: 'char' | 'special' | 'paste';
  name?: string;
  text?: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const SIMPLE_SEQUENCES: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  Z: 'tab',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

const TILDE_SEQUENCES: Record<string, string> = {
  '1': 'home',
  '2': 'insert',
  '3': 'delete',
  '4': 'end',
  '5': 'pageup',
  '6': 'pagedown',
  '7': 'home',
  '8': 'end',
  '11': 'f1',
  '12': 'f2',
  '13': 'f3',
  '14': 'f4',
  '15': 'f5',
  '17': 'f6',
  '18': 'f7',
  '19': 'f8',
  '20': 'f9',
  '21': 'f10',
  '23': 'f11',
  '24': 'f12',
};

function modifierFlags(value: number): Pick<Key, 'shift' | 'alt' | 'ctrl'> {
  const flags: Pick<Key, 'shift' | 'alt' | 'ctrl'> = {};
  if (value >= 2) flags.shift = (value - 1) & 1 ? true : undefined;
  if (value >= 3) flags.alt = (value - 1) & 2 ? true : undefined;
  if (value >= 5) flags.ctrl = (value - 1) & 4 ? true : undefined;
  return flags;
}

function isPartialMarker(buffer: string): boolean {
  if (buffer.length < 2) return false;
  return (
    (PASTE_START.startsWith(buffer) && buffer.length < PASTE_START.length) ||
    (PASTE_END.startsWith(buffer) && buffer.length < PASTE_END.length)
  );
}

export class KeyParser {
  private buffer = '';
  private pasteMode = false;
  private pasteText = '';

  feed(chunk: string): Key[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  /** True when a partial escape sequence is waiting for more bytes. */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  reset(): void {
    this.buffer = '';
    this.pasteMode = false;
    this.pasteText = '';
  }

  /**
   * Called after a short timeout when no more bytes arrive. A lone ESC becomes
   * the Escape key; a partial unknown sequence is flushed as Escape plus the
   * remaining input. Partial paste markers are discarded rather than typed.
   */
  flushPending(): Key[] {
    if (this.buffer.length === 0) return [];
    if (this.buffer === '\x1b') {
      this.buffer = '';
      return [{ type: 'special', name: 'escape' }];
    }
    if (isPartialMarker(this.buffer)) {
      this.buffer = '';
      return [];
    }
    if (this.buffer.startsWith('\x1b')) {
      const rest = this.buffer.slice(1);
      this.buffer = '';
      const keys: Key[] = [{ type: 'special', name: 'escape' }];
      if (rest) keys.push(...this.feed(rest));
      return keys;
    }
    const rest = this.buffer;
    this.buffer = '';
    return this.feed(rest);
  }

  private drain(final: boolean): Key[] {
    const keys: Key[] = [];

    while (this.buffer.length > 0) {
      if (this.pasteMode) {
        const end = this.buffer.indexOf(PASTE_END);
        if (end === -1) {
          this.pasteText += this.buffer;
          this.buffer = '';
          break;
        }
        this.pasteText += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + PASTE_END.length);
        keys.push({ type: 'paste', text: this.pasteText });
        this.pasteText = '';
        this.pasteMode = false;
        continue;
      }

      if (this.buffer.startsWith(PASTE_START)) {
        this.buffer = this.buffer.slice(PASTE_START.length);
        this.pasteMode = true;
        continue;
      }

      if (isPartialMarker(this.buffer)) break;

      const first = this.buffer[0];
      const code = first.charCodeAt(0);

      // Escape sequences.
      if (first === '\x1b') {
        if (this.buffer.length === 1) {
          // Wait briefly: this may be the start of an arrow/function key
          // sequence rather than a standalone Escape key. Terminal.flushPending()
          // emits Escape if no further bytes arrive.
          break;
        }

        const second = this.buffer[1];
        if (second === '[' || second === 'O') {
          const parsed = this.parseEscape();
          if (!parsed) break; // incomplete, wait for more
          if (parsed.key) keys.push(parsed.key);
          continue;
        }

        // Alt + character.
        const next = this.takeCodePoint(1);
        if (!next) break;
        this.buffer = this.buffer.slice(1 + next.length);
        keys.push({ type: 'char', text: next, alt: true });
        continue;
      }

      // Control characters and whitespace.
      if (code === 13 || code === 10) {
        keys.push({ type: 'special', name: 'enter' });
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (code === 9) {
        keys.push({ type: 'special', name: 'tab' });
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (code === 127 || code === 8) {
        keys.push({ type: 'special', name: 'backspace' });
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (code === 0) {
        keys.push({ type: 'char', text: ' ', ctrl: true });
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (code > 0 && code < 32) {
        const letter = String.fromCharCode(code + 96);
        if (code === 3) {
          keys.push({ type: 'special', name: 'ctrl-c' });
        } else {
          keys.push({ type: 'char', text: letter, ctrl: true });
        }
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // Printable code point.
      const next = this.takeCodePoint(0);
      if (!next) {
        if (!final) break;
        this.buffer = '';
        break;
      }
      this.buffer = this.buffer.slice(next.length);
      keys.push({ type: 'char', text: next });
    }

    return keys;
  }

  private takeCodePoint(offset: number): string | null {
    if (offset >= this.buffer.length) return null;
    const cp = this.buffer.codePointAt(offset);
    if (cp === undefined) return null;
    return String.fromCodePoint(cp);
  }

  private parseEscape(): { key?: Key } | null {
    const start = 2;
    // Find the CSI/SS3 final byte (0x40-0x7e).
    let finalIndex = -1;
    for (let i = start; i < this.buffer.length; i++) {
      const c = this.buffer.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) {
        finalIndex = i;
        break;
      }
    }
    if (finalIndex === -1) return null;

    const sequence = this.buffer.slice(0, finalIndex + 1);
    const body = this.buffer.slice(start, finalIndex);
    const final = this.buffer[finalIndex];
    this.buffer = this.buffer.slice(finalIndex + 1);

    // SS3 (ESC O x) and simple CSI (ESC [ A).
    if (body === '' || /^\d*$/.test(body)) {
      if (body === '' && SIMPLE_SEQUENCES[final]) {
        return { key: { type: 'special', name: SIMPLE_SEQUENCES[final], shift: final === 'Z' || undefined } };
      }
      if (/^\d+$/.test(body) && TILDE_SEQUENCES[body] && final === '~') {
        return { key: { type: 'special', name: TILDE_SEQUENCES[body] } };
      }
    }

    // CSI with parameters/modifiers: ESC [ 1 ; 5 A
    if (final !== '~') {
      const parts = body.split(';');
      const modifier = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) : 1;
      const flags = modifierFlags(Number.isFinite(modifier) ? modifier : 1);
      const name = SIMPLE_SEQUENCES[final];
      if (name) return { key: { type: 'special', name, ...flags } };
    }

    // Modified tilde sequences: ESC [ 3 ; 5 ~
    const tildeParts = body.split(';');
    if (final === '~' && tildeParts.length >= 1) {
      const code = tildeParts[0];
      if (TILDE_SEQUENCES[code]) {
        const modifier = tildeParts.length > 1 ? parseInt(tildeParts[tildeParts.length - 1], 10) : 1;
        return {
          key: {
            type: 'special',
            name: TILDE_SEQUENCES[code],
            ...modifierFlags(Number.isFinite(modifier) ? modifier : 1),
          },
        };
      }
    }

    // Unknown sequence: consume it silently.
    void sequence;
    return {};
  }
}

export function isChar(key: Key, text?: string): boolean {
  return key.type === 'char' && !key.ctrl && !key.alt && (text === undefined || key.text === text);
}

export function isSpecial(key: Key, name: string): boolean {
  return key.type === 'special' && key.name === name;
}

export function keyLabel(key: Key): string {
  if (key.type === 'paste') return 'paste';
  if (key.type === 'char') {
    if (key.ctrl) return `Ctrl+${key.text?.toUpperCase() ?? ''}`;
    if (key.alt) return `Alt+${key.text ?? ''}`;
    return key.text ?? '';
  }
  return key.name ?? '';
}
