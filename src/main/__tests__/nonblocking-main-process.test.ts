// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : productionTypeScriptFiles(path);
      }
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    })
  );
  return nested.flat();
}

describe('main-process responsiveness boundary', () => {
  it('does not use synchronous child processes outside the explicit smoke-test bootstrap', async () => {
    const mainRoot = join(process.cwd(), 'src', 'main');
    const files = (await productionTypeScriptFiles(mainRoot)).filter(
      (path) => relative(mainRoot, path) !== 'index.ts'
    );
    const offenders: string[] = [];

    await Promise.all(
      files.map(async (path) => {
        const source = await readFile(path, 'utf8');
        if (/\b(?:spawnSync|execSync|execFileSync)\s*\(/.test(source)) {
          offenders.push(relative(process.cwd(), path));
        }
      })
    );

    expect(offenders).toEqual([]);
  });
});
