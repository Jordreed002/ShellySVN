// @vitest-environment node
/**
 * Security Tests for the secure-storage util
 *
 * This module is the single choke point every persisted credential flows
 * through. The tests pin its contract: availability detection (including the
 * Linux basic_text trap), fail-closed encryption, and the canonical-base64
 * heuristic used to recognize legacy plaintext-format entries without ever
 * misclassifying corrupted ciphertext as recoverable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    encryptString: vi.fn(),
    decryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(),
    getSelectedStorageBackend: vi.fn(),
  },
}));

import { safeStorage } from 'electron';
import {
  ENCRYPTED_VALUE_PREFIX,
  decodeLegacyBase64Secret,
  decryptSecret,
  encryptSecret,
  isSecureStorageAvailable,
} from '../utils/secure-storage';

const mockEncryptString = vi.mocked(safeStorage.encryptString);
const mockDecryptString = vi.mocked(safeStorage.decryptString);
const mockIsEncryptionAvailable = vi.mocked(safeStorage.isEncryptionAvailable);
const mockGetSelectedStorageBackend = vi.mocked(safeStorage.getSelectedStorageBackend);

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    writable: true,
  });
}

describe('isSecureStorageAvailable', () => {
  afterEach(() => setPlatform(originalPlatform));

  it('is true on macOS when the keychain reports availability', () => {
    setPlatform('darwin');
    mockIsEncryptionAvailable.mockReturnValue(true);
    expect(isSecureStorageAvailable(safeStorage)).toBe(true);
  });

  it('is false when safeStorage reports no encryption', () => {
    setPlatform('darwin');
    mockIsEncryptionAvailable.mockReturnValue(false);
    expect(isSecureStorageAvailable(safeStorage)).toBe(false);
  });

  it('is true on Linux with a real keyring backend', () => {
    setPlatform('linux');
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockGetSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    expect(isSecureStorageAvailable(safeStorage)).toBe(true);
  });

  it('is false on Linux with the obfuscation-only basic_text backend', () => {
    setPlatform('linux');
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockGetSelectedStorageBackend.mockReturnValue('basic_text');
    expect(isSecureStorageAvailable(safeStorage)).toBe(false);
  });

  it('is false when the availability probe throws', () => {
    setPlatform('darwin');
    mockIsEncryptionAvailable.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });
    expect(isSecureStorageAvailable(safeStorage)).toBe(false);
  });
});

describe('encryptSecret', () => {
  beforeEach(() => {
    mockEncryptString.mockReset();
  });

  it('returns the safeStorage blob as base64', () => {
    mockEncryptString.mockReturnValue(Buffer.from('os-encrypted-bytes'));
    expect(encryptSecret(safeStorage, 'hunter2')).toBe(
      Buffer.from('os-encrypted-bytes').toString('base64')
    );
    expect(mockEncryptString).toHaveBeenCalledWith('hunter2');
  });

  it('returns null (fail closed) when the keychain throws', () => {
    mockEncryptString.mockImplementation(() => {
      throw new Error('keychain locked');
    });
    expect(encryptSecret(safeStorage, 'hunter2')).toBeNull();
  });
});

describe('decryptSecret', () => {
  beforeEach(() => {
    mockDecryptString.mockReset();
  });

  it('passes the decoded buffer to safeStorage and returns the plaintext', () => {
    mockDecryptString.mockReturnValue('hunter2');
    const stored = Buffer.from('os-encrypted-bytes').toString('base64');
    expect(decryptSecret(safeStorage, stored)).toBe('hunter2');
    expect(mockDecryptString).toHaveBeenCalledWith(Buffer.from('os-encrypted-bytes'));
  });

  it('returns null when decryption fails', () => {
    mockDecryptString.mockImplementation(() => {
      throw new Error('decryption failed');
    });
    expect(decryptSecret(safeStorage, 'bm90LXZhbGlk')).toBeNull();
  });
});

describe('decodeLegacyBase64Secret', () => {
  it('recovers the plaintext from a canonical legacy base64 entry', () => {
    const legacy = Buffer.from('legacy-plaintext-secret').toString('base64');
    expect(decodeLegacyBase64Secret(legacy)).toBe('legacy-plaintext-secret');
  });

  it('rejects empty values', () => {
    expect(decodeLegacyBase64Secret('')).toBeNull();
  });

  it('rejects strings that are not canonical base64', () => {
    // Contains '-' (invalid in base64) — could never have been produced by
    // Buffer.from(...).toString('base64'), so it is not a legacy entry.
    expect(decodeLegacyBase64Secret('invalid-encrypted')).toBeNull();
  });

  it('rejects unpadded or lossy encodings', () => {
    const legacy = Buffer.from('legacy-plaintext-secret').toString('base64');
    expect(decodeLegacyBase64Secret(legacy.slice(0, -1))).toBeNull();
  });

  it('rejects binary garbage that does not round-trip as UTF-8', () => {
    // Corrupted safeStorage ciphertext: valid base64 of non-UTF-8 bytes.
    const garbage = Buffer.from([0x00, 0x9f, 0x92, 0x96, 0xff, 0xfe]).toString('base64');
    expect(decodeLegacyBase64Secret(garbage)).toBeNull();
  });
});

describe('ENCRYPTED_VALUE_PREFIX', () => {
  it('marks encrypted settings values', () => {
    expect(ENCRYPTED_VALUE_PREFIX).toBe('enc:');
  });
});
