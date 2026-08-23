// @vitest-environment node

import { EventEmitter } from 'node:events';

import type { SvnExecutionContext } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  readFile: vi.fn(),
  writtenFiles: new Map<string, string>(),
}));

vi.mock('child_process', () => ({ spawn: mockState.spawn }));

vi.mock('../../utils/process-tree', () => ({ terminateProcessTree: vi.fn() }));

vi.mock('fs/promises', () => ({
  mkdtemp: mockState.mkdtemp,
  rm: mockState.rm,
  readFile: mockState.readFile,
  writeFile: vi.fn(async (path: string, content: string) => {
    mockState.writtenFiles.set(path, content);
  }),
}));

vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runResolvedSvn, toSvnSpawnArgs, toSvnSpawnCwd } from '../svn-runner';

function makeFakeProcess(): EventEmitter & {
  stdin: { on: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const proc = new EventEmitter() as never as EventEmitter & {
    stdin: { on: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

const INFO_ARGS = ['info', '--xml', '--', 'https://svn.example.com/repo'];

async function runInfo(context: Partial<SvnExecutionContext> = {}): Promise<void> {
  await runResolvedSvn(INFO_ARGS, {
    svnCommand: 'svn',
    context: { sslVerify: true, ...context },
  });
}

function spawnedArgs(): string[] {
  return mockState.spawn.mock.calls[0][1];
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.writtenFiles.clear();
  mockState.mkdtemp.mockResolvedValue('/tmp/svn-config-fixed');
  mockState.rm.mockResolvedValue(undefined);
  mockState.readFile.mockImplementation(async () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  mockState.spawn.mockImplementation(() => {
    const proc = makeFakeProcess();
    setImmediate(() => proc.emit('close', 0));
    return proc;
  });
});

describe('svn-runner client-certificate configuration', () => {
  it('passes a configured client certificate as servers config overrides, not --certificate', async () => {
    await runInfo({ clientCertificatePath: 'C:\\certs\\client.p12' });

    expect(spawnedArgs()).toEqual([
      'info',
      '--xml',
      '--non-interactive',
      '--config-option',
      'servers:global:ssl-client-cert-file=C:\\certs\\client.p12',
      '--',
      'https://svn.example.com/repo',
    ]);
  });

  it('adds no certificate arguments when none is configured', async () => {
    await runInfo();

    expect(spawnedArgs()).toEqual([
      'info',
      '--xml',
      '--non-interactive',
      '--',
      'https://svn.example.com/repo',
    ]);
  });
});

describe('svn-runner temp servers file', () => {
  it('writes proxy settings (and no config file) for a proxy-only configuration', async () => {
    await runInfo({
      proxySettings: {
        enabled: true,
        host: 'proxy.corp',
        port: 8080,
        username: 'puser',
        password: 'ppass',
        bypassForLocal: false,
      },
    });

    const args = spawnedArgs();
    expect(args).toContain('--config-dir');
    expect(args[args.indexOf('--config-dir') + 1]).toBe('/tmp/svn-config-fixed');
    // Proxy secrets live in the 0600 servers file, never in argv.
    expect(args.join(' ')).not.toContain('ppass');
    expect(mockState.writtenFiles.get('/tmp/svn-config-fixed/servers')).toBe(
      [
        '[global]',
        'http-proxy-host = proxy.corp',
        'http-proxy-port = 8080',
        'http-proxy-username = puser',
        'http-proxy-password = ppass',
      ].join('\n')
    );
    expect(mockState.writtenFiles.has('/tmp/svn-config-fixed/config')).toBe(false);

    await settle();
    expect(mockState.rm).toHaveBeenCalledWith('/tmp/svn-config-fixed', {
      recursive: true,
      force: true,
    });
  });

  it('merges the user config dir into the temp config instead of discarding it', async () => {
    const userServers = [
      '[global]',
      'http-proxy-host = stale-proxy',
      'store-plaintext-passwords = no',
      '',
      '[groups]',
      'corp = proxy.corp',
    ].join('\n');
    const userConfig = '[auth]\npassword-stores =\n';
    const userConfigDir = 'C:\\Users\\jordan\\svn-config';
    // path.join uses the HOST separator; normalize before comparing.
    const userConfigDirPosix = userConfigDir.replaceAll('\\', '/');
    mockState.readFile.mockImplementation(async (path: string) => {
      const normalized = path.replaceAll('\\', '/');
      if (normalized === `${userConfigDirPosix}/servers`) return userServers;
      if (normalized === `${userConfigDirPosix}/config`) return userConfig;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await runInfo({
      proxySettings: {
        enabled: true,
        host: 'proxy.corp',
        port: 8080,
        username: '',
        password: 'ppass',
        bypassForLocal: true,
      },
      clientCertificatePath: 'C:\\certs\\client.p12',
      svnConfigPath: userConfigDir,
    });

    // The generated [global] keys come after the user's own sections so they
    // win svn's last-value-wins config parsing.
    expect(mockState.writtenFiles.get('/tmp/svn-config-fixed/servers')).toBe(
      `${userServers}\n${[
        '[global]',
        'http-proxy-host = proxy.corp',
        'http-proxy-port = 8080',
        'http-proxy-password = ppass',
        'http-proxy-exceptions = localhost, 127.0.0.1',
        'ssl-client-cert-file = C:\\certs\\client.p12',
      ].join('\n')}`
    );
    expect(mockState.writtenFiles.get('/tmp/svn-config-fixed/config')).toBe(userConfig);
    // The temp dir replaces the --config-dir argument; the certificate still
    // reaches svn per-invocation as a config override.
    expect(spawnedArgs().join(' ')).not.toContain('C:\\Users\\jordan\\svn-config');
    expect(spawnedArgs()).toContain('servers:global:ssl-client-cert-file=C:\\certs\\client.p12');
  });

  it('keeps passing the user config dir when no proxy is active', async () => {
    await runInfo({ svnConfigPath: 'C:\\Users\\jordan\\svn-config' });

    const args = spawnedArgs();
    expect(args).toContain('--config-dir');
    expect(args[args.indexOf('--config-dir') + 1]).toBe('C:\\Users\\jordan\\svn-config');
    expect(mockState.mkdtemp).not.toHaveBeenCalled();
    expect(mockState.writtenFiles.size).toBe(0);
  });
});

describe('svn-runner win32 long-path mapping', () => {
  const deepDir = `C:\\wc\\${'deep\\'.repeat(60)}nested`;
  const uncDeep = `\\\\server\\share\\${'dir\\'.repeat(130)}leaf`;

  it('maps a MAX_PATH+ cwd into the extended-length namespace on win32 only', () => {
    expect(deepDir.length).toBeGreaterThanOrEqual(260);
    expect(toSvnSpawnCwd(deepDir, 'win32')).toBe(`\\\\?\\${deepDir}`);
    expect(toSvnSpawnCwd('C:\\wc', 'win32')).toBe('C:\\wc');
    expect(toSvnSpawnCwd(deepDir, 'darwin')).toBe(deepDir);
  });

  it('maps only absolute win32 path arguments, leaving options, URLs and relative targets untouched', () => {
    const deepTarget = `${deepDir}\\pic@2.png@`;
    expect(
      toSvnSpawnArgs(
        [
          'update',
          '--depth',
          'infinity',
          '--non-interactive',
          '--',
          deepTarget,
          'src\\relative.txt',
          'https://svn.example.com/repo',
        ],
        'win32'
      )
    ).toEqual([
      'update',
      '--depth',
      'infinity',
      '--non-interactive',
      '--',
      `\\\\?\\${deepTarget}`,
      'src\\relative.txt',
      'https://svn.example.com/repo',
    ]);
  });

  it('maps deep UNC share arguments to the \\\\?\\UNC namespace', () => {
    expect(toSvnSpawnArgs(['status', '--', uncDeep], 'win32')).toEqual([
      'status',
      '--',
      `\\\\?\\UNC\\${uncDeep.slice(2)}`,
    ]);
  });

  it('is a no-op on non-win32 platforms', () => {
    expect(toSvnSpawnArgs(['update', '--', deepDir], 'darwin')).toEqual(['update', '--', deepDir]);
  });

  it.skipIf(process.platform === 'win32')(
    'spawns with unchanged argv and cwd on non-win32 hosts',
    async () => {
      await runResolvedSvn(['update', '--', '/very/long/path'], {
        svnCommand: 'svn',
        context: { sslVerify: true },
        cwd: '/very/long/path',
      });

      const [command, args, spawnOptions] = mockState.spawn.mock.calls[0];
      expect(command).toBe('svn');
      expect(args).toEqual(['update', '--non-interactive', '--', '/very/long/path']);
      expect(spawnOptions.cwd).toBe('/very/long/path');
    }
  );
});
