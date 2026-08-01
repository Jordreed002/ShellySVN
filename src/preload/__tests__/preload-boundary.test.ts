// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('preload security boundary', () => {
  it('exposes only the curated API and never the toolkit raw IPC bridge', async () => {
    const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('@electron-toolkit/preload');
    expect(source).not.toContain("exposeInMainWorld('electron'");
    expect(source).toContain("exposeInMainWorld('api', api)");
  });
});
