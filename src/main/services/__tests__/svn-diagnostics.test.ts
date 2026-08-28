// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  runSvn: vi.fn(),
  runSvnMuccText: vi.fn(),
  findForUrl: vi.fn(),
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
  getSvnClientPath: vi.fn().mockReturnValue('svn'),
  resolveSvnClientPath: vi.fn().mockResolvedValue('svn'),
  settingsReady: vi.fn().mockResolvedValue(undefined),
  getSvnExecutionContext: vi.fn(),
  sslReady: vi.fn(),
  sslSet: vi.fn(),
  sslFindDecisionForUrl: vi.fn().mockReturnValue(null),
  sslListTrustedOrigins: vi.fn().mockReturnValue([]),
  sslHasPrompted: vi.fn().mockReturnValue(false),
  sslMarkPrompted: vi.fn(),
  sslRecordDecision: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('../../auth-cache', () => ({
  getAuthCache: () => ({
    findForUrl: mockState.findForUrl,
    isEncryptionAvailable: mockState.isEncryptionAvailable,
  }),
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    getSvnClientPath: mockState.getSvnClientPath,
    resolveSvnClientPath: mockState.resolveSvnClientPath,
    ready: mockState.settingsReady,
    getSvnExecutionContext: mockState.getSvnExecutionContext,
  }),
}));

// Keep the REAL classification logic (tests feed real svn stderr through it)
// and only stub the cache singleton behind getSslTrustCache.
vi.mock('../../ssl-trust-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ssl-trust-cache')>();
  return {
    ...actual,
    getSslTrustCache: () => ({
      ready: mockState.sslReady,
      set: mockState.sslSet,
      findDecisionForUrl: mockState.sslFindDecisionForUrl,
      listTrustedOrigins: mockState.sslListTrustedOrigins,
      hasPrompted: mockState.sslHasPrompted,
      markPrompted: mockState.sslMarkPrompted,
      recordDecision: mockState.sslRecordDecision,
    }),
  };
});

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
  runSvn: mockState.runSvn,
  runSvnMuccText: mockState.runSvnMuccText,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getDiagnostics,
  getSvnCapabilities,
  rejectServerCertificate,
  trustServerCertificate,
} from '../svn-diagnostics';

// Real svn 1.14.5 stderr (--non-interactive), captured against badssl.com.
const SELF_SIGNED_STDERR =
  "svn: E170013: Unable to connect to a repository at URL 'https://svn.example.com/repo'\n" +
  'svn: E230001: Server SSL certificate verification failed: issuer is not trusted';
const EXPIRED_STDERR =
  "svn: E170013: Unable to connect to a repository at URL 'https://svn.example.com/repo'\n" +
  'svn: E230001: Server SSL certificate verification failed: certificate has expired, issuer is not trusted';
const AUTH_FAILED_STDERR =
  "svn: E170013: Unable to connect to a repository at URL 'https://svn.example.com/repo'\n" +
  'svn: E215004: No more credentials or we tried too many times.\n' +
  'Authentication failed';

