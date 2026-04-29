import { describe, expect, it } from 'vitest';

import { getCredentialEncryptionStatusCopy } from '../src/components/settings/SettingsPanels';

describe('AuthSettings credential encryption status copy', () => {
  it('names the platform secure store when encryption is available', () => {
    expect(getCredentialEncryptionStatusCopy(true, 'win32')).toContain(
      'Windows secure storage is available'
    );
    expect(getCredentialEncryptionStatusCopy(true, 'darwin')).toContain(
      'macOS Keychain is available'
    );
    expect(getCredentialEncryptionStatusCopy(true, 'linux')).toContain(
      'Linux secret service is available'
    );
  });

  it('explains memory-only fallback when encryption is unavailable', () => {
    expect(getCredentialEncryptionStatusCopy(false, 'win32')).toBe(
      'Credential encryption is unavailable on Windows. SVN credentials stay memory-only and are not saved persistently.'
    );
    expect(getCredentialEncryptionStatusCopy(false, 'darwin')).toBe(
      'Credential encryption is unavailable on macOS. SVN credentials stay memory-only and are not saved persistently.'
    );
    expect(getCredentialEncryptionStatusCopy(false, 'linux')).toBe(
      'Credential encryption is unavailable on Linux. SVN credentials stay memory-only and are not saved persistently.'
    );
  });
});
