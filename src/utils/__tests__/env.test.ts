import { describe, it, expect } from 'vitest';
import { formatEnvLine, parseEnvFile, normalizeEnvKey } from '../env.js';

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

  it('round-trips complex values successfully', () => {
    const original = 'json: {"name": "test", "num": 42}\nNew line here!';
    const line = formatEnvLine('CONFIG', original);
    const parsed = parseEnvFile(line);
    expect(parsed[0].value).toBe(original);
  });
});
