import { EventEmitter } from 'events';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  spawn: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('C:\\temp\\svn-config-123'),
  rm: vi.fn().mockResolvedValue(undefined),
  getSvnClientPath: vi.fn().mockReturnValue('custom-svn'),
  settingsReady: vi.fn().mockResolvedValue(undefined),
  getSvnExecutionContext: vi.fn().mockReturnValue({
    proxySettings: { enabled: false },
    connectionTimeout: 0,
    sslVerify: true,
    clientCertificatePath: '',
  }),
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
  authReady: vi.fn().mockResolvedValue(undefined),
  authFindForUrl: vi.fn(),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslFindForUrl: vi.fn(),
  terminateProcessTree: vi.fn().mockResolvedValue(undefined),
}));

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  proc.stdin = stdin;
  proc.kill = vi.fn();
  return proc;
}

vi.mock('child_process', () => ({
  default: { spawn: mockState.spawn },
  spawn: mockState.spawn,
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: mockState.writeFile,
    mkdtemp: mockState.mkdtemp,
    rm: mockState.rm,
  },
  writeFile: mockState.writeFile,
  mkdtemp: mockState.mkdtemp,
  rm: mockState.rm,
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: mockState.settingsReady,
    getSvnClientPath: mockState.getSvnClientPath,
    getSvnExecutionContext: mockState.getSvnExecutionContext,
  }),
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    log: mockState.debugLog,
    warn: mockState.debugWarn,
    error: mockState.debugError,
  },
  default: {
    log: mockState.debugLog,
    warn: mockState.debugWarn,
    error: mockState.debugError,
  },
}));

vi.mock('../../auth-cache', () => ({
  getAuthCache: () => ({
    ready: mockState.authReady,
    findForUrl: mockState.authFindForUrl,
  }),
}));

vi.mock('../../ssl-trust-cache', () => ({
  getSslTrustCache: () => ({
    ready: mockState.sslReady,
    findForUrl: mockState.sslFindForUrl,
  }),
}));

vi.mock('../../utils/process-tree', () => ({
  terminateProcessTree: mockState.terminateProcessTree,
}));

import { runSvn, runSvnMuccText, runSvnText } from '../svn-executor';
import { buildSvnSshCommand } from '../svn-runner';
import {
  buildSvnDiskFullRecoveryHint,
  extractSvnDiskFullDetails,
  getSvnDiskFullOperationKind,
  isSvnDiskFullText,
  resolveSvnDiskFullTargetPath,
  SVN_DISK_FULL_ERROR_CODE,
  type SvnDiskFullError,
} from '../svn-executor';

async function startSvn(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvnText(args, options);
  while (mockState.spawn.mock.calls.length === 0) {
    await Promise.resolve();
  }
  return { proc, promise };
}

async function startSvnResult(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvn(args, options);
  while (mockState.spawn.mock.calls.length === 0) {
    await Promise.resolve();
  }
  return { proc, promise };
}

async function startSvnMucc(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvnMuccText(args, options);
  while (mockState.spawn.mock.calls.length === 0) {
    await Promise.resolve();
  }
  return { proc, promise };
}

