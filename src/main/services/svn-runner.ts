import { spawn } from 'child_process';
import { terminateProcessTree } from '../utils/process-tree';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { SvnExecutionContext } from '@shared/types';
import { debug } from '../utils/debug';
import { toExtendedLengthPath } from '../utils/path-guard';
import { redactArgs, redactValue } from '../utils/redaction';
import { SvnCommandError } from '../utils/svn-errors';
import {
  buildSvnSpawnNetworkConfig,
  type SvnSpawnNetworkConfig,
} from '../utils/svn-spawn-network-config';

const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;
const DEFAULT_SSL_FAILURES = ALLOWED_SSL_FAILURES.join(',');

/**
 * Marker distinguishing sleep/resume gate aborts from ordinary cancellations.
 * Defined here (not the executor) so the runner can recognise it without an
 * import cycle: the executor already imports the runner.
 */
export const SVN_NETWORK_SUSPENDED_ABORT_CODE = 'SVN_NETWORK_SUSPENDED';

export function createSvnNetworkSuspendedError(): Error & { code: string } {
  return Object.assign(new Error('SVN network operations suspended while the system sleeps'), {
    code: SVN_NETWORK_SUSPENDED_ABORT_CODE,
  });
}

export const DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES = 1024 * 1024;

/** Bounded grace period when killing every child during app shutdown. */
export const SHUTDOWN_TERMINATION_GRACE_MS = 1_500;

/**
 * Every spawned SVN child, so app shutdown can reap processes that no
 * individual cancel path owns (backlog item #24). Children are spawned
 * detached (POSIX process-group leaders); without this registry they would
 * outlive a crashing or quitting app and could keep mutating a working copy.
 */
const liveSvnProcesses = new Set<ReturnType<typeof spawn>>();

export function getLiveSvnProcessCount(): number {
  return liveSvnProcesses.size;
}

/**
 * Terminate every tracked SVN child: SIGTERM to the process tree, then a
 * bounded SIGKILL escalation (via terminateProcessTree) for whatever is still
 * alive. Returns the number of children that were still running.
 */
export async function terminateAllSvnProcesses(
  graceMs = SHUTDOWN_TERMINATION_GRACE_MS
): Promise<number> {
  const pending = Array.from(liveSvnProcesses);
  liveSvnProcesses.clear();
  await Promise.all(
    pending.map((proc) => terminateProcessTree(proc, graceMs).catch(() => undefined))
  );
  return pending.length;
}

function trackSvnProcess(proc: ReturnType<typeof spawn>): void {
  liveSvnProcesses.add(proc);
  const untrack = () => {
    liveSvnProcesses.delete(proc);
  };
  proc.once('close', untrack);
  proc.once('error', untrack);
}

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

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // Absent or unreadable files fall back to defaults.
    return null;
  }
}

/**
 * Write a temp config dir carrying the generated `[global]` servers settings
 * (proxy and, when configured, the client-certificate keys). It is written
 * only for an active proxy — a lone client certificate travels as
 * `--config-option` arguments instead — and the user's own config dir is
 * MERGED into it rather than discarded: their `servers` content is kept first
 * so the generated keys win svn's last-value-wins config parsing, and their
 * `config` file is copied verbatim.
 */
async function createTempSvnConfig(
  networkConfig: SvnSpawnNetworkConfig,
  userConfigPath: string | undefined
): Promise<string | null> {
  if (!networkConfig.proxyActive) {
    return null;
  }

  const configDir = await mkdtemp(join(tmpdir(), 'svn-config-'));
  const serversPath = join(configDir, 'servers');
  const generatedServers = networkConfig.serverConfigLines.join('\n');
  const userServers = userConfigPath
    ? await readOptionalTextFile(join(userConfigPath, 'servers'))
    : null;

  await writeFile(
    serversPath,
    userServers?.trim() ? `${userServers.trim()}\n${generatedServers}` : generatedServers,
    { mode: 0o600 }
  );

  if (userConfigPath) {
    const userConfig = await readOptionalTextFile(join(userConfigPath, 'config'));
    if (userConfig !== null) {
      await writeFile(join(configDir, 'config'), userConfig, { mode: 0o600 });
    }
  }

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

/** Absolute Windows filesystem arguments (drive letters and UNC shares). */
const WINDOWS_ABSOLUTE_ARG = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

/**
 * Long-path support for spawned svn processes on Windows: working directories
 * and absolute path arguments at or beyond MAX_PATH are handed to svn in the
 * `\\?\` extended-length namespace. Options, URLs, relative targets, and
 * non-win32 platforms pass through unchanged. The `platform` parameter only
 * exists so tests on any host can exercise the win32 mapping.
 */
export function toSvnSpawnCwd(cwd: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? toExtendedLengthPath(cwd, { platform }) : cwd;
}

export function toSvnSpawnArgs(
  args: string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== 'win32') return args;
  return args.map((argument) =>
    WINDOWS_ABSOLUTE_ARG.test(argument) ? toExtendedLengthPath(argument, { platform }) : argument
  );
}

