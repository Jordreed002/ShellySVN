import type { SvnExecutionContext } from '@shared/types';
import { getSettingsManager } from '../settings-manager';
import { getAuthCache } from '../auth-cache';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import {
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
  runResolvedSvn,
  type RunSvnResult,
} from './svn-runner';

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
}

export interface ResolvedSvnExecution {
  svnCommand: string;
  context: SvnExecutionContext;
}

function getRepositoryUrlArgs(args: string[]): string[] {
  return args.filter((arg) => /^https?:\/\//i.test(arg));
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
  const urls = getRepositoryUrlArgs(args);
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
  };

  return {
    svnCommand: settingsManager.getSvnClientPath(),
    context,
  };
}

export async function runSvn(args: string[], options: RunSvnOptions = {}): Promise<RunSvnResult> {
  const { svnCommand, context } = await resolveSvnExecution(options);
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
  });
}

export async function runSvnText(args: string[], options: RunSvnOptions = {}): Promise<string> {
  const result = await runSvn(args, options);
  return result.stdout;
}
