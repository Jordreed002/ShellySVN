import { describe, expect, it } from 'vitest';
import type { DiffMergeSettings } from '@shared/types';

import { resolveExternalToolForPath } from '../src/utils/externalToolOverrides';

const settings: DiffMergeSettings = {
  externalDiffTool: 'global-diff',
  externalMergeTool: 'global-merge',
  externalToolOverrides: [
    { extension: 'ts', diffTool: 'ts-diff', mergeTool: 'ts-merge' },
    { extension: '.png', diffTool: 'image-diff', mergeTool: '' },
  ],
  diffOnDoubleClick: true,
  ignoreWhitespace: false,
  ignoreEol: false,
  contextLines: 3,
};

describe('resolveExternalToolForPath', () => {
  it('uses per-extension diff and merge overrides before global tools', () => {
    expect(resolveExternalToolForPath(settings, 'C:\\wc\\file.ts', 'diff')).toBe('ts-diff');
    expect(resolveExternalToolForPath(settings, 'C:\\wc\\file.ts', 'merge')).toBe('ts-merge');
    expect(resolveExternalToolForPath(settings, 'C:\\wc\\FILE.PNG', 'diff')).toBe('image-diff');
  });

  it('falls back to global tools when an override is missing', () => {
    expect(resolveExternalToolForPath(settings, 'C:\\wc\\FILE.PNG', 'merge')).toBe('global-merge');
    expect(resolveExternalToolForPath(settings, 'C:\\wc\\file.md', 'diff')).toBe('global-diff');
  });
});
