import { ipcMain, app } from 'electron';
import { readFile, access, chmod } from 'fs/promises';
import { join } from 'path';
import { getSettingsManager } from '../settings-manager';
import type { AppSettings } from '@shared/types';
import { writeSecureJson } from '../utils/secure-json';

const MAX_STORE_VALUE_BYTES = 5 * 1024 * 1024;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

function validateStoreKey(key: unknown): string {
  if (
    typeof key !== 'string' ||
    forbiddenKeys.has(key) ||
    !(key === 'settings' || key === 'onboarding' || key === 'hasLaunchedBefore' || key.startsWith('shellysvn'))
  ) {
    throw new Error('Unsupported store key');
  }
  return key;
}

/**
 * Async JSON-based store
 * PERFORMANCE: Uses async file operations to avoid blocking the event loop
 *
 * NOTE: Settings are managed by SettingsManager to avoid race conditions.
 * This store only persists non-settings data.
 */
class SimpleStore {
  private filePath: string;
  private data: Record<string, unknown>;
  private _loadPromise: Promise<void>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(name: string = 'config') {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, `${name}.json`);
    this.data = {};
    this._loadPromise = this.load();
  }

  /**
   * Get the load promise for awaiting initialization
   */
  get loadPromise(): Promise<void> {
    return this._loadPromise;
  }

  private async load(): Promise<void> {
    try {
      await access(this.filePath);
      if (process.platform !== 'win32') await chmod(this.filePath, 0o600);
      const content = await readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);

      // Sync settings to SettingsManager on load (one-way sync for initialization)
      if (this.data['settings']) {
        const settingsManager = getSettingsManager();
        await settingsManager.ready();
        // Only sync if settings haven't been loaded yet
        // SettingsManager handles its own persistence after initialization
        const currentSettings = settingsManager.getSettings();
        if (!currentSettings.recentRepositories?.length) {
          await settingsManager.updateSettings(this.data['settings'] as Partial<AppSettings>);
        }
      }
    } catch {
      // File doesn't exist or parse error, use defaults
      this.data = {};
    }
  }

  private async save(): Promise<void> {
    // Debounce saves by waiting for previous save to complete
    await this.savePromise;

    this.savePromise = (async () => {
      try {
        await writeSecureJson(this.filePath, this.data);
      } catch (error) {
        console.error('Failed to save store:', error);
      }
    })();
  }

  async get<T>(key: string): Promise<T | undefined> {
    validateStoreKey(key);
    await this.loadPromise;

    // For settings, delegate to SettingsManager which is the source of truth
    if (key === 'settings') {
      const settingsManager = getSettingsManager();
      await settingsManager.ready();
      return settingsManager.getSettings() as T;
    }

    return this.data[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    validateStoreKey(key);
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_STORE_VALUE_BYTES) {
      throw new Error('Store value is too large or cannot be serialized');
    }
    await this.loadPromise;

    // For settings, delegate to SettingsManager which handles persistence
    if (key === 'settings') {
      const settingsManager = getSettingsManager();
      await settingsManager.updateSettings(value as Partial<AppSettings>);
      // Also update local cache for non-settings-manager consumers
      this.data[key] = value;
      return;
    }

    this.data[key] = value;
    await this.save();
  }

  async delete(key: string): Promise<void> {
    validateStoreKey(key);
    await this.loadPromise;
    delete this.data[key];
    await this.save();
  }

  /**
   * Flush any pending saves
   */
  async flush(): Promise<void> {
    await this.savePromise;
  }
}

// Lazy-initialized store
let storePromise: Promise<SimpleStore> | null = null;

async function getStore(): Promise<SimpleStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new SimpleStore('shellysvn-config');
      await store.loadPromise;
      return store;
    })();
  }
  return storePromise;
}

/**
 * Test seam: drop the cached store so the next getStore() reconstructs it,
 * picking up newly configured fs mocks. Mirrors resetSvnCacheServiceForTests.
 */
export function resetStoreForTests(): void {
  storePromise = null;
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', async (_, key: string) => {
    return (await getStore()).get(key);
  });

  ipcMain.handle('store:set', async (_, key: string, value: unknown) => {
    await (await getStore()).set(key, value);
  });

  ipcMain.handle('store:delete', async (_, key: string) => {
    await (await getStore()).delete(key);
  });
}

// Export getStore for use in other main process modules
export { getStore };