export async function runResolvedSvn(
  args: string[],
  options: RunResolvedSvnOptions
): Promise<RunSvnResult> {
  const networkConfig = buildSvnSpawnNetworkConfig({
    proxySettings: options.context.proxySettings,
    clientCertificatePath: options.context.clientCertificatePath,
  });
  // Client-certificate config-option route. Built from the certificate alone
  // so proxy secrets stay out of argv (`ps`/`/proc` visibility): when a proxy
  // writes a temp servers file, the certificate keys ride that file too.
  const clientCertificateConfig = buildSvnSpawnNetworkConfig({
    clientCertificatePath: options.context.clientCertificatePath,
  });
  const tempConfigDir = await createTempSvnConfig(
    networkConfig,
    options.context.svnConfigPath?.trim() || undefined
  );

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

    // svn 1.14 has no `--certificate` CLI option — passing one failed every
    // command. The configured client certificate must reach svn as
    // servers-config overrides instead (backlog item #37).
    for (const configOption of clientCertificateConfig.configOptionArgs) {
      addGeneratedArgs('--config-option', configOption);
    }

    debug.log(
      `[SVN] Running: svn ${redactArgs(finalArgs).join(' ')} in ${options.cwd || process.cwd()}`
    );

    // Windows cannot launch a .cmd/.bat launcher directly with shell:false —
    // Node throws spawn EINVAL (CVE-2024-27980 mitigation). Real svn.exe is
    // unaffected, but some distributions ship a batch wrapper, so route those
    // through cmd.exe explicitly. shell:true is avoided because svn args
    // (URLs, paths, commit messages) must never be shell-interpreted.
    const isBatchLauncher =
      process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(options.svnCommand);
    const launchCommand = isBatchLauncher ? process.env.ComSpec || 'cmd.exe' : options.svnCommand;
    // Absolute Windows path arguments are canonicalized to the extended-length
    // namespace only for the spawn itself; logging and redaction above show the
    // human-readable forms.
    const launchArgs = isBatchLauncher
      ? ['/d', '/s', '/c', options.svnCommand, ...toSvnSpawnArgs(finalArgs)]
      : toSvnSpawnArgs(finalArgs);

    const proc = spawn(launchCommand, launchArgs, {
      cwd: toSvnSpawnCwd(options.cwd || process.cwd()),
      env,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: isBatchLauncher,
    });
    trackSvnProcess(proc);

    if (proc.stdin) {
      // Swallow EPIPE if svn closes stdin early (e.g. cached credentials mean
      // it never reads the password prompt).
      proc.stdin.on('error', () => {});
      if (passwordViaStdin !== null) {
        // Always terminate with \n, not the host EOL: on Windows EOL is \r\n
        // and svn's --password-from-stdin reads until newline, so a trailing
        // \r would become part of the password and break authentication.
        proc.stdin.write(`${passwordViaStdin}\n`);
      }
      // Always close stdin. --non-interactive is set on every command, so svn
      // never needs interactive input; leaving the pipe open lets svn block on
      // a stdin read (a prompt/credential-helper read that --non-interactive
      // doesn't fully suppress on Windows), which hangs until the connection
      // timeout fires. EOF makes any such read return immediately.
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

    const cancel = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', abort);
      void terminateProcessTree(proc).finally(() => {
        void cleanupTempSvnConfig(tempConfigDir);
        reject(error);
      });
    };

    const abort = () => {
      // Plain cancellations keep the historical "SVN operation cancelled"
      // message; only the sleep/resume gate surfaces its own reason.
      const reason = (options.signal as { reason?: unknown } | undefined)?.reason;
      const message =
        typeof reason === 'object' &&
        reason !== null &&
        (reason as { code?: unknown }).code === SVN_NETWORK_SUSPENDED_ABORT_CODE &&
        typeof (reason as { message?: unknown }).message === 'string'
          ? (reason as { message: string }).message
          : 'SVN operation cancelled';
      cancel(new SvnCommandError(message, commandContext));
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
        cancel(
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
