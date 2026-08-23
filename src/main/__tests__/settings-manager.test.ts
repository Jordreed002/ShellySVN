// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAccess = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockChmod = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteSecureJson = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPath = vi.hoisted(() =>
  vi.fn().mockReturnValue('C:\\Users\\test\\AppData\\ShellySVN')
);
const mockIsEncryptionAvailable = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockGetSelectedStorageBackend = vi.hoisted(() => vi.fn().mockReturnValue('gnome_libsecret'));
const mockEncryptString = vi.hoisted(() =>
  vi.fn((value: string) => Buffer.from(`encrypted:${value}`))
);
const mockDecryptString = vi.hoisted(() =>
  vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''))
);
const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockStatSync = vi.hoisted(() => vi.fn());
const mockAccessSync = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());
const mockAssertPathApproved = vi.hoisted(() => vi.fn((path: string) => path));

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
  },
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    getSelectedStorageBackend: mockGetSelectedStorageBackend,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString,
  },
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  chmod: mockChmod,
}));

vi.mock('../utils/secure-json', () => ({ writeSecureJson: mockWriteSecureJson }));

vi.mock('fs', () => ({
  accessSync: mockAccessSync,
  constants: { X_OK: 1 },
  existsSync: mockExistsSync,
  statSync: mockStatSync,
}));

