import type { IpcMainInvokeEvent } from 'electron';
import type { CheckoutOptions, SvnExecutionContext } from '@shared/types';
import { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, runSvn, runSvnText } from './svn-executor';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';

const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;

const activeCheckouts = new Map<string, AbortController>();

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
  _options?: CheckoutOptions
): string[] {
  const args = ['checkout', '--non-interactive'];

  if (revision) args.push('-r', revision);
  if (depth) args.push('--depth', depth);

  args.push(url, path);
  return args;
}

function parseSvnRevision(output: string): number {
  const match = output.match(/(?:Checked out|Updated to|At) revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
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
    candidatePath = normalizeUrlPath(candidateUrl.pathname);
  } catch {
    candidatePath = normalizeCandidate(trimmed);
  }

  if (candidatePath === basePath) {
    return '.';
  }

  if (candidatePath.startsWith(`${basePath}/`)) {
    return candidatePath.slice(basePath.length + 1);
  }

  const baseTail = normalizeCandidate(basePath.split('/').filter(Boolean).slice(-1)[0] || '');
  if (baseTail && candidatePath.startsWith(`/${baseTail}/`)) {
    return candidatePath.slice(baseTail.length + 2);
  }

  return trimmed.replace(/^\/+/, '');
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
  options: CheckoutOptions | undefined,
  trustedSslFailures: string | undefined
): Promise<{ success: boolean; revision: number; output?: string }> {
  const sparseRelativePaths = getSparseRelativePaths(url, options?.sparsePaths);
  const bootstrapOutput = await runSvnText(buildCheckoutArgs(url, path, revision, 'empty'), {
    trustSslFailures: options?.trustSsl,
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
        trustSslFailures: options?.trustSsl,
        trustedSslFailures,
        credentials: options?.credentials,
      }
    );
    revisionNumber = parseSvnRevision(updateOutput) || revisionNumber;
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

function parseCheckoutRevision(output: string): number {
  const match = output.match(/Checked out revision (\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

export async function checkout(
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: CheckoutOptions
): Promise<{ success: boolean; revision: number; output?: string }> {
  const operationContext: Partial<SvnExecutionContext> = {};

  try {
    const trustedSslFailures = options?.trustSsl ? normalizeSslFailures(options.sslFailures) : undefined;
    if (options?.sparsePaths?.length) {
      const result = await runSparseCheckout(url, path, revision, options, trustedSslFailures);
      if (options?.trustSsl && options.trustPermanently && trustedSslFailures) {
        const cache = getSslTrustCache();
        await cache.ready();
        cache.set(url, trustedSslFailures);
      }
      return result;
    }

    const args = buildCheckoutArgs(url, path, revision, depth, options);
    const output = await runSvnText(args, {
      operationContext,
      trustSslFailures: options?.trustSsl,
      trustedSslFailures,
      credentials: options?.credentials,
    });
    if (options?.trustSsl && options.trustPermanently && trustedSslFailures) {
      const cache = getSslTrustCache();
      await cache.ready();
      cache.set(url, trustedSslFailures);
    }
    return {
      success: true,
      revision: parseCheckoutRevision(output),
      output,
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      output: error instanceof Error ? error.message : 'Checkout failed',
    };
  }
}

export async function checkoutWithProgress(
  event: IpcMainInvokeEvent,
  checkoutId: string,
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: CheckoutOptions
): Promise<{ success: boolean; revision: number; output?: string; filesProcessed?: number }> {
  const operationContext: Partial<SvnExecutionContext> = {};
  const controller = new AbortController();
  activeCheckouts.set(checkoutId, controller);

  let lastProgressTime = 0;
  const progressThrottleMs = 500;
  let filesProcessed = 0;
  let currentPath = '';
  let streamedRevision = 0;
  let revisionBuffer = '';
  const trustedSslFailures = options?.trustSsl ? normalizeSslFailures(options.sslFailures) : undefined;

  try {
    if (options?.sparsePaths?.length) {
      const sparseRelativePaths = getSparseRelativePaths(url, options.sparsePaths);
      const result = await runSvn(
        buildCheckoutArgs(url, path, revision, 'empty'),
        {
          cwd: process.cwd(),
          operationContext,
          trustSslFailures: options?.trustSsl,
          trustedSslFailures,
          credentials: options?.credentials,
          signal: controller.signal,
          maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
          maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
          onStdout: (chunk) => {
            revisionBuffer = (revisionBuffer + chunk).slice(-2000);
            streamedRevision = parseSvnRevision(revisionBuffer) || streamedRevision;
          },
        }
      );

      for (const sparseRelativePath of sparseRelativePaths) {
        currentPath = sparseRelativePath;
        filesProcessed++;
        event.sender.send('svn:checkout:progress', {
          checkoutId,
          action: null,
          path: sparseRelativePath,
          filesProcessed,
        });

        const updateOutput = await runSvnText(
          ['update', '--parents', '--depth', 'infinity', sparseRelativePath],
          {
            cwd: path,
            trustSslFailures: options?.trustSsl,
            trustedSslFailures,
            credentials: options?.credentials,
            signal: controller.signal,
          }
        );
        streamedRevision = parseSvnRevision(updateOutput) || streamedRevision;
      }

      if (options?.trustSsl && options.trustPermanently && trustedSslFailures) {
        const cache = getSslTrustCache();
        await cache.ready();
        cache.set(url, trustedSslFailures);
      }

      return {
        success: true,
        revision: streamedRevision || parseSvnRevision(result.stdout),
        output: result.stdout,
        filesProcessed,
      };
    }

    const args = buildCheckoutArgs(url, path, revision, depth, options);
    const result = await runSvn(args, {
      cwd: process.cwd(),
      operationContext,
      trustSslFailures: options?.trustSsl,
      trustedSslFailures,
      credentials: options?.credentials,
      signal: controller.signal,
      maxStdoutBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      maxStderrBytes: DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      onStdout: (chunk) => {
        revisionBuffer = (revisionBuffer + chunk).slice(-2000);
        streamedRevision = parseCheckoutRevision(revisionBuffer) || streamedRevision;

        for (const line of chunk.split('\n')) {
          const progress = parseCheckoutProgress(line);
          if (progress.action && progress.path) {
            filesProcessed++;
            currentPath = progress.path;

            const now = Date.now();
            if (now - lastProgressTime >= progressThrottleMs) {
              lastProgressTime = now;
              event.sender.send('svn:checkout:progress', {
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
      event.sender.send('svn:checkout:progress', {
        checkoutId,
        action: null,
        path: currentPath,
        filesProcessed,
      });
    }

    if (options?.trustSsl && options.trustPermanently && trustedSslFailures) {
      const cache = getSslTrustCache();
      await cache.ready();
      cache.set(url, trustedSslFailures);
    }

    return {
      success: true,
      revision: streamedRevision || parseCheckoutRevision(result.stdout),
      output: result.stdout,
      filesProcessed,
    };
  } catch (error) {
    return {
      success: false,
      revision: 0,
      output: error instanceof Error ? error.message : 'Checkout failed',
    };
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
