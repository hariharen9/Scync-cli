import type { Buffer, Rect } from '../buffer.js';
import type { TuiApp } from '../app.js';
import type { Key } from '../keys.js';
import { isChar, isSpecial } from '../keys.js';
import type { Project } from '../../core/types.js';
import { formatDate, matchesText, sortByName } from '../format.js';
import { projectColorHex } from '../format.js';
import { clamp, displayWidth } from '../width.js';
import { drawListRow, drawPanel } from '../widgets.js';

function visibleProjects(app: TuiApp): Project[] {
  const list = app.state.lists.projects;
  return sortByName(
    app.state.data.projects.filter((project) =>
      matchesText(list.query, project.name, project.description, project.color)
    )
  );
}

export function renderProjectsView(app: TuiApp, buf: Buffer, rect: Rect): void {
  const { theme, state } = app;
  const { p, g } = theme;
  const list = state.lists.projects;
  const projects = visibleProjects(app);
  list.selected = clamp(list.selected, 0, Math.max(0, projects.length - 1));

  const filterH = 1;
  buf.fill(rect.x, rect.y, rect.w, 1, { bg: p.panelAlt });
  buf.put(rect.x + 1, rect.y, g.search, { fg: p.accent });
  buf.put(rect.x + 3, rect.y, list.query || 'Search projects…', {
    fg: list.query ? p.text : p.faint,
  }, Math.max(10, rect.w - 24));
  const countLabel = `${projects.length} project(s)`;
  buf.put(rect.x + rect.w - displayWidth(countLabel) - 2, rect.y, countLabel, { fg: p.faint });

  const panel: Rect = { x: rect.x, y: rect.y + filterH, w: rect.w, h: rect.h - filterH };
  drawPanel(buf, theme, panel, 'PROJECTS', {
    focused: true,
    footer: 'Enter filter secrets · n new · e edit · d delete · / search',
  });

  const x = panel.x + 2;
  const w = panel.w - 4;
  const nameW = Math.max(14, Math.floor(w * 0.26));
  const descW = Math.max(10, w - nameW - 22);

  let hx = x + 2;
  buf.put(hx, panel.y + 1, 'PROJECT', { fg: p.faint, bold: true }, nameW);
  hx += nameW + 1;
  buf.put(hx, panel.y + 1, 'DESCRIPTION', { fg: p.faint, bold: true }, descW);
  hx += descW + 1;
  buf.put(hx, panel.y + 1, 'SECRETS', { fg: p.faint, bold: true }, 8);
  buf.put(hx + 9, panel.y + 1, 'CREATED', { fg: p.faint, bold: true }, 10);
  buf.hline(panel.x + 1, panel.y + 2, panel.w - 2, { fg: p.border }, g.h);

  const top = panel.y + 3;
  const viewport = Math.max(1, panel.h - 4);
  const start = clamp(list.selected - viewport + 1, 0, Math.max(0, projects.length - viewport));
  list.scroll = start;

  if (projects.length === 0) {
    buf.put(x, top + 1, list.query ? 'No projects match your search.' : 'No projects yet — press n to create one.', {
      fg: p.faint,
    });
    return;
  }

  for (let i = 0; i < viewport; i++) {
    const project = projects[start + i];
    if (!project) break;
    const selected = start + i === list.selected;
    const secretCount = state.data.secrets.filter((secret) => secret.projectId === project.id).length;
    drawListRow(buf, theme, panel.x + 1, top + i, panel.w - 2, selected, [
      { text: g.dot, style: { fg: projectColorHex(project.color) }, width: 1 },
      { text: project.name, style: { fg: p.text, bold: selected }, width: nameW },
      { text: project.description || '—', style: { fg: p.faint }, width: descW },
      { text: String(secretCount), style: { fg: secretCount ? p.accentSoft : p.faint }, width: 8 },
      { text: formatDate(project.createdAt), style: { fg: p.faint }, width: 10 },
    ]);
  }
}

export function handleProjectsKey(app: TuiApp, key: Key): void {
  const list = app.state.lists.projects;
  const projects = visibleProjects(app);
  const selected = projects[list.selected];

  if (list.searching) {
    if (isSpecial(key, 'enter') || isSpecial(key, 'escape')) {
      list.searching = false;
      return;
    }
    if (isSpecial(key, 'backspace')) {
      list.query = [...list.query].slice(0, -1).join('');
      list.selected = 0;
      return;
    }
    if (key.type === 'char' && key.text && !key.ctrl && !key.alt) {
      list.query += key.text;
      list.selected = 0;
    }
    return;
  }

  if (isChar(key, '/')) {
    list.searching = true;
    return;
  }
  if (isSpecial(key, 'up') || isChar(key, 'k')) {
    list.selected = Math.max(0, list.selected - 1);
    return;
  }
  if (isSpecial(key, 'down') || isChar(key, 'j')) {
    list.selected = Math.min(Math.max(0, projects.length - 1), list.selected + 1);
    return;
  }
  if (isSpecial(key, 'enter') && selected) {
    app.openProject(selected);
    return;
  }
  if (isChar(key, 'n')) return app.newProject();
  if (isChar(key, 'e') && selected) return app.editProject(selected);
  if (isChar(key, 'd') && selected) return app.deleteProject(selected);
  if (isSpecial(key, 'escape')) {
    if (list.query) {
      list.query = '';
      list.selected = 0;
    } else {
      app.goBack();
    }
  }
}
