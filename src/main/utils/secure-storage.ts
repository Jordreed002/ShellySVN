import type { SafeStorage } from 'electron';

/**
 * Whether safeStorage is backed by an OS-protected credential store.
 *
 * Electron's Linux `basic_text` backend only obfuscates values with a fixed
 * password. Treating it as encryption would silently persist recoverable
 * credentials, so Linux installations without a real keyring stay session-only.
 */
export function isSecureStorageAvailable(storage: SafeStorage): boolean {
  try {
    if (!storage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || storage.getSelectedStorageBackend() !== 'basic_text';
  } catch {
    return false;
  }
}