describe('svn-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockState.getSvnClientPath.mockReturnValue('custom-svn');
    mockState.settingsReady.mockResolvedValue(undefined);
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });
    mockState.authReady.mockResolvedValue(undefined);
    mockState.authFindForUrl.mockReturnValue(null);
    mockState.sslReady.mockResolvedValue(undefined);
    mockState.sslFindForUrl.mockReturnValue(null);
  });

  it('uses the configured SVN client path and redacts credentials in logs', async () => {
    const { proc, promise } = await startSvn(['status', '--password', 'secret-value']);

    proc.stdout.emit('data', Buffer.from('ok'));
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('ok');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      ['status', '--password', 'secret-value', '--non-interactive'],
      expect.objectContaining({ windowsHide: true })
    );
    expect(mockState.debugLog.mock.calls.join('\n')).not.toContain('secret-value');
  });

  it('closes svn stdin even without credentials so a non-interactive command cannot block', async () => {
    // Regression: for a no-auth command (e.g. svn info on a local working copy)
    // passwordViaStdin is null, so the password write is skipped — but stdin
    // must still be closed (EOF). Leaving the pipe open let svn block on a stdin
    // read on Windows, hanging until the connection timeout fired.
    const { proc, promise } = await startSvn(['info', '--xml', '--', 'C:\\LineIndustries']);
    proc.stdout.emit('data', Buffer.from('<info />'));
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('<info />');
    expect(proc.stdin.end).toHaveBeenCalledTimes(1);
    expect(proc.stdin.write).not.toHaveBeenCalled();
  });

  it('uses the sibling svnmucc executable for repository URL transactions', async () => {
    mockState.getSvnClientPath.mockReturnValue('/tools/svn.exe');
    const { proc, promise } = await startSvnMucc([
      '-m',
      'set property',
      'propset',
      'custom:owner',
      'team',
      'https://svn.example.com/repo/trunk',
    ]);

    proc.stdout.emit('data', Buffer.from('r12 committed'));
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('r12 committed');
    expect(mockState.spawn).toHaveBeenCalledWith(
      // svnmucc is resolved as a sibling of the svn client path; mirror the
      // source's join()/dirname() so the expected path matches on every host.
      join(dirname('/tools/svn.exe'), 'svnmucc.exe'),
      expect.arrayContaining(['propset', 'custom:owner', 'team']),
      expect.objectContaining({ windowsHide: true })
    );
  });

  it('waits for settings to load before spawning SVN', async () => {
    let resolveReady!: () => void;
    mockState.settingsReady.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      })
    );
    const proc = createMockProcess();
    mockState.spawn.mockReturnValueOnce(proc);

    const promise = runSvnText(['status']);
    await Promise.resolve();
    expect(mockState.spawn).not.toHaveBeenCalled();

    resolveReady();
    while (mockState.spawn.mock.calls.length === 0) {
      await Promise.resolve();
    }

    proc.emit('close', 0);
    await expect(promise).resolves.toBe('');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      ['status', '--non-interactive'],
      expect.any(Object)
    );
  });

  it('redacts secret-looking stderr before returning command failures', async () => {
    const { proc, promise } = await startSvn(['commit']);

    proc.stderr.emit('data', Buffer.from('svn failed password=hunter2 token=abc123'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow('password=[REDACTED] token=[REDACTED]');
    await expect(promise).rejects.not.toThrow('hunter2');
  });

  it('cleans up temporary proxy config after successful commands', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: {
        enabled: true,
        host: 'proxy.example.com',
        port: 8080,
        username: 'proxy-user',
        password: 'proxy-pass',
        bypassForLocal: true,
      },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });

    const { proc, promise } = await startSvn(['info']);

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('servers'),
      expect.stringContaining('http-proxy-host = proxy.example.com'),
      { mode: 0o600 }
    );
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--config-dir', 'C:\\temp\\svn-config-123']),
      expect.any(Object)
    );
    expect(mockState.rm).toHaveBeenCalledWith('C:\\temp\\svn-config-123', {
      recursive: true,
      force: true,
    });
  });

  it('applies proxy config to checkout, update, commit, repo browser, log, externals, and sparse update commands', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: {
        enabled: true,
        host: 'proxy.example.com',
        port: 8080,
        username: 'proxy-user',
        password: 'proxy-pass',
        bypassForLocal: false,
      },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });

    const representativeCommands = [
      ['checkout', 'https://svn.example.com/repo/trunk', 'C:\\wc'],
      ['update', 'C:\\wc'],
      ['commit', '-m', 'message', 'C:\\wc\\file.txt'],
      ['list', '--xml', 'https://svn.example.com/repo/trunk'],
      ['log', '--xml', 'https://svn.example.com/repo/trunk'],
      ['propget', 'svn:externals', 'C:\\wc'],
      ['update', '--depth', 'empty', 'src/module'],
    ];

    for (const args of representativeCommands) {
      mockState.spawn.mockClear();
      const { proc, promise } = await startSvn(args);

      while (mockState.spawn.mock.calls.length === 0) {
        await Promise.resolve();
      }
      proc.emit('close', 0);

      await expect(promise).resolves.toBe('');
      expect(mockState.spawn).toHaveBeenCalledWith(
        'custom-svn',
        expect.arrayContaining(['--config-dir', 'C:\\temp\\svn-config-123']),
        expect.any(Object)
      );
    }

    expect(mockState.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('servers'),
      expect.stringContaining('http-proxy-username = proxy-user'),
      { mode: 0o600 }
    );
  });

  it('passes configured client certificates and surfaces certificate failures', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: ' C:\\certs\\client.p12 ',
    });
    const { proc, promise } = await startSvn(['list', 'https://repo.example.com/svn']);

    proc.stderr.emit('data', Buffer.from('svn: E230001: client certificate load failed'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow('client certificate load failed');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining([
        '--config-option',
        'servers:global:ssl-client-cert-file=C:\\certs\\client.p12',
      ]),
      expect.any(Object)
    );
  });

  it('passes the configured SVN config directory when no proxy override is needed', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
      svnConfigPath: ' C:\\Users\\alice\\Subversion ',
    });
    const { proc, promise } = await startSvn(['status']);

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--config-dir', 'C:\\Users\\alice\\Subversion']),
      expect.any(Object)
    );
  });

  it('only bypasses explicitly confirmed SSL failure classes', async () => {
    const { proc, promise } = await startSvn(['info', 'https://svn.example.com/repo'], {
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca,other,expired',
    });

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--trust-server-cert-failures', 'unknown-ca,expired']),
      expect.any(Object)
    );
  });

  it('does not apply broad SSL trust when no failure classes were confirmed', async () => {
    const { proc, promise } = await startSvn(['info', 'https://svn.example.com/repo'], {
      trustSslFailures: true,
    });

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    const spawnedArgs = mockState.spawn.mock.calls.at(-1)?.[1] as string[];
    expect(spawnedArgs).not.toContain('--trust-server-cert-failures');
    expect(mockState.debugWarn.mock.calls.join('\n')).toContain(
      'without confirmed failure classes'
    );
  });

  it('applies cached per-realm credentials to URL-based SVN commands', async () => {
    mockState.authFindForUrl.mockImplementation((url: string) =>
      url.startsWith('https://svn.example.com/project')
        ? { realm: 'https://svn.example.com/project', username: 'alice', password: 'secret' }
        : null
    );
    const { proc, promise } = await startSvn([
      'log',
      '--xml',
      'https://svn.example.com/project/trunk',
    ]);

    proc.stdout.emit('data', Buffer.from('<log />'));
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('<log />');
    expect(mockState.authFindForUrl).toHaveBeenCalledWith('https://svn.example.com/project/trunk');
    const spawnedArgs = mockState.spawn.mock.calls.at(-1)?.[1] as string[];
    expect(spawnedArgs).toEqual(
      expect.arrayContaining(['--username', 'alice', '--password-from-stdin'])
    );
    expect(spawnedArgs).not.toContain('--password');
    expect(proc.stdin.write).toHaveBeenCalledWith('secret\n');
  });

  it('applies cached SSL trust to URL-based SVN commands', async () => {
    mockState.sslFindForUrl.mockReturnValue({
      realm: 'https://svn.example.com/project',
      failures: 'unknown-ca',
    });
    const { proc, promise } = await startSvn(['list', 'https://svn.example.com/project/trunk']);

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.sslFindForUrl).toHaveBeenCalledWith('https://svn.example.com/project/trunk');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--trust-server-cert-failures', 'unknown-ca']),
      expect.any(Object)
    );
  });

  it('uses cached credentials for svn+ssh without consulting the HTTPS trust cache', async () => {
    mockState.authFindForUrl.mockReturnValue({
      realm: 'svn+ssh://svn.example.com/project',
      username: 'alice',
      password: 'secret',
    });
    const { proc, promise } = await startSvn(['list', 'svn+ssh://svn.example.com/project/trunk']);
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.authFindForUrl).toHaveBeenCalled();
    expect(mockState.sslFindForUrl).not.toHaveBeenCalled();
  });

  it('applies the configured SSH client, agent policy, and host-matched key to svn+ssh', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
      sshSettings: {
        sshClientPath: '/opt/tools/custom ssh',
        useAgent: false,
        keys: [
          {
            id: 'fallback',
            name: 'Fallback',
            privateKeyPath: '/keys/default',
            keyType: 'ed25519',
            hasPassphrase: false,
            createdAt: 1,
          },
          {
            id: 'matched',
            name: 'Matched',
            privateKeyPath: '/keys/project key',
            keyType: 'ed25519',
            hasPassphrase: false,
            hostPattern: '*.example.com',
            createdAt: 2,
          },
        ],
      },
    });

    const { proc, promise } = await startSvn([
      'list',
      'svn+ssh://alice@svn.example.com/project/trunk',
    ]);
    proc.emit('close', 0);
    await promise;

    const spawnOptions = mockState.spawn.mock.calls.at(-1)?.[2];
    expect(spawnOptions.env.SVN_SSH).toBe(
      '"/opt/tools/custom ssh" "-o" "BatchMode=yes" "-o" "IdentityAgent=none" "-i" "/keys/project key" "-o" "IdentitiesOnly=yes"'
    );
  });

  it('rejects unsafe control characters in configured SSH paths', () => {
    expect(() =>
      buildSvnSshCommand(['list', 'svn+ssh://host/repo'], {
        sshClientPath: 'ssh\nmalicious',
        useAgent: true,
        keys: [],
      })
    ).toThrow(/control characters/i);
  });

  it.each([
    ['http://svn.example.com/project', true],
    ['svn://svn.example.com/project', true],
    ['svn+ssh://svn.example.com/project', true],
    ['file:///tmp/repository', false],
  ])('applies protocol-appropriate auth and never HTTPS trust for %s', async (url, usesAuth) => {
    mockState.authFindForUrl.mockReturnValue({
      realm: url,
      username: 'alice',
      password: 'secret',
    });
    const { proc, promise } = await startSvn(['list', url]);
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    if (usesAuth) {
      expect(mockState.authFindForUrl).toHaveBeenCalledWith(url);
      expect(mockState.spawn.mock.calls.at(-1)?.[1]).toEqual(
        expect.arrayContaining(['--username', 'alice', '--password-from-stdin'])
      );
    } else {
      expect(mockState.authFindForUrl).not.toHaveBeenCalled();
      expect(mockState.spawn.mock.calls.at(-1)?.[1]).not.toContain('--username');
    }
    expect(mockState.sslFindForUrl).not.toHaveBeenCalled();
  });

  it('keeps explicit credentials ahead of cached realm credentials', async () => {
    mockState.authFindForUrl.mockReturnValue({
      realm: 'https://svn.example.com',
      username: 'cached',
      password: 'cached-pass',
    });
    const { proc, promise } = await startSvn(['list', 'https://svn.example.com/repo'], {
      credentials: { username: 'explicit', password: 'explicit-pass' },
    });

    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    expect(mockState.authFindForUrl).not.toHaveBeenCalled();
    const spawnedArgs = mockState.spawn.mock.calls.at(-1)?.[1] as string[];
    expect(spawnedArgs).toEqual(
      expect.arrayContaining(['--username', 'explicit', '--password-from-stdin'])
    );
    expect(spawnedArgs).not.toContain('--password');
    expect(proc.stdin.write).toHaveBeenCalledWith('explicit-pass\n');
  });

  it('inserts generated auth and trust options before the target separator', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: 'C:\\certs\\client.p12',
    });
    const url = 'https://svn.example.com/repo';
    const { proc, promise } = await startSvn(['info', '--xml', '--', url], {
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('');
    const spawnedArgs = mockState.spawn.mock.calls.at(-1)?.[1] as string[];
    const separatorIndex = spawnedArgs.indexOf('--');
    for (const option of [
      '--non-interactive',
      '--trust-server-cert-failures',
      '--username',
      '--password-from-stdin',
      '--config-option',
    ]) {
      expect(spawnedArgs.indexOf(option)).toBeGreaterThanOrEqual(0);
      expect(spawnedArgs.indexOf(option)).toBeLessThan(separatorIndex);
    }
    expect(spawnedArgs).toContain('servers:global:ssl-client-cert-file=C:\\certs\\client.p12');
    expect(spawnedArgs).not.toContain('--certificate');
    expect(spawnedArgs.slice(separatorIndex)).toEqual(['--', url]);
  });

  it('kills the SVN process when the operation is aborted', async () => {
    const controller = new AbortController();
    const { proc, promise } = await startSvn(['checkout'], { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toThrow('SVN operation cancelled');
    expect(mockState.terminateProcessTree).toHaveBeenCalledWith(proc);
  });

  it('kills the SVN process when the configured connection timeout elapses', async () => {
    vi.useFakeTimers();
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 2,
      sslVerify: true,
      clientCertificatePath: '',
    });
    const { proc, promise } = await startSvn(['status']);

    const assertion = expect(promise).rejects.toThrow('SVN operation timed out after 2 seconds');
    await vi.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(mockState.terminateProcessTree).toHaveBeenCalledWith(proc);
  });

  it('caps stored stdout while still streaming full chunks to callbacks', async () => {
    const onStdout = vi.fn();
    const { proc, promise } = await startSvnResult(['log'], {
      maxStdoutBytes: 5,
      onStdout,
    });

    proc.stdout.emit('data', Buffer.from('hello'));
    proc.stdout.emit('data', Buffer.from(' world'));
    proc.emit('close', 0);

    await expect(promise).resolves.toMatchObject({
      stdout: 'hello',
      stdoutTruncated: true,
      stderrTruncated: false,
    });
    expect(onStdout).toHaveBeenCalledWith('hello');
    expect(onStdout).toHaveBeenCalledWith(' world');
  });

  it('caps stderr without splitting multi-byte characters', async () => {
    const { proc, promise } = await startSvnResult(['status'], {
      maxStderrBytes: 5,
    });

    proc.stderr.emit('data', Buffer.from('abc😀def'));
    proc.emit('close', 0);

    await expect(promise).resolves.toMatchObject({
      stderr: 'abc',
      stderrTruncated: true,
    });
  });

  describe('disk-full classification (item #30)', () => {
    it.each([
      "svn: E720164: Can't write to file '/wc/x': No space left on device",
      'svn: E175002: PROPFIND failed: disk full',
      'There is not enough space on the disk.',
      'write error: file system full',
      "svn: E700028: Can't write to file",
      'svn: E700112: write failed',
      'write failed: ENOSPC',
    ])('recognizes disk-full message %j', (message) => {
      expect(isSvnDiskFullText(message)).toBe(true);
    });

    it.each([
      'svn: E175002: connection refused',
      'svn: E155007: not a working copy',
      'SVN operation cancelled',
      'not enough entropy in the pool',
      'no spare capacity',
    ])('does not misclassify %j', (message) => {
      expect(isSvnDiskFullText(message)).toBe(false);
    });

    it('maps argv to the operation kind and the local target path', () => {
      expect(
        getSvnDiskFullOperationKind(['checkout', '--non-interactive', 'https://x/repo', '/tmp/wc'])
      ).toBe('checkout');
      expect(getSvnDiskFullOperationKind(['co', 'https://x/repo', '/tmp/wc'])).toBe('checkout');
      expect(
        getSvnDiskFullOperationKind(['export', '-r', '5', 'https://x/repo', 'C:\\exports\\r'])
      ).toBe('export');
      expect(getSvnDiskFullOperationKind(['up'])).toBe('update');
      expect(getSvnDiskFullOperationKind(['status'])).toBeNull();

      expect(
        resolveSvnDiskFullTargetPath([
          'checkout',
          '--non-interactive',
          '--depth',
          'infinity',
          'https://x/repo',
          '/tmp/wc',
        ])
      ).toBe('/tmp/wc');
      expect(resolveSvnDiskFullTargetPath(['export', '-r', '123', 'https://x/repo'])).toBeNull();
      expect(resolveSvnDiskFullTargetPath(['update', '-r', '5'])).toBeNull();
      expect(resolveSvnDiskFullTargetPath(['update'], '/tmp/wc')).toBe('/tmp/wc');
      // Relative update targets resolve against the command cwd.
      expect(resolveSvnDiskFullTargetPath(['update', 'src/module'], '/tmp/wc')).toBe(
        join('/tmp/wc', 'src/module')
      );
      // Windows drive-letter targets survive POSIX hosts untouched.
      expect(
        resolveSvnDiskFullTargetPath(['export', 'https://x/repo', 'C:\\exports\\repo'], '/tmp')
      ).toBe('C:\\exports\\repo');
    });

    it('wraps a disk-full checkout failure in the typed, actionable error', async () => {
      const { proc, promise } = await startSvnResult([
        'checkout',
        '--non-interactive',
        'https://svn.example.com/repo',
        '/tmp/wc',
      ]);

      proc.stderr.emit(
        'data',
        Buffer.from("svn: E720164: Can't write to file '/tmp/wc/f': No space left on device")
      );
      proc.emit('close', 1);

      const error = (await promise.then(
        () => null,
        (reason: SvnDiskFullError) => reason
      )) as SvnDiskFullError;
      expect(error).not.toBeNull();
      expect(error.name).toBe('SvnDiskFullError');
      expect(error.code).toBe(SVN_DISK_FULL_ERROR_CODE);
      expect(error.message).toContain('No space left on device');
      expect(error.diskFull).toEqual({
        operationKind: 'checkout',
        targetPath: '/tmp/wc',
        recoveryHint: expect.stringContaining('/tmp/wc'),
      });
      expect(error.diskFull?.recoveryHint).toContain('Free up space');
      expect(error.diskFull?.recoveryHint).toContain('retry');
    });

    it('reports the cwd as the update target when the argv has no positional', async () => {
      const { proc, promise } = await startSvnResult(['update'], { cwd: '/tmp/wc' });

      proc.stderr.emit('data', Buffer.from('svn: E175002: disk full during update'));
      proc.emit('close', 1);

      const error = (await promise.then(
        () => null,
        (reason: SvnDiskFullError) => reason
      )) as SvnDiskFullError;
      expect(error.diskFull).toMatchObject({ operationKind: 'update', targetPath: '/tmp/wc' });
      expect(error.diskFull?.recoveryHint).toContain('Run cleanup on the working copy first');
    });

    it('leaves non-disk-full failures untouched', async () => {
      const { proc, promise } = await startSvnResult(['checkout', 'https://x/repo', '/tmp/wc']);

      proc.stderr.emit('data', Buffer.from('svn: E175002: connection refused'));
      proc.emit('close', 1);

      const error = (await promise.then(
        () => null,
        (reason: unknown) => reason
      )) as { code?: string; diskFull?: unknown };
      expect(error.message).toContain('connection refused');
      expect(error.code).not.toBe(SVN_DISK_FULL_ERROR_CODE);
      expect(error.diskFull).toBeUndefined();
    });

    it('classifies a raw Node ENOSPC spawn error as disk-full', async () => {
      const { proc, promise } = await startSvnResult(['export', 'https://x/repo', '/tmp/wc']);

      proc.emit('error', Object.assign(new Error('spawn ENOSPC'), { code: 'ENOSPC' }));

      const error = (await promise.then(
        () => null,
        (reason: SvnDiskFullError) => reason
      )) as SvnDiskFullError;
      expect(error.code).toBe(SVN_DISK_FULL_ERROR_CODE);
      expect(error.diskFull).toMatchObject({ operationKind: 'export', targetPath: '/tmp/wc' });
    });

    it('extracts details from wrapped and raw errors alike', () => {
      const wrapped = Object.assign(new Error('disk full'), {
        name: 'SvnDiskFullError',
        code: SVN_DISK_FULL_ERROR_CODE,
        diskFull: {
          operationKind: 'checkout' as const,
          targetPath: '/tmp/wc',
          recoveryHint: buildSvnDiskFullRecoveryHint('checkout', '/tmp/wc'),
        },
      });
      expect(extractSvnDiskFullDetails(wrapped)).toMatchObject({
        operationKind: 'checkout',
        targetPath: '/tmp/wc',
      });

      expect(
        extractSvnDiskFullDetails(Object.assign(new Error('write failed'), { code: 'ENOSPC' }))
      ).toMatchObject({ operationKind: null, targetPath: null });

      // A diskFull payload without the marker code is not trusted.
      expect(
        extractSvnDiskFullDetails({ diskFull: { operationKind: 'update', targetPath: '/x' } })
      ).toBeNull();
      expect(extractSvnDiskFullDetails(new Error('connection refused'))).toBeNull();
      expect(extractSvnDiskFullDetails(undefined)).toBeNull();
    });
  });
});
