import { getValidSession } from '../../auth/session.js';
import { getSecrets, resolveProjectId } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import { renderTable, envBadge, statusBadge } from '../tui.js';
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
    const resolvedProj = await resolveProjectId(session.uid, options.project, db);
    const projLower = resolvedProj.toLowerCase();
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

  const columns = [
    { header: 'NAME', minWidth: 26 },
    { header: 'SERVICE', minWidth: 14 },
    { header: 'ENVIRONMENT', minWidth: 16 },
    { header: 'TYPE', minWidth: 16 },
    { header: 'STATUS', minWidth: 12 },
    { header: 'VER', minWidth: 5, align: 'right' as const }
  ];

  const rows = secrets.map(s => [
    pc.bold(sanitizeTerminalOutput(s.name)),
    pc.dim(sanitizeTerminalOutput(s.service)),
    envBadge(sanitizeTerminalOutput(s.environment)),
    sanitizeTerminalOutput(s.type),
    statusBadge(s.status),
    pc.dim(`v${s.version || 1}`)
  ]);

  const projectsCount = new Set(secrets.map(s => s.projectId).filter(Boolean)).size;
  const projectSummary = projectsCount > 0 ? ` across ${projectsCount} project(s)` : '';
  const footer = pc.dim(`Showing ${secrets.length} secret(s)${projectSummary} • 🔒 Vault Encrypted (AES-256-GCM)`);

  renderTable(columns, rows, { footer, emptyMessage: 'No secrets found matching specified criteria.' });
}
