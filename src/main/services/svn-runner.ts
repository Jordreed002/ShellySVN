import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { SvnExecutionContext } from '@shared/types';
import { debug } from '../utils/debug';
import { redactArgs, redactValue } from '../utils/redaction';

const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;
const DEFAULT_SSL_FAILURES = ALLOWED_SSL_FAILURES.join(',');

export const DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES = 1024 * 1024;

export interface RunResolvedSvnOptions {
  svnCommand: string;
  context: SvnExecutionContext;
  cwd?: string;
  trustSslFailures?: boolean;
  trustedSslFailures?: string;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export interface RunSvnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

function appendCappedOutput(
  currentOutput: string,
  chunk: string,
  maxBytes: number | undefined
): { output: string; truncated: boolean } {
  if (maxBytes === undefined || maxBytes < 0) {
    return { output: currentOutput + chunk, truncated: false };
  }

  const currentBytes = Buffer.byteLength(currentOutput, 'utf8');
  if (currentBytes >= maxBytes) {
    return { output: currentOutput, truncated: chunk.length > 0 };
  }

  const remainingBytes = maxBytes - currentBytes;
  const chunkBytes = Buffer.byteLength(chunk, 'utf8');
  if (chunkBytes <= remainingBytes) {
    return { output: currentOutput + chunk, truncated: false };
  }

  let output = currentOutput;
  let usedBytes = 0;
  for (const char of chunk) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (usedBytes + charBytes > remainingBytes) {
      break;
    }
    output += char;
    usedBytes += charBytes;
  }

  return { output, truncated: true };
}

async function createTempSvnConfig(
  proxySettings: SvnExecutionContext['proxySettings']
): Promise<string | null> {
  if (!proxySettings?.enabled || !proxySettings.host || !proxySettings.port) {
    return null;
  }

  const configDir = await mkdtemp(join(tmpdir(), 'svn-config-'));
  const serversPath = join(configDir, 'servers');
  const configLines = [
    '[global]',
    `http-proxy-host = ${proxySettings.host}`,
    `http-proxy-port = ${proxySettings.port}`,
  ];

  if (proxySettings.username) {
    configLines.push(`http-proxy-username = ${proxySettings.username}`);
  }

  if (proxySettings.password) {
    configLines.push(`http-proxy-password = ${proxySettings.password}`);
  }

  if (proxySettings.bypassForLocal) {
    configLines.push('http-proxy-exceptions = localhost, 127.0.0.1');
  }

  await writeFile(serversPath, configLines.join('\n'), { mode: 0o600 });
  return configDir;
}

async function cleanupTempSvnConfig(configDir: string | null): Promise<void> {
  if (!configDir) {
    return;
  }

  try {
    await rm(configDir, { recursive: true, force: true });
  } catch (error) {
    debug.warn('[SVN] Failed to cleanup temp config dir:', error);
  }
}

function normalizeTrustedSslFailures(failures?: string): string | undefined {
  if (!failures?.trim()) {
    return undefined;
  }

  const allowed = new Set<string>(ALLOWED_SSL_FAILURES);
  const normalized = failures
    .split(',')
    .map((failure) => failure.trim())
    .filter((failure) => allowed.has(failure));

  return normalized.length > 0 ? Array.from(new Set(normalized)).join(',') : undefined;
}

export async function runResolvedSvn(
  args: string[],
  options: RunResolvedSvnOptions
): Promise<RunSvnResult> {
  const tempConfigDir = await createTempSvnConfig(options.context.proxySettings);

  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'en_US.UTF-8' };
    const finalArgs: string[] = [];

    if (tempConfigDir) {
      finalArgs.push('--config-dir', tempConfigDir);
    } else if (options.context.svnConfigPath?.trim()) {
      finalArgs.push('--config-dir', options.context.svnConfigPath.trim());
    }

    finalArgs.push(...args);

    if (options.context.sslVerify === false || options.trustSslFailures) {
      if (!finalArgs.includes('--non-interactive')) {
        finalArgs.push('--non-interactive');
      }
      const trustedFailures =
        options.context.sslVerify === false
          ? DEFAULT_SSL_FAILURES
          : normalizeTrustedSslFailures(options.trustedSslFailures);
      if (trustedFailures) {
        finalArgs.push('--trust-server-cert-failures', trustedFailures);
        debug.warn(`[SECURITY] SSL verification bypassed for: ${options.cwd || process.cwd()}`);
      } else {
        debug.warn(
          '[SECURITY] SSL trust requested without confirmed failure classes; not bypassing certificate checks.'
        );
      }
    }

    if (options.credentials?.username) {
      finalArgs.push('--username', options.credentials.username);
    }
    if (options.credentials?.password) {
      finalArgs.push('--password', options.credentials.password);
    }

    if (options.context.clientCertificatePath?.trim()) {
      finalArgs.push('--certificate', options.context.clientCertificatePath.trim());
    }

    debug.log(
      `[SVN] Running: svn ${redactArgs(finalArgs).join(' ')} in ${options.cwd || process.cwd()}`
    );

    const useWindowsShell =
      process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(options.svnCommand);

    const proc = spawn(options.svnCommand, finalArgs, {
      cwd: options.cwd || process.cwd(),
      env,
      shell: useWindowsShell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timeoutId: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      void cleanupTempSvnConfig(tempConfigDir);
      options.signal?.removeEventListener('abort', abort);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const abort = () => {
      proc.kill();
      fail(new Error('SVN operation cancelled'));
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener('abort', abort, { once: true });

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      const capped = appendCappedOutput(stdout, chunk, options.maxStdoutBytes);
      stdout = capped.output;
      stdoutTruncated = stdoutTruncated || capped.truncated;
      options.onStdout?.(chunk);
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const capped = appendCappedOutput(stderr, chunk, options.maxStderrBytes);
      stderr = capped.output;
      stderrTruncated = stderrTruncated || capped.truncated;
      options.onStderr?.(chunk);
    });

    if (options.context.connectionTimeout && options.context.connectionTimeout > 0) {
      timeoutId = setTimeout(() => {
        proc.kill();
        fail(
          new Error(`SVN operation timed out after ${options.context.connectionTimeout} seconds`)
        );
      }, options.context.connectionTimeout * 1000);
    }

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      debug.log(`[SVN] Exit code: ${code}`);

      if (code === 0) {
        resolve({ stdout, stderr, code, stdoutTruncated, stderrTruncated });
      } else {
        reject(new Error((redactValue(stderr) as string) || `SVN exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      debug.error('[SVN] Error:', error);
      fail(error);
    });
  });
}
