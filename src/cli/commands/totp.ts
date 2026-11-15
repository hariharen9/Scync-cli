import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getTOTPTokens } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { generateTOTPCode, getRemainingSeconds } from '../../core/totp.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import pc from 'picocolors';

export interface TOTPOptions {
  copy?: boolean;
  json?: boolean;
  noAgent?: boolean;
}

export async function totpCommand(nameQuery?: string, options: TOTPOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const tokens = await getTOTPTokens(session.uid, db);

  if (tokens.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(pc.dim('No TOTP tokens found in your vault.'));
    return;
  }

  // 1. Listing mode if no query
  if (!nameQuery) {
    if (options.json) {
      console.log(JSON.stringify(tokens.map(t => ({
        id: t.id,
        issuer: t.issuer,
        label: t.label,
        algorithm: t.algorithm,
        digits: t.digits,
        period: t.period,
      })), null, 2));
      return;
    }

    console.log(pc.bold('--- TOTP Authenticator Tokens ---'));
    console.log(
      `${pc.dim('ISSUER'.padEnd(20))} ${pc.dim('LABEL'.padEnd(25))} ${pc.dim('PERIOD')}`
    );
    console.log('─'.repeat(55));

    for (const t of tokens) {
      const remaining = getRemainingSeconds(t.period);
      console.log(
        `${pc.cyan(t.issuer.padEnd(20))} ${t.label.padEnd(25)} ${t.period}s (${remaining}s remaining)`
      );
    }
    console.log(pc.dim('\nTo generate a code: scync totp <issuer-or-label>'));
    return;
  }

  // 2. Specific token generation
  const q = nameQuery.toLowerCase();
  const matches = tokens.filter(
    (t) => t.issuer.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)
  );

  if (matches.length === 0) {
    throw new CliError(`No TOTP token matching '${nameQuery}' found.`, ExitCode.NOT_FOUND);
  }

  if (matches.length > 1) {
    const list = matches.map((m) => `  • ${m.issuer} (${m.label})`).join('\n');
    throw new CliError(`Multiple TOTP tokens match '${nameQuery}'. Please disambiguate:\n${list}`, ExitCode.AMBIGUOUS);
  }

  const token = matches[0];
  const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
  const secret = await vault.decrypt(token.encSecret);

  const code = generateTOTPCode({
    issuer: token.issuer,
    label: token.label,
    secret,
    algorithm: token.algorithm,
    digits: token.digits,
    period: token.period,
  });
  const remaining = getRemainingSeconds(token.period);

  if (options.json) {
    console.log(JSON.stringify({
      issuer: token.issuer,
      label: token.label,
      code,
      remainingSeconds: remaining,
    }, null, 2));
    return;
  }

  const formattedCode = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  console.log(
    `${pc.bold(token.issuer)} (${token.label}): ${pc.green(pc.bold(formattedCode))}  ${pc.dim(`[expires in ${remaining}s]`)}`
  );

  if (options.copy) {
    await copyWithAutoClear(code, 30);
    console.error(pc.dim('✓ Code copied to clipboard (will auto-clear in 30s).'));
  }
}
