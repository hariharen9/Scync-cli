export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  AUTH_REQUIRED = 2,
  VAULT_LOCKED = 3,
  NOT_FOUND = 4,
  AMBIGUOUS = 5,
  CONFLICT = 6,
  NETWORK_ERROR = 7,
}

export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode = ExitCode.GENERAL_ERROR) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class AuthRequiredError extends CliError {
  constructor(message = "Authentication required. Run 'scync login' first.") {
    super(message, ExitCode.AUTH_REQUIRED);
    this.name = 'AuthRequiredError';
  }
}

export class VaultLockedError extends CliError {
  constructor(message = "Vault is locked or master password was incorrect.") {
    super(message, ExitCode.VAULT_LOCKED);
    this.name = 'VaultLockedError';
  }
}

export class SecretNotFoundError extends CliError {
  constructor(name: string) {
    super(`Secret '${name}' not found.`, ExitCode.NOT_FOUND);
    this.name = 'SecretNotFoundError';
  }
}

export class AmbiguousSecretError extends CliError {
  constructor(name: string, matches: Array<{ id: string; service: string; environment: string; projectId?: string | null }>) {
    const list = matches.map(m => `  • id: ${m.id} | service: ${m.service} | env: ${m.environment} ${m.projectId ? `| project: ${m.projectId}` : ''}`).join('\n');
    super(
      `Multiple secrets found matching '${name}'. Disambiguate using --id, --project, or --env:\n${list}`,
      ExitCode.AMBIGUOUS
    );
    this.name = 'AmbiguousSecretError';
  }
}

export class ConflictError extends CliError {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(name: string, expectedVersion: number, actualVersion: number) {
    super(
      `Conflict detected on '${name}': secret is currently at v${actualVersion}, but expected v${expectedVersion}.\n` +
      `Someone else (or another session) may have modified it. Use --force to override.`,
      ExitCode.CONFLICT
    );
    this.name = 'ConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
