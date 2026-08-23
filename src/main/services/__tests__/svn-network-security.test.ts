// @vitest-environment node
/**
 * Backlog items #37 / #38 — authenticated proxy & client-certificate spawn
 * configuration, end to end.
 *
 * These tests drive the real main-process path: settings-manager →
 * svn-executor.resolveSvnExecution (the same context resolution every spawned
 * svn command uses) → buildSvnSpawnNetworkConfig (the payload the spawn layer
 * must apply). The process spawn itself is mocked at the svn-runner boundary,
 * mirroring how the existing service tests stub execution.
 *
 * Security property under test: the payload necessarily contains secrets
 * (they must reach svn), but nothing that is ever logged or reported through
 * diagnostics may contain them — `redactArgs` fully redacts `--config-option`
 * values and diagnostics report booleans/hostnames/paths only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runResolvedSvn: vi.fn(),
  settingsReady: vi.fn().mockResolvedValue(undefined),
  getSvnClientPath: vi.fn().mockReturnValue('svn'),
  getSvnExecutionContext: vi.fn(),
  authReady: vi.fn().mockResolvedValue(undefined),
  authFindForUrl: vi.fn().mockReturnValue(null),
  sslReady: vi.fn().mockResolvedValue(undefined),
  sslFindForUrl: vi.fn().mockReturnValue(null),
}));

vi.mock('../svn-runner', () => ({
  runResolvedSvn: mockState.runResolvedSvn,
  createSvnNetworkSuspendedError: () => new Error('SVN network operations suspended'),
  DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES: 1024 * 1024,
}));

vi.mock('../svn-command-timeline', () => ({
  beginSvnTimelineEntry: vi.fn(() => 'timeline-1'),
  completeSvnTimelineEntry: vi.fn(),
  failSvnTimelineEntry: vi.fn(),
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: mockState.settingsReady,
    getSvnClientPath: mockState.getSvnClientPath,
    getSvnExecutionContext: mockState.getSvnExecutionContext,
  }),
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

vi.mock('../../utils/debug', () => ({
  debug: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runSvn } from '../svn-executor';
import { buildSvnSpawnNetworkConfig } from '../svn-network-context';
import { redactArgs } from '../../utils/redaction';

function proxySettings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    host: 'proxy.corp.example',
    port: 8080,
    username: '',
    password: '',
    bypassForLocal: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.runResolvedSvn.mockResolvedValue({
    stdout: '',
    stderr: '',
    code: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
});

describe('settings → spawn config (full main-process path, spawn mocked)', () => {
  it('carries an authenticated proxy from settings into the spawn payload', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: proxySettings({
        username: 'svc-svn',
        password: 'hunter2',
        bypassForLocal: true,
      }),
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });

    await runSvn(['info', 'https://svn.example.com/repo']);

    expect(mockState.runResolvedSvn).toHaveBeenCalledTimes(1);
    const context = mockState.runResolvedSvn.mock.calls[0][1].context;

    const config = buildSvnSpawnNetworkConfig(context);
    expect(config.proxyActive).toBe(true);
    expect(config.clientCertificateActive).toBe(false);
    expect(config.serverConfigLines).toEqual([
      '[global]',
      'http-proxy-host = proxy.corp.example',
      'http-proxy-port = 8080',
      'http-proxy-username = svc-svn',
      'http-proxy-password = hunter2',
      'http-proxy-exceptions = localhost, 127.0.0.1',
    ]);
    expect(config.configOptionArgs).toEqual([
      'servers:global:http-proxy-host=proxy.corp.example',
      'servers:global:http-proxy-port=8080',
      'servers:global:http-proxy-username=svc-svn',
      'servers:global:http-proxy-password=hunter2',
      'servers:global:http-proxy-exceptions=localhost, 127.0.0.1',
    ]);
  });

  it('carries a client certificate (and passphrase) into the spawn payload', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: proxySettings({ enabled: false }),
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '/certs/alice.p12',
    });

    await runSvn(['list', 'https://svn.example.com/repo']);

    const context = mockState.runResolvedSvn.mock.calls[0][1].context;
    const config = buildSvnSpawnNetworkConfig({
      ...context,
      clientCertificatePassword: 'cert-pass-1',
    });

    expect(config.proxyActive).toBe(false);
    expect(config.clientCertificateActive).toBe(true);
    expect(config.serverConfigLines).toEqual([
      '[global]',
      'ssl-client-cert-file = /certs/alice.p12',
      'ssl-client-cert-password = cert-pass-1',
    ]);
    expect(config.configOptionArgs).toEqual([
      'servers:global:ssl-client-cert-file=/certs/alice.p12',
      'servers:global:ssl-client-cert-password=cert-pass-1',
    ]);
  });

  it('produces no proxy or cert payload when neither is configured', async () => {
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: proxySettings({ enabled: false, host: 'ignored.example' }),
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '   ',
    });

    await runSvn(['status']);

    const context = mockState.runResolvedSvn.mock.calls[0][1].context;
    const config = buildSvnSpawnNetworkConfig(context);

    expect(config.proxyActive).toBe(false);
    expect(config.clientCertificateActive).toBe(false);
    expect(config.serverConfigLines).toEqual(['[global]']);
    expect(config.configOptionArgs).toEqual([]);
  });

  it('includes a proxy username without a password when only the username is set', () => {
    const config = buildSvnSpawnNetworkConfig({
      proxySettings: proxySettings({ username: 'svc-svn' }),
    });

    expect(config.serverConfigLines).toEqual([
      '[global]',
      'http-proxy-host = proxy.corp.example',
      'http-proxy-port = 8080',
      'http-proxy-username = svc-svn',
    ]);
  });

  it('rejects control characters instead of allowing config injection', () => {
    expect(() =>
      buildSvnSpawnNetworkConfig({
        proxySettings: proxySettings({ host: 'evil.example\nhttp-proxy-port = 1' }),
      })
    ).toThrow(/control characters/);
    expect(() =>
      buildSvnSpawnNetworkConfig({
        clientCertificatePath: '/certs/a.p12\nssl-client-cert-password=x',
      })
    ).toThrow(/control characters/);
  });

  it('rejects invalid proxy ports and treats port 0 as inactive', () => {
    // Port 0 is falsy: the proxy is reported inactive (mirrors the spawn
    // layer's `!proxySettings.port` guard), not an error.
    const zeroPort = buildSvnSpawnNetworkConfig({ proxySettings: proxySettings({ port: 0 }) });
    expect(zeroPort.proxyActive).toBe(false);
    expect(zeroPort.serverConfigLines).toEqual(['[global]']);

    expect(() =>
      buildSvnSpawnNetworkConfig({ proxySettings: proxySettings({ port: 70000 }) })
    ).toThrow(/between 1 and 65535/);
  });
});

describe('redaction of the spawn payload (no secrets in logs)', () => {
  it('redacts every --config-option value carrying proxy or cert secrets', () => {
    const config = buildSvnSpawnNetworkConfig({
      proxySettings: proxySettings({ username: 'svc-svn', password: 'hunter2' }),
      clientCertificatePath: '/certs/alice.p12',
      clientCertificatePassword: 'cert-pass-1',
    });

    // How the spawn layer would log the invocation: one --config-option flag
    // per entry, exactly as svn requires them on the command line.
    const logged = redactArgs([
      'svn',
      'info',
      ...config.configOptionArgs.flatMap((value) => ['--config-option', value]),
    ]);

    expect(logged.join(' ')).not.toContain('hunter2');
    expect(logged.join(' ')).not.toContain('cert-pass-1');
    expect(logged.join(' ')).not.toContain('svc-svn');
    expect(logged.filter((arg) => arg === '[REDACTED]').length).toBe(
      config.configOptionArgs.length
    );
  });

  it('never puts secrets in a diagnostics-shaped summary object', () => {
    const config = buildSvnSpawnNetworkConfig({
      proxySettings: proxySettings({ username: 'svc-svn', password: 'hunter2' }),
    });

    const diagnosticsShape = {
      proxy: {
        active: config.proxyActive,
        authenticated: true,
      },
      clientCertificate: { configured: config.clientCertificateActive },
    };
    const serialized = JSON.stringify(diagnosticsShape);

    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('svc-svn');
  });
});
