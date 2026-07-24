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
 * electron's safeStorage before being persisted to disk.
 */

import { app, safeStorage } from 'electron';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import type { AppSettings, SvnExecutionContext, ProxySettings } from '@shared/types';
import { mergeDeep, mergeSettings } from '@shared/settings-defaults';
import {
  KNOWN_DIFF_TOOL_ALIASES,
  KNOWN_MERGE_TOOL_ALIASES,
  validateExternalToolSetting,
} from './utils/external-tool-validation';
import { assertPathApprovedForIpc } from './utils/approved-paths';

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

  private constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, 'shellysvn-config.json');
    this.settings = mergeSettings();
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
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
      const content = await readFile(this.filePath, 'utf-8');
      const stored = JSON.parse(content);
      // Merge with defaults to ensure all fields exist
      this.settings = mergeSettings(stored.settings || stored);

      // SECURITY: Decrypt proxy password if it exists and is encrypted
      if (this.settings.proxySettings?.password) {
        this.settings.proxySettings.password = this.decryptSensitiveValue(
          this.settings.proxySettings.password
        );
      }
    } catch {
      // File doesn't exist or parse error, use defaults
      this.settings = mergeSettings();
    }
  }

  private validateSvnClientPath(path: string): void {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    if (!existsSync(trimmedPath)) {
      throw new Error('Custom SVN client path does not exist.');
    }

    const stats = statSync(trimmedPath);
    if (!stats.isFile()) {
      throw new Error('Custom SVN client path must point to an executable file.');
    }

    const version = spawnSync(trimmedPath, ['--version', '--quiet'], {
      timeout: 3000,
      windowsHide: true,
      encoding: 'utf-8',
    });

    if (version.error || version.status !== 0) {
      throw new Error('Custom SVN client path did not run `svn --version --quiet` successfully.');
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
        // Ensure directory exists (mkdir with recursive won't throw if exists)
        const dir = join(this.filePath, '..');
        await mkdir(dir, { recursive: true });

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

        await writeFile(this.filePath, JSON.stringify(existingData, null, 2), 'utf-8');
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
   * Encrypt a sensitive value using safeStorage.
   */
  private encryptSensitiveValue(value: string): string {
    if (!value) return value;

    if (!this.encryptionAvailable) {
      console.warn('[SECURITY] Cannot encrypt sensitive value - encryption not available');
      return '';
    }

    try {
      const encrypted = safeStorage.encryptString(value);
      return `enc:${encrypted.toString('base64')}`;
    } catch (error) {
      console.error('[SettingsManager] Failed to encrypt value:', error);
      return value;
    }
  }

  /**
   * Decrypt a sensitive value that was encrypted with safeStorage
   * Returns the original value if decryption fails or value wasn't encrypted
   */
  private decryptSensitiveValue(value: string): string {
    if (!value) return value;

    // Check if this is an encrypted value (prefixed with 'enc:')
    if (!value.startsWith('enc:')) {
      console.warn('[SECURITY] Dropping plaintext sensitive value from settings');
      return '';
    }

    if (!this.encryptionAvailable) {
      console.warn('[SECURITY] Cannot decrypt proxy password - encryption not available');
      return ''; // Return empty - user will need to re-enter
    }

    try {
      const encryptedBase64 = value.substring(4); // Remove 'enc:' prefix
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('[SettingsManager] Failed to decrypt value:', error);
      return ''; // Return empty on decryption failure - user will need to re-enter
    }
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
      validateExternalToolSetting(
        updates.diffMerge.externalDiffTool,
        'External diff tool',
        KNOWN_DIFF_TOOL_ALIASES
      );
    }
    if (updates.diffMerge?.externalMergeTool !== undefined) {
      validateExternalToolSetting(
        updates.diffMerge.externalMergeTool,
        'External merge tool',
        KNOWN_MERGE_TOOL_ALIASES
      );
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
        this.validateSvnClientPath(this.settings.svnClientPath);
        return this.settings.svnClientPath.trim();
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
