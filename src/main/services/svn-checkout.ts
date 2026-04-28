import type { IpcMainInvokeEvent } from 'electron';
import type { CheckoutOptions, SvnExecutionContext } from '@shared/types';
import { runSvn, runSvnText } from './svn-executor';
import debug from '../utils/debug';

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
  options?: CheckoutOptions
): string[] {
  const args = ['checkout', '--non-interactive'];

  if (revision) args.push('-r', revision);
  if (depth) args.push('--depth', depth);

  if (options?.sparsePaths && options.sparsePaths.length > 0) {
    args.push('--depth', 'empty');
    options.sparsePaths.forEach((p) => args.push(p));
  }

  if (options?.trustSsl) {
    args.push('--trust-server-cert-failures', normalizeSslFailures(options.sslFailures));
  }

  if (options?.credentials) {
    args.push('--username', options.credentials.username);
    if (options.credentials.password) {
      args.push('--password', options.credentials.password);
    }
  }

  args.push(url, path);
  return args;
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

export async function checkout(
  url: string,
  path: string,
  revision?: string,
  depth?: 'empty' | 'files' | 'immediates' | 'infinity',
  options?: CheckoutOptions
): Promise<{ success: boolean; revision: number; output?: string }> {
  const args = buildCheckoutArgs(url, path, revision, depth, options);
  const operationContext: Partial<SvnExecutionContext> = {};

  try {
    const output = await runSvnText(args, { operationContext });
    const match = output.match(/Checked out revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
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
  const args = buildCheckoutArgs(url, path, revision, depth, options);
  const operationContext: Partial<SvnExecutionContext> = {};
  const controller = new AbortController();
  activeCheckouts.set(checkoutId, controller);

  let lastProgressTime = 0;
  const progressThrottleMs = 500;
  let filesProcessed = 0;
  let currentPath = '';

  try {
    const result = await runSvn(args, {
      cwd: process.cwd(),
      operationContext,
      trustSslFailures: options?.trustSsl,
      trustedSslFailures: options?.trustSsl ? normalizeSslFailures(options.sslFailures) : undefined,
      credentials: options?.credentials,
      signal: controller.signal,
      onStdout: (chunk) => {
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

    const match = result.stdout.match(/Checked out revision (\d+)\./);
    return {
      success: true,
      revision: match ? parseInt(match[1], 10) : 0,
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

