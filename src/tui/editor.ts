import { codepointWidth, displayWidth } from './width.js';

/**
 * Cursor-aware plain-text editor used by TUI form fields.
 *
 * Cursor positions are JS string indices but every movement stays on code
 * point boundaries. `up`/`down` use hard-wrapped visual lines so multi-line
 * values (PEMs, JSON, notes) behave predictably.
 */

export interface VisualLine {
  text: string;
  start: number;
  end: number;
}

function hardWrapWithOffsets(value: string, width: number): VisualLine[] {
  const result: VisualLine[] = [];
  if (width <= 0) return [{ text: '', start: 0, end: 0 }];

  let logicalStart = 0;
  const logicalLines: Array<{ text: string; start: number }> = [];
  let current = '';
  let currentStart = 0;

  for (let i = 0; i < value.length; ) {
    const cp = value.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    if (ch === '\n') {
      logicalLines.push({ text: current, start: currentStart });
      current = '';
      currentStart = i + 1;
    } else {
      current += ch;
    }
    i += ch.length;
  }
  logicalLines.push({ text: current, start: currentStart });

  for (const logical of logicalLines) {
    if (logical.text === '') {
      result.push({ text: '', start: logical.start, end: logical.start });
      continue;
    }

    let chunk = '';
    let offset = logical.start;
    let chunkStart = offset;
    let used = 0;

    for (const ch of logical.text) {
      const w = codepointWidth(ch.codePointAt(0) ?? 0);
      if (used + w > width && chunk.length > 0) {
        result.push({ text: chunk, start: chunkStart, end: offset });
        chunk = '';
        chunkStart = offset;
        used = 0;
      }
      chunk += ch;
      offset += ch.length;
      used += w;
    }
    result.push({ text: chunk, start: chunkStart, end: offset });
  }

  return result;
}

export function visualLines(value: string, width: number): VisualLine[] {
  return hardWrapWithOffsets(value, width);
}

function offsetForWidth(text: string, target: number): number {
  let used = 0;
  let index = 0;
  for (const ch of text) {
    const w = codepointWidth(ch.codePointAt(0) ?? 0);
    if (used + w > target) break;
    used += w;
    index += ch.length;
  }
  return index;
}

export class TextEditor {
  value: string;
  cursor: number;

  constructor(value = '') {
    this.value = value;
    this.cursor = value.length;
  }

  set(value: string, cursor = value.length): void {
    this.value = value;
    this.cursor = Math.max(0, Math.min(value.length, cursor));
  }

  private prevIndex(index: number): number {
    if (index <= 0) return 0;
    const cp = this.value.codePointAt(index - 2);
    if (cp !== undefined && cp > 0xffff) return index - 2;
    return index - 1;
  }

  private nextIndex(index: number): number {
    if (index >= this.value.length) return this.value.length;
    const cp = this.value.codePointAt(index);
    return index + (cp !== undefined && cp > 0xffff ? 2 : 1);
  }

  insert(text: string): void {
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
  }

  backspace(): void {
    if (this.cursor === 0) return;
    const prev = this.prevIndex(this.cursor);
    this.value = this.value.slice(0, prev) + this.value.slice(this.cursor);
    this.cursor = prev;
  }

  del(): void {
    if (this.cursor >= this.value.length) return;
    const next = this.nextIndex(this.cursor);
    this.value = this.value.slice(0, this.cursor) + this.value.slice(next);
  }

  left(): void {
    this.cursor = this.prevIndex(this.cursor);
  }

  right(): void {
    this.cursor = this.nextIndex(this.cursor);
  }

  home(): void {
    const before = this.value.lastIndexOf('\n', Math.max(0, this.cursor - 1));
    this.cursor = before === -1 ? 0 : before + 1;
  }

  end(): void {
    const after = this.value.indexOf('\n', this.cursor);
    this.cursor = after === -1 ? this.value.length : after;
  }

  docHome(): void {
    this.cursor = 0;
  }

  docEnd(): void {
    this.cursor = this.value.length;
  }

  wordLeft(): void {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.value[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.value[i - 1])) i--;
    this.cursor = i;
  }

  wordRight(): void {
    let i = this.cursor;
    while (i < this.value.length && /\s/.test(this.value[i])) i++;
    while (i < this.value.length && !/\s/.test(this.value[i])) i++;
    this.cursor = i;
  }

  deleteWordBefore(): void {
    const wordStart = (() => {
      let i = this.cursor;
      while (i > 0 && /\s/.test(this.value[i - 1])) i--;
      while (i > 0 && !/\s/.test(this.value[i - 1])) i--;
      return i;
    })();
    this.value = this.value.slice(0, wordStart) + this.value.slice(this.cursor);
    this.cursor = wordStart;
  }

  clearBefore(): void {
    this.value = this.value.slice(this.cursor);
    this.cursor = 0;
  }

  up(width: number): void {
    const lines = hardWrapWithOffsets(this.value, width);
    const index = this.lineIndex(lines);
    if (index <= 0) return;
    const line = lines[index];
    const target = lines[index - 1];
    const column = displayWidth(this.value.slice(line.start, this.cursor));
    this.cursor = Math.min(target.start + offsetForWidth(target.text, column), target.end);
  }

  down(width: number): void {
    const lines = hardWrapWithOffsets(this.value, width);
    const index = this.lineIndex(lines);
    if (index >= lines.length - 1) return;
    const line = lines[index];
    const target = lines[index + 1];
    const column = displayWidth(this.value.slice(line.start, this.cursor));
    this.cursor = Math.min(target.start + offsetForWidth(target.text, column), target.end);
  }

  private lineIndex(lines: VisualLine[]): number {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (this.cursor >= line.start && (this.cursor < line.end || (isLast && this.cursor <= line.end))) {
        return i;
      }
      // Cursor at a soft-wrap boundary belongs to the earlier line.
      if (this.cursor === line.end) return i;
    }
    return lines.length - 1;
  }
}

/** Cursor position for a wrapped value, used by textarea rendering. */
export function cursorInWrapped(value: string, cursor: number, width: number): { line: number; column: number } {
  const lines = hardWrapWithOffsets(value, width);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (cursor >= line.start && cursor <= line.end) {
      return { line: i, column: displayWidth(value.slice(line.start, cursor)) };
    }
  }
  return { line: Math.max(0, lines.length - 1), column: 0 };
}
