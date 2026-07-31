import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { EOL, tmpdir } from 'os';
import { join } from 'path';

import type { SvnExecutionContext } from '@shared/types';
import { debug } from '../utils/debug';
import { redactArgs, redactValue } from '../utils/redaction';
import { SvnCommandError } from '../utils/svn-errors';

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
  binaryStdout?: boolean;
}

export interface RunSvnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** Exact stdout bytes, encoded for safe IPC transport, when binaryStdout is requested. */
  stdoutBase64?: string;
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

function matchesSshHost(pattern: string | undefined, host: string): boolean {
  if (!pattern?.trim()) return true;
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(host);
}

function findSvnSshHost(args: string[]): string | undefined {
  for (const argument of args) {
    try {
      const url = new URL(argument);
      if (url.protocol === 'svn+ssh:' && url.hostname) {
        return url.hostname.toLowerCase();
      }
    } catch {
      // Non-URL SVN arguments are expected.
    }
  }
  return undefined;
}

function quoteSvnSshArgument(value: string): string {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('SSH executable and key paths must not contain control characters');
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function buildSvnSshCommand(
  args: string[],
  sshSettings: SvnExecutionContext['sshSettings']
): string | undefined {
  if (!sshSettings) return undefined;
  const host = findSvnSshHost(args);
  if (!host) return undefined;
  const key = sshSettings.keys
    .filter((candidate) => matchesSshHost(candidate.hostPattern, host))
    .toSorted(
      (left, right) => (right.hostPattern?.length ?? 0) - (left.hostPattern?.length ?? 0)
    )[0];
  const command = [
    sshSettings.sshClientPath.trim() || 'ssh',
    '-o',
    'BatchMode=yes',
    ...(sshSettings.useAgent ? [] : ['-o', 'IdentityAgent=none']),
    ...(key ? ['-i', key.privateKeyPath, '-o', 'IdentitiesOnly=yes'] : []),
  ];
  return command.map(quoteSvnSshArgument).join(' ');
}

export async function runResolvedSvn(
  args: string[],
  options: RunResolvedSvnOptions
): Promise<RunSvnResult> {
  const tempConfigDir = await createTempSvnConfig(options.context.proxySettings);

  return new Promise((resolve, reject) => {
    const commandContext = {
      command: args[0] || 'svn',
      target: args.at(-1),
    };
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform === 'win32') {
      // Windows SVN uses the native wide-character APIs. Unix locale overrides
      // can force paths through a lossy code-page conversion.
      delete env.LANG;
      delete env.LC_ALL;
      delete env.LC_CTYPE;
    } else {
      env.LANG = 'en_US.UTF-8';
    }
    const svnSshCommand = buildSvnSshCommand(args, options.context.sshSettings);
    if (svnSshCommand) {
      env.SVN_SSH = svnSshCommand;
    }
    const finalArgs: string[] = [];

    if (tempConfigDir) {
      finalArgs.push('--config-dir', tempConfigDir);
    } else if (options.context.svnConfigPath?.trim()) {
      finalArgs.push('--config-dir', options.context.svnConfigPath.trim());
    }

    finalArgs.push(...args);
    const addGeneratedArgs = (...generatedArgs: string[]) => {
      const targetSeparatorIndex = finalArgs.indexOf('--');
      if (targetSeparatorIndex >= 0) {
        finalArgs.splice(targetSeparatorIndex, 0, ...generatedArgs);
      } else {
        finalArgs.push(...generatedArgs);
      }
    };

    // ShellySVN cannot respond to terminal prompts. Apply this consistently
    // so every command either uses configured/native credentials or fails
    // promptly with an actionable authentication error.
    if (!finalArgs.includes('--non-interactive')) {
      addGeneratedArgs('--non-interactive');
    }

    if (options.context.sslVerify === false || options.trustSslFailures) {
      const trustedFailures =
        options.context.sslVerify === false
          ? DEFAULT_SSL_FAILURES
          : normalizeTrustedSslFailures(options.trustedSslFailures);
      if (trustedFailures) {
        addGeneratedArgs('--trust-server-cert-failures', trustedFailures);
        debug.warn(`[SECURITY] SSL verification bypassed for: ${options.cwd || process.cwd()}`);
      } else {
        debug.warn(
          '[SECURITY] SSL trust requested without confirmed failure classes; not bypassing certificate checks.'
        );
      }
    }

    if (options.credentials?.username) {
      addGeneratedArgs('--username', options.credentials.username);
    }
    // Feed the password through stdin (svn 1.10+) rather than as a CLI
    // argument, so it never appears in `ps`/`/proc/<pid>/cmdline`.
    const passwordViaStdin = options.credentials?.password || null;
    if (passwordViaStdin !== null) {
      addGeneratedArgs('--password-from-stdin');
    }

    if (options.context.clientCertificatePath?.trim()) {
      addGeneratedArgs('--certificate', options.context.clientCertificatePath.trim());
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

    if (passwordViaStdin !== null && proc.stdin) {
      // Swallow EPIPE if svn closes stdin early (e.g. cached credentials mean
      // it never reads the password prompt).
      proc.stdin.on('error', () => {});
      proc.stdin.write(`${passwordViaStdin}${EOL}`);
      proc.stdin.end();
    }

    let stdout = '';
    const stdoutBuffers: Buffer[] = [];
    let stdoutBufferBytes = 0;
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
      fail(new SvnCommandError('SVN operation cancelled', commandContext));
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener('abort', abort, { once: true });

    proc.stdout.on('data', (data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (options.binaryStdout) {
        const maximum = options.maxStdoutBytes;
        const remaining =
          maximum === undefined || maximum < 0 ? buffer.length : maximum - stdoutBufferBytes;
        if (remaining > 0) {
          const captured = buffer.subarray(0, remaining);
          stdoutBuffers.push(captured);
          stdoutBufferBytes += captured.length;
        }
        if (remaining < buffer.length) stdoutTruncated = true;
      }
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
          new SvnCommandError(
            `SVN operation timed out after ${options.context.connectionTimeout} seconds`,
            commandContext
          )
        );
      }, options.context.connectionTimeout * 1000);
    }

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      debug.log(`[SVN] Exit code: ${code}`);

      if (code === 0) {
        resolve({
          stdout,
          stderr,
          code,
          stdoutTruncated,
          stderrTruncated,
          ...(options.binaryStdout
            ? { stdoutBase64: Buffer.concat(stdoutBuffers).toString('base64') }
            : {}),
        });
      } else {
        reject(
          new SvnCommandError(
            (redactValue(stderr) as string) || `SVN exited with code ${code}`,
            commandContext
          )
        );
      }
    });

    proc.on('error', (error) => {
      debug.error('[SVN] Error:', error);
      fail(new SvnCommandError(error, commandContext));
    });
  });
}
