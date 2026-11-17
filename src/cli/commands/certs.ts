import { getValidSession } from '../../auth/session.js';
import { getDb } from '../../core/firebase.js';
import { getCertificates } from '../../core/firestore.js';
import { unlockVault } from '../../core/vault-session.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { renderTable, renderCard } from '../tui.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import pc from 'picocolors';

export interface CertsOptions {
  revealKey?: boolean;
  json?: boolean;
  noAgent?: boolean;
}

export async function certsCommand(query?: string, options: CertsOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  let certs = await getCertificates(session.uid, db);

  if (query) {
    const q = query.toLowerCase();
    certs = certs.filter(
      c => c.name.toLowerCase().includes(q) ||
           c.subject.toLowerCase().includes(q) ||
           c.hosts.some(h => h.toLowerCase().includes(q))
    );
  }

  if (certs.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(pc.dim(query ? `No certificates matching '${query}' found.` : 'No certificates found in your vault.'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(certs.map(c => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      issuer: c.issuer,
      serialNumber: c.serialNumber,
      validFrom: c.validFrom.toISOString(),
      validTo: c.validTo.toISOString(),
      isSelfSigned: c.isSelfSigned,
      fingerprint: c.fingerprint,
      hosts: c.hosts,
      hasPrivateKey: !!c.encKeyPem,
    })), null, 2));
    return;
  }

  const columns = [
    { header: 'CERTIFICATE NAME', minWidth: 22 },
    { header: 'SUBJECT / HOSTS', minWidth: 28 },
    { header: 'EXPIRES ON', minWidth: 16 },
    { header: 'KEY STORED', minWidth: 12 }
  ];

  const rows = certs.map(c => {
    const isExpired = c.validTo.getTime() < Date.now();
    const expiryStr = isExpired
      ? pc.red(c.validTo.toLocaleDateString())
      : pc.green(c.validTo.toLocaleDateString());
    const hostsDesc = c.hosts.length > 0 ? c.hosts.join(', ') : c.subject;
    const hasKey = c.encKeyPem ? pc.green('● Yes') : pc.dim('No');

    return [
      pc.bold(sanitizeTerminalOutput(c.name)),
      pc.dim(sanitizeTerminalOutput(hostsDesc).slice(0, 26) + (hostsDesc.length > 26 ? '…' : '')),
      expiryStr,
      hasKey
    ];
  });

  const footer = pc.dim(`Total: ${certs.length} certificate(s) • Use --reveal-key to inspect private key PEM`);
  renderTable(columns, rows, { footer });

  if (options.revealKey) {
    const vault = await unlockVault(session.uid, db, undefined, { noAgent: options.noAgent });
    for (const c of certs) {
      if (c.encKeyPem) {
        const keyPem = await vault.decrypt(c.encKeyPem);
        renderCard({
          title: `Private Key: ${sanitizeTerminalOutput(c.name)}`,
          badge: pc.yellow('● Decrypted'),
          sections: [{ lines: keyPem.trim().split('\n').map(l => pc.dim(l)) }],
          footer: pc.dim('Vault Protected Key Pair')
        });
      }
    }
  }
}
