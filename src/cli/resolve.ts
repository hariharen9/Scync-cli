import type { StoredSecret } from '../core/types.js';
import { SecretNotFoundError, AmbiguousSecretError } from './errors.js';

export interface ResolveSecretOptions {
  id?: string;
  project?: string;
  env?: string;
}

/**
 * Resolves a single unique secret matching `name` and optional filters (`id`, `project`, `env`).
 * Throws `SecretNotFoundError` if no secret matches.
 * Throws `AmbiguousSecretError` if multiple secrets match.
 */
export function resolveSingleSecret(
  secrets: StoredSecret[],
  name: string,
  options: ResolveSecretOptions = {}
): StoredSecret {
  let matches = secrets.filter(s => s.name.toLowerCase() === name.toLowerCase());

  if (options.id) {
    matches = matches.filter(s => s.id === options.id);
  }

  if (options.project) {
    const p = options.project.toLowerCase();
    matches = matches.filter(s => s.projectId?.toLowerCase() === p);
  }

  if (options.env) {
    const e = options.env.toLowerCase();
    matches = matches.filter(s => s.environment.toLowerCase() === e);
  }

  if (matches.length === 0) {
    throw new SecretNotFoundError(name);
  }

  if (matches.length > 1) {
    throw new AmbiguousSecretError(
      name,
      matches.map(m => ({
        id: m.id,
        service: m.service,
        environment: m.environment,
        projectId: m.projectId
      }))
    );
  }

  return matches[0];
}
