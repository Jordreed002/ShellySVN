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

import { app, safeStorage } from 'electron'
import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AppSettings, SvnExecutionContext, ProxySettings } from '@shared/types'

// Default settings (must match renderer defaults)
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'en',
  checkUpdatesOnStartup: true,
  confirmDestructiveOps: true,
  singleInstanceMode: false,
  defaultCheckoutDirectory: '',
  startupAction: 'welcome',
  recentRepositories: [],
  showIgnoredFiles: false,
  showUnversionedFiles: true,
  sidebarWidth: 250,
  defaultCommitMessage: '',
  autoRefreshInterval: 0,
  svnClientPath: '',
  workingCopyFormat: '1.14',
  globalIgnorePatterns: [],
  proxySettings: {
    enabled: false,
    host: '',
    port: 8080,
    username: '',
    password: '',
    bypassForLocal: true
  },
  connectionTimeout: 30,
  sslVerify: true,
  clientCertificatePath: '',
  diffMerge: {
    externalDiffTool: '',
    externalMergeTool: '',
    diffOnDoubleClick: true,
    ignoreWhitespace: false,
    ignoreEol: false,
    contextLines: 3
  },
  dialogs: {
    rememberPositions: true,
    rememberSizes: true,
    commitDialogColumns: ['status', 'path', 'extension'],
    logMessagesPerPage: 100,
    maxCachedMessages: 1000
  },
  notifications: {
    enableSounds: true,
    enableSystemNotifications: true,
    showHookOutput: true,
    monitorPollInterval: 60
  },
  integration: {
    shellExtensionEnabled: false,
    contextMenuItems: ['update', 'commit', 'revert', 'log', 'diff', 'checkout', 'export'],
    iconOverlaysEnabled: true
  },
  fontSize: 'medium',
  showStatusBar: true,
  fileListHeight: 'fill',
  accentColor: '#6366f1',
  compactFileRows: false,
  animationSpeed: 'normal',
  showThumbnails: false,
  showFolderSizes: false,
  bookmarks: [],
  recentPaths: [],
  savedCredentials: [],
  logLevel: 'info',
  svnConfigPath: '',
  logCachePath: '',
  maxLogCacheSize: 100
}

/**
 * Settings Manager - Singleton class that manages app settings
 * and provides them to SVN operations
 */
class SettingsManager {
  private static instance: SettingsManager | null = null
  private filePath: string
  private settings: AppSettings
  private loadPromise: Promise<void>
  private savePromise: Promise<void> = Promise.resolve()
  private listeners: Set<(settings: AppSettings) => void> = new Set()
  private encryptionAvailable: boolean

