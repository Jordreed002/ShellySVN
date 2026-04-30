import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  spawn: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('C:\\temp\\svn-config-123'),
  rm: vi.fn().mockResolvedValue(undefined),
  getSvnClientPath: vi.fn().mockReturnValue('custom-svn'),
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
}));

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
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

import { runSvn, runSvnText } from '../svn-executor';

async function startSvn(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvnText(args, options);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return { proc, promise };
}

async function startSvnResult(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvn(args, options);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return { proc, promise };
}

describe('svn-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockState.getSvnClientPath.mockReturnValue('custom-svn');
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: { enabled: false },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });
    mockState.authReady.mockResolvedValue(undefined);
    mockState.authFindForUrl.mockReturnValue(null);
  });

  it('uses the configured SVN client path and redacts credentials in logs', async () => {
    const { proc, promise } = await startSvn(['status', '--password', 'secret-value']);

    proc.stdout.emit('data', Buffer.from('ok'));
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('ok');
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      ['status', '--password', 'secret-value'],
      expect.objectContaining({ windowsHide: true })
    );
    expect(mockState.debugLog.mock.calls.join('\n')).not.toContain('secret-value');
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
      expect.arrayContaining(['--certificate', 'C:\\certs\\client.p12']),
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
    expect(mockState.authFindForUrl).toHaveBeenCalledWith(
      'https://svn.example.com/project/trunk'
    );
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--username', 'alice', '--password', 'secret']),
      expect.any(Object)
    );
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
    expect(mockState.spawn).toHaveBeenCalledWith(
      'custom-svn',
      expect.arrayContaining(['--username', 'explicit', '--password', 'explicit-pass']),
      expect.any(Object)
    );
  });

  it('kills the SVN process when the operation is aborted', async () => {
    const controller = new AbortController();
    const { proc, promise } = await startSvn(['checkout'], { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toThrow('SVN operation cancelled');
    expect(proc.kill).toHaveBeenCalled();
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

    const assertion = expect(promise).rejects.toThrow(
      'SVN operation timed out after 2 seconds'
    );
    await vi.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(proc.kill).toHaveBeenCalled();
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
});
