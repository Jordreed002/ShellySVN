import type {
  SvnDiskFullErrorDetails,
  SvnDiskFullOperationKind,
  SvnExecutionContext,
} from '@shared/types';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { getSettingsManager } from '../settings-manager';
import { getAuthCache } from '../auth-cache';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import { createSvnNetworkSuspendedError, runResolvedSvn, type RunSvnResult } from './svn-runner';
import {
  beginSvnTimelineEntry,
  completeSvnTimelineEntry,
  failSvnTimelineEntry,
} from './svn-command-timeline';

export { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, type RunSvnResult } from './svn-runner';
// The disk-full shapes live in @shared/types (they cross IPC on operation
// results); re-exported here so existing service imports keep working.
export type { SvnDiskFullErrorDetails, SvnDiskFullOperationKind } from '@shared/types';

// ---------------------------------------------------------------------------
// Disk-full classification (backlog item #30)
// ---------------------------------------------------------------------------

/**
 * Marker (`error.code`) for an ENOSPC-condition failure during an SVN command.
 * Distinguished from SVN's own exit codes, which are not unique for disk-full
 * failures (svn reuses exit 1 and encodes the cause in stderr).
 */
export const SVN_DISK_FULL_ERROR_CODE = 'SVN_DISK_FULL';

export type SvnDiskFullError = Error & {
  name: 'SvnDiskFullError';
  code: typeof SVN_DISK_FULL_ERROR_CODE;
  diskFull: SvnDiskFullErrorDetails;
  cause: unknown;
};

/**
 * SVN surfaces ENOSPC through the OS strerror text wrapped in its own E-code
 * output. Recognized variants:
 * - POSIX strerror(ENOSPC): "No space left on device" (shown as svn E700028,
 *   APR_OS_START_SYSERR + 28).
 * - Windows strerror(ERROR_DISK_FULL): "There is not enough space on the disk."
 *   (svn E700112, APR_OS_START_SYSERR + 112).
 * - Raw Node errno (`error.code === 'ENOSPC'`) when an fs write caused the
 *   failure, and SVN's own "disk full"/"file system full" phrasings.
 */
const SVN_DISK_FULL_MESSAGE_PATTERN =
  /\bno space left on device\b|\bthere is not enough space on the disk\b|\bdisk (?:is )?full\b|\bfile system full\b|\b(?:E700028|E700112)\b|\bENOSPC\b/i;

const SVN_DISK_FULL_OPERATION_ALIASES: Record<string, SvnDiskFullOperationKind> = {
  checkout: 'checkout',
  co: 'checkout',
  export: 'export',
  update: 'update',
  up: 'update',
};

/** Option forms whose following argument is a value, not a positional target. */
const VALUE_TAKING_OPTIONS = new Set([
  '-r',
  '--revision',
  '--depth',
  '--set-depth',
  '--username',
  '--password',
  '--config-dir',
  '--certificate',
  '--trust-server-cert-failures',
  '-m',
  '--message',
  '--change',
  '--accept',
  '--old',
  '--new',
  '--limit',
  '-l',
]);

/** Windows drive/UNC absolutes that `path.isAbsolute` misses on POSIX hosts. */
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

function looksLikeRepositoryUrlArg(candidate: string): boolean {
  return /^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(candidate);
}

/** Pure predicate: does this error text describe a disk-full (ENOSPC) failure? */
export function isSvnDiskFullText(text: string): boolean {
  return SVN_DISK_FULL_MESSAGE_PATTERN.test(text);
}

/** Map an SVN argv to the disk-full-relevant operation kind, if any. */
export function getSvnDiskFullOperationKind(args: string[]): SvnDiskFullOperationKind | null {
  return SVN_DISK_FULL_OPERATION_ALIASES[args[0]?.toLowerCase() ?? ''] ?? null;
}

/**
 * Best-effort local target of the failing operation, derived from the argv.
 * Scans backwards for the last positional argument that is neither an option,
 * an option value, nor a repository URL; relative targets resolve against the
 * command's cwd. Used for messaging only — never for path authorization.
 */
