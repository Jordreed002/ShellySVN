import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// Simple JSON-based store (avoids ESM issues with electron-store)
class SimpleStore {
  private filePath: string
  private data: Record<string, unknown>

  constructor(name: string = 'config') {
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    this.filePath = join(userDataPath, `${name}.json`)
    this.data = this.load()
  }

  private load(): Record<string, unknown> {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, 'utf-8')
        return JSON.parse(content)
      }
    } catch {
      // Ignore parse errors, start fresh
    }
    return {}
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save store:', error)
    }
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.save()
  }

  delete(key: string): void {
    delete this.data[key]
    this.save()
  }
}

// Lazy-initialized store
let store: SimpleStore | null = null

function getStore(): SimpleStore {
  if (!store) {
    store = new SimpleStore('shellysvn-config')
  }
  return store
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', (_, key: string) => {
    return getStore().get(key)
  })

  ipcMain.handle('store:set', (_, key: string, value: unknown) => {
    getStore().set(key, value)
  })

  ipcMain.handle('store:delete', (_, key: string) => {
    getStore().delete(key)
  })
}
