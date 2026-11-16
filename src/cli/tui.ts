import pc from 'picocolors';

export function visibleLength(str: string): number {
  return str.replace(/\x1B\[[0-9;]*m/g, '').length;
}

export function padVisible(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  const visLen = visibleLength(str);
  if (visLen >= width) return str;
  const padding = ' '.repeat(width - visLen);
  return align === 'left' ? str + padding : padding + str;
}

export function envBadge(env: string): string {
  const e = env.toLowerCase();
  if (e === 'production' || e === 'prod') {
    return pc.magenta('[Production]');
  }
  if (e === 'staging' || e === 'stage') {
    return pc.yellow('[Staging]');
  }
  if (e === 'development' || e === 'dev') {
    return pc.cyan('[Development]');
  }
  if (e === 'personal') {
    return pc.blue('[Personal]');
  }
  return pc.dim(`[${env}]`);
}

export function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === 'active') {
    return pc.green('● Active');
  }
  if (s === 'rotated') {
    return pc.yellow('● Rotated');
  }
  if (s === 'revoked') {
    return pc.red('● Revoked');
  }
  if (s === 'expired') {
    return pc.red('● Expired');
  }
  return pc.dim(`● ${status}`);
}

export interface CardRow {
  key: string;
  val: string;
}

export interface CardSection {
  title?: string;
  lines: string[];
}

export interface CardOptions {
  title?: string;
  badge?: string;
  rows?: CardRow[];
  sections?: CardSection[];
  footer?: string;
  minWidth?: number;
}

export function renderCard(options: CardOptions): void {
  const border = pc.dim;
  const minW = options.minWidth || 64;

  let maxInner = 0;
  if (options.title) {
    const titleLen = visibleLength(options.title) + (options.badge ? visibleLength(options.badge) + 1 : 0) + 6;
    if (titleLen > maxInner) maxInner = titleLen;
  }
  if (options.rows) {
    for (const r of options.rows) {
      const len = visibleLength(r.key) + visibleLength(r.val) + 6;
      if (len > maxInner) maxInner = len;
    }
  }
  if (options.sections) {
    for (const sec of options.sections) {
      if (sec.title) {
        const tLen = visibleLength(sec.title) + 6;
        if (tLen > maxInner) maxInner = tLen;
      }
      for (const line of sec.lines) {
        const lLen = visibleLength(line) + 4;
        if (lLen > maxInner) maxInner = lLen;
      }
    }
  }
  if (options.footer) {
    const fLen = visibleLength(options.footer) + 6;
    if (fLen > maxInner) maxInner = fLen;
  }

  const width = Math.max(minW, Math.min(maxInner, 92));

  // Top header border
  let titlePart = '';
  if (options.title) {
    titlePart = ' ' + pc.bold(options.title);
    if (options.badge) {
      titlePart += ' ' + options.badge;
    }
    titlePart += ' ';
  }
  const titleVis = visibleLength(titlePart);
  const dashesNeeded = width - 1 - titleVis;
  console.log(border('╭─') + titlePart + border('─'.repeat(Math.max(1, dashesNeeded)) + '╮'));
  console.log(border('│') + ' '.repeat(width) + border('│'));

  // Rows
  if (options.rows && options.rows.length > 0) {
    const maxKey = Math.max(...options.rows.map(r => visibleLength(r.key)));
    const keyColWidth = Math.max(14, maxKey + 2);
    for (const r of options.rows) {
      const line = '  ' + pc.dim(padVisible(r.key, keyColWidth)) + r.val;
      console.log(border('│') + padVisible(line, width) + border('│'));
    }
  }

  // Sections
  if (options.sections && options.sections.length > 0) {
    for (const sec of options.sections) {
      if (options.rows?.length || sec.title) {
        console.log(border('│') + ' '.repeat(width) + border('│'));
      }
      if (sec.title) {
        const secTitle = '  ' + pc.bold(pc.dim(sec.title.toUpperCase()));
        console.log(border('│') + padVisible(secTitle, width) + border('│'));
        console.log(border('│') + padVisible('  ' + pc.dim('─'.repeat(visibleLength(sec.title) + 2)), width) + border('│'));
      }
      for (const l of sec.lines) {
        console.log(border('│') + padVisible('  ' + l, width) + border('│'));
      }
    }
  }

  console.log(border('│') + ' '.repeat(width) + border('│'));

  // Footer
  if (options.footer) {
    console.log(border('├' + '─'.repeat(width) + '┤'));
    console.log(border('│') + padVisible('  ' + options.footer, width) + border('│'));
  }

  console.log(border('╰' + '─'.repeat(width) + '╯'));
}

