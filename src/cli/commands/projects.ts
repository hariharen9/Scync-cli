import { getValidSession } from '../../auth/session.js';
import { getProjects, getSecrets } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
import { renderTable } from '../tui.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import pc from 'picocolors';

export interface ProjectsOptions {
  json?: boolean;
}

export async function projectsCommand(options: ProjectsOptions = {}): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const [projects, secrets] = await Promise.all([
    getProjects(session.uid, db),
    getSecrets(session.uid, db),
  ]);

  if (options.json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  if (projects.length === 0) {
    console.log(pc.dim('No projects found in your vault. Create projects on the Scync web app.'));
    return;
  }

  const secretCounts: Record<string, number> = {};
  for (const s of secrets) {
    if (s.projectId) {
      secretCounts[s.projectId] = (secretCounts[s.projectId] || 0) + 1;
    }
  }

  const columns = [
    { header: 'PROJECT NAME', minWidth: 26 },
    { header: 'PROJECT ID', minWidth: 26 },
    { header: 'SECRETS', minWidth: 10, align: 'right' as const },
    { header: 'THEME', minWidth: 12 }
  ];

  const rows = projects.map(p => {
    const count = secretCounts[p.id] || 0;
    return [
      pc.bold(sanitizeTerminalOutput(p.name)),
      pc.dim(p.id),
      count > 0 ? pc.green(String(count)) : pc.dim('0'),
      pc.cyan(`● ${sanitizeTerminalOutput(p.color || 'blue')}`)
    ];
  });

  const totalSecrets = Object.values(secretCounts).reduce((a, b) => a + b, 0);
  const footer = pc.dim(`Total: ${projects.length} project(s) containing ${totalSecrets} vaulted secret(s)`);

  renderTable(columns, rows, { footer });
}
