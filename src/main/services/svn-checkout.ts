import type { IpcMainInvokeEvent } from 'electron';
import type { CheckoutOptions, SvnExecutionContext, SvnOperationRevision } from '@shared/types';
import {
  buildSvnDiskFullRecoveryHint,
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
  extractSvnDiskFullDetails,
  runSvn,
  runSvnText,
  type SvnDiskFullErrorDetails,
} from './svn-executor';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import { requireSvnRevision } from '../utils/svn-revision';
import { withSvnTargets } from '../utils/svn-targets';
import { sendToRenderer } from '../utils/safe-renderer-send';

const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;

const activeCheckouts = new Map<string, AbortController>();

/**
 * Disk-full failure shape for checkout results (backlog item #30): instead of a
 * raw stderr dump the caller gets the actionable recovery hint plus the typed
 * details (operation kind, destination, guidance) for the renderer to render.
 */
interface CheckoutFailure {
  success: false;
  revision: null;
  output: string;
  diskFull?: SvnDiskFullErrorDetails;
}

function toCheckoutFailure(error: unknown, destinationPath: string): CheckoutFailure {
  const diskFull = extractSvnDiskFullDetails(error);
  if (diskFull) {
    // The checkout service knows the real destination; refine the executor's
    // argv-derived details with it.
    const details: SvnDiskFullErrorDetails = {
      ...diskFull,
      operationKind: 'checkout',
      targetPath: destinationPath,
      recoveryHint: buildSvnDiskFullRecoveryHint('checkout', destinationPath),
    };
    return { success: false, revision: null, output: details.recoveryHint, diskFull: details };
  }
  return {
    success: false,
    revision: null,
    output: error instanceof Error ? error.message : 'Checkout failed',
  };
}

function isHttpsRepositoryUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

async function persistSslTrust(
  url: string,
  options: InternalCheckoutOptions | undefined,
  trustedSslFailures: string | undefined
): Promise<void> {
  if (
    !isHttpsRepositoryUrl(url) ||
    !options?.trustSsl ||
    !options.trustPermanently ||
    !trustedSslFailures
  ) {
    return;
  }
  const cache = getSslTrustCache();
  await cache.ready();
  cache.set(url, trustedSslFailures);
}

function normalizeSslFailures(failures?: string[]): string {
  const mapped = new Set<(typeof ALLOWED_SSL_FAILURES)[number]>();

  for (const failure of failures && failures.length > 0 ? failures : ['unknown-ca']) {
    switch (failure) {
      case 'untrusted-issuer':
      case 'unknown-ca':
        mapped.add('unknown-ca');
        break;
      case 'hostname-mismatch':
      case 'cn-mismatch':
        mapped.add('cn-mismatch');
        break;
      case 'expired':
        mapped.add('expired');
        break;
      case 'not-yet-valid':
        mapped.add('not-yet-valid');
        break;
      default:
        debug.warn('[SECURITY] Ignoring unsupported SSL trust failure type:', failure);
    }
  }

  return mapped.size > 0 ? Array.from(mapped).join(',') : 'unknown-ca';
}

function buildCheckoutArgs(
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  _options?: InternalCheckoutOptions
): string[] {
  const args = ['checkout', '--non-interactive'];

  if (revision) args.push('-r', requireSvnRevision(revision, 'checkout revision'));
  if (depth) args.push('--depth', depth);

  return withSvnTargets(args, [url, path]);
}