describe('svn-diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.getSvnExecutionContext.mockReturnValue({
      proxySettings: {
        enabled: false,
        host: '',
        port: 0,
        username: '',
        password: '',
        bypassForLocal: false,
      },
      connectionTimeout: 0,
      sslVerify: true,
      clientCertificatePath: '',
    });
    mockState.sslFindDecisionForUrl.mockReturnValue(null);
    mockState.sslHasPrompted.mockReturnValue(false);
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === '--version') return '1.14.2\n';
      throw new Error('not a working copy');
    });
    mockState.runSvn.mockRejectedValue(new Error('"shelve": unknown command.'));
    mockState.runSvnMuccText.mockResolvedValue('1.14.2');
  });

  it('capability-gates companion-client and experimental workflows', async () => {
    mockState.runSvn.mockResolvedValue({ code: 0, stdout: 'shelve help', stderr: '' });
    await expect(getSvnCapabilities()).resolves.toEqual({
      shelving: true,
      nativeShelving: true,
      remoteProperties: true,
    });

    mockState.runSvnMuccText.mockRejectedValue(new Error('svnmucc unavailable'));
    await expect(getSvnCapabilities()).resolves.toEqual({
      shelving: true,
      nativeShelving: true,
      remoteProperties: false,
    });
  });

  it('reports the SVN 1.14 advanced workflow baseline', async () => {
    const diagnostics = await getDiagnostics('C:\\wc');

    expect(diagnostics.minimumSvnVersion).toBe('1.14');
    expect(diagnostics.svnVersion).toBe('1.14.2');
    expect(diagnostics.svnVersionSupported).toBe(true);
    expect(diagnostics.svnVersionWarning).toBeUndefined();
  });

  it('flags SVN versions below the advanced workflow baseline', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === '--version') return '1.13.0\n';
      throw new Error('not a working copy');
    });

    const diagnostics = await getDiagnostics('C:\\wc');

    expect(diagnostics.svnVersionSupported).toBe(false);
    expect(diagnostics.svnVersionWarning).toBe(
      'SVN 1.14.x or newer is required for advanced workflows.'
    );
  });

  it.each([
    'http://svn.example.com/repo',
    'svn://svn.example.com/repo',
    'svn+ssh://svn.example.com/repo',
    'file:///tmp/repository',
  ])('does not initialize HTTPS trust storage for %s', async (url) => {
    await expect(trustServerCertificate(url, 'certificate expired')).resolves.toEqual({
      success: false,
      error: 'Server-certificate trust is only available for HTTPS repository URLs.',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
    expect(mockState.sslReady).not.toHaveBeenCalled();
    expect(mockState.sslSet).not.toHaveBeenCalled();
  });

  /*
   * Windows binary-name resolution. getDiagnosticResourceStatus probes the
   * bundled binaries with a .exe suffix on win32 and no suffix elsewhere.
   * The resource paths are returned in diagnostics.resourceStatus, so the
   * platform branch can be pinned without mocking the filesystem (the files
   * simply read as absent).
   */
  describe('resource binary names — Windows', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
    });

    it('probes svn.exe and shelly-engine.exe on Windows', async () => {
      const diagnostics = await getDiagnostics('C:\\wc');
      const paths = diagnostics.resourceStatus.map((entry) => entry.path);

      expect(paths.some((path) => path.endsWith('svn.exe'))).toBe(true);
      expect(paths.some((path) => path.endsWith('shelly-engine.exe'))).toBe(true);
    });
  });

  describe('resource binary names — POSIX (platform boundary)', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
    });

    it('probes extension-less binaries on POSIX', async () => {
      const diagnostics = await getDiagnostics('/wc');
      const paths = diagnostics.resourceStatus.map((entry) => entry.path);

      expect(paths.some((path) => path.endsWith('svn'))).toBe(true);
      expect(paths.some((path) => path.endsWith('shelly-engine'))).toBe(true);
      // No Windows .exe suffix on POSIX.
      expect(paths.some((path) => path.endsWith('.exe'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Network security diagnostics + certificate trust flow (items #37 / #38)
  // -------------------------------------------------------------------------

  describe('networkSecurity diagnostics (item #37)', () => {
    function mockWorkingCopyConnected() {
      mockState.runSvnText.mockImplementation(async (args: string[]) => {
        if (args[0] === '--version') return '1.14.2\n';
        if (args[0] === 'info') {
          return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<info>' +
            '<entry kind="dir" path="/wc" revision="1">' +
            '<url>https://svn.example.com/repo/trunk</url>' +
            '<repository><root>https://svn.example.com/repo</root><uuid>u-1</uuid></repository>' +
            '<wc-info><wcroot-abspath>/wc</wcroot-abspath></wc-info>' +
            '</entry></info>'
          );
        }
        if (args[0] === 'list') return '<?xml version="1.0"?><lists><list></list></lists>';
        throw new Error(`unexpected svn call: ${args.join(' ')}`);
      });
    }

    it('reports the active authenticated proxy and client cert without any secrets', async () => {
      mockWorkingCopyConnected();
      mockState.getSvnExecutionContext.mockReturnValue({
        proxySettings: {
          enabled: true,
          host: 'proxy.corp.example',
          port: 8080,
          username: 'svc-svn',
          password: 'hunter2',
          bypassForLocal: true,
        },
        connectionTimeout: 30,
        sslVerify: true,
        clientCertificatePath: '/certs/alice.p12',
      });
      mockState.sslListTrustedOrigins.mockReturnValue(['https://svn.example.com']);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.connectionStatus).toBe('ok');
      expect(diagnostics.networkSecurity.proxy).toEqual({
        active: true,
        host: 'proxy.corp.example',
        port: 8080,
        authenticated: true,
        bypassesLocalAddresses: true,
      });
      expect(diagnostics.networkSecurity.clientCertificate).toEqual({
        configured: true,
        path: '/certs/alice.p12',
      });
      expect(diagnostics.networkSecurity.ssl).toEqual({
        verificationEnabled: true,
        trustedOrigins: ['https://svn.example.com'],
      });

      // REDACTION PROOF: neither the proxy password nor the username may appear
      // anywhere in the serialized diagnostics payload.
      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain('hunter2');
      expect(serialized).not.toContain('svc-svn');
    });

    it('reports proxy and client cert as inactive when unconfigured', async () => {
      mockWorkingCopyConnected();

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.networkSecurity.proxy).toEqual({
        active: false,
        host: null,
        port: null,
        authenticated: false,
        bypassesLocalAddresses: false,
      });
      expect(diagnostics.networkSecurity.clientCertificate).toEqual({
        configured: false,
        path: null,
      });
    });

    it('still produces a networkSecurity section when settings cannot be read', async () => {
      mockWorkingCopyConnected();
      mockState.getSvnExecutionContext.mockImplementation(() => {
        throw new Error('settings unavailable');
      });

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.networkSecurity.proxy.active).toBe(false);
      expect(diagnostics.networkSecurity.ssl.verificationEnabled).toBe(true);
      expect(JSON.stringify(diagnostics)).not.toContain('settings unavailable');
    });
  });

  describe('ssl-error diagnostics with structured classification (item #38)', () => {
    function mockWorkingCopyWithConnectionFailure(stderr: string) {
      mockState.runSvnText.mockImplementation(async (args: string[]) => {
        if (args[0] === '--version') return '1.14.2\n';
        if (args[0] === 'info') {
          return (
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<info><entry kind="dir" path="/wc" revision="1">' +
            '<url>https://svn.example.com/repo/trunk</url>' +
            '<repository><root>https://svn.example.com/repo</root><uuid>u-1</uuid></repository>' +
            '</entry></info>'
          );
        }
        if (args[0] === 'list') throw new Error(stderr);
        throw new Error(`unexpected svn call: ${args.join(' ')}`);
      });
    }

    it('classifies a self-signed certificate failure with prompt eligibility', async () => {
      mockWorkingCopyWithConnectionFailure(SELF_SIGNED_STDERR);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.connectionStatus).toBe('ssl-error');
      expect(diagnostics.networkSecurity.ssl.failure).toEqual({
        failureKind: 'unknown-ca',
        failureKinds: ['unknown-ca'],
        host: 'svn.example.com',
        rawMessage: SELF_SIGNED_STDERR,
        trustState: 'untrusted',
        promptEligible: true,
      });
    });

    it('labels a rejected stored credential as an actionable auth failure', async () => {
      mockState.findForUrl.mockReturnValue({
        username: 'jordan',
        password: 'whatever',
        realm: 'https://svn.example.com/repo',
      });
      mockWorkingCopyWithConnectionFailure(AUTH_FAILED_STDERR);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.connectionStatus).toBe('auth-required');
      expect(diagnostics.connectionError).toContain('stored credential');
      expect(diagnostics.connectionError).toContain('jordan');
      expect(diagnostics.connectionError).toContain(AUTH_FAILED_STDERR);
      // Debug details: the exact credential the probe used.
      expect(diagnostics.connectionError).toContain('Attempted with the saved credential:');
      expect(diagnostics.connectionError).toContain('username: jordan');
      expect(diagnostics.connectionError).toContain('password: [hidden] (8 characters)');
      expect(diagnostics.connectionError).not.toContain('whatever');
      expect(diagnostics.hasCredentials).toBe(true);
    });

    it('reports plain authentication required when no credential is stored', async () => {
      mockState.findForUrl.mockReturnValue(null);
      mockWorkingCopyWithConnectionFailure(AUTH_FAILED_STDERR);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.connectionStatus).toBe('auth-required');
      expect(diagnostics.connectionError).toContain('Attempted without saved credentials');
      expect(diagnostics.connectionError).toContain(AUTH_FAILED_STDERR);
    });

    it('never prints the attempted password and still flags edge whitespace', async () => {
      mockState.findForUrl.mockReturnValue({
        username: 'jordan',
        password: ' ab"cd ',
        realm: 'https://svn.example.com/repo',
      });
      mockWorkingCopyWithConnectionFailure(AUTH_FAILED_STDERR);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.connectionError).toContain(
        'password: [hidden] (7 characters — has leading/trailing whitespace)'
      );
      expect(diagnostics.connectionError).not.toContain('ab"cd');
    });
    it('keeps expired certificates distinguishable from plain unknown-ca', async () => {
      mockWorkingCopyWithConnectionFailure(EXPIRED_STDERR);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.networkSecurity.ssl.failure?.failureKind).toBe('expired');
      expect(diagnostics.networkSecurity.ssl.failure?.failureKinds).toEqual([
        'expired',
        'unknown-ca',
      ]);
    });

    it('marks the failure as not prompt-eligible once prompted this session', async () => {
      mockWorkingCopyWithConnectionFailure(SELF_SIGNED_STDERR);
      mockState.sslHasPrompted.mockReturnValue(true);

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.networkSecurity.ssl.failure?.promptEligible).toBe(false);
    });

    it('reports a cached rejection with promptEligible=false', async () => {
      mockWorkingCopyWithConnectionFailure(SELF_SIGNED_STDERR);
      mockState.sslFindDecisionForUrl.mockReturnValue({
        realm: 'https://svn.example.com/repo',
        decision: 'rejected',
        failures: 'unknown-ca',
        failureKind: 'unknown-ca',
      });

      const diagnostics = await getDiagnostics('/wc');

      expect(diagnostics.networkSecurity.ssl.failure?.trustState).toBe('rejected');
      expect(diagnostics.networkSecurity.ssl.failure?.promptEligible).toBe(false);
    });
  });

  describe('trustServerCertificate (item #38)', () => {
    it('refuses to trust a failure it cannot classify', async () => {
      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        "svn: E175015: The HTTP method 'OPTIONS' is not allowed on '/'"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to classify');
      expect(mockState.runSvnText).not.toHaveBeenCalled();
      expect(mockState.sslRecordDecision).not.toHaveBeenCalled();
      expect(mockState.sslMarkPrompted).not.toHaveBeenCalled();
    });

    it('verifies then records an accepted decision with the classified failures', async () => {
      mockState.runSvnText.mockResolvedValue('');

      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        SELF_SIGNED_STDERR
      );

      expect(result.success).toBe(true);
      expect(result.failureKind).toBe('unknown-ca');
      expect(mockState.sslMarkPrompted).toHaveBeenCalledTimes(1);

      const verificationCall = mockState.runSvnText.mock.calls.find(
        (call) => call[0][0] === 'info'
      );
      expect(verificationCall?.[1]).toMatchObject({
        trustSslFailures: true,
        trustedSslFailures: 'unknown-ca',
      });
      expect(mockState.sslRecordDecision).toHaveBeenCalledWith(
        'https://svn.example.com/repo',
        expect.objectContaining({ failureKind: 'unknown-ca', host: 'svn.example.com' }),
        'accepted'
      );
    });

    it('trusts the full combined failure list for an expired certificate', async () => {
      mockState.runSvnText.mockResolvedValue('');

      const result = await trustServerCertificate('https://svn.example.com/repo', EXPIRED_STDERR);

      expect(result.success).toBe(true);
      expect(result.failureKind).toBe('expired');
      const verificationCall = mockState.runSvnText.mock.calls.find(
        (call) => call[0][0] === 'info'
      );
      expect(verificationCall?.[1]).toMatchObject({
        trustedSslFailures: 'expired,unknown-ca',
      });
    });

    it('still caches the trust when verification only hits an authentication error', async () => {
      mockState.runSvnText.mockRejectedValue(new Error('Authentication error from server'));

      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        SELF_SIGNED_STDERR
      );

      expect(result.success).toBe(true);
      expect(mockState.sslRecordDecision).toHaveBeenCalledWith(
        'https://svn.example.com/repo',
        expect.objectContaining({ failureKind: 'unknown-ca' }),
        'accepted'
      );
    });

    it('records a rejection when verification still fails on certificate grounds', async () => {
      mockState.runSvnText.mockRejectedValue(new Error(SELF_SIGNED_STDERR));

      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        SELF_SIGNED_STDERR
      );

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('unknown-ca');
      expect(mockState.sslRecordDecision).toHaveBeenCalledWith(
        'https://svn.example.com/repo',
        expect.objectContaining({ failureKind: 'unknown-ca' }),
        'rejected'
      );
    });

    it('fails fast on a cached rejection without re-running svn (no retry loop)', async () => {
      mockState.sslFindDecisionForUrl.mockReturnValue({
        realm: 'https://svn.example.com/repo',
        decision: 'rejected',
        failures: 'unknown-ca',
        failureKind: 'unknown-ca',
      });
      mockState.runSvnText.mockResolvedValue('');

      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        SELF_SIGNED_STDERR
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('previously rejected');
      expect(result.failureKind).toBe('unknown-ca');
      // The decisive property: no svn verification ran at all.
      expect(mockState.runSvnText).not.toHaveBeenCalled();
      expect(mockState.sslRecordDecision).not.toHaveBeenCalled();
    });

    it('refuses to trust failures outside the trustable kinds (e.g. revoked)', async () => {
      const result = await trustServerCertificate(
        'https://svn.example.com/repo',
        'svn: E230001: Server SSL certificate verification failed: certificate revoked'
      );

      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('other');
      expect(mockState.runSvnText).not.toHaveBeenCalled();
      expect(mockState.sslRecordDecision).not.toHaveBeenCalled();
    });
  });

  describe('rejectServerCertificate (item #38)', () => {
    it('records a typed rejection for a classified failure', async () => {
      const result = await rejectServerCertificate('https://svn.example.com/repo', EXPIRED_STDERR);

      expect(result.success).toBe(true);
      expect(result.failureKind).toBe('expired');
      expect(mockState.sslMarkPrompted).toHaveBeenCalledTimes(1);
      expect(mockState.sslRecordDecision).toHaveBeenCalledWith(
        'https://svn.example.com/repo',
        expect.objectContaining({ failureKind: 'expired' }),
        'rejected'
      );
      expect(mockState.runSvnText).not.toHaveBeenCalled();
    });

    it('refuses unclassifiable input', async () => {
      const result = await rejectServerCertificate('https://svn.example.com/repo', 'E170013');

      expect(result.success).toBe(false);
      expect(mockState.sslRecordDecision).not.toHaveBeenCalled();
    });
  });
});
