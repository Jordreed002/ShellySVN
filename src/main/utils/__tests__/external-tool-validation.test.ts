// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockState.existsSync,
  statSync: mockState.statSync,
}));

import {
  KNOWN_DIFF_TOOL_ALIASES,
  validateExternalToolSetting,
} from '../external-tool-validation';

describe('external tool setting validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existsSync.mockReturnValue(true);
    mockState.statSync.mockReturnValue({ isFile: () => true });
  });

  it('allows empty settings and known tool aliases', () => {
    expect(validateExternalToolSetting('', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)).toBe('');
    expect(validateExternalToolSetting('meld', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)).toBe(
      'meld'
    );
    expect(
      validateExternalToolSetting('KDIFF3', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toBe('KDIFF3');
    expect(mockState.existsSync).not.toHaveBeenCalled();
  });

  it('requires custom executable paths to exist and be files', () => {
    expect(
      validateExternalToolSetting('C:\\Tools\\diff.exe', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toContain('diff.exe');

    mockState.existsSync.mockReturnValueOnce(false);
    expect(() =>
      validateExternalToolSetting('C:\\Tools\\missing.exe', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toThrow('does not exist');

    mockState.statSync.mockReturnValueOnce({ isFile: () => false });
    expect(() =>
      validateExternalToolSetting('C:\\Tools\\folder', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toThrow('must point to an executable file');
  });

  it('rejects traversal in custom executable paths', () => {
    expect(() =>
      validateExternalToolSetting('tools\\..\\secret.exe', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toThrow('path traversal');
  });
});
