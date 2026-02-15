/**
 * Auth credential cache for SVN operations
 * Stores credentials in memory + encrypted on disk using electron's safeStorage
 * 
 * PERFORMANCE: Uses async file operations to avoid blocking the event loop
 */
import { safeStorage } from 'electron'
import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { join, dirname } from 'path'

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
  private persistCredentials: boolean
  private loadPromise: Promise<void>
  private savePromise: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.storePath = join(userDataPath, 'auth-cache.json')
    this.encryptionAvailable = safeStorage.isEncryptionAvailable()
    
    // SECURITY: Only persist credentials if encryption is available
    // If encryption is unavailable, credentials are stored in memory only (session-only)
    this.persistCredentials = this.encryptionAvailable
    
    if (!this.encryptionAvailable) {
      console.warn(
        '[SECURITY] Encryption not available. Credentials will be stored in memory only.',
        'You will need to re-enter credentials after restarting the application.',
        'On Linux, ensure you have a keyring service (gnome-keyring or kwallet) running.'
      )
    }
    
    // Only load from disk if we're persisting
    // Store promise for async initialization
    this.loadPromise = this.persistCredentials ? this.load() : Promise.resolve()
  }
  
  /**
   * Wait for initial load to complete
   */
  async ready(): Promise<void> {
    await this.loadPromise
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable(): boolean {
    return this.encryptionAvailable
  }
  
  /**
   * Check if credentials will be persisted to disk
   */
  isPersistenceEnabled(): boolean {
    return this.persistCredentials
  }

  /**
   * Store credential (encrypt password if persistence enabled)
   */
  set(realm: string, username: string, password: string): void {
    // If persisting, encrypt the password; otherwise store plaintext in memory only
    const storedPassword = this.persistCredentials ? this.encrypt(password) : password
    const credential: CachedCredential = {
      realm,
      username,
      password: storedPassword,
      createdAt: Date.now()
    }
    this.credentials.set(realm, credential)
    
    // Only save to disk if persistence is enabled
    if (this.persistCredentials) {
      this.save()
    }
  }

  /**
   * Get credential (decrypt password if persistence enabled)
   */
  get(realm: string): { username: string; password: string } | null {
    const credential = this.credentials.get(realm)
    if (!credential) {
      return null
    }
    
    try {
      // If persisted, decrypt; otherwise password is stored plaintext in memory
      const decryptedPassword = this.persistCredentials 
        ? this.decrypt(credential.password) 
        : credential.password
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
    if (this.persistCredentials) {
      this.save()
    }
  }

  /**
   * Clear all credentials
   */
  clear(): void {
    this.credentials.clear()
    if (this.persistCredentials) {
      this.save()
    }
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
   * SECURITY: Only called when encryption is available
   */
  private encrypt(plaintext: string): string {
    if (!this.encryptionAvailable) {
      // SECURITY: This should never be called when encryption is unavailable
      // Credentials are stored in memory only in that case
      throw new Error('Cannot encrypt: secure storage not available')
    }
    
    const encrypted = safeStorage.encryptString(plaintext)
    return encrypted.toString('base64')
  }

  /**
   * Decrypt a password using safeStorage
   * SECURITY: Only called when encryption is available
   */
  private decrypt(ciphertext: string): string {
    if (!this.encryptionAvailable) {
      // SECURITY: This should never be called when encryption is unavailable
      // Credentials are stored in memory only in that case
      throw new Error('Cannot decrypt: secure storage not available')
    }
    
    const buffer = Buffer.from(ciphertext, 'base64')
    return safeStorage.decryptString(buffer)
  }

  /**
   * Load credentials from disk
   * PERFORMANCE: Uses async file operations
   */
  private async load(): Promise<void> {
    try {
      await access(this.storePath)
      const content = await readFile(this.storePath, 'utf-8')
      const data: StoredCache = JSON.parse(content)
      
      if (data.version === 1 && Array.isArray(data.credentials)) {
        for (const cred of data.credentials) {
          this.credentials.set(cred.realm, cred)
        }
      }
    } catch (error) {
      // File doesn't exist or parse error
      console.error('Failed to load auth cache:', error)
      // Start fresh on error
      this.credentials.clear()
    }
  }

  /**
   * Save credentials to disk
   * SECURITY: Only saves if persistence is enabled (encryption available)
   * PERFORMANCE: Uses async file operations with debouncing
   */
  private async save(): Promise<void> {
    // Don't persist if encryption is not available
    if (!this.persistCredentials) {
      return
    }
    
    // Debounce saves by waiting for previous save to complete
    await this.savePromise
    
    this.savePromise = (async () => {
      try {
        const data: StoredCache = {
          version: 1,
          credentials: Array.from(this.credentials.values())
        }
        
        // Ensure directory exists
        const dir = dirname(this.storePath)
        await mkdir(dir, { recursive: true })
        
        await writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8')
      } catch (error) {
        console.error('Failed to save auth cache:', error)
      }
    })()
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
