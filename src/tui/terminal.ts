import { StringDecoder } from 'node:string_decoder';
import { KeyParser, type Key } from './keys.js';
import type { Buffer as ScreenBuffer } from './buffer.js';

/**
 * Owns the process terminal: alternate screen, raw mode, bracketed paste,
 * resize handling and row-diffed rendering.
 *
 * The terminal is always restored through an idempotent `exit()`, which the
 * app calls from a finally block and from process signal handlers.
 */

export interface Cursor {
  x: number;
  y: number;
}

export class Terminal {
  private readonly out = process.stdout;
  private readonly input = process.stdin;
  private readonly decoder = new StringDecoder('utf8');
  private readonly parser = new KeyParser();
  private keyHandler: ((key: Key) => void) | null = null;
  private errorHandler: ((err: unknown) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private active = false;
  private previousLines: string[] = [];
  private previousW = 0;
  private previousH = 0;
  private resizeTimer: NodeJS.Timeout | null = null;
  private escapeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.onData = this.onData.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onInputEnd = this.onInputEnd.bind(this);
  }

  get width(): number {
    return this.out.columns || 100;
  }

  get height(): number {
    return this.out.rows || 30;
  }

  get isTTY(): boolean {
    return Boolean(this.input.isTTY && this.out.isTTY);
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.previousLines = [];
    this.previousW = 0;
    this.previousH = 0;
    this.parser.reset();

    if (this.input.isTTY) this.input.setRawMode(true);
    this.input.resume();
    this.input.on('data', this.onData);
    this.input.on('end', this.onInputEnd);
    this.out.on('resize', this.onResize);

    this.out.write(
      '\x1b[?1049h' + // alternate screen
        '\x1b[?25l' + // hide cursor
        '\x1b[?7l' + // disable autowrap
        '\x1b[?2004h' + // bracketed paste
        '\x1b[2J\x1b[H'
    );
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;

    try {
      this.out.write('\x1b[0m\x1b[?25h\x1b[?7h\x1b[?2004l\x1b[?1049l');
    } catch {
      // ignore
    }

    this.input.removeListener('data', this.onData);
    this.input.removeListener('end', this.onInputEnd);
    this.out.removeListener('resize', this.onResize);

    try {
      if (this.input.isTTY) this.input.setRawMode(false);
    } catch {
      // ignore
    }
    try {
      this.input.pause();
    } catch {
      // ignore
    }

    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
  }

  onKey(handler: (key: Key) => void): void {
    this.keyHandler = handler;
  }

  onError(handler: (err: unknown) => void): void {
    this.errorHandler = handler;
  }

  onResizeEvent(handler: () => void): void {
    this.resizeHandler = handler;
  }

  render(frame: ScreenBuffer, cursor: Cursor | null = null): void {
    if (!this.active) return;
    const lines = frame.toLines();
    let payload = '\x1b[?2026h';

    const sizeChanged =
      this.previousW !== frame.w ||
      this.previousH !== frame.h ||
      this.previousLines.length !== lines.length;

    if (sizeChanged) {
      payload += '\x1b[H' + lines.join('\r\n') + '\x1b[J';
      this.previousLines = lines.slice();
      this.previousW = frame.w;
      this.previousH = frame.h;
    } else {
      for (let y = 0; y < lines.length; y++) {
        if (lines[y] === this.previousLines[y]) continue;
        payload += `\x1b[${y + 1};1H\x1b[2K` + lines[y];
        this.previousLines[y] = lines[y];
      }
    }

    if (cursor) {
      payload += `\x1b[${Math.max(1, cursor.y + 1)};${Math.max(1, cursor.x + 1)}H\x1b[?25h`;
    } else {
      payload += '\x1b[?25l';
    }

    payload += '\x1b[?2026l';
    if (payload.length > 8) this.out.write(payload);
  }

  /** Temporarily leaves the TUI, runs `fn`, then restores the TUI. */
  async suspend(fn: () => Promise<void> | void): Promise<void> {
    this.exit();
    try {
      await fn();
    } finally {
      this.enter();
    }
  }

  private onData(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (!text) return;

    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = null;
    }

    this.dispatchKeys(this.parser.feed(text));
    this.scheduleEscapeFlush();
  }

  private dispatchKeys(keys: Key[]): void {
    for (const key of keys) {
      try {
        this.keyHandler?.(key);
      } catch (err) {
        this.errorHandler?.(err);
      }
    }
  }

  /**
   * A lone ESC is ambiguous: it can be the Escape key or the first byte of an
   * arrow/function-key sequence delivered in a separate read. Wait a short
   * moment for more bytes, then deliver Escape if none arrive.
   */
  private scheduleEscapeFlush(): void {
    if (!this.parser.hasPending() || this.escapeTimer) return;
    this.escapeTimer = setTimeout(() => {
      this.escapeTimer = null;
      this.dispatchKeys(this.parser.flushPending());
      this.scheduleEscapeFlush();
    }, 40);
    if (typeof this.escapeTimer.unref === 'function') this.escapeTimer.unref();
  }

  private onInputEnd(): void {
    this.keyHandler?.({ type: 'special', name: 'ctrl-c' });
  }

  private onResize(): void {
    if (this.resizeTimer) return;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.previousLines = [];
      this.previousW = 0;
      this.previousH = 0;
      this.resizeHandler?.();
    }, 40);
  }
}
