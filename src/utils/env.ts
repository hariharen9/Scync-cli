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
 * Collapses duplicate variable names in a parsed .env file.
 * Later entries win (matching shell dotenv semantics) and the number of
 * discarded duplicate lines is returned so callers can warn the user.
 */
export function dedupeEnvEntries(entries: EnvEntry[]): { entries: EnvEntry[]; duplicates: number } {
  const byKey = new Map<string, EnvEntry>();
  let duplicates = 0;
  for (const entry of entries) {
    const key = normalizeEnvKey(entry.key);
    if (byKey.has(key)) duplicates++;
    byKey.set(key, { ...entry, key });
  }
  return { entries: Array.from(byKey.values()), duplicates };
}

/**
 * Finds secret names that normalize to the same environment variable name,
 * which would otherwise silently overwrite each other in a .env export.
 */
export function findEnvKeyCollisions(keys: string[]): Map<string, string[]> {
  const byNorm = new Map<string, string[]>();
  for (const key of keys) {
    const norm = normalizeEnvKey(key);
    const group = byNorm.get(norm);
    if (group) group.push(key);
    else byNorm.set(norm, [key]);
  }
  const collisions = new Map<string, string[]>();
  for (const [norm, originals] of byNorm) {
    if (originals.length > 1) collisions.set(norm, originals);
  }
  return collisions;
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
 * Decodes escape sequences inside double-quoted .env strings in a single pass.
 * Prevents corruption of Windows paths (e.g. C:\new\temp) or escaped backslashes (a\nb).
 */
function decodeDoubleQuoted(val: string): string {
  return val.replace(/\\(["'nrtbf0\\])/g, (_, char) => {
    switch (char) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '0': return '\0';
      case '"': return '"';
      case "'": return "'";
      case '\\': return '\\';
      default: return char;
    }
  });
}

/**
 * Parses raw .env string into key-value entries.
 * Handles export prefixes, inline comments, single/double quotes,
 * multi-line quoted values (such as PEM certificates/keys), and escape sequences.
 */
export function parseEnvFile(content: string): EnvEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: EnvEntry[] = [];

  let inMultiLine = false;
  let quoteChar = '';
  let currentKey = '';
  let currentValue = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    if (inMultiLine) {
      // Find closing quote that is not escaped
      let endIdx = -1;
      for (let c = 0; c < rawLine.length; c++) {
        if (rawLine[c] === quoteChar) {
          let backslashes = 0;
          for (let b = c - 1; b >= 0 && rawLine[b] === '\\'; b--) {
            backslashes++;
          }
          if (quoteChar === "'" || backslashes % 2 === 0) {
            endIdx = c;
            break;
          }
        }
      }

      if (endIdx !== -1) {
        currentValue += '\n' + rawLine.slice(0, endIdx);
        inMultiLine = false;
        const val = quoteChar === '"' ? decodeDoubleQuoted(currentValue) : currentValue;
        entries.push({ key: currentKey, value: val });
        currentKey = '';
        currentValue = '';
        quoteChar = '';
      } else {
        currentValue += '\n' + rawLine;
      }
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Strip leading "export " if present
    let line = trimmed;
    if (line.startsWith('export ') || line.startsWith('export\t')) {
      line = line.replace(/^export\s+/, '');
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let valPart = line.slice(eqIdx + 1).trim();

    if (!valPart) {
      entries.push({ key, value: '' });
      continue;
    }

    const firstChar = valPart[0];
    if (firstChar === '"' || firstChar === "'") {
      quoteChar = firstChar;
      // Search for closing quote on the SAME line
      let closeIdx = -1;
      for (let c = 1; c < valPart.length; c++) {
        if (valPart[c] === quoteChar) {
          let backslashes = 0;
          for (let b = c - 1; b >= 0 && valPart[b] === '\\'; b--) {
            backslashes++;
          }
          if (quoteChar === "'" || backslashes % 2 === 0) {
            closeIdx = c;
            break;
          }
        }
      }

      if (closeIdx !== -1) {
        // Quoted value closed on the same line; any trailing characters like `# comment` are ignored
        const rawQuoted = valPart.slice(1, closeIdx);
        const val = quoteChar === '"' ? decodeDoubleQuoted(rawQuoted) : rawQuoted;
        entries.push({ key, value: val });
        quoteChar = '';
      } else {
        // Multi-line value starts here
        currentKey = key;
        currentValue = valPart.slice(1);
        inMultiLine = true;
      }
    } else {
      // Unquoted value: inline comment starting with # must be preceded by whitespace (e.g. ` # comment`)
      // A # inside a token (like PASS=abc#def or URL=http://x/#frag) is preserved as part of the value.
      const commentMatch = valPart.match(/\s+#.*$/);
      if (commentMatch && commentMatch.index !== undefined) {
        valPart = valPart.slice(0, commentMatch.index).trim();
      }
      entries.push({ key, value: valPart });
    }
  }

  return entries;
}
