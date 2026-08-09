// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { KNOWN_DIFF_TOOL_ALIASES, validateExternalToolSetting } from '../external-tool-validation';

describe('external tool setting validation', () => {
  it('allows empty settings, known aliases, and opaque registered ids', () => {
    expect(validateExternalToolSetting('', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)).toBe('');
    expect(validateExternalToolSetting('meld', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)).toBe(
      'meld'
    );
    expect(
      validateExternalToolSetting(
        'registered:abc123',
        'External diff tool',
        KNOWN_DIFF_TOOL_ALIASES
      )
    ).toBe('registered:abc123');
  });

  it('rejects renderer-supplied executable paths and traversal', () => {
    expect(() =>
      validateExternalToolSetting('/bin/sh', 'External diff tool', KNOWN_DIFF_TOOL_ALIASES)
    ).toThrow('built-in or registered tool');
    expect(() =>
      validateExternalToolSetting(
        'tools/../secret.exe',
        'External diff tool',
        KNOWN_DIFF_TOOL_ALIASES
      )
    ).toThrow('built-in or registered tool');
  });
});
