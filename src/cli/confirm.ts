import { promptConfirm } from './prompts.js';
import { CliError, ExitCode } from './errors.js';

export interface ConfirmationOptions {
  /** Explicit non-interactive confirmation. */
  yes?: boolean;
}

/**
 * Confirmation gate for destructive CLI actions (delete, overwrite, forced
 * conflict overrides). Interactive runs always ask; non-interactive runs must
 * pass --yes explicitly instead of hanging on a prompt.
 */
export async function confirmDestructive(
  message: string,
  options: ConfirmationOptions = {}
): Promise<boolean> {
  if (options.yes) return true;

  if (!process.stdin.isTTY) {
    throw new CliError(
      `Refusing a destructive action without confirmation.\n${message}\nRe-run with --yes to confirm in non-interactive mode.`,
      ExitCode.GENERAL_ERROR
    );
  }

  return promptConfirm(message, false);
}
