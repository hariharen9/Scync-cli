import { describe, expect, it } from 'vitest';
import { confirmDestructive } from '../confirm.js';

describe('destructive CLI confirmation gate', () => {
  it('allows explicit non-interactive confirmation', async () => {
    await expect(confirmDestructive('Delete everything?', { yes: true })).resolves.toBe(true);
  });

  it('refuses non-interactive destructive actions without --yes', async () => {
    await expect(confirmDestructive('Delete everything?')).rejects.toThrow(/--yes/);
  });
});
