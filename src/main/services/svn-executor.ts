import type { SvnExecutionContext } from '@shared/types';
import { dirname, extname, join } from 'node:path';
import { getSettingsManager } from '../settings-manager';
import { getAuthCache } from '../auth-cache';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import {
  createSvnNetworkSuspendedError,
  runResolvedSvn,
  type RunSvnResult,
} from './svn-runner';
import {
  beginSvnTimelineEntry,
  completeSvnTimelineEntry,
  failSvnTimelineEntry,
} from './svn-command-timeline';

export { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, type RunSvnResult } from './svn-runner';

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
    throw error;
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