vi.mock('child_process', () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock('../utils/approved-paths', () => ({
  assertPathApprovedForIpc: mockAssertPathApproved,
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
    mockWriteSecureJson.mockResolvedValue(undefined);
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockGetSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    mockEncryptString.mockImplementation((value: string) => Buffer.from(`encrypted:${value}`));
    mockDecryptString.mockImplementation((value: Buffer) =>
      value.toString('utf8').replace(/^encrypted:/, '')
    );
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReset();
    mockAccessSync.mockReset();
    mockSpawnSync.mockReset();
    mockAssertPathApproved.mockImplementation((path: string) => path);
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
    expect(mockWriteSecureJson).toHaveBeenCalled();
  });

  it('persists proxy passwords only as OS-encrypted values', async () => {
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({
      proxySettings: {
        enabled: true,
        host: 'proxy.example.com',
        password: 'do-not-write-plaintext',
      },
    });

    const persisted = mockWriteSecureJson.mock.calls.at(-1)?.[1] as {
      settings: { proxySettings: { password: string } };
    };
    expect(persisted.settings.proxySettings.password).toMatch(/^enc:/);
    expect(persisted.settings.proxySettings.password).not.toContain('do-not-write-plaintext');
    expect(mockEncryptString).toHaveBeenCalledWith('do-not-write-plaintext');
  });

  it('drops proxy passwords from persistence when encryption is unavailable', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    resetSettingsManager();
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({
      proxySettings: { password: 'session-only-secret' },
    });

    const persisted = mockWriteSecureJson.mock.calls.at(-1)?.[1] as {
      settings: { proxySettings: { password: string } };
    };
    expect(persisted.settings.proxySettings.password).toBe('');
    expect(mockEncryptString).not.toHaveBeenCalled();
  });

  it('keeps proxy passwords session-only with the Linux basic_text backend', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
      writable: true,
    });
    mockGetSelectedStorageBackend.mockReturnValue('basic_text');
    resetSettingsManager();

    try {
      const manager = SettingsManager.getInstance();
      await manager.ready();
      await manager.updateSettings({
        proxySettings: { password: 'session-only-secret' },
      });

      const persisted = mockWriteSecureJson.mock.calls.at(-1)?.[1] as {
        settings: { proxySettings: { password: string } };
      };
      expect(persisted.settings.proxySettings.password).toBe('');
      expect(manager.getSettings().proxySettings.password).toBe('session-only-secret');
      expect(mockEncryptString).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
        writable: true,
      });
      resetSettingsManager();
    }
  });

  it('fails closed instead of persisting plaintext when OS encryption throws', async () => {
    mockEncryptString.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({
      proxySettings: { password: 'must-remain-session-only' },
    });

    const persisted = mockWriteSecureJson.mock.calls.at(-1)?.[1] as {
      settings: { proxySettings: { password: string } };
    };
    expect(persisted.settings.proxySettings.password).toBe('');
    expect(JSON.stringify(persisted)).not.toContain('must-remain-session-only');
    expect(manager.getSettings().proxySettings.password).toBe('must-remain-session-only');
  });

  /*
   * Legacy plaintext migration. Settings written before OS encryption shipped
   * keep the proxy password as raw plaintext in shellysvn-config.json. On
   * first load the value must be re-encrypted (or scrubbed when safeStorage is
   * unavailable) and the store rewritten, so no plaintext copy survives on
   * disk. The serialized-store scan below is the guard for backlog item 3:
   * after migration, no password value may appear in the persisted JSON
   * unless it is `enc:`-prefixed ciphertext.
   */
  describe('legacy proxy password migration', () => {
    const legacyPlaintext = 'legacy-plaintext-proxy-password';

    function persistedStore(): { serialized: string; persisted: Record<string, unknown> } {
      const persisted = mockWriteSecureJson.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      return { serialized: JSON.stringify(persisted), persisted };
    }

    function passwordValuesIn(serialized: string): string[] {
      return [...serialized.matchAll(/"password":\s*"([^"]*)"/g)].map((match) => match[1]);
    }

    it('re-encrypts a legacy plaintext proxy password on first load', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          settings: {
            proxySettings: {
              enabled: true,
              host: 'proxy.example.com',
              username: 'proxy-user',
              password: legacyPlaintext,
            },
          },
        })
      );
      const manager = SettingsManager.getInstance();
      await manager.ready();
      // save() is serialized-but-async; flush the migration rewrite.
      await vi.waitFor(() => expect(mockWriteSecureJson).toHaveBeenCalled());

      // The credential survives for the session...
      expect(manager.getSettings().proxySettings.password).toBe(legacyPlaintext);
      expect(mockEncryptString).toHaveBeenCalledWith(legacyPlaintext);

      // ...and the persisted store only contains the ciphertext copy.
      const { serialized, persisted } = persistedStore();
      const passwordValues = passwordValuesIn(serialized);
      expect(passwordValues).toHaveLength(1);
      expect(passwordValues[0].startsWith('enc:')).toBe(true);
      expect(serialized).not.toContain(legacyPlaintext);
      expect(
        (persisted as { settings: { proxySettings: { password: string } } }).settings
          .proxySettings.password
      ).toMatch(/^enc:/);
    });

    it('is idempotent: already-encrypted passwords are decrypted without a rewrite', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          settings: {
            proxySettings: {
              enabled: true,
              password: `enc:${Buffer.from('encrypted:stored-secret').toString('base64')}`,
            },
          },
        })
      );
      const manager = SettingsManager.getInstance();
      await manager.ready();

      expect(manager.getSettings().proxySettings.password).toBe('stored-secret');
      expect(mockWriteSecureJson).not.toHaveBeenCalled();
    });

    it('scrubs legacy plaintext from disk when encryption is unavailable', async () => {
      mockIsEncryptionAvailable.mockReturnValue(false);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          settings: { proxySettings: { enabled: true, password: legacyPlaintext } },
        })
      );
      const manager = SettingsManager.getInstance();
      await manager.ready();
      await vi.waitFor(() => expect(mockWriteSecureJson).toHaveBeenCalled());

      // Fail closed: the password cannot be preserved without a keychain, so
      // it is dropped everywhere instead of being re-persisted as plaintext.
      expect(manager.getSettings().proxySettings.password).toBe('');
      expect(mockEncryptString).not.toHaveBeenCalled();

      const { serialized } = persistedStore();
      expect(serialized).not.toContain(legacyPlaintext);
      expect(passwordValuesIn(serialized)).toEqual(['']);
    });

    it('drops undecryptable encrypted passwords from memory without rewriting the store', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          settings: {
            proxySettings: {
              enabled: true,
              password: `enc:${Buffer.from('encrypted:rotting-entry').toString('base64')}`,
            },
          },
        })
      );
      mockDecryptString.mockImplementationOnce(() => {
        throw new Error('keychain changed');
      });
      const manager = SettingsManager.getInstance();
      await manager.ready();

      expect(manager.getSettings().proxySettings.password).toBe('');
      // Ciphertext is not plaintext: the unusable copy is left alone rather
      // than triggering a rewrite on every launch.
      expect(mockWriteSecureJson).not.toHaveBeenCalled();
    });
  });

  it('accepts an approved cache directory and bounded log-cache size', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({
      logCachePath: '/approved/cache',
      maxLogCacheSize: 250,
    });

    expect(manager.getSettings()).toMatchObject({
      logCachePath: '/approved/cache',
      maxLogCacheSize: 250,
    });
    expect(mockAssertPathApproved).toHaveBeenCalledWith(
      '/approved/cache',
      'Custom SVN cache storage'
    );
  });

  it('rejects unapproved or out-of-range cache settings', async () => {
    const manager = SettingsManager.getInstance();
    await manager.ready();
    mockAssertPathApproved.mockImplementation(() => {
      throw new Error('not approved');
    });

    await expect(manager.updateSettings({ logCachePath: '/unapproved/cache' })).rejects.toThrow(
      'not approved'
    );
    await expect(manager.updateSettings({ maxLogCacheSize: 1 })).rejects.toThrow(
      'between 10 and 1000 MB'
    );
  });

  it('validates an approved custom SVN executable once and revalidates after replacement', async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 1024,
      mtimeMs: 10,
    });
    mockSpawnSync.mockReturnValue({ status: 0 });
    const manager = SettingsManager.getInstance();
    await manager.ready();

    await manager.updateSettings({ svnClientPath: '/approved/svn' });
    expect(manager.getSvnClientPath()).toBe('/approved/svn');
    expect(manager.getSvnClientPath()).toBe('/approved/svn');
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);

    mockStatSync.mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 2048,
      mtimeMs: 20,
    });
    expect(manager.getSvnClientPath()).toBe('/approved/svn');
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  /*
   * Windows executable rules for the custom SVN client. validateSvnClientPath
   * skips accessSync(X_OK) on win32 (no execute bit), refuses script wrappers
   * (.cmd/.bat/...) exactly as it does for external tools, and getSvnClientPath
   * falls back to the platform default ('svn.exe' on win32) when validation
   * fails. The default is platform-dependent too.
   */
  describe('custom SVN client validation — Windows executable rules', () => {
    const originalPlatform = process.platform;

    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
        mtimeMs: 10,
      });
      mockSpawnSync.mockReturnValue({ status: 0 });
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

    it('defaults to svn.exe on Windows when no custom client is configured', async () => {
      const manager = SettingsManager.getInstance();
      await manager.ready();
      expect(manager.getSvnClientPath()).toBe('svn.exe');
    });

    it('skips the execute-bit (X_OK) check on Windows', async () => {
      const manager = SettingsManager.getInstance();
      await manager.ready();
      await manager.updateSettings({ svnClientPath: 'C:\\tools\\svn.exe' });

      expect(manager.getSvnClientPath()).toBe('C:\\tools\\svn.exe');
      expect(mockAccessSync).not.toHaveBeenCalled();
    });

    it('rejects a .cmd wrapper at write time and keeps the svn.exe default', async () => {
      const manager = SettingsManager.getInstance();
      await manager.ready();

      // updateSettings validates synchronously and refuses script wrappers.
      await expect(manager.updateSettings({ svnClientPath: 'C:\\tools\\svn.cmd' })).rejects.toThrow(
        'native executables, not scripts'
      );

      // The invalid path was never stored, so the default still applies.
      expect(manager.getSvnClientPath()).toBe('svn.exe');
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('custom SVN client validation — POSIX executable rules', () => {
    const originalPlatform = process.platform;

    beforeEach(async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
        mtimeMs: 10,
      });
      mockSpawnSync.mockReturnValue({ status: 0 });
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

    it('checks X_OK on POSIX and defaults to svn (no .exe)', async () => {
      const manager = SettingsManager.getInstance();
      await manager.ready();
      await manager.updateSettings({ svnClientPath: '/usr/local/bin/svn' });

      expect(manager.getSvnClientPath()).toBe('/usr/local/bin/svn');
      expect(mockAccessSync).toHaveBeenCalled();
    });
  });
});