export function resolveSvnDiskFullTargetPath(args: string[], cwd?: string): string | null {
  for (let index = args.length - 1; index >= 1; index -= 1) {
    const candidate = args[index];
    if (candidate === '--') break; // only option values can precede the targets
    if (candidate.startsWith('-')) continue;
    if (VALUE_TAKING_OPTIONS.has(args[index - 1] ?? '')) continue; // an option's value
    if (looksLikeRepositoryUrlArg(candidate)) continue;
    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate) || isAbsolute(candidate) || !cwd) {
      return candidate;
    }
    return join(cwd, candidate);
  }
  return cwd ?? null;
}

export function buildSvnDiskFullRecoveryHint(
  operationKind: SvnDiskFullOperationKind | null,
  targetPath: string | null
): string {
  const operation = operationKind ?? 'SVN operation';
  const target = targetPath ? ` at ${targetPath}` : '';
  const retryAdvice =
    operationKind === 'update'
      ? 'Run cleanup on the working copy first if SVN then reports it as locked.'
      : 'A partial destination may have been left behind: run cleanup on the working copy (or delete the partial export destination) before retrying.';
  return `The disk ran out of free space during the ${operation}${target}. Free up space on that disk, or choose a destination with more free space, then retry. ${retryAdvice}`;
}

/**
 * Extract disk-full details from any thrown error: either one already wrapped
 * by this executor, or a raw error whose message/errno carries an ENOSPC
 * signature. Returns null when the error is not disk-full related.
 */
