import chalk from 'chalk';

import type { DoctorCheck } from '../core/doctor.js';

export const icons = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  arrow: '→',
  plus: '+',
  minus: '−',
  tilde: '~',
} as const;

export const BANNER = `${chalk.dim('⚒')}  ${chalk.bold.cyan('skillpod')}`;

export function box(content: string): string {
  const lines = content.split('\n');
  const maxWidth = Math.max(...lines.map((line) => stripAnsi(line).length));
  const top = `┌${'─'.repeat(maxWidth + 2)}┐`;
  const bottom = `└${'─'.repeat(maxWidth + 2)}┘`;
  const body = lines.map((line) => {
    const visibleLength = stripAnsi(line).length;
    const padding = ' '.repeat(maxWidth - visibleLength);
    return `│ ${line}${padding} │`;
  });

  return [top, ...body, bottom].join('\n');
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

export function stepLabel(current: number, total: number, label: string): string {
  return `${chalk.dim(`Step ${current}/${total}`)} ${chalk.dim('·')} ${label}`;
}

export function formatBoxTable(headers: string[], rows: string[][]): string {
  const columnCount = headers.length;
  const widths: number[] = [];

  for (let col = 0; col < columnCount; col += 1) {
    let max = headers[col]?.length ?? 0;

    for (const row of rows) {
      const cellLength = row[col]?.length ?? 0;
      if (cellLength > max) {
        max = cellLength;
      }
    }

    widths.push(max);
  }

  const topBorder = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const headerSeparator = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bottomBorder = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (cells: string[]): string => {
    return (
      '│' +
      cells
        .map((cell, index) => {
          const width = widths[index] ?? 0;
          return ` ${(cell ?? '').padEnd(width)} `;
        })
        .join('│') +
      '│'
    );
  };

  const headerRow = formatRow(headers);
  const bodyRows = rows.map((row) => formatRow(row));

  return [topBorder, headerRow, headerSeparator, ...bodyRows, bottomBorder].join('\n');
}

interface ChangeSummary {
  added: string[];
  modified: string[];
  removed: string[];
}

export function formatChangeSummary(summary: ChangeSummary, heading: string): string {
  const lines = [heading];

  if (summary.added.length > 0) {
    lines.push(`${chalk.green(`${icons.plus} Added`)}: ${summary.added.join(', ')}`);
  }

  if (summary.modified.length > 0) {
    lines.push(`${chalk.yellow(`${icons.tilde} Modified`)}: ${summary.modified.join(', ')}`);
  }

  if (summary.removed.length > 0) {
    lines.push(`${chalk.red(`${icons.minus} Removed`)}: ${summary.removed.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  if (days < 7) {
    return `${days}d ago`;
  }

  return date.toISOString().slice(0, 10);
}

export function formatDoctorCheck(check: DoctorCheck): string {
  if (check.status === 'pass') {
    return `${chalk.green(icons.success)} ${chalk.green('PASS')} ${check.label}: ${check.detail}`;
  }

  if (check.status === 'fail') {
    return `${chalk.red(icons.error)} ${chalk.red('FAIL')} ${check.label}: ${check.detail}`;
  }

  if (check.status === 'recommended') {
    return `${chalk.yellow(icons.warning)} ${chalk.yellow('RECOMMENDED')} ${check.label}: ${check.detail}`;
  }

  return `${chalk.gray(icons.info)} ${chalk.gray('UNREACHABLE')} ${check.label}: ${check.detail}`;
}
