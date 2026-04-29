import { spawn } from 'child_process';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { SvnExecutionContext } from '@shared/types';
import { getSettingsManager } from '../settings-manager';
import { debug } from '../utils/debug';
import { redactArgs } from '../utils/redaction';

const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;
const DEFAULT_SSL_FAILURES = ALLOWED_SSL_FAILURES.join(',');
export const DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES = 1024 * 1024;

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

async function cleanupTempSvnConfig(configDir: string): Promise<void> {
  try {
    await rm(configDir, { recursive: true, force: true });
  } catch (error) {
    debug.warn('[SVN] Failed to cleanup temp config dir:', error);
  }
}

export async function runSvn(args: string[], options: RunSvnOptions = {}): Promise<RunSvnResult> {
  const settingsManager = getSettingsManager();
  const globalContext = settingsManager.getSvnExecutionContext();
  const context: SvnExecutionContext = {
    proxySettings: options.operationContext?.proxySettings ?? globalContext.proxySettings,
    connectionTimeout:
      options.operationContext?.connectionTimeout ?? globalContext.connectionTimeout,
    sslVerify: options.operationContext?.sslVerify ?? globalContext.sslVerify,
    clientCertificatePath:
      options.operationContext?.clientCertificatePath ?? globalContext.clientCertificatePath,
  };

  const tempConfigDir = await createTempSvnConfig(context.proxySettings);

  return new Promise((resolve, reject) => {
    const svnCommand = settingsManager.getSvnClientPath();
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'en_US.UTF-8' };
    const finalArgs: string[] = [];

    if (tempConfigDir) {
      finalArgs.push('--config-dir', tempConfigDir);
    }

    finalArgs.push(...args);

    if (context.sslVerify === false || options.trustSslFailures) {
      if (!finalArgs.includes('--non-interactive')) {
        finalArgs.push('--non-interactive');
      }
      finalArgs.push('--trust-server-cert-failures', options.trustedSslFailures ?? DEFAULT_SSL_FAILURES);
      debug.warn(`[SECURITY] SSL verification bypassed for: ${options.cwd || process.cwd()}`);
    }

    if (options.credentials?.username) {
      finalArgs.push('--username', options.credentials.username);
    }
    if (options.credentials?.password) {
      finalArgs.push('--password', options.credentials.password);
    }

    if (context.clientCertificatePath && context.clientCertificatePath.trim()) {
      finalArgs.push('--certificate', context.clientCertificatePath.trim());
    }

    debug.log(
      `[SVN] Running: svn ${redactArgs(finalArgs).join(' ')} in ${options.cwd || process.cwd()}`
    );

    const proc = spawn(svnCommand, finalArgs, {
      cwd: options.cwd || process.cwd(),
      env,
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
      if (tempConfigDir) cleanupTempSvnConfig(tempConfigDir);
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

    if (context.connectionTimeout && context.connectionTimeout > 0) {
      timeoutId = setTimeout(() => {
        proc.kill();
        fail(new Error(`SVN operation timed out after ${context.connectionTimeout} seconds`));
      }, context.connectionTimeout * 1000);
    }

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      debug.log(`[SVN] Exit code: ${code}`);

      if (code === 0) {
        resolve({ stdout, stderr, code, stdoutTruncated, stderrTruncated });
      } else {
        reject(new Error(stderr || `SVN exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      debug.error('[SVN] Error:', error);
      fail(error);
    });
  });
}

export async function runSvnText(args: string[], options: RunSvnOptions = {}): Promise<string> {
  const result = await runSvn(args, options);
  return result.stdout;
}
