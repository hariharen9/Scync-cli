import { describe, it, expect } from 'vitest';
import {
  generateTOTPSecret,
  validateBase32,
  parseTOTPUri,
  buildTOTPUri,
  generateTOTPCode,
  getRemainingSeconds,
} from '../totp.js';

describe('TOTP Two-Factor Authentication Core', () => {
  // Standard test seed
  const testSecret = 'JBSWY3DPEHPK3PXP'; // Base32 for 'Hello!\xde\xad\xbe\xef'

  it('validates base32 strings correctly', () => {
    expect(validateBase32(testSecret)).toBe(true);
    expect(validateBase32('jbswy3dpehpk3pxp')).toBe(true); // case-insensitive
    expect(validateBase32('JBSW-Y3DP-EHPK-3PXP')).toBe(true); // strips dashes
    expect(validateBase32('invalid 1890 characters')).toBe(false);
    expect(validateBase32('')).toBe(false);
  });

  it('generates random valid base32 secrets', () => {
    const secret = generateTOTPSecret();
    expect(secret).toBeTruthy();
    expect(validateBase32(secret)).toBe(true);
  });

  it('parses and builds otpauth:// URIs with full fidelity', () => {
    const uri = 'otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30';
    const config = parseTOTPUri(uri);

    expect(config).not.toBeNull();
    expect(config?.issuer).toBe('GitHub');
    expect(config?.label).toBe('octocat');
    expect(config?.secret).toBe(testSecret);
    expect(config?.digits).toBe(6);
    expect(config?.period).toBe(30);

    const rebuilt = buildTOTPUri(config!);
    expect(rebuilt).toContain('JBSWY3DPEHPK3PXP');
    expect(rebuilt).toContain('GitHub');
  });

  it('generates a 6-digit numeric TOTP code', () => {
    const code = generateTOTPCode({
      issuer: 'TestCorp',
      label: 'user@testcorp.com',
      secret: testSecret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    expect(code).toMatch(/^\d{6}$/);
    const remaining = getRemainingSeconds(30);
    expect(remaining).toBeGreaterThanOrEqual(1);
    expect(remaining).toBeLessThanOrEqual(30);
  });
});
