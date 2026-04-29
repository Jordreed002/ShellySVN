// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  findForUrl: vi.fn(),
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
  getSvnClientPath: vi.fn().mockReturnValue('svn'),
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

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import { getDiagnostics } from '../svn-diagnostics';

describe('svn-diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === '--version') return '1.14.2\n';
      throw new Error('not a working copy');
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
});
