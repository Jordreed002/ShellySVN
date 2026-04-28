import { runSvnText } from './svn-executor';

const DEFAULT_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'].join(',');

function parseCommittedRevision(output: string): number {
  const match = output.match(/Committed revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

function parseUpdatedRevision(output: string): number {
  const match = output.match(/Updated to revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

export async function exportRepository(
  url: string,
  path: string,
  revision?: string
): Promise<{ success: boolean; revision: number; output: string }> {
  const args = [
    'export',
    '--non-interactive',
    '--trust-server-cert-failures',
    DEFAULT_SSL_FAILURES,
    url,
    path,
  ];
  if (revision) args.push('-r', revision);
  const output = await runSvnText(args);
  const match = output.match(/Exported revision (\d+)\./);
  return {
    success: true,
    revision: match ? parseInt(match[1], 10) : 0,
    output,
  };
}

export async function importRepository(
  path: string,
  url: string,
  message: string
): Promise<{ success: boolean; revision: number; output: string }> {
  const output = await runSvnText([
    'import',
    '-m',
    message,
    '--non-interactive',
    '--trust-server-cert-failures',
    DEFAULT_SSL_FAILURES,
    path,
    url,
  ]);
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

export async function resolveConflict(
  path: string,
  resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict'
): Promise<{ success: boolean }> {
  await runSvnText(['resolve', '--accept', resolution, path]);
  return { success: true };
}

export async function switchWorkingCopy(
  path: string,
  url: string,
  revision?: string
): Promise<{ success: boolean; revision: number; output: string }> {
  const args = ['switch', url, path];
  if (revision) args.push('-r', revision);
  const output = await runSvnText(args);
  return {
    success: true,
    revision: parseUpdatedRevision(output),
    output,
  };
}

export async function copyRepositoryItem(
  src: string,
  dst: string,
  message: string
): Promise<{ success: boolean; revision: number; output: string }> {
  const output = await runSvnText(['copy', '-m', message, src, dst]);
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

export async function mergeRepositoryRange(
  source: string,
  target: string,
  revisions?: string[],
  ranges?: Array<{ start: number; end: number }>
): Promise<{ success: boolean; output: string }> {
  const args = ['merge', source, target];
  if (revisions && revisions.length > 0) {
    args.push('-c', revisions.join(','));
  }
  if (ranges && ranges.length > 0) {
    for (const range of ranges) {
      args.push('-r', `${range.start}:${range.end}`);
    }
  }
  const output = await runSvnText(args);
  return { success: true, output };
}

export async function relocateWorkingCopy(
  from: string,
  to: string,
  path: string
): Promise<{ success: boolean; output: string }> {
  const output = await runSvnText(['relocate', from, to, path]);
  return { success: true, output };
}
