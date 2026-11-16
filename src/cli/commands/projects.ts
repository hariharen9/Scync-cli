import { getValidSession } from '../../auth/session.js';
import { getProjects, getSecrets } from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { AuthRequiredError } from '../errors.js';
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

  console.log(pc.bold(
    'NAME'.padEnd(26) +
    'ID'.padEnd(28) +
    'SECRETS'.padEnd(10) +
    'COLOR'
  ));
  console.log(pc.dim('─'.repeat(74)));

  for (const p of projects) {
    const count = secretCounts[p.id] || 0;
    console.log(
      pc.bold(p.name.padEnd(26)) +
      pc.dim(p.id.padEnd(28)) +
      String(count).padEnd(10) +
      (p.color || 'blue')
    );
  }

  console.log(pc.dim(`\nTotal: ${projects.length} project(s)`));
}
