import { describe, it, expect } from 'vitest';
import { resolveSingleSecret } from '../resolve.js';
import { ExitCode } from '../errors.js';
import type { StoredSecret } from '../../core/types.js';

function secret(overrides: Partial<StoredSecret> & Pick<StoredSecret, 'id' | 'name'>): StoredSecret {
  return {
    id: overrides.id,
    name: overrides.name,
    service: overrides.service ?? 'Stripe',
    type: overrides.type ?? 'API Key',
    environment: overrides.environment ?? 'Development',
    status: overrides.status ?? 'Active',
    encValue: { iv: 'iv', ciphertext: 'ct' },
    encNotes: null,
    lastRotated: null,
    expiresOn: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    projectId: overrides.projectId ?? null,
    remainingCodes: null,
    version: overrides.version ?? 1,
  };
}

describe('resolveSingleSecret', () => {
  const secrets = [
    secret({ id: 'a', name: 'STRIPE_KEY', environment: 'Development', projectId: 'web' }),
    secret({ id: 'b', name: 'STRIPE_KEY', environment: 'Production', projectId: 'web' }),
    secret({ id: 'c', name: 'OPENAI_KEY', environment: 'Development', projectId: 'api' }),
  ];

  it('resolves a unique secret case-insensitively', () => {
    expect(resolveSingleSecret(secrets, 'openai_key').id).toBe('c');
  });

  it('disambiguates by environment, project and id', () => {
    expect(resolveSingleSecret(secrets, 'stripe_key', { env: 'production' }).id).toBe('b');
    expect(resolveSingleSecret(secrets, 'stripe_key', { project: 'web', env: 'Development' }).id).toBe('a');
    expect(resolveSingleSecret(secrets, 'stripe_key', { id: 'b' }).id).toBe('b');
  });

  it('throws NOT_FOUND when nothing matches', () => {
    try {
      resolveSingleSecret(secrets, 'MISSING');
      expect.fail('expected SecretNotFoundError');
    } catch (err: any) {
      expect(err.name).toBe('SecretNotFoundError');
      expect(err.exitCode).toBe(ExitCode.NOT_FOUND);
    }
  });

  it('throws AMBIGUOUS with all candidates when filters are insufficient', () => {
    try {
      resolveSingleSecret(secrets, 'stripe_key');
      expect.fail('expected AmbiguousSecretError');
    } catch (err: any) {
      expect(err.name).toBe('AmbiguousSecretError');
      expect(err.exitCode).toBe(ExitCode.AMBIGUOUS);
      expect(err.message).toContain('id: a');
      expect(err.message).toContain('id: b');
    }
  });
});
