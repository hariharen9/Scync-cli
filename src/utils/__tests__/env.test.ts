import { describe, it, expect } from 'vitest';
import {
  formatEnvLine,
  parseEnvFile,
  normalizeEnvKey,
  dedupeEnvEntries,
  findEnvKeyCollisions,
} from '../env.js';

describe('Environment Variable Utilities (.env handling)', () => {
  it('normalizes variable names correctly', () => {
    expect(normalizeEnvKey('stripe-key')).toBe('STRIPE_KEY');
    expect(normalizeEnvKey('database url (prod)')).toBe('DATABASE_URL__PROD_');
    expect(normalizeEnvKey('123_key')).toBe('_123_KEY');
  });

  it('formats unquoted single values without spaces', () => {
    expect(formatEnvLine('PORT', '3000')).toBe('PORT=3000');
    expect(formatEnvLine('API_KEY', 'abcdef123456')).toBe('API_KEY=abcdef123456');
  });

  it('escapes and quotes strings containing spaces, quotes, and newlines', () => {
    const formatted = formatEnvLine('SECRET_NOTE', 'Line 1\nLine "2" with spaces');
    expect(formatted).toBe('SECRET_NOTE="Line 1\\nLine \\"2\\" with spaces"');
  });

  it('parses .env files with exports, comments, quotes, and escapes', () => {
    const raw = `
# Comment line
export STRIPE_KEY="sk_test_12345"
DB_URL='postgres://user:pass@localhost:5432/db'
PLAIN_VAL=hello_world
NOTE="Multi\\nLine \\"Quote\\""
PORT=8080 # inline comment
`;
    const parsed = parseEnvFile(raw);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({ key: 'STRIPE_KEY', value: 'sk_test_12345' });
    expect(parsed[1]).toEqual({ key: 'DB_URL', value: 'postgres://user:pass@localhost:5432/db' });
    expect(parsed[2]).toEqual({ key: 'PLAIN_VAL', value: 'hello_world' });
    expect(parsed[3]).toEqual({ key: 'NOTE', value: 'Multi\nLine "Quote"' });
    expect(parsed[4]).toEqual({ key: 'PORT', value: '8080' });
  });

  it('collapses duplicate variable names with last-value-wins semantics', () => {
    const entries = dedupeEnvEntries([
      { key: 'API_KEY', value: 'first' },
      { key: 'api-key', value: 'second' },
      { key: 'OTHER', value: 'keep' },
    ]);
    expect(entries.duplicates).toBe(1);
    expect(entries.entries).toHaveLength(2);
    expect(entries.entries.find(e => e.key === 'API_KEY')?.value).toBe('second');
  });

  it('reports names that normalize to the same .env key', () => {
    const collisions = findEnvKeyCollisions(['stripe-key', 'STRIPE_KEY', 'OPENAI_KEY']);
    expect(collisions.get('STRIPE_KEY')).toEqual(['stripe-key', 'STRIPE_KEY']);
    expect(collisions.has('OPENAI_KEY')).toBe(false);
  });

  it('round-trips complex values successfully', () => {
    const original = 'json: {"name": "test", "num": 42}\nNew line here!';
    const line = formatEnvLine('CONFIG', original);
    const parsed = parseEnvFile(line);
    expect(parsed[0].value).toBe(original);
  });

  it('handles user-reported edge cases: inline # without space, comments after quotes, Windows paths, and multi-line PEM', () => {
    const envContent = `
PASS=abc#def
URL=http://x/#frag
KEY="value" # note
KEY2='single value' # single note
PEM="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0
-----END RSA PRIVATE KEY-----"
EMPTY=
EMPTY_QUOTED=""
C_PATH="C:\\\\new\\\\temp"
A_NB="a\\\\nb"
`;
    const parsed = parseEnvFile(envContent);
    const map = Object.fromEntries(parsed.map(e => [e.key, e.value]));

    expect(map.PASS).toBe('abc#def');
    expect(map.URL).toBe('http://x/#frag');
    expect(map.KEY).toBe('value');
    expect(map.KEY2).toBe('single value');
    expect(map.PEM).toBe('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----');
    expect(map.EMPTY).toBe('');
    expect(map.EMPTY_QUOTED).toBe('');
    expect(map.C_PATH).toBe('C:\\new\\temp');
    expect(map.A_NB).toBe('a\\nb');

    // Test round-trip preservation for paths and escaped sequences
    for (const [k, v] of Object.entries(map)) {
      const formatted = formatEnvLine(k, v);
      const reParsed = parseEnvFile(formatted);
      expect(reParsed[0]?.value).toBe(v);
    }
  });
});
