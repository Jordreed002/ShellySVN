import type { IpcMainInvokeEvent } from 'electron';
import type { SvnMergeOptions } from '@shared/types';
import { runSvnText } from './svn-executor';
import { runSvnOperationWithProgress } from './svn-progress';

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

export async function exportRepositoryWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  url: string,
  path: string,
  revision?: string
): Promise<{ success: boolean; revision: number; output?: string; error?: string }> {
  const args = [
    'export',
    '--non-interactive',
    '--trust-server-cert-failures',
    DEFAULT_SSL_FAILURES,
    url,
    path,
  ];
  if (revision) args.push('-r', revision);
  return runSvnOperationWithProgress(event, operationId, 'export', args);
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

export async function importRepositoryWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  path: string,
  url: string,
  message: string
): Promise<{ success: boolean; revision: number; output?: string; error?: string }> {
  return runSvnOperationWithProgress(event, operationId, 'import', [
    'import',
    '-m',
    message,
    '--non-interactive',
    '--trust-server-cert-failures',
    DEFAULT_SSL_FAILURES,
    path,
    url,
  ]);
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
): Promise<{ success: boolean; revision: number; output?: string; error?: string }> {
  const validationError = await validateCopyTarget(src, dst, message);
  if (validationError) {
    return { success: false, revision: 0, error: validationError };
  }

  const output = await runSvnText(['copy', '-m', message.trim().replace(/\0/g, ''), src, dst]);
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

export async function createRemoteFolder(
  parentUrl: string,
  folderName: string,
  message: string,
  credentials?: { username: string; password: string }
): Promise<{ success: boolean; revision: number; output?: string; error?: string }> {
  const validationError = validateRemoteFolder(parentUrl, folderName, message);
  if (validationError) {
    return { success: false, revision: 0, error: validationError };
  }

  const targetUrl = buildRemoteChildUrl(parentUrl, folderName.trim());
  const args = [
    'mkdir',
    '-m',
    message.trim().replace(/\0/g, ''),
    '--non-interactive',
    '--trust-server-cert-failures',
    DEFAULT_SSL_FAILURES,
  ];
  if (credentials?.username) args.push('--username', credentials.username);
  if (credentials?.password) args.push('--password', credentials.password);
  args.push(targetUrl);

  const output = await runSvnText(args);
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

async function validateCopyTarget(src: string, dst: string, message: string): Promise<string | null> {
  if (!message.trim()) {
    return 'Branch/tag creation requires a log message.';
  }

  if (hasUnsafePathText(src) || hasUnsafePathText(dst)) {
    return 'Branch/tag source and destination must not contain control characters.';
  }

  if (!isValidSvnTarget(src)) {
    return 'Branch/tag source must be a valid SVN URL or working-copy path.';
  }

  if (!isValidSvnUrl(dst)) {
    return 'Branch/tag destination must be a valid SVN URL.';
  }

  try {
    await runSvnText(['list', dst]);
    return 'Branch/tag destination already exists.';
  } catch {
    return null;
  }
}

function hasUnsafePathText(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

function isValidSvnTarget(value: string): boolean {
  return isValidSvnUrl(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

function isValidSvnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'svn:', 'svn+ssh:', 'file:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateRemoteFolder(parentUrl: string, folderName: string, message: string): string | null {
  if (!isValidSvnUrl(parentUrl)) {
    return 'Remote folder parent must be a valid SVN URL.';
  }

  if (!folderName.trim()) {
    return 'Remote folder name is required.';
  }

  if (hasUnsafePathText(folderName) || folderName.includes('/') || folderName.includes('\\')) {
    return 'Remote folder name must be a single path segment without control characters.';
  }

  if (!message.trim()) {
    return 'Remote folder creation requires a log message.';
  }

  return null;
}

function buildRemoteChildUrl(parentUrl: string, folderName: string): string {
  const separator = parentUrl.endsWith('/') ? '' : '/';
  return `${parentUrl}${separator}${encodeURIComponent(folderName)}`;
}

export async function mergeRepositoryRange(
  source: string,
  target: string,
  revisions?: string[],
  ranges?: Array<{ start: number; end: number }>,
  options?: SvnMergeOptions
): Promise<{ success: boolean; output: string }> {
  const args = buildMergeArgs(source, target, revisions, ranges, options);
  const output = await runSvnText(args);
  return { success: true, output };
}

export async function mergeRepositoryRangeWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  source: string,
  target: string,
  revisions?: string[],
  ranges?: Array<{ start: number; end: number }>,
  options?: SvnMergeOptions
): Promise<{ success: boolean; output?: string; error?: string }> {
  const args = buildMergeArgs(source, target, revisions, ranges, options);
  const result = await runSvnOperationWithProgress(event, operationId, 'merge', args);
  return result.success
    ? { success: true, output: result.output }
    : { success: false, error: result.error };
}

function buildMergeArgs(
  source: string,
  target: string,
  revisions?: string[],
  ranges?: Array<{ start: number; end: number }>,
  options?: SvnMergeOptions
): string[] {
  const args = ['merge'];
  if (options?.dryRun) {
    args.push('--dry-run');
  }
  if (options?.depth) {
    args.push('--depth', options.depth);
  }
  if (options?.ignoreAncestry) {
    args.push('--ignore-ancestry');
  }
  if (options?.allowMixedRevisions) {
    args.push('--allow-mixed-revisions');
  }
  if (options?.onlyRecordMerge) {
    args.push('--record-only');
  }
  if (revisions && revisions.length > 0) {
    args.push('-c', revisions.join(','));
  }
  if (ranges && ranges.length > 0) {
    for (const range of ranges) {
      args.push('-r', `${range.start}:${range.end}`);
    }
  }
  args.push(source, target);
  return args;
}

export async function relocateWorkingCopy(
  from: string,
  to: string,
  path: string
): Promise<{ success: boolean; output: string }> {
  const output = await runSvnText(['relocate', from, to, path]);
  return { success: true, output };
}
