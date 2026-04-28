import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

import { shell } from 'electron';
import { isValidExternalUrl, openValidatedExternalUrl } from '../external-url';

describe('external URL validation', () => {
  it('allows http, https, and mailto URLs', () => {
    expect(isValidExternalUrl('https://example.com')).toBe(true);
    expect(isValidExternalUrl('http://example.com')).toBe(true);
    expect(isValidExternalUrl('mailto:test@example.com')).toBe(true);
  });

  it('rejects unsafe or invalid URLs', () => {
    expect(isValidExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isValidExternalUrl('not a url')).toBe(false);
  });

  it('does not open rejected URLs', async () => {
    const result = await openValidatedExternalUrl('file:///C:/secret.txt');

    expect(result.success).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
