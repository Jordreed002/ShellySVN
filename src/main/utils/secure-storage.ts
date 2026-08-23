import type { SafeStorage } from 'electron';

/**
 * Credential storage policy
 * -------------------------
 * Every secret that ShellySVN persists (SVN passwords, webhook signing
 * secrets, proxy passwords) MUST flow through these helpers so that each
 * on-disk copy is encrypted by Electron's safeStorage, which is backed by the
 * OS credential store (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet).
 *
 * Fallback when safeStorage is unavailable: this happens mostly on Linux
 * without a real keyring, where Electron falls back to the `basic_text`
 * backend that only obfuscates values with a fixed password — recoverable by
 * anyone with file access, so `isSecureStorageAvailable()` reports false.
 * In that mode credentials are NEVER written to disk: they stay in memory for
 * the current session only, and any legacy plaintext copy discovered on disk
 * is scrubbed on first load (see the migration paths in auth-cache.ts and
 * settings-manager.ts). `encryptSecret` returning null always means "fail
 * closed" — callers must drop the value rather than persist plaintext.
 */

/** Prefix marking a persisted settings value as safeStorage-encrypted base64. */
export const ENCRYPTED_VALUE_PREFIX = 'enc:';

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

/**
 * Encrypt a secret into the base64 blob format used by the on-disk caches.
 * Returns null when the OS keychain refuses the value; callers must treat
 * that as "do not persist" instead of falling back to plaintext.
 */
export function encryptSecret(storage: SafeStorage, plaintext: string): string | null {
  try {
    return storage.encryptString(plaintext).toString('base64');
  } catch {
    return null;
  }
}

/**
 * Decrypt a base64 blob produced by `encryptSecret`.
 * Returns null when decryption fails (corruption or a changed keychain);
 * callers should drop the credential and ask the user to re-authenticate.
 */
export function decryptSecret(storage: SafeStorage, base64Ciphertext: string): string | null {
  try {
    return storage.decryptString(Buffer.from(base64Ciphertext, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Recover the plaintext of a legacy auth-cache entry.
 *
 * Pre-migration builds persisted `Buffer.from(password).toString('base64')`
 * whenever safeStorage was unavailable — base64 is an encoding, not
 * encryption, so those entries are plaintext for practical purposes and get
 * re-encrypted on first load. A stored value only qualifies as legacy when it
 * round-trips through canonical base64, which filters out corrupted
 * safeStorage ciphertext so it is never mistaken for a recoverable secret.
 * Returns null when the value is not a canonical base64 string.
 */
export function decodeLegacyBase64Secret(stored: string): string | null {
  if (!stored) return null;
  const decoded = Buffer.from(stored, 'base64').toString('utf-8');
  return Buffer.from(decoded, 'utf-8').toString('base64') === stored ? decoded : null;
}
