import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    fullChangelog: true,
    allowPrerelease: false,
    allowDowngrade: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return updater;
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    removeAllListeners: () => listeners.clear(),
  };
  return {
    isPackaged: true,
    settings: { checkUpdatesOnStartup: false, updateChannel: 'stable' as 'stable' | 'preview' },
    activeMutation: false,
    activeProgress: false,
    updater,
  };
});

const updater = mocks.updater;

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getVersion: () => '1.1.0-beta.2',
    getPath: () => '/tmp',
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: mocks.updater,
    CancellationToken: class {
      cancelled = false;
      cancel() {
        this.cancelled = true;
      }
    },
  },
}));

vi.mock('fs/promises', () => {
  const methods = {
    appendFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error('missing')),
  };
  return { ...methods, default: methods };
});

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: vi.fn().mockResolvedValue(undefined),
    getSettings: () => mocks.settings,
    addListener: vi.fn().mockReturnValue(() => {}),
  }),
}));

vi.mock('../svn-mutation-queue', () => ({
  hasActiveWorkingCopyMutations: () => mocks.activeMutation,
}));
vi.mock('../svn-progress', () => ({
  hasActiveSvnProgressOperations: () => mocks.activeProgress,
}));

import { UpdateService } from '../update-service';

describe('UpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPackaged = true;
    mocks.settings = { checkUpdatesOnStartup: false, updateChannel: 'stable' };
    mocks.activeMutation = false;
    mocks.activeProgress = false;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    delete process.env.PORTABLE_EXECUTABLE_FILE;
    if (process.platform === 'linux') {
      process.env.APPIMAGE = '/tmp/ShellySVN.AppImage';
    }
    updater.removeAllListeners();
  });

  it('reports unpackaged applications as manual-update installations', () => {
    mocks.isPackaged = false;
    expect(new UpdateService().getState()).toMatchObject({
      status: 'unsupported',
      reason: 'unpackaged',
    });
  });

  it('checks the stable channel without enabling downgrade', async () => {
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-not-available', { version: '1.1.0-beta.2' });
      return null;
    });
    const service = new UpdateService();
    await service.initialize();

    await expect(service.check('manual')).resolves.toMatchObject({ status: 'upToDate' });
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
  });

  it('opts preview users into prereleases without allowing downgrade', async () => {
    mocks.settings = { checkUpdatesOnStartup: false, updateChannel: 'preview' };
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', {
        version: '1.1.0-rc.1',
        files: [],
        path: '',
        sha512: '',
        releaseDate: '2026-08-01T00:00:00Z',
      });
      return null;
    });
    const service = new UpdateService();
    await service.initialize();

    await expect(service.check('manual')).resolves.toMatchObject({
      status: 'available',
      availableVersion: '1.1.0-rc.1',
    });
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
  });

  it('does not restart while an SVN mutation is active', async () => {
    const service = new UpdateService();
    await service.initialize();
    updater.emit('update-downloaded', {
      version: '1.1.0',
      files: [],
      path: '',
      sha512: '',
      releaseDate: '2026-08-02T00:00:00Z',
    });
    mocks.activeMutation = true;

    expect(service.restartAndInstall()).toEqual({
      started: false,
      reason: 'svn-operation-active',
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('collapses concurrent checks into one updater request', async () => {
    let finishCheck: (() => void) | undefined;
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          finishCheck = () => {
            updater.emit('update-not-available', { version: '1.1.0-beta.2' });
            resolve(null);
          };
        })
    );
    const service = new UpdateService();
    await service.initialize();

    const first = service.check('manual');
    const second = service.check('manual');
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    finishCheck?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'upToDate' }),
      expect.objectContaining({ status: 'upToDate' }),
    ]);
  });

  it('does not download or restart before an update is available and downloaded', async () => {
    const service = new UpdateService();
    await service.initialize();

    await expect(service.download()).resolves.toMatchObject({ status: 'idle' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.restartAndInstall()).toEqual({
      started: false,
      reason: 'not-downloaded',
    });
  });

  it('redacts network response details before exposing an error state', async () => {
    updater.checkForUpdates.mockRejectedValue(
      new Error(
        'GET https://updates.example.test/private Headers: authorization: secret /Users/alice/token'
      )
    );
    const service = new UpdateService();
    await service.initialize();

    const state = await service.check('manual');
    expect(state).toMatchObject({ status: 'error', source: 'manual', code: 'network' });
    expect('message' in state ? state.message : '').not.toMatch(
      /updates\.example|secret|Users\/alice/
    );
  });
});
