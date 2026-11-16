/**
 * Sanitizes untrusted strings fetched from remote storage to prevent terminal injection attacks.
 * Strips ANSI escape sequences, control characters (except common newlines/tabs when formatted),
 * and terminal control characters.
 */

// Matches ANSI escape codes: \x1b[...m, OSC, CSI, etc.
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

// Matches control characters \x00-\x1f except \t (\x09) and \n (\x0a)
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function sanitizeTerminalOutput(str: string): string {
  if (!str) return '';
  return str.replace(ANSI_REGEX, '').replace(CONTROL_CHARS_REGEX, '');
}

export function maskSecretValue(value: string): string {
  if (!value) return '••••••••';
  if (value.length <= 10) return '••••••••';
  if (value.length <= 16) return `${value.slice(0, 2)}••••••••${value.slice(-2)}`;
  return `${value.slice(0, 3)}••••••••${value.slice(-3)}`;
}

export function parseExpirationDate(val: string): Date {
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid expiration date '${val}'. Please provide a valid date string (e.g. '2026-12-31' or ISO 8601).`);
  }
  return d;
}
