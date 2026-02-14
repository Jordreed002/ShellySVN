/**
 * Auth IPC handlers
 * Provides secure credential storage for SVN authentication
 */
import { ipcMain } from 'electron'
import { getAuthCache } from '../auth-cache'

export interface AuthCredential {
  username: string
  password: string
}

export interface AuthListEntry {
  realm: string
  username: string
  createdAt: number
}

export function registerAuthHandlers(): void {
  // Get credential for a realm
  ipcMain.handle('auth:get', (_, realm: string): AuthCredential | null => {
    return getAuthCache().get(realm)
  })

  // Store credential for a realm
  ipcMain.handle('auth:set', (_, realm: string, username: string, password: string) => {
    getAuthCache().set(realm, username, password)
    return { success: true }
  })

  // Delete credential for a realm
  ipcMain.handle('auth:delete', (_, realm: string) => {
    getAuthCache().delete(realm)
    return { success: true }
  })

  // List all cached realms (without passwords)
  ipcMain.handle('auth:list', (): AuthListEntry[] => {
    return getAuthCache().list()
  })

  // Check if credential exists for a realm
  ipcMain.handle('auth:has', (_, realm: string): boolean => {
    return getAuthCache().has(realm)
  })

  // Clear all credentials
  ipcMain.handle('auth:clear', () => {
    getAuthCache().clear()
    return { success: true }
  })

  // Check if encryption is available
  ipcMain.handle('auth:isEncryptionAvailable', (): boolean => {
    return getAuthCache().isEncryptionAvailable()
  })
}
