import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getState: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  cancelDownload: vi.fn(),
  restartAndInstall: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../services/update-service', () => ({
  getUpdateService: () => ({
    getState: mocks.getState,
    check: mocks.check,
    download: mocks.download,
    cancelDownload: mocks.cancelDownload,
    restartAndInstall: mocks.restartAndInstall,
  }),
}));

import { registerUpdaterHandlers } from '../updater';

describe('updater IPC handlers', () => {
  const handlers = new Map<string, () => unknown>();

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mocks.handle.mockImplementation((channel: string, handler: () => unknown) => {
      handlers.set(channel, handler);
    });
    registerUpdaterHandlers();
  });

  it('registers only the fixed updater command surface', () => {
    expect([...handlers.keys()]).toEqual([
      'updater:getState',
      'updater:check',
      'updater:download',
      'updater:cancelDownload',
      'updater:restartAndInstall',
    ]);
  });

  it('does not accept renderer-supplied feed or installer arguments', async () => {
    await handlers.get('updater:check')?.();
    await handlers.get('updater:download')?.();
    await handlers.get('updater:restartAndInstall')?.();

    expect(mocks.check).toHaveBeenCalledWith('manual');
    expect(mocks.download).toHaveBeenCalledWith();
    expect(mocks.restartAndInstall).toHaveBeenCalledWith();
  });
});
