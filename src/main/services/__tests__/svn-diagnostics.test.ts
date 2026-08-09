// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  runSvnMuccText: vi.fn(),
  findForUrl: vi.fn(),
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
  getSvnClientPath: vi.fn().mockReturnValue('svn'),
  sslReady: vi.fn(),
  sslSet: vi.fn(),
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
  }),
}));

vi.mock('../../ssl-trust-cache', () => ({
  getSslTrustCache: () => ({
    ready: mockState.sslReady,
    set: mockState.sslSet,
  }),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
  runSvnMuccText: mockState.runSvnMuccText,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { getDiagnostics, getSvnCapabilities, trustServerCertificate } from '../svn-diagnostics';

describe('svn-diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === '--version') return '1.14.2\n';
      throw new Error('not a working copy');
    });
    mockState.runSvnMuccText.mockResolvedValue('1.14.2');
  });

  it('capability-gates companion-client and experimental workflows', async () => {
    mockState.runSvnText.mockResolvedValue('shelve help');
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
});
