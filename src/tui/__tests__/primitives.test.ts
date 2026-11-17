import { describe, expect, it } from 'vitest';
import { KeyParser } from '../keys.js';
import { TextEditor } from '../editor.js';
import { displayWidth, stripAnsi, truncate, wrapText } from '../width.js';

describe('TUI key parser', () => {
  it('parses arrows, home/end and modified sequences', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x1b[A')[0]).toMatchObject({ type: 'special', name: 'up' });
    expect(parser.feed('\x1b[1;5C')[0]).toMatchObject({ type: 'special', name: 'right', ctrl: true });
    expect(parser.feed('\x1b[Z')[0]).toMatchObject({ type: 'special', name: 'tab', shift: true });
    expect(parser.feed('\x1b[3~')[0]).toMatchObject({ type: 'special', name: 'delete' });
    expect(parser.feed('\x1b[5~')[0]).toMatchObject({ type: 'special', name: 'pageup' });
    expect(parser.feed('\x1b[24~')[0]).toMatchObject({ type: 'special', name: 'f12' });
  });

  it('buffers partial escape sequences across chunks', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x1b[')).toEqual([]);
    expect(parser.feed('A')[0]).toMatchObject({ type: 'special', name: 'up' });
  });

  it('waits for a possible sequence before emitting a lone Escape', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x1b')).toEqual([]);
    expect(parser.hasPending()).toBe(true);
    expect(parser.flushPending()).toEqual([{ type: 'special', name: 'escape' }]);
    expect(parser.hasPending()).toBe(false);
  });

  it('parses an arrow sequence split immediately after ESC', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x1b')).toEqual([]);
    expect(parser.feed('[B')[0]).toMatchObject({ type: 'special', name: 'down' });
    expect(parser.hasPending()).toBe(false);
  });

  it('parses an arrow sequence split inside the CSI prefix', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x1b[')).toEqual([]);
    expect(parser.feed('1;5D')[0]).toMatchObject({ type: 'special', name: 'left', ctrl: true });
  });

  it('handles control keys, alt keys and unicode input', () => {
    const parser = new KeyParser();
    expect(parser.feed('\x03')[0]).toMatchObject({ type: 'special', name: 'ctrl-c' });
    expect(parser.feed('\x15')[0]).toMatchObject({ type: 'char', text: 'u', ctrl: true });
    expect(parser.feed('\x1bx')[0]).toMatchObject({ type: 'char', text: 'x', alt: true });
    expect(parser.feed('λ')[0]).toMatchObject({ type: 'char', text: 'λ' });
  });

  it('supports bracketed paste including newlines', () => {
    const parser = new KeyParser();
    const keys = parser.feed('\x1b[200~line one\nline two\x1b[201~');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ type: 'paste', text: 'line one\nline two' });
  });
});

describe('TUI width helpers', () => {
  it('strips ANSI and measures wide characters', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本')).toBe(4);
    expect(displayWidth('a\u0301')).toBe(1);
  });

  it('sanitises control characters and truncates by width', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('日本語', 3)).toBe('日…');
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });
});

describe('TUI text editor', () => {
  it('edits at the cursor', () => {
    const editor = new TextEditor('hello');
    editor.left();
    editor.insert('!');
    expect(editor.value).toBe('hell!o');
    editor.backspace();
    expect(editor.value).toBe('hello');
    editor.del();
    expect(editor.value).toBe('hell');
  });

  it('moves by word and line', () => {
    const editor = new TextEditor('alpha beta\ngamma delta');
    editor.docHome();
    editor.wordRight();
    expect(editor.cursor).toBe(5);
    editor.deleteWordBefore();
    expect(editor.value).toBe(' beta\ngamma delta');
    editor.docEnd();
    editor.home();
    expect(editor.cursor).toBe(6);
    editor.up(80);
    expect(editor.cursor).toBe(0);
  });

  it('navigates wrapped multi-line values', () => {
    const editor = new TextEditor('abcdefghij');
    editor.set('abcdefghij', 10);
    editor.up(4);
    expect(editor.cursor).toBe(6);
    editor.down(4);
    expect(editor.cursor).toBe(10);
  });
});
