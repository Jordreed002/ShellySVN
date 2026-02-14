/**
 * Auth credential cache for SVN operations
 * Stores credentials in memory + encrypted on disk using electron's safeStorage
 */
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

interface CachedCredential {
  realm: string
  username: string
  password: string // encrypted (base64)
  createdAt: number
}

interface StoredCache {
  version: number
  credentials: CachedCredential[]
}

class AuthCache {
  private credentials: Map<string, CachedCredential> = new Map()
  private storePath: string
  private encryptionAvailable: boolean

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'auth-cache.json')
    this.encryptionAvailable = safeStorage.isEncryptionAvailable()
    this.load()
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable
  }

  /**
   * Store credential (encrypt password)
   */
  set(realm: string, username: string, password: string): void {
    const encryptedPassword = this.encrypt(password)
    const credential: CachedCredential = {
      realm,
      username,
      password: encryptedPassword,
      createdAt: Date.now()
    }
    this.credentials.set(realm, credential)
    this.save()
  }

  /**
   * Get credential (decrypt password)
   */
  get(realm: string): { username: string; password: string } | null {
    const credential = this.credentials.get(realm)
    if (!credential) {
      return null
    }
    
    try {
      const decryptedPassword = this.decrypt(credential.password)
      return {
        username: credential.username,
        password: decryptedPassword
      }
    } catch {
      // Decryption failed (key changed or corruption)
      console.error('Failed to decrypt credential for realm:', realm)
      this.delete(realm)
      return null
    }
  }

  /**
   * Remove credential
   */
  delete(realm: string): void {
    this.credentials.delete(realm)
    this.save()
  }

  /**
   * Clear all credentials
   */
  clear(): void {
    this.credentials.clear()
    this.save()
  }

  /**
   * List all cached realms (without passwords)
   */
  list(): Array<{ realm: string; username: string; createdAt: number }> {
    return Array.from(this.credentials.values()).map(c => ({
      realm: c.realm,
      username: c.username,
      createdAt: c.createdAt
    }))
  }

  /**
   * Check if a credential exists for a realm
   */
  has(realm: string): boolean {
    return this.credentials.has(realm)
  }

  /**
   * Encrypt a password using safeStorage
   */
  private encrypt(plaintext: string): string {
    if (!this.encryptionAvailable) {
      // Fallback: base64 encode (not secure, but better than plaintext)
      console.warn('Encryption not available, using fallback encoding')
      return Buffer.from(plaintext).toString('base64')
    }
    
    const encrypted = safeStorage.encryptString(plaintext)
    return encrypted.toString('base64')
  }

  /**
   * Decrypt a password using safeStorage
   */
  private decrypt(ciphertext: string): string {
    if (!this.encryptionAvailable) {
      // Fallback: base64 decode
      return Buffer.from(ciphertext, 'base64').toString('utf-8')
    }
    
    const buffer = Buffer.from(ciphertext, 'base64')
    return safeStorage.decryptString(buffer)
  }

  /**
   * Load credentials from disk
   */
  private load(): void {
    try {
      if (existsSync(this.storePath)) {
        const content = readFileSync(this.storePath, 'utf-8')
        const data: StoredCache = JSON.parse(content)
        
        if (data.version === 1 && Array.isArray(data.credentials)) {
          for (const cred of data.credentials) {
            this.credentials.set(cred.realm, cred)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load auth cache:', error)
      // Start fresh on error
      this.credentials.clear()
    }
  }

  /**
   * Save credentials to disk
   */
  private save(): void {
    try {
      const data: StoredCache = {
        version: 1,
        credentials: Array.from(this.credentials.values())
      }
      
      // Ensure directory exists
      const dir = join(this.storePath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      
      writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save auth cache:', error)
    }
  }
}

// Lazy-initialized auth cache
let authCacheInstance: AuthCache | null = null

/**
 * Get the auth cache instance (lazy initialization)
 */
export function getAuthCache(): AuthCache {
  if (!authCacheInstance) {
    const { app } = require('electron')
    const userDataPath = app.getPath('userData')
    authCacheInstance = new AuthCache(userDataPath)
  }
  return authCacheInstance
}

// Export class for testing
export { AuthCache }

// Export convenience instance getter
export const authCache = {
  get instance(): AuthCache {
    return getAuthCache()
  }
}
