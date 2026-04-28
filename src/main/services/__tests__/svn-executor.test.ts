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

import { runSvnText } from '../svn-executor';

async function startSvn(args: string[], options = {}) {
  const proc = createMockProcess();
  mockState.spawn.mockReturnValueOnce(proc);
  const promise = runSvnText(args, options);
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

  it('kills the SVN process when the operation is aborted', async () => {
    const controller = new AbortController();
    const { proc, promise } = await startSvn(['checkout'], { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toThrow('SVN operation cancelled');
    expect(proc.kill).toHaveBeenCalled();
  });
});