function parseSvnRevision(output: string): number | null {
  const match = output.match(/(?:Checked out|Updated to|At) revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeUrlPath(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

function toSparseRelativePath(baseUrl: string, sparsePath: string): string | null {
  const trimmed = sparsePath.trim();
  if (!trimmed) {
    return null;
  }

  const normalizeCandidate = (value: string): string => value.replace(/\/+/g, '/');
  const base = new URL(baseUrl);
  const basePath = normalizeUrlPath(base.pathname);

  let candidatePath: string;
  try {
    const candidateUrl = new URL(trimmed);
    if (candidateUrl.protocol !== base.protocol || candidateUrl.host !== base.host) {
      throw new Error('Sparse checkout target is outside the checkout repository');
    }
    candidatePath = normalizeUrlPath(candidateUrl.pathname);
  } catch {
    candidatePath = normalizeCandidate(trimmed);
  }

  if (
    candidatePath.split('/').includes('..') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('\\\\')
  ) {
    throw new Error('Sparse checkout target is outside the checkout URL');
  }

  if (candidatePath === basePath) {
    return '.';
  }

  if (candidatePath.startsWith(`${basePath}/`)) {
    return candidatePath.slice(basePath.length + 1);
  }

  const relativeCandidate = candidatePath.replace(/^\/+/, '');
  const baseRelative = basePath.replace(/^\/+/, '');
  if (relativeCandidate.startsWith(`${baseRelative}/`)) {
    return relativeCandidate.slice(baseRelative.length + 1);
  }

  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    return relativeCandidate;
  }

  throw new Error('Sparse checkout target is outside the checkout URL');
}

function getSparseRelativePaths(baseUrl: string, sparsePaths?: string[]): string[] {
  if (!sparsePaths?.length) {
    return [];
  }

  return sparsePaths
    .map((sparsePath) => toSparseRelativePath(baseUrl, sparsePath))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function runSparseCheckout(
  url: string,
  path: string,
  revision: string | undefined,
  options: InternalCheckoutOptions | undefined,
  trustedSslFailures: string | undefined
): Promise<{ success: boolean; revision: SvnOperationRevision; output?: string }> {
  const sparseRelativePaths = getSparseRelativePaths(url, options?.sparsePaths);
  const bootstrapOutput = await runSvnText(buildCheckoutArgs(url, path, revision, 'empty'), {
    trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
    trustedSslFailures,
    credentials: options?.credentials,
  });

  let revisionNumber = parseSvnRevision(bootstrapOutput);
  const outputs = [bootstrapOutput];

  for (const sparseRelativePath of sparseRelativePaths) {
    const updateOutput = await runSvnText(
      ['update', '--parents', '--depth', 'infinity', sparseRelativePath],
      {
        cwd: path,
        trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
        trustedSslFailures,
        credentials: options?.credentials,
      }
    );
    revisionNumber = parseSvnRevision(updateOutput) ?? revisionNumber;
    outputs.push(updateOutput);
  }

  return {
    success: true,
    revision: revisionNumber,
    output: outputs.join(''),
  };
}

function parseCheckoutProgress(line: string): {
  action: 'A' | 'U' | 'D' | 'G' | 'E' | 'C' | null;
  path: string | null;
} {
  const match = line.match(/^([AUCDGE])\s+(.+)$/);
  if (match) {
    return { action: match[1] as 'A' | 'U' | 'D' | 'G' | 'E' | 'C', path: match[2].trim() };
  }
  return { action: null, path: null };
}

function parseCheckoutRevision(output: string): number | null {
  const match = output.match(/Checked out revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

export async function checkout(
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: InternalCheckoutOptions
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  output?: string;
  diskFull?: SvnDiskFullErrorDetails;
}> {
  const operationContext: Partial<SvnExecutionContext> = {};

  try {
    const trustedSslFailures =
      options?.trustSsl && isHttpsRepositoryUrl(url)
        ? normalizeSslFailures(options.sslFailures)
        : undefined;
    if (options?.sparsePaths?.length) {
      const result = await runSparseCheckout(url, path, revision, options, trustedSslFailures);
      await persistSslTrust(url, options, trustedSslFailures);
      return result;
    }

    const args = buildCheckoutArgs(url, path, revision, depth, options);
    const output = await runSvnText(args, {
      operationContext,
      trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
      trustedSslFailures,
      credentials: options?.credentials,
    });
    await persistSslTrust(url, options, trustedSslFailures);
    return {
      success: true,
      revision: parseCheckoutRevision(output),
      output,
    };
  } catch (error) {
    return toCheckoutFailure(error, path);
  }
}

export async function checkoutWithProgress(
  event: IpcMainInvokeEvent,
  checkoutId: string,
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: InternalCheckoutOptions
): Promise<{
  success: boolean;
  revision: SvnOperationRevision;
  output?: string;
  filesProcessed?: number;
  diskFull?: SvnDiskFullErrorDetails;
}> {
  const operationContext: Partial<SvnExecutionContext> = {};
  const controller = new AbortController();
  activeCheckouts.set(checkoutId, controller);

  let lastProgressTime = 0;
  const progressThrottleMs = 500;
  let filesProcessed = 0;
  let currentPath = '';
  let streamedRevision: number | null = null;
  let revisionBuffer = '';
  let lineBuffer = '';
  const processedPaths = new Set<string>();
  const trustedSslFailures =
    options?.trustSsl && isHttpsRepositoryUrl(url)
      ? normalizeSslFailures(options.sslFailures)
      : undefined;

  try {
    if (options?.sparsePaths?.length) {
      const sparseRelativePaths = getSparseRelativePaths(url, options.sparsePaths);
      const result = await runSvn(buildCheckoutArgs(url, path, revision, 'empty'), {
        cwd: process.cwd(),
        operationContext,
        trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
        trustedSslFailures,
        credentials: options?.credentials,
        signal: controller.signal,
        maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
        maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
        onStdout: (chunk) => {
          revisionBuffer = (revisionBuffer + chunk).slice(-2000);
          streamedRevision = parseSvnRevision(revisionBuffer) ?? streamedRevision;
        },
      });

      for (const sparseRelativePath of sparseRelativePaths) {
        currentPath = sparseRelativePath;
        filesProcessed++;
        sendToRenderer(event.sender, 'svn:checkout:progress', {
          checkoutId,
          action: null,
          path: sparseRelativePath,
          filesProcessed,
        });

        const updateOutput = await runSvnText(
          ['update', '--parents', '--depth', 'infinity', sparseRelativePath],
          {
            cwd: path,
            trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
            trustedSslFailures,
            credentials: options?.credentials,
            signal: controller.signal,
          }
        );
        streamedRevision = parseSvnRevision(updateOutput) ?? streamedRevision;
        result.stdout += updateOutput;
      }

      await persistSslTrust(url, options, trustedSslFailures);

      return {
        success: true,
        revision: streamedRevision ?? parseSvnRevision(result.stdout),
        output: result.stdout,
        filesProcessed,
      };
    }

    const args = buildCheckoutArgs(url, path, revision, depth, options);
    const result = await runSvn(args, {
      cwd: process.cwd(),
      operationContext,
      trustSslFailures: isHttpsRepositoryUrl(url) && options?.trustSsl,
      trustedSslFailures,
      credentials: options?.credentials,
      signal: controller.signal,
      maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      onStdout: (chunk) => {
        revisionBuffer = (revisionBuffer + chunk).slice(-2000);
        streamedRevision = parseCheckoutRevision(revisionBuffer) ?? streamedRevision;

        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const progress = parseCheckoutProgress(line);
          if (progress.action && progress.path && !processedPaths.has(progress.path)) {
            processedPaths.add(progress.path);
            filesProcessed++;
            currentPath = progress.path;

            const now = Date.now();
            if (now - lastProgressTime >= progressThrottleMs) {
              lastProgressTime = now;
              sendToRenderer(event.sender, 'svn:checkout:progress', {
                checkoutId,
                action: progress.action,
                path: progress.path,
                filesProcessed,
              });
            }
          }
        }
      },
    });

    if (currentPath) {
      sendToRenderer(event.sender, 'svn:checkout:progress', {
        checkoutId,
        action: null,
        path: currentPath,
        filesProcessed,
      });
    }

    await persistSslTrust(url, options, trustedSslFailures);

    return {
      success: true,
      revision: streamedRevision || parseCheckoutRevision(result.stdout),
      output: result.stdout,
      filesProcessed,
    };
  } catch (error) {
    return toCheckoutFailure(error, path);
  } finally {
    if (activeCheckouts.get(checkoutId) === controller) {
      activeCheckouts.delete(checkoutId);
    }
  }
}

export function cancelCheckout(checkoutId: string): { success: boolean; error?: string } {
  const controller = activeCheckouts.get(checkoutId);
  if (controller) {
    controller.abort();
    activeCheckouts.delete(checkoutId);
    debug.log(`[SVN] Cancelled checkout: ${checkoutId}`);
    return { success: true };
  }
  return { success: false, error: 'No active checkout found with that ID' };
}
type InternalCheckoutOptions = CheckoutOptions & {
  credentials?: { username: string; password: string };
};
