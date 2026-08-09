import type { IpcMainInvokeEvent } from 'electron';
import type { SvnMergeOptions, SvnOperationRevision } from '@shared/types';
import { runSvnText } from './svn-executor';
import { runSvnOperationWithProgress } from './svn-progress';
import { runSerializedWorkingCopyMutation } from './svn-mutation-queue';
import { getWorkingCopyContext } from './svn-working-copy';
import {
  getNetworkOptionsForUrl,
  getNetworkOptionsForWorkingCopyPath,
} from './svn-network-context';
import { parseSvnInfoXml } from '../svn/parsers';
import { parseSvnStatusXml } from '../svn/parsers';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';

type SvnCredentials = { username: string; password: string };

interface RepositoryIdentity {
  root: string;
  uuid: string;
  url: string;
}

function parseCommittedRevision(output: string): number | null {
  const match = output.match(/Committed revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

function parseUpdatedRevision(output: string): number | null {
  const match = output.match(/Updated to revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

export async function exportRepository(
  url: string,
  path: string,
  revision?: string
): Promise<{ success: boolean; revision: SvnOperationRevision; output: string }> {
  const args = ['export', '--non-interactive'];
  if (revision) args.push('-r', revision);
  const output = await runSvnText(withSvnTargets(args, [url, path]));
  const match = output.match(/Exported revision (\d+)\./);
  return {
    success: true,
    revision: match ? parseInt(match[1], 10) : null,
    output,
  };
}

export async function exportRepositoryWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  url: string,
  path: string,
  revision?: string
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  const args = ['export', '--non-interactive'];
  if (revision) args.push('-r', revision);
  return runSvnOperationWithProgress(
    event,
    operationId,
    'export',
    withSvnTargets(args, [url, path])
  );
}

export async function importRepository(
  path: string,
  url: string,
  message: string
): Promise<{ success: boolean; revision: SvnOperationRevision; output: string }> {
  const output = await runSvnText(
    withSvnTargets(['import', '-m', message, '--non-interactive'], [path, url])
  );
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
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  return runSvnOperationWithProgress(
    event,
    operationId,
    'import',
    withSvnTargets(['import', '-m', message, '--non-interactive'], [path, url])
  );
}

export async function resolveConflict(
  path: string,
  resolution: 'base' | 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict' | 'working'
): Promise<{ success: boolean }> {
  validateSvnTargets([path], 'Conflict target');
  const context = await getWorkingCopyContext(path);
  const workingCopyRoot = context?.workingCopyRoot ?? path;
  return runSerializedWorkingCopyMutation(workingCopyRoot, async () => {
    await runSvnText(
      withSvnTargets(['resolve', '--accept', resolution], [path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    const statusXml = await runSvnText(
      withSvnTargets(['status', '--xml'], [path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    const remainingConflict = parseSvnStatusXml(statusXml, path).entries.find(
      (entry) =>
        entry.status === 'C' || entry.propsStatus === 'C' || entry.treeConflict !== undefined
    );
    if (remainingConflict) {
      throw new Error(`SVN still reports an unresolved conflict for ${remainingConflict.path}.`);
    }
    return { success: true };
  });
}

export async function switchWorkingCopy(
  path: string,
  url: string,
  revision?: string
): Promise<{ success: boolean; revision: SvnOperationRevision; output: string }> {
  const args = ['switch'];
  if (revision) args.push('-r', revision);
  const output = await runSvnText(withSvnTargets(args, [url, path]));
  return {
    success: true,
    revision: parseUpdatedRevision(output),
    output,
  };
}

export async function copyRepositoryItem(
  src: string,
  dst: string,
  message: string,
  credentials?: SvnCredentials
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  const validationError = await validateCopyTarget(src, dst, message, credentials);
  if (validationError) {
    return { success: false, revision: null, error: validationError };
  }

  const args = withSvnTargets(
    ['copy', '-m', message.trim().replace(/\0/g, ''), '--non-interactive'],
    [src, dst]
  );
  const output = credentials ? await runSvnText(args, { credentials }) : await runSvnText(args);
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
  credentials?: SvnCredentials
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  const validationError = validateRemoteFolder(parentUrl, folderName, message);
  if (validationError) {
    return { success: false, revision: null, error: validationError };
  }

  const targetUrl = buildRemoteChildUrl(parentUrl, folderName.trim());
  await requireRepositoryTarget(parentUrl, 'Remote folder parent', credentials);
  const destinationError = await validateDestinationDoesNotExist(
    targetUrl,
    'Remote folder destination',
    credentials
  );
  if (destinationError) {
    return { success: false, revision: null, error: destinationError };
  }
  const args = ['mkdir', '-m', message.trim().replace(/\0/g, ''), '--non-interactive'];
  const output = await runSvnText(withSvnTargets(args, [targetUrl]), { credentials });
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

export async function deleteRemoteItem(
  url: string,
  message: string,
  credentials?: SvnCredentials
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  const validationError = validateRemoteMutation(url, message, 'Remote delete');
  if (validationError) {
    return { success: false, revision: null, error: validationError };
  }

  await requireRepositoryTarget(url, 'Remote delete target', credentials);

  const args = ['delete', '-m', message.trim().replace(/\0/g, ''), '--non-interactive'];
  const output = await runSvnText(withSvnTargets(args, [url]), { credentials });
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

export async function moveRemoteItem(
  srcUrl: string,
  dstUrl: string,
  message: string,
  credentials?: SvnCredentials
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string; error?: string }> {
  const validationError = validateRemoteMove(srcUrl, dstUrl, message);
  if (validationError) {
    return { success: false, revision: null, error: validationError };
  }

  const sourceIdentity = await requireRepositoryTarget(srcUrl, 'Remote move source', credentials);
  const parentIdentity = await requireRepositoryTarget(
    getRemoteParentUrl(dstUrl),
    'Remote move destination parent',
    credentials
  );
  const identityError = validateSameRepository(sourceIdentity, parentIdentity, 'Remote move');
  if (identityError) {
    return { success: false, revision: null, error: identityError };
  }
  const destinationError = await validateDestinationDoesNotExist(
    dstUrl,
    'Remote move destination',
    credentials
  );
  if (destinationError) {
    return { success: false, revision: null, error: destinationError };
  }

  const args = ['move', '-m', message.trim().replace(/\0/g, ''), '--non-interactive'];
  const output = await runSvnText(withSvnTargets(args, [srcUrl, dstUrl]), { credentials });
  return {
    success: true,
    revision: parseCommittedRevision(output),
    output,
  };
}

async function validateCopyTarget(
  src: string,
  dst: string,
  message: string,
  credentials?: SvnCredentials
): Promise<string | null> {
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

  const sourceIdentity = await requireRepositoryTarget(src, 'Branch/tag source', credentials);
  const parentIdentity = await requireRepositoryTarget(
    getRemoteParentUrl(dst),
    'Branch/tag destination parent',
    credentials
  );
  const identityError = validateSameRepository(sourceIdentity, parentIdentity, 'Branch/tag copy');
  if (identityError) {
    return identityError;
  }
  return validateDestinationDoesNotExist(dst, 'Branch/tag destination', credentials);
}

async function requireRepositoryTarget(
  target: string,
  label: string,
  credentials?: SvnCredentials
): Promise<RepositoryIdentity> {
  let output: string;
  try {
    output = await runSvnText(withSvnTargets(['info', '--xml', '--non-interactive'], [target]), {
      credentials,
    });
  } catch (error) {
    if (isMissingTargetError(error)) {
      throw new Error(`${label} does not exist.`);
    }
    throw error;
  }

  const info = parseSvnInfoXml(output);
  if (info.parseError || !info.repositoryUuid || !info.repositoryRoot || !info.url) {
    throw new Error(`${label} did not return a valid SVN repository identity.`);
  }
  return { root: info.repositoryRoot, uuid: info.repositoryUuid, url: info.url };
}

function validateSameRepository(
  source: RepositoryIdentity,
  destinationParent: RepositoryIdentity,
  operationName: string
): string | null {
  if (source.uuid !== destinationParent.uuid) {
    return `${operationName} source and destination must belong to the same repository.`;
  }
  return null;
}

async function validateDestinationDoesNotExist(
  destination: string,
  label: string,
  credentials?: SvnCredentials
): Promise<string | null> {
  try {
    await runSvnText(withSvnTargets(['info', '--xml', '--non-interactive'], [destination]), {
      credentials,
    });
    return `${label} already exists.`;
  } catch (error) {
    if (isMissingTargetError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b(?:E160013|E200009|W160013)\b|\bnot found\b|does not exist/i.test(message);
}

function getRemoteParentUrl(value: string): string {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return url.toString();
  }
  segments.pop();
  url.pathname = `/${segments.join('/')}`;
  return url.toString().replace(/\/$/, '');
}

function hasUnsafePathText(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

function isValidSvnTarget(value: string): boolean {
  return (
    isValidSvnUrl(value) ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\\\')
  );
}

function isValidSvnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'svn:', 'svn+ssh:', 'file:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateRemoteFolder(
  parentUrl: string,
  folderName: string,
  message: string
): string | null {
  const mutationError = validateRemoteMutation(parentUrl, message, 'Remote folder creation');
  if (mutationError) {
    return mutationError === 'Remote folder creation target must be a valid SVN URL.'
      ? 'Remote folder parent must be a valid SVN URL.'
      : mutationError;
  }

  if (!folderName.trim()) {
    return 'Remote folder name is required.';
  }

  if (hasUnsafePathText(folderName) || folderName.includes('/') || folderName.includes('\\')) {
    return 'Remote folder name must be a single path segment without control characters.';
  }

  return null;
}

function validateRemoteMutation(
  url: string,
  message: string,
  operationName: string
): string | null {
  if (!isValidSvnUrl(url)) {
    return `${operationName} target must be a valid SVN URL.`;
  }

  if (!message.trim()) {
    return `${operationName} requires a log message.`;
  }

  if (hasUnsafePathText(url)) {
    return `${operationName} target must not contain control characters.`;
  }

  return null;
}

function validateRemoteMove(srcUrl: string, dstUrl: string, message: string): string | null {
  if (!message.trim()) {
    return 'Remote move requires a log message.';
  }

  if (!isValidSvnUrl(srcUrl)) {
    return 'Remote move source must be a valid SVN URL.';
  }

  if (hasUnsafePathText(srcUrl)) {
    return 'Remote move source must not contain control characters.';
  }

  if (!isValidSvnUrl(dstUrl)) {
    return 'Remote move destination must be a valid SVN URL.';
  }

  if (hasUnsafePathText(dstUrl)) {
    return 'Remote move destination must not contain control characters.';
  }

  if (srcUrl === dstUrl) {
    return 'Remote move destination must be different from the source.';
  }

  const source = new URL(srcUrl);
  const destination = new URL(dstUrl);

  const sourcePath = source.pathname.replace(/\/+$/, '');
  const destinationPath = destination.pathname.replace(/\/+$/, '');
  if (destinationPath.startsWith(`${sourcePath}/`)) {
    return 'A repository folder cannot be moved inside itself.';
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
  const { workingCopyRoot, networkOptions } = await getMergeExecutionContext(source, target);
  return runSerializedWorkingCopyMutation(workingCopyRoot, async () => {
    const output = await runSvnText(args, networkOptions);
    return { success: true, output };
  });
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
  const { workingCopyRoot, networkOptions } = await getMergeExecutionContext(source, target);
  const result = await runSerializedWorkingCopyMutation(workingCopyRoot, () =>
    runSvnOperationWithProgress(event, operationId, 'merge', args, networkOptions)
  );
  return result.success
    ? { success: true, output: result.output }
    : { success: false, error: result.error };
}

async function getMergeExecutionContext(
  source: string,
  target: string
): Promise<{
  workingCopyRoot: string;
  networkOptions: Awaited<ReturnType<typeof getNetworkOptionsForUrl>>;
}> {
  const context = await getWorkingCopyContext(target);
  if (!context) throw new Error('Merge target must be inside a valid SVN working copy.');
  const networkOptions = isValidSvnUrl(source)
    ? await getNetworkOptionsForUrl(source)
    : await getNetworkOptionsForWorkingCopyPath(source);
  return { workingCopyRoot: context.workingCopyRoot, networkOptions };
}

function buildMergeArgs(
  source: string,
  target: string,
  revisions?: string[],
  ranges?: Array<{ start: number; end: number }>,
  options?: SvnMergeOptions
): string[] {
  if (!source.trim() || !target.trim()) throw new Error('Merge source and target are required.');
  if (isValidSvnUrl(target)) throw new Error('Merge target must be a working-copy path.');
  if (options?.secondSource !== undefined && !options.secondSource.trim()) {
    throw new Error('The second merge source must not be empty.');
  }
  if (
    options?.secondSource &&
    ((revisions && revisions.length > 0) || (ranges && ranges.length > 0))
  ) {
    throw new Error('A two-source merge cannot also specify cherry-pick revisions or ranges.');
  }
  if (revisions?.some((revision) => !/^-?\d+$/.test(revision.trim()))) {
    throw new Error('Merge revisions must be whole revision numbers.');
  }
  if (
    ranges?.some(
      (range) =>
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.end < 0
    )
  ) {
    throw new Error('Merge ranges must contain valid non-negative revision numbers.');
  }
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
  return withSvnTargets(
    args,
    options?.secondSource ? [source, options.secondSource.trim(), target] : [source, target]
  );
}

export async function relocateWorkingCopy(
  from: string,
  to: string,
  path: string
): Promise<{ success: boolean; output: string }> {
  validateSvnTargets([from, to, path], 'Relocate target');
  return runSerializedWorkingCopyMutation(path, async () => {
    const output = await runSvnText(
      withSvnTargets(['relocate'], [from, to, path]),
      await getNetworkOptionsForWorkingCopyPath(path)
    );
    return { success: true, output };
  });
}
