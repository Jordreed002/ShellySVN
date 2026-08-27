/**
 * Settings Manager for Main Process
 *
 * Provides cached access to application settings for SVN operations
 * and other main process modules.
 *
 * This solves the issue where settings UI exists but wasn't connected
 * to the actual SVN command execution.
 *
 * SECURITY: Sensitive fields like proxy password are encrypted using
 * electron's safeStorage before being persisted to disk. Legacy plaintext
 * values found in pre-encryption settings files are migrated (re-encrypted)
 * or scrubbed on first load — see migrateProxyPassword().
 */

import { app, safeStorage } from 'electron';
import { readFile, access, chmod } from 'fs/promises';
import { accessSync, constants, existsSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import type { AppSettings, SvnExecutionContext, ProxySettings } from '@shared/types';
import { mergeDeep, mergeSettings, DEFAULT_SETTINGS } from '@shared/settings-defaults';

/**
 * The connectionTimeout default before it was raised to 300s in the same
 * release; a stored value of exactly this is migrated up on load.
 */
const LEGACY_CONNECTION_TIMEOUT = 30;
import {
  KNOWN_DIFF_TOOL_ALIASES,
  KNOWN_MERGE_TOOL_ALIASES,
  validateExternalToolSetting,
} from './utils/external-tool-validation';
import { assertPathApprovedForIpc } from './utils/approved-paths';
import { writeSecureJson } from './utils/secure-json';
import {
  ENCRYPTED_VALUE_PREFIX,
  decryptSecret,
  encryptSecret,
  isSecureStorageAvailable,
} from './utils/secure-storage';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

/**
 * Settings Manager - Singleton class that manages app settings
 * and provides them to SVN operations
 */
class SettingsManager {
  private static instance: SettingsManager | null = null;
  private filePath: string;
  private settings: AppSettings;
  private loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();
  private listeners: Set<(settings: AppSettings) => void> = new Set();
  private encryptionAvailable: boolean;
  private validatedSvnClient: { path: string; size: number; modifiedAt: number } | null = null;

  private constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, 'shellysvn-config.json');
    this.settings = mergeSettings();
    this.encryptionAvailable = isSecureStorageAvailable(safeStorage);
    this.loadPromise = this.load();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * Load settings from disk
   */
  private async load(): Promise<void> {
    try {
      await access(this.filePath);
      if (process.platform !== 'win32') await chmod(this.filePath, 0o600);
      const content = await readFile(this.filePath, 'utf-8');
      const stored = JSON.parse(content);
      // Merge with defaults to ensure all fields exist
      this.settings = mergeSettings(stored.settings || stored);

      const safeToolId = (value: string, allowedAliases: ReadonlySet<string>) =>
        allowedAliases.has(value.toLowerCase()) || value.startsWith('registered:') ? value : '';
      this.settings.diffMerge.externalDiffTool = safeToolId(
        this.settings.diffMerge.externalDiffTool,
        KNOWN_DIFF_TOOL_ALIASES
      );
      this.settings.diffMerge.externalMergeTool = safeToolId(
        this.settings.diffMerge.externalMergeTool,
        KNOWN_MERGE_TOOL_ALIASES
      );
      this.settings.diffMerge.externalToolOverrides = this.settings.diffMerge.externalToolOverrides
        .map((override) => ({
          ...override,
          diffTool: safeToolId(override.diffTool, KNOWN_DIFF_TOOL_ALIASES),
          mergeTool: safeToolId(override.mergeTool, KNOWN_MERGE_TOOL_ALIASES),
        }))
        .filter((override) => override.diffTool || override.mergeTool);
      this.settings.customOpenWithTools = [];

      // SECURITY: Migrate or decrypt the proxy password (see method docs).
      await this.migrateProxyPassword();
      this.migrateLegacyConnectionTimeout();
    } catch {
      // File doesn't exist or parse error, use defaults
      this.settings = mergeSettings();
    }
  }

  /**
   * The connection timeout used to default to 30s, which is shorter than a
   * legitimate `svn status` scan on large working copies — those operations
   * were killed mid-flight on every refresh. Stored configs still pin the old
   * default (deep merge keeps stored values over new defaults), so an exact
   * legacy value is treated as "never customized" and bumped once. Values the
   * user actually typed (anything ≠ 30) are left untouched. Idempotent: after
   * the bump the stored value is 300 and never matches again.
   */
  private migrateLegacyConnectionTimeout(): void {
    if (this.settings.connectionTimeout !== LEGACY_CONNECTION_TIMEOUT) return;
    this.settings.connectionTimeout = DEFAULT_SETTINGS.connectionTimeout;
  }

  /**
   * SECURITY: one-time migration of the persisted proxy password.
   *
   * Encrypted values (`enc:` + safeStorage base64) are decrypted into memory.
   * Legacy plaintext values (written before OS encryption shipped) are kept
   * for the session and the store is rewritten immediately so the plaintext
   * copy disappears from disk. When encryption is unavailable the password
   * cannot be preserved, so the rewrite scrubs it (fail closed) rather than
   * re-persisting plaintext. Idempotent: after a successful rewrite the
   * on-disk value is `enc:`-prefixed or empty, so this never fires twice.
   * Crash safe: writes are atomic (temp file + rename), so a crash
   * mid-migration either leaves the old file — and migration retries on the
   * next launch — or the fully re-encrypted one. Undecryptable `enc:` values
   * (e.g. keychain changed) are dropped from memory but left on disk, since
   * ciphertext is not plaintext and the keychain may become readable again.
   */
  private async migrateProxyPassword(): Promise<void> {
    const stored = this.settings.proxySettings?.password;
    if (!stored) return;

    if (stored.startsWith(ENCRYPTED_VALUE_PREFIX)) {
      if (!this.encryptionAvailable) {
        console.warn('[SECURITY] Dropping encrypted proxy password - encryption not available');
        this.settings.proxySettings.password = '';
        return;
      }

      const decrypted = decryptSecret(safeStorage, stored.slice(ENCRYPTED_VALUE_PREFIX.length));
      if (decrypted === null) {
        console.warn('[SECURITY] Dropping undecryptable proxy password (keychain changed?)');
        this.settings.proxySettings.password = '';
      } else {
        this.settings.proxySettings.password = decrypted;
      }
      return;
    }

    if (this.encryptionAvailable) {
      console.warn('[SECURITY] Migrating legacy plaintext proxy password to OS-encrypted storage');
      // Keep the plaintext in memory; the save below re-encrypts it.
    } else {
      console.warn('[SECURITY] Scrubbing legacy plaintext proxy password - encryption unavailable');
      this.settings.proxySettings.password = '';
    }
    await this.save();
  }

  private validateSvnClientPath(path: string): void {
    const trimmedPath = path.trim();
    this.validatedSvnClient = null;
    if (!trimmedPath) return;

    const approvedPath = assertPathApprovedForIpc(trimmedPath, 'Custom SVN client selection');

    if (/\.(?:cmd|bat|ps1|vbs|js|mjs|cjs|py|pl|rb|sh)$/i.test(approvedPath)) {
      throw new Error(
        'Custom SVN clients must be native executables, not scripts or command wrappers.'
      );
    }

    if (!existsSync(approvedPath)) {
      throw new Error('Custom SVN client path does not exist.');
    }

    const stats = statSync(approvedPath);
    if (!stats.isFile()) {
      throw new Error('Custom SVN client path must point to an executable file.');
    }
    if (process.platform !== 'win32') {
      try {
        accessSync(approvedPath, constants.X_OK);
      } catch {
        throw new Error('Custom SVN client path is not executable.');
      }
    }

    const version = spawnSync(approvedPath, ['--version', '--quiet'], {
      timeout: 3000,
      windowsHide: true,
      encoding: 'utf-8',
    });

    if (version.error || version.status !== 0) {
      throw new Error('Custom SVN client path did not run `svn --version --quiet` successfully.');
    }

    this.validatedSvnClient = {
      path: approvedPath,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
    };
  }

  private isSvnClientValidationCurrent(path: string): boolean {
    const cached = this.validatedSvnClient;
    if (!cached || cached.path !== path) return false;
    try {
      const stats = statSync(path);
      return stats.isFile() && stats.size === cached.size && stats.mtimeMs === cached.modifiedAt;
    } catch {
      return false;
    }
  }

  private validateLogCacheSettings(path?: string, maxSize?: number): void {
    if (path !== undefined && path.trim()) {
      const approvedPath = assertPathApprovedForIpc(path.trim(), 'Custom SVN cache storage');
      if (!existsSync(approvedPath) || !statSync(approvedPath).isDirectory()) {
        throw new Error('Custom SVN cache storage must be an existing directory.');
      }
    }
    if (maxSize !== undefined && (!Number.isFinite(maxSize) || maxSize < 10 || maxSize > 1000)) {
      throw new Error('Maximum SVN log cache size must be between 10 and 1000 MB.');
    }
  }

  /**
   * Save settings to disk
   */
  private async save(): Promise<void> {
    await this.savePromise;

    this.savePromise = (async () => {
      try {
        // Read existing file to preserve other keys
        let existingData: Record<string, unknown> = {};
        try {
          const content = await readFile(this.filePath, 'utf-8');
          existingData = JSON.parse(content) as Record<string, unknown>;
        } catch {
          // File doesn't exist
        }

        // SECURITY: Create a copy of settings with encrypted sensitive values
        const settingsToSave = this.encryptSensitiveSettings({ ...this.settings });

        // Update only the settings key
        existingData.settings = settingsToSave;

        await writeSecureJson(this.filePath, existingData);
      } catch (error) {
        console.error('[SettingsManager] Failed to save settings:', error);
      }
    })();
  }

  /**
   * Encrypt sensitive settings before saving to disk
   */
  private encryptSensitiveSettings(settings: AppSettings): AppSettings {
    const encrypted = { ...settings };

    // Encrypt proxy password if present
    if (encrypted.proxySettings?.password) {
      if (!this.encryptionAvailable) {
        console.warn(
          '[SECURITY] Dropping proxy password from persisted settings - encryption not available'
        );
        encrypted.proxySettings = {
          ...encrypted.proxySettings,
          password: '',
        };
        return encrypted;
      }

      encrypted.proxySettings = {
        ...encrypted.proxySettings,
        password: this.encryptSensitiveValue(encrypted.proxySettings.password),
      };
    }

    return encrypted;
  }

  /**
   * Encrypt a sensitive value using safeStorage (via the secure-storage util).
   */
  private encryptSensitiveValue(value: string): string {
    if (!value) return value;

    const encrypted = encryptSecret(safeStorage, value);
    if (encrypted === null) {
      console.error('[SettingsManager] Failed to encrypt sensitive value');
      // Never turn an OS keychain failure into plaintext persistence. The
      // in-memory value remains available for the current session, but the
      // durable settings copy must fail closed.
      return '';
    }
    return `${ENCRYPTED_VALUE_PREFIX}${encrypted}`;
  }

  /**
   * Wait for initial load to complete
   */
  async ready(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * Get a specific setting value
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  /**
   * Update settings
   */
  async updateSettings(updates: DeepPartial<AppSettings>): Promise<void> {
    await this.loadPromise;

    if (updates.svnClientPath !== undefined) {
      this.validateSvnClientPath(updates.svnClientPath);
    }
    this.validateLogCacheSettings(updates.logCachePath, updates.maxLogCacheSize);
    if (updates.diffMerge?.externalDiffTool !== undefined) {
      if (updates.diffMerge.externalDiffTool.startsWith('registered:')) {
        // Registry ownership and role are checked when the tool is launched.
      } else {
        validateExternalToolSetting(
          updates.diffMerge.externalDiffTool,
          'External diff tool',
          KNOWN_DIFF_TOOL_ALIASES
        );
      }
    }
    if (updates.diffMerge?.externalMergeTool !== undefined) {
      if (updates.diffMerge.externalMergeTool.startsWith('registered:')) {
        // Registry ownership and role are checked when the tool is launched.
      } else {
        validateExternalToolSetting(
          updates.diffMerge.externalMergeTool,
          'External merge tool',
          KNOWN_MERGE_TOOL_ALIASES
        );
      }
    }
    if (updates.diffMerge?.externalToolOverrides !== undefined) {
      for (const override of updates.diffMerge.externalToolOverrides) {
        if (override.diffTool !== undefined) {
          validateExternalToolSetting(
            override.diffTool,
            `Diff tool override for ${override.extension || 'extension'}`,
            KNOWN_DIFF_TOOL_ALIASES
          );
        }
        if (override.mergeTool !== undefined) {
          validateExternalToolSetting(
            override.mergeTool,
            `Merge tool override for ${override.extension || 'extension'}`,
            KNOWN_MERGE_TOOL_ALIASES
          );
        }
      }
    }
    if (updates.customOpenWithTools?.length) {
      throw new Error('Legacy command-based external tools are no longer supported.');
    }

    this.settings = mergeDeep(
      this.settings as unknown as Record<string, unknown>,
      updates as unknown as Partial<Record<string, unknown>>
    ) as unknown as AppSettings;
    await this.save();
    this.notifyListeners();
  }

  /**
   * Get SVN execution context from current settings
   * This is the key method that connects settings to SVN operations
   */
  getSvnExecutionContext(): SvnExecutionContext {
    return {
      proxySettings: this.settings.proxySettings,
      connectionTimeout: this.settings.connectionTimeout,
      sslVerify: this.settings.sslVerify,
      clientCertificatePath: this.settings.clientCertificatePath,
      svnConfigPath: this.settings.svnConfigPath,
      sshSettings: this.settings.sshSettings,
    };
  }

  /**
   * Get the SVN client path (custom or default)
   */
  getSvnClientPath(): string {
    if (this.settings.svnClientPath && this.settings.svnClientPath.trim()) {
      try {
        const approvedPath = assertPathApprovedForIpc(
          this.settings.svnClientPath.trim(),
          'Custom SVN client selection'
        );
        if (!this.isSvnClientValidationCurrent(approvedPath)) {
          this.validateSvnClientPath(approvedPath);
        }
        return approvedPath;
      } catch (error) {
        console.warn(
          '[SECURITY] Ignoring invalid custom SVN client path:',
          (error as Error).message
        );
      }
    }
    // Default to system SVN
    return process.platform === 'win32' ? 'svn.exe' : 'svn';
  }

  /**
   * Get working copy format for new checkouts
   */
  getWorkingCopyFormat(): string {
    return this.settings.workingCopyFormat;
  }

  /**
   * Get proxy settings
   */
  getProxySettings(): ProxySettings {
    return this.settings.proxySettings;
  }

  /**
   * Check if SSL verification should be skipped
   */
  shouldSkipSslVerify(): boolean {
    return !this.settings.sslVerify;
  }

  /**
   * Get connection timeout in seconds
   */
  getConnectionTimeout(): number {
    return this.settings.connectionTimeout;
  }

  /**
   * Get external diff tool path
   */
  getExternalDiffTool(): string {
    return this.settings.diffMerge.externalDiffTool;
  }

  /**
   * Get external merge tool path
   */
  getExternalMergeTool(): string {
    return this.settings.diffMerge.externalMergeTool;
  }

  /**
   * Add a listener for settings changes
   */
  addListener(callback: (settings: AppSettings) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of settings change
   */
  private notifyListeners(): void {
    const settings = this.getSettings();
    this.listeners.forEach((callback) => {
      try {
        callback(settings);
      } catch (error) {
        console.error('[SettingsManager] Listener error:', error);
      }
    });
  }
}

// Export singleton getter
export const getSettingsManager = (): SettingsManager => SettingsManager.getInstance();
export { SettingsManager };