export function extractSvnDiskFullDetails(error: unknown): SvnDiskFullErrorDetails | null {
  if (error && typeof error === 'object') {
    const existing = (error as { diskFull?: unknown }).diskFull;
    if (
      existing &&
      typeof existing === 'object' &&
      (error as { code?: unknown }).code === SVN_DISK_FULL_ERROR_CODE
    ) {
      const details = existing as SvnDiskFullErrorDetails;
      return {
        operationKind: details.operationKind ?? null,
        targetPath: details.targetPath ?? null,
        recoveryHint: buildSvnDiskFullRecoveryHint(
          details.operationKind ?? null,
          details.targetPath ?? null
        ),
      };
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const errnoCode = (error as { code?: unknown } | null)?.code;
  if (errnoCode !== 'ENOSPC' && !isSvnDiskFullText(rawMessage)) {
    return null;
  }
  return {
    operationKind: null,
    targetPath: null,
    recoveryHint: buildSvnDiskFullRecoveryHint(null, null),
  };
}

/** Wrap a disk-full failure in the typed error, or return null to re-throw as-is. */
function toSvnDiskFullError(error: unknown, args: string[], cwd?: string): SvnDiskFullError | null {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const errnoCode = (error as { code?: unknown } | null)?.code;
  if (errnoCode !== 'ENOSPC' && !isSvnDiskFullText(rawMessage)) {
    return null;
  }

  const operationKind = getSvnDiskFullOperationKind(args);
  const targetPath = resolveSvnDiskFullTargetPath(args, cwd);
  return Object.assign(new Error(rawMessage), {
    name: 'SvnDiskFullError',
    code: SVN_DISK_FULL_ERROR_CODE,
    diskFull: {
      operationKind,
      targetPath,
      recoveryHint: buildSvnDiskFullRecoveryHint(operationKind, targetPath),
    },
    cause: error,
  }) as SvnDiskFullError;
}

export interface RunSvnOptions {
  cwd?: string;
  operationContext?: Partial<SvnExecutionContext>;
  trustSslFailures?: boolean;
  trustedSslFailures?: string;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  binaryStdout?: boolean;
}

export interface ResolvedSvnExecution {
  svnCommand: string;
  context: SvnExecutionContext;
}

function getRepositoryUrlArgs(args: string[]): string[] {
  return args.filter((arg) => /^(?:https?|svn(?:\+ssh)?):\/\//i.test(arg));
}

function getHttpsUrlArgs(args: string[]): string[] {
  return args.filter((arg) => /^https:\/\//i.test(arg));
}

/*
 * Sleep/resume connectivity gate (backlog item #25).
 *
 * While the system is suspended, repository-bound SVN commands are either
 * aborted (in flight) or queued at the gate; they only proceed once the
 * lifecycle service re-verified connectivity after a resume. Commands
 * without repository URLs (local status, diff, etc.) never touch the gate.
 */
const networkSuspendedError = createSvnNetworkSuspendedError;

let svnNetworkSuspended = false;
const networkGateWaiters = new Set<() => void>();
const trackedNetworkOperations = new Map<AbortController, string[]>();
const suspendedRepositoryUrls = new Set<string>();

export function isSvnNetworkSuspended(): boolean {
  return svnNetworkSuspended;
}

/** Repository URLs seen by operations that were aborted or queued mid-suspension. */
export function getSuspendedSvnNetworkUrls(): string[] {
  return Array.from(suspendedRepositoryUrls);
}

/**
 * Close the gate and abort every in-flight repository-bound operation.
 * Returns the number of operations that were aborted.
 */
export function beginSvnNetworkSuspend(): number {
  svnNetworkSuspended = true;
  const controllers = Array.from(trackedNetworkOperations.keys());
  for (const controller of controllers) {
    controller.abort(networkSuspendedError());
  }
  return controllers.length;
}

/** Open the gate and release every queued repository-bound operation. */
export function endSvnNetworkSuspend(): void {
  svnNetworkSuspended = false;
  suspendedRepositoryUrls.clear();
  const waiters = Array.from(networkGateWaiters);
  networkGateWaiters.clear();
  for (const release of waiters) release();
}

export function waitForSvnNetworkGate(): Promise<void> {
  if (!svnNetworkSuspended) return Promise.resolve();
  return new Promise<void>((resolve) => networkGateWaiters.add(resolve));
}

/**
 * Route repository-bound executions through the connectivity gate and track
 * their composite abort signal so a suspension can abort them. Local-only
 * commands pass straight through with their original signal.
 */
async function runWithNetworkGate<T>(
  args: string[],
  options: Pick<RunSvnOptions, 'signal'>,
  execute: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  if (getRepositoryUrlArgs(args).length === 0) {
    return execute(options.signal);
  }

  await waitForSvnNetworkGate();

  const externalSignal = options.signal;
  if (externalSignal?.aborted) {
    return execute(externalSignal);
  }

  // Every repository-bound operation gets a composite signal the gate can
  // abort — including callers that provided no signal of their own.
  const controller = new AbortController();
  const repositoryUrls = getRepositoryUrlArgs(args);
  trackedNetworkOperations.set(controller, repositoryUrls);
  for (const url of repositoryUrls) suspendedRepositoryUrls.add(url);

  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    return await execute(controller.signal);
  } finally {
    externalSignal?.removeEventListener('abort', forwardAbort);
    trackedNetworkOperations.delete(controller);
  }
}

async function getCachedCredentialsForArgs(
  args: string[]
): Promise<{ username: string; password: string; realm: string } | null> {
  const urls = getRepositoryUrlArgs(args);
  if (urls.length === 0) {
    return null;
  }

  try {
    const cache = getAuthCache();
    await cache.ready();

    for (const url of urls) {
      const match = cache.findForUrl(url);
      if (match) {
        return match;
      }
    }
  } catch (error) {
    debug.warn('[SVN] Failed to look up cached credentials:', error);
  }

  return null;
}

async function getCachedTrustedSslFailuresForArgs(args: string[]): Promise<string | undefined> {
  const urls = getHttpsUrlArgs(args);
  if (urls.length === 0) {
    return undefined;
  }

  try {
    const cache = getSslTrustCache();
    await cache.ready();

    for (const url of urls) {
      const match = cache.findForUrl(url);
      if (match) {
        return match.failures;
      }
    }
  } catch (error) {
    debug.warn('[SVN] Failed to look up cached SSL trust:', error);
  }

  return undefined;
}

export async function resolveSvnExecution(
  options: Pick<RunSvnOptions, 'operationContext'> = {}
): Promise<ResolvedSvnExecution> {
  const settingsManager = getSettingsManager();
  await settingsManager.ready();
  const globalContext = settingsManager.getSvnExecutionContext();
  const context: SvnExecutionContext = {
    proxySettings: options.operationContext?.proxySettings ?? globalContext.proxySettings,
    connectionTimeout:
      options.operationContext?.connectionTimeout ?? globalContext.connectionTimeout,
    sslVerify: options.operationContext?.sslVerify ?? globalContext.sslVerify,
    clientCertificatePath:
      options.operationContext?.clientCertificatePath ?? globalContext.clientCertificatePath,
    svnConfigPath: options.operationContext?.svnConfigPath ?? globalContext.svnConfigPath,
    sshSettings: options.operationContext?.sshSettings ?? globalContext.sshSettings,
  };

  return {
    svnCommand: settingsManager.getSvnClientPath(),
    context,
  };
}

export async function runSvn(args: string[], options: RunSvnOptions = {}): Promise<RunSvnResult> {
  const startedAt = Date.now();
  const timelineId = beginSvnTimelineEntry(args);
  try {
    const { svnCommand, context } = await resolveSvnExecution(options);
    const result = await runWithNetworkGate(args, options, (signal) =>
      runResolvedCommand(args, svnCommand, context, { ...options, signal })
    );
    completeSvnTimelineEntry(timelineId, startedAt, result, options.signal?.aborted === true);
    return result;
  } catch (error) {
    failSvnTimelineEntry(timelineId, startedAt, error, options.signal?.aborted === true);
    // Disk-full failures carry typed, actionable recovery details (item #30)
    // instead of a raw stderr dump; everything else propagates unchanged.
    throw toSvnDiskFullError(error, args, options.cwd) ?? error;
  }
}

function getSvnMuccCommand(svnCommand: string): string {
  const extension = extname(svnCommand);
  const muccName = `svnmucc${extension}`;
  const commandDirectory = dirname(svnCommand);
  return commandDirectory === '.' ? muccName : join(commandDirectory, muccName);
}

async function runResolvedCommand(
  args: string[],
  svnCommand: string,
  context: SvnExecutionContext,
  options: RunSvnOptions
): Promise<RunSvnResult> {
  const cachedCredentials =
    options.credentials === undefined ? await getCachedCredentialsForArgs(args) : null;
  const cachedTrustedSslFailures =
    options.trustedSslFailures === undefined
      ? await getCachedTrustedSslFailuresForArgs(args)
      : undefined;
  const credentials = options.credentials ?? cachedCredentials ?? undefined;
  const trustedSslFailures = options.trustedSslFailures ?? cachedTrustedSslFailures;
  const trustSslFailures =
    options.trustSslFailures === true || trustedSslFailures !== undefined ? true : undefined;

  return runResolvedSvn(args, {
    svnCommand,
    context,
    cwd: options.cwd,
    trustSslFailures,
    trustedSslFailures,
    credentials,
    signal: options.signal,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    maxStdoutBytes: options.maxStdoutBytes,
    maxStderrBytes: options.maxStderrBytes,
    binaryStdout: options.binaryStdout,
  });
}

export async function runSvnText(args: string[], options: RunSvnOptions = {}): Promise<string> {
  const result = await runSvn(args, options);
  return result.stdout;
}

/**
 * Run the companion `svnmucc` client with the same credentials, SSL, proxy,
 * timeout, cancellation, and output handling as normal SVN commands.
 */
export async function runSvnMuccText(args: string[], options: RunSvnOptions = {}): Promise<string> {
  const { svnCommand, context } = await resolveSvnExecution(options);
  const result = await runWithNetworkGate(args, options, (signal) =>
    runResolvedCommand(args, getSvnMuccCommand(svnCommand), context, { ...options, signal })
  );
  return result.stdout;
}
