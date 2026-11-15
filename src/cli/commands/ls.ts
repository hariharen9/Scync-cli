import { getValidSession } from '../../auth/session.js';
import { getSecrets } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import type { SecretType, Environment, SecretStatus } from '../../core/types.js';
import pc from 'picocolors';

export interface LsOptions {
  project?: string;
  env?: string;
  service?: string;
  type?: string;
  status?: string;
  search?: string;
  json?: boolean;
}

export async function lsCommand(options: LsOptions): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  let secrets = await getSecrets(session.uid, db);

  // Apply filters
  if (options.project) {
    const projLower = options.project.toLowerCase();
    secrets = secrets.filter(s => s.projectId?.toLowerCase() === projLower);
  }
  if (options.env) {
    const envLower = options.env.toLowerCase();
    secrets = secrets.filter(s => s.environment.toLowerCase() === envLower);
  }
  if (options.service) {
    const srvLower = options.service.toLowerCase();
    secrets = secrets.filter(s => s.service.toLowerCase() === srvLower);
  }
  if (options.type) {
    const typeLower = options.type.toLowerCase();
    secrets = secrets.filter(s => s.type.toLowerCase() === typeLower);
  }
  if (options.status) {
    const statusLower = options.status.toLowerCase();
    secrets = secrets.filter(s => s.status.toLowerCase() === statusLower);
  }
  if (options.search) {
    const term = options.search.toLowerCase();
    secrets = secrets.filter(s => 
      s.name.toLowerCase().includes(term) ||
      s.service.toLowerCase().includes(term) ||
      s.type.toLowerCase().includes(term)
    );
  }

  // Sort by name
  secrets.sort((a, b) => a.name.localeCompare(b.name));

  if (options.json) {
    const safeData = secrets.map(s => ({
      id: s.id,
      name: s.name,
      service: s.service,
      type: s.type,
      environment: s.environment,
      status: s.status,
      projectId: s.projectId,
      version: s.version || 1,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      lastRotated: s.lastRotated ? s.lastRotated.toISOString() : null,
      expiresOn: s.expiresOn ? s.expiresOn.toISOString() : null
    }));
    console.log(JSON.stringify(safeData, null, 2));
    return;
  }

  if (secrets.length === 0) {
    console.log(pc.dim('No secrets found matching specified criteria.'));
    return;
  }

  // Terminal tabular format
  console.log(
    pc.bold(
      `${'NAME'.padEnd(28)} ${'SERVICE'.padEnd(14)} ${'ENVIRONMENT'.padEnd(14)} ${'TYPE'.padEnd(22)} ${'STATUS'.padEnd(10)} ${'VER'}`
    )
  );
  console.log(pc.dim('─'.repeat(96)));

  for (const s of secrets) {
    const name = sanitizeTerminalOutput(s.name);
    const service = sanitizeTerminalOutput(s.service);
    const env = sanitizeTerminalOutput(s.environment);
    const type = sanitizeTerminalOutput(s.type);
    
    let statusText: string = s.status;
    if (s.status === 'Active') statusText = pc.green(s.status);
    else if (s.status === 'Rotated') statusText = pc.yellow(s.status);
    else if (s.status === 'Expired' || s.status === 'Revoked') statusText = pc.red(s.status);

    const ver = `v${s.version || 1}`;

    console.log(
      `${pc.bold(name.padEnd(28))} ${service.padEnd(14)} ${env.padEnd(14)} ${type.padEnd(22)} ${statusText.padEnd(10)} ${pc.dim(ver)}`
    );
  }

  console.log(pc.dim(`\nTotal: ${secrets.length} secrets`));
}
