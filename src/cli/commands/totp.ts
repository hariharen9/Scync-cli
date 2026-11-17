import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getTOTPTokens } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { generateTOTPCode, getRemainingSeconds } from '../../core/totp.js';
import { copyWithAutoClear } from '../../utils/clipboard.js';
import { getClipboardTimeoutSecs } from '../../config/index.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { renderTable, renderCard, renderProgressBar, successBanner } from '../tui.js';
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
    console.log(pc.dim('No TOTP tokens found in your vault. Add authenticator tokens on the Scync web app.'));
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

    const columns = [
      { header: 'ISSUER', minWidth: 20 },
      { header: 'ACCOUNT LABEL', minWidth: 26 },
      { header: 'INTERVAL', minWidth: 10 },
      { header: 'STATUS', minWidth: 18 }
    ];

    const rows = tokens.map(t => {
      const remaining = getRemainingSeconds(t.period);
      return [
        pc.bold(t.issuer),
        pc.dim(t.label),
        `${t.period}s`,
        remaining > 5 ? pc.green(`● ${remaining}s left`) : pc.red(`● ${remaining}s left`)
      ];
    });

    const footer = pc.dim('To generate code: scync totp <issuer-or-label> [-c]');
    renderTable(columns, rows, { footer });
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

  const formattedCode = code.length === 6 ? `${code.slice(0, 3)}  ${code.slice(3)}` : code;
  const progress = renderProgressBar(remaining / token.period, 16);

  renderCard({
    title: `TOTP: ${token.issuer}`,
    badge: remaining > 5 ? pc.green(`● ${remaining}s`) : pc.red(`● ${remaining}s`),
    rows: [
      { key: 'Label', val: token.label },
      { key: 'Code', val: pc.bold(pc.green(formattedCode)) },
      { key: 'Countdown', val: `${progress}  ${remaining}s remaining` },
      { key: 'Algorithm', val: pc.dim(`${token.algorithm || 'SHA-1'} · ${token.digits || 6} digits · ${token.period}s step`) }
    ],
    footer: pc.dim('Time-based One-Time Password • RFC 6238')
  });

  if (options.copy) {
    const clipboardSecs = getClipboardTimeoutSecs();
    await copyWithAutoClear(code, clipboardSecs);
    successBanner('TOTP Code copied to clipboard', [
      {
        key: 'Auto-Clear',
        val: clipboardSecs > 0 ? `Clears in ${clipboardSecs} seconds` : 'Disabled'
      }
    ]);
  }
}