export function successBanner(title: string, details?: Array<{ key: string; val: string }>): void {
  console.log(pc.green('✔ ') + pc.bold(title));
  if (details && details.length > 0) {
    const maxK = Math.max(...details.map(d => visibleLength(d.key)));
    for (const d of details) {
      console.log(`  ${pc.dim('•')} ${pc.dim(padVisible(d.key + ':', maxK + 2))} ${d.val}`);
    }
  }
}

export function infoBanner(title: string, details?: Array<{ key: string; val: string }>): void {
  console.log(pc.cyan('ℹ ') + pc.bold(title));
  if (details && details.length > 0) {
    const maxK = Math.max(...details.map(d => visibleLength(d.key)));
    for (const d of details) {
      console.log(`  ${pc.dim('•')} ${pc.dim(padVisible(d.key + ':', maxK + 2))} ${d.val}`);
    }
  }
}

export function warningBanner(title: string, details?: Array<{ key: string; val: string }>): void {
  console.log(pc.yellow('⚠ ') + pc.bold(title));
  if (details && details.length > 0) {
    const maxK = Math.max(...details.map(d => visibleLength(d.key)));
    for (const d of details) {
      console.log(`  ${pc.dim('•')} ${pc.dim(padVisible(d.key + ':', maxK + 2))} ${d.val}`);
    }
  }
}

export interface TableColumn {
  header: string;
  width?: number;
  align?: 'left' | 'right';
}

export function renderTable(
  columns: TableColumn[],
  rows: string[][],
  options: { footer?: string; emptyMessage?: string } = {}
): void {
  if (rows.length === 0) {
    console.log(pc.dim(options.emptyMessage || 'No items found.'));
    return;
  }

  // Resolve column widths
  const computedCols = columns.map((col, idx) => {
    let maxContent = visibleLength(col.header);
    for (const r of rows) {
      const cell = r[idx] || '';
      const cellLen = visibleLength(cell);
      if (cellLen > maxContent) maxContent = cellLen;
    }
    const width = col.width ? Math.max(col.width, maxContent) : maxContent;
    return {
      header: col.header,
      width,
      align: col.align || 'left'
    };
  });

  const totalWidth = computedCols.reduce((sum, c) => sum + c.width, 0) + (computedCols.length - 1) * 2;
  const divider = pc.dim('─'.repeat(totalWidth));

  // Print Header
  const headerLine = computedCols
    .map(c => pc.dim(pc.bold(padVisible(c.header, c.width, c.align))))
    .join('  ');
  console.log('  ' + headerLine);
  console.log('  ' + divider);

  // Print Rows
  for (const r of rows) {
    const line = computedCols
      .map((c, idx) => padVisible(r[idx] || '', c.width, c.align))
      .join('  ');
    console.log('  ' + line);
  }

  console.log('  ' + divider);
  if (options.footer) {
    console.log('  ' + options.footer);
  }
}

export function renderProgressBar(percent: number, totalSlots = 20): string {
  const p = Math.max(0, Math.min(1, percent));
  const filled = Math.round(p * totalSlots);
  const empty = totalSlots - filled;
  const bar = pc.green('■'.repeat(filled)) + pc.dim('·'.repeat(empty));
  return `[${bar}]`;
}
