// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAccess = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPath = vi.hoisted(() => vi.fn().mockReturnValue('C:\\Users\\test\\AppData\\ShellySVN'));
const mockIsEncryptionAvailable = vi.hoisted(() => vi.fn().mockReturnValue(true));

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')),
  },
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { SettingsManager } from '../settings-manager';

function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance: unknown }).instance = null;
}

describe('SettingsManager migration and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsManager();
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{}');
    mockWriteFile.mockResolvedValue(undefined);
    mockIsEncryptionAvailable.mockReturnValue(true);
  });

  it('deep-merges old settings files with current defaults', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        settings: {
          theme: 'dark',
          proxySettings: {
            enabled: true,
            host: 'proxy.example.com',
          },
          diffMerge: {
            ignoreWhitespace: true,
          },
          dialogs: {
            logMessagesPerPage: 50,
          },
        },
      })
    );

    const manager = SettingsManager.getInstance();
    await manager.ready();
    const settings = manager.getSettings();

    expect(settings.theme).toBe('dark');
    expect(settings.proxySettings).toMatchObject({
      enabled: true,
      host: 'proxy.example.com',
      port: 8080,
      bypassForLocal: true,
    });
    expect(settings.diffMerge).toMatchObject({
      ignoreWhitespace: true,
      externalDiffTool: '',
      externalMergeTool: '',
      externalToolOverrides: [],
      contextLines: 3,
    });
    expect(settings.dialogs).toMatchObject({
      logMessagesPerPage: 50,
      rememberPositions: true,
      rememberSizes: true,
    });
    expect(settings.notifications.enableSystemNotifications).toBe(true);
    expect(settings.integration.contextMenuItems).toContain('checkout');
  });

  it('preserves sibling fields when nested settings are partially updated', async () => {
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({
      diffMerge: {
        ignoreWhitespace: true,
      },
    });

    const settings = manager.getSettings();
    expect(settings.diffMerge.ignoreWhitespace).toBe(true);
    expect(settings.diffMerge.externalDiffTool).toBe('');
    expect(settings.diffMerge.externalMergeTool).toBe('');
    expect(settings.diffMerge.externalToolOverrides).toEqual([]);
    expect(settings.diffMerge.contextLines).toBe(3);
    expect(mockWriteFile).toHaveBeenCalled();
  });
});
