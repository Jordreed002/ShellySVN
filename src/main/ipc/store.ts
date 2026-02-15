import { ipcMain, app } from 'electron'
import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { getSettingsManager } from '../settings-manager'
import type { AppSettings } from '@shared/types'

/**
 * Async JSON-based store
 * PERFORMANCE: Uses async file operations to avoid blocking the event loop
 */
class SimpleStore {
  private filePath: string
  private data: Record<string, unknown>
  private _loadPromise: Promise<void>
  private savePromise: Promise<void> = Promise.resolve()

  constructor(name: string = 'config') {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, `${name}.json`)
    this.data = {}
    this._loadPromise = this.load()
  }
  
  /**
   * Get the load promise for awaiting initialization
   */
  get loadPromise(): Promise<void> {
    return this._loadPromise
  }

  private async load(): Promise<void> {
    try {
      await access(this.filePath)
      const content = await readFile(this.filePath, 'utf-8')
      this.data = JSON.parse(content)
      
      // Sync settings to SettingsManager on load
      if (this.data['settings']) {
        const settingsManager = getSettingsManager()
        await settingsManager.ready()
        await settingsManager.updateSettings(this.data['settings'] as Partial<AppSettings>)
      }
    } catch {
      // File doesn't exist or parse error, use defaults
      this.data = {}
    }
  }

  private async save(): Promise<void> {
    // Debounce saves by waiting for previous save to complete
    await this.savePromise
    
    this.savePromise = (async () => {
      try {
        // Ensure directory exists
        const dir = join(this.filePath, '..')
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true })
        }
        
        await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
      } catch (error) {
        console.error('Failed to save store:', error)
      }
    })()
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.loadPromise
    return this.data[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.loadPromise
    this.data[key] = value
    await this.save()
    
    // Notify SettingsManager when settings are updated
    if (key === 'settings') {
      try {
        const settingsManager = getSettingsManager()
        await settingsManager.updateSettings(value as Partial<AppSettings>)
      } catch (error) {
        console.error('[Store] Failed to sync settings to manager:', error)
      }
    }
  }

  async delete(key: string): Promise<void> {
    await this.loadPromise
    delete this.data[key]
    await this.save()
  }
  
  /**
   * Flush any pending saves
   */
  async flush(): Promise<void> {
    await this.savePromise
  }
}

// Lazy-initialized store
let storePromise: Promise<SimpleStore> | null = null

async function getStore(): Promise<SimpleStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new SimpleStore('shellysvn-config')
      await store.loadPromise
      return store
    })()
  }
  return storePromise
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', async (_, key: string) => {
    return (await getStore()).get(key)
  })

  ipcMain.handle('store:set', async (_, key: string, value: unknown) => {
    await (await getStore()).set(key, value)
  })

  ipcMain.handle('store:delete', async (_, key: string) => {
    await (await getStore()).delete(key)
  })
}

// Export getStore for use in other main process modules
export { getStore }
