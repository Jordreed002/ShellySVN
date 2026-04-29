// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

import { getLog, getUrlDiff } from '../svn-history';

describe('svn-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads merge-tracking logs with revision ranges', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="12">
    <author>alice</author>
    <date>2026-04-25T10:00:00.000Z</date>
    <msg>Merged feature branch</msg>
  </logentry>
</log>`);

    const result = await getLog('C:\\wc', 50, 10, 12, true);

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'log',
      '--xml',
      '-l',
      '50',
      '-r',
      '10:12',
      '--use-merge-history',
      'C:\\wc',
    ]);
    expect(result.entries[0]?.revision).toBe(12);
  });

  it('compares branch and tag URLs with svn diff', async () => {
    mockState.runSvnText.mockResolvedValue(`Index: src/app.ts
===================================================================
--- src/app.ts
+++ src/app.ts
@@ -1 +1 @@
-old
+new
`);

    const result = await getUrlDiff(
      'https://svn.example.com/repo/trunk',
      'https://svn.example.com/repo/branches/feature'
    );

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'diff',
      'https://svn.example.com/repo/trunk',
      'https://svn.example.com/repo/branches/feature',
    ]);
    expect(result.hasChanges).toBe(true);
    expect(result.files[0]?.newPath).toBe('src/app.ts');
  });
});
