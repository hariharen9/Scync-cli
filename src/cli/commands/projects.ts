import { getValidSession } from '../../auth/session.js';
import {
  createProject,
  deleteProject,
  getProjects,
  getSecrets,
  updateProject,
} from '../../core/firestore.js';
import { getDb } from '../../core/firebase.js';
import { PROJECT_COLORS } from '../../core/constants.js';
import type { Project, ProjectColor } from '../../core/types.js';
import { AuthRequiredError, CliError, ExitCode } from '../errors.js';
import { confirmDestructive } from '../confirm.js';
import { renderTable, successBanner, warningBanner } from '../tui.js';
import { sanitizeTerminalOutput } from '../../utils/sanitize.js';
import pc from 'picocolors';

export interface ProjectsOptions {
  json?: boolean;
}

const PROJECT_COLOR_NAMES = Object.keys(PROJECT_COLORS) as ProjectColor[];

function normalizeProjectColor(input?: string): ProjectColor {
  if (!input) return 'green';
  const match = PROJECT_COLOR_NAMES.find((color) => color === input.trim().toLowerCase());
  if (!match) {
    throw new CliError(
      `Invalid project color '${input}'. Valid colors: ${PROJECT_COLOR_NAMES.join(', ')}`,
      ExitCode.GENERAL_ERROR
    );
  }
  return match;
}

function resolveProject(projects: Project[], needle: string): Project {
  const value = needle.trim();
  const byId = projects.find((project) => project.id === value);
  if (byId) return byId;

  const matches = projects.filter(
    (project) => project.name.toLowerCase() === value.toLowerCase()
  );
  if (matches.length === 0) {
    throw new CliError(`Project '${needle}' not found.`, ExitCode.NOT_FOUND);
  }
  if (matches.length > 1) {
    throw new CliError(
      `Multiple projects are named '${needle}'. Use the project id instead:\n${matches
        .map((project) => `  • ${project.id}  ${project.name}`)
        .join('\n')}`,
      ExitCode.AMBIGUOUS
    );
  }
  return matches[0];
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
    console.log(pc.dim('No projects found. Create one with: scync projects create <name>'));
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

// ─── Project mutations ───

export interface ProjectCreateOptions {
  description?: string;
  color?: string;
  icon?: string;
  json?: boolean;
}

export async function createProjectCommand(
  name: string,
  options: ProjectCreateOptions = {}
): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const cleanName = name.trim();
  if (!cleanName) {
    throw new CliError('Project name cannot be empty.', ExitCode.GENERAL_ERROR);
  }

  const color = normalizeProjectColor(options.color);
  const db = getDb();
  const projects = await getProjects(session.uid, db);
  if (projects.some((project) => project.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new CliError(`A project named '${cleanName}' already exists.`, ExitCode.CONFLICT);
  }

  const id = await createProject(
    session.uid,
    {
      name: cleanName,
      description: options.description?.trim() ?? '',
      color,
      icon: options.icon ?? '',
    },
    db
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          id,
          name: cleanName,
          description: options.description?.trim() ?? '',
          color,
          icon: options.icon ?? '',
        },
        null,
        2
      )
    );
    return;
  }

  successBanner(`Created project '${cleanName}'`, [
    { key: 'Project ID', val: pc.dim(id) },
    { key: 'Color', val: pc.cyan(color) },
    ...(options.description ? [{ key: 'Description', val: options.description }] : []),
  ]);
}

export interface ProjectUpdateOptions {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  json?: boolean;
}

export async function updateProjectCommand(
  projectRef: string,
  options: ProjectUpdateOptions = {}
): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  if (
    options.name === undefined &&
    options.description === undefined &&
    options.color === undefined &&
    options.icon === undefined
  ) {
    throw new CliError(
      'Nothing to update. Provide --name, --description, --color and/or --icon.',
      ExitCode.GENERAL_ERROR
    );
  }

  const db = getDb();
  const projects = await getProjects(session.uid, db);
  const project = resolveProject(projects, projectRef);
  const nextName = options.name?.trim() ?? project.name;

  if (!nextName) {
    throw new CliError('Project name cannot be empty.', ExitCode.GENERAL_ERROR);
  }
  if (
    nextName.toLowerCase() !== project.name.toLowerCase() &&
    projects.some(
      (entry) => entry.id !== project.id && entry.name.toLowerCase() === nextName.toLowerCase()
    )
  ) {
    throw new CliError(`A project named '${nextName}' already exists.`, ExitCode.CONFLICT);
  }

  const color = options.color ? normalizeProjectColor(options.color) : project.color;
  await updateProject(
    session.uid,
    project.id,
    {
      name: nextName,
      description: options.description?.trim() ?? project.description,
      color,
      icon: options.icon ?? project.icon,
    },
    db
  );

  const updated = {
    ...project,
    name: nextName,
    description: options.description?.trim() ?? project.description,
    color,
    icon: options.icon ?? project.icon,
  };

  if (options.json) {
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  successBanner(`Updated project '${updated.name}'`, [
    { key: 'Project ID', val: pc.dim(updated.id) },
    { key: 'Color', val: pc.cyan(updated.color) },
    { key: 'Description', val: updated.description || pc.dim('none') },
  ]);
}

export interface ProjectDeleteOptions {
  moveTo?: string;
  yes?: boolean;
  json?: boolean;
}

export async function deleteProjectCommand(
  projectRef: string,
  options: ProjectDeleteOptions = {}
): Promise<void> {
  const session = await getValidSession();
  if (!session) throw new AuthRequiredError();

  const db = getDb();
  const [projects, secrets] = await Promise.all([
    getProjects(session.uid, db),
    getSecrets(session.uid, db),
  ]);
  const project = resolveProject(projects, projectRef);
  const moveTo = options.moveTo ? resolveProject(projects, options.moveTo) : null;
  if (moveTo?.id === project.id) {
    throw new CliError('Cannot move secrets into the project being deleted.', ExitCode.GENERAL_ERROR);
  }

  const secretCount = secrets.filter((secret) => secret.projectId === project.id).length;
  const destination = moveTo
    ? `${secretCount} secret(s) will be moved to '${moveTo.name}'.`
    : `${secretCount} secret(s) will become uncategorized.`;

  const confirmed = await confirmDestructive(
    `Delete project '${project.name}'? ${destination}`,
    { yes: options.yes }
  );
  if (!confirmed) {
    warningBanner('Aborted project deletion. Nothing was changed.');
    return;
  }

  const moved = await deleteProject(session.uid, project.id, moveTo?.id ?? null, db);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          deleted: true,
          id: project.id,
          name: project.name,
          movedSecrets: moved,
          movedTo: moveTo ? { id: moveTo.id, name: moveTo.name } : null,
        },
        null,
        2
      )
    );
    return;
  }

  successBanner(`Deleted project '${project.name}'`, [
    { key: 'Project ID', val: pc.dim(project.id) },
    {
      key: 'Secrets',
      val: moveTo
        ? `${moved} moved to ${pc.cyan(moveTo.name)}`
        : `${moved} uncategorized`,
    },
  ]);
}