  private constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, 'shellysvn-config.json')
    this.settings = { ...DEFAULT_SETTINGS }
    this.encryptionAvailable = safeStorage.isEncryptionAvailable()
    this.loadPromise = this.load()
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager()
    }
    return SettingsManager.instance
  }

  /**
   * Load settings from disk
   */
  private async load(): Promise<void> {
    try {
      await access(this.filePath)
      const content = await readFile(this.filePath, 'utf-8')
      const stored = JSON.parse(content)
      // Merge with defaults to ensure all fields exist
      this.settings = this.mergeDeep({ ...DEFAULT_SETTINGS }, stored.settings || stored)
      
      // SECURITY: Decrypt proxy password if it exists and is encrypted
      if (this.settings.proxySettings?.password) {
        this.settings.proxySettings.password = this.decryptSensitiveValue(
          this.settings.proxySettings.password
        )
      }
    } catch {
      // File doesn't exist or parse error, use defaults
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  /**
   * Deep merge utility
   * Type-safe implementation for merging partial settings
   */
  private mergeDeep<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const output = { ...target }
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        const typedKey = key as keyof T
        if (this.isObject(source[typedKey])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[typedKey] })
          } else {
            output[typedKey] = this.mergeDeep(
              target[typedKey] as Record<string, unknown>,
              source[typedKey] as Partial<Record<string, unknown>>
            ) as T[keyof T]
          }
        } else {
          Object.assign(output, { [key]: source[typedKey] })
        }
      })
    }
    return output
  }

  private isObject(item: unknown): item is Record<string, unknown> {
    return item !== null && typeof item === 'object' && !Array.isArray(item)
  }

  /**
   * Save settings to disk
   */
  private async save(): Promise<void> {
    await this.savePromise
    
    this.savePromise = (async () => {
      try {
        const dir = join(this.filePath, '..')
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true })
        }
        
        // Read existing file to preserve other keys
        let existingData: Record<string, unknown> = {}
        try {
          const content = await readFile(this.filePath, 'utf-8')
          existingData = JSON.parse(content) as Record<string, unknown>
        } catch {
          // File doesn't exist
        }
        
        // SECURITY: Create a copy of settings with encrypted sensitive values
        const settingsToSave = this.encryptSensitiveSettings({ ...this.settings })
        
        // Update only the settings key
        existingData.settings = settingsToSave
        
        await writeFile(this.filePath, JSON.stringify(existingData, null, 2), 'utf-8')
      } catch (error) {
        console.error('[SettingsManager] Failed to save settings:', error)
      }
    })()
  }
  
  /**
   * Encrypt sensitive settings before saving to disk
   */
  private encryptSensitiveSettings(settings: AppSettings): AppSettings {
    const encrypted = { ...settings }
    
    // Encrypt proxy password if present
    if (encrypted.proxySettings?.password) {
      encrypted.proxySettings = {
        ...encrypted.proxySettings,
        password: this.encryptSensitiveValue(encrypted.proxySettings.password)
      }
    }
    
    return encrypted
  }
  
  /**
   * Encrypt a sensitive value using safeStorage
   * Returns the original value if encryption is not available (will be stored in memory only)
   */
  private encryptSensitiveValue(value: string): string {
    if (!value) return value
    
    // If encryption is not available, return value with a prefix to indicate it's plaintext
    // This shouldn't happen in normal operation, but provides a fallback
    if (!this.encryptionAvailable) {
      console.warn('[SECURITY] Cannot encrypt proxy password - encryption not available')
      return value // Store as-is (not ideal but better than losing the setting)
    }
    
    try {
      const encrypted = safeStorage.encryptString(value)
      return `enc:${encrypted.toString('base64')}`
    } catch (error) {
      console.error('[SettingsManager] Failed to encrypt value:', error)
      return value
    }
  }
  
  /**
   * Decrypt a sensitive value that was encrypted with safeStorage
   * Returns the original value if decryption fails or value wasn't encrypted
   */
  private decryptSensitiveValue(value: string): string {
    if (!value) return value
    
    // Check if this is an encrypted value (prefixed with 'enc:')
    if (!value.startsWith('enc:')) {
      // Not encrypted - could be plaintext from older version or empty
      return value
    }
    
    if (!this.encryptionAvailable) {
      console.warn('[SECURITY] Cannot decrypt proxy password - encryption not available')
      return '' // Return empty - user will need to re-enter
    }
    
    try {
      const encryptedBase64 = value.substring(4) // Remove 'enc:' prefix
      const buffer = Buffer.from(encryptedBase64, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (error) {
      console.error('[SettingsManager] Failed to decrypt value:', error)
      return '' // Return empty on decryption failure - user will need to re-enter
    }
  }

  /**
   * Wait for initial load to complete
   */
  async ready(): Promise<void> {
    await this.loadPromise
  }

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    return { ...this.settings }
  }

  /**
   * Get a specific setting value
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  /**
   * Update settings
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    await this.loadPromise
    this.settings = { ...this.settings, ...updates }
    await this.save()
    this.notifyListeners()
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
      clientCertificatePath: this.settings.clientCertificatePath
    }
  }

  /**
   * Get the SVN client path (custom or default)
   */
  getSvnClientPath(): string {
    if (this.settings.svnClientPath && this.settings.svnClientPath.trim()) {
      return this.settings.svnClientPath.trim()
    }
    // Default to system SVN
    return process.platform === 'win32' ? 'svn.exe' : 'svn'
  }

  /**
   * Get working copy format for new checkouts
   */
  getWorkingCopyFormat(): string {
    return this.settings.workingCopyFormat
  }

  /**
   * Get proxy settings
   */
  getProxySettings(): ProxySettings {
    return this.settings.proxySettings
  }

  /**
   * Check if SSL verification should be skipped
   */
  shouldSkipSslVerify(): boolean {
    return !this.settings.sslVerify
  }

  /**
   * Get connection timeout in seconds
   */
  getConnectionTimeout(): number {
    return this.settings.connectionTimeout
  }

  /**
   * Get external diff tool path
   */
  getExternalDiffTool(): string {
    return this.settings.diffMerge.externalDiffTool
  }

  /**
   * Get external merge tool path
   */
  getExternalMergeTool(): string {
    return this.settings.diffMerge.externalMergeTool
  }

  /**
   * Add a listener for settings changes
   */
  addListener(callback: (settings: AppSettings) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Notify all listeners of settings change
   */
  private notifyListeners(): void {
    const settings = this.getSettings()
    this.listeners.forEach(callback => {
      try {
        callback(settings)
      } catch (error) {
        console.error('[SettingsManager] Listener error:', error)
      }
    })
  }
}

// Export singleton getter
export const getSettingsManager = (): SettingsManager => SettingsManager.getInstance()
export { SettingsManager }
