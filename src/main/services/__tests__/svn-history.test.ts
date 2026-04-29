// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

import { getUrlDiff } from '../svn-history';

describe('svn-history URL comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
