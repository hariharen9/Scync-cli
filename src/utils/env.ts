export interface EnvEntry {
  key: string;
  value: string;
  comment?: string;
}

/**
 * Normalizes a secret name to a valid POSIX environment variable name.
 * e.g. "stripe-api-key" -> "STRIPE_API_KEY"
 */
export function normalizeEnvKey(name: string): string {
  let cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  // Must not start with a digit
  if (/^[0-9]/.test(cleaned)) {
    cleaned = '_' + cleaned;
  }
  return cleaned || 'SECRET';
}

/**
 * Safely formats a key-value pair for a .env file.
 */
export function formatEnvLine(key: string, value: string): string {
  const normKey = normalizeEnvKey(key);
  
  // If value is empty, write KEY=""
  if (value === '') {
    return `${normKey}=""`;
  }

  // Check if quoting is required
  const needsQuotes = /[\s"'#=\\]|\n|\r/.test(value);
  if (!needsQuotes) {
    return `${normKey}=${value}`;
  }

  // Escape backslashes, double quotes, and newlines
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

  return `${normKey}="${escaped}"`;
}

/**
 * Parses raw .env string into key-value entries.
 * Handles export prefixes, comments, quotes, and escaped characters.
 */
export function parseEnvFile(content: string): EnvEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: EnvEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }

    // Strip leading "export " if present
    let line = rawLine;
    if (line.startsWith('export ') || line.startsWith('export\t')) {
      line = line.replace(/^export\s+/, '');
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    // Check quotes
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
      val = val.slice(1, -1);
    } else {
      // Strip inline comments if not quoted
      const commentIdx = val.indexOf('#');
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }
    }

    entries.push({ key, value: val });
  }

  return entries;
}
