// @vitest-environment node

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
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
  it('keeps interactive approval and containment guards free of synchronous disk work', async () => {
    const paths = ['utils/approved-paths.ts', 'utils/path-guard.ts', 'utils/validation.ts'];
    for (const path of paths) {
      const source = await readFile(join(process.cwd(), 'src/main', path), 'utf8');
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text.endsWith('Async')) {
          expect(node.body?.getText(file), `${path}:${node.name.text}`).not.toMatch(
            /\b\w+Sync\s*\(/
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    const files = await productionTypeScriptFiles(join(process.cwd(), 'src/main'));
    for (const path of files) {
      if (path.includes('utils' + (process.platform === 'win32' ? '\\' : '/'))) continue;
      const source = await readFile(path, 'utf8');
      expect(source, path).not.toMatch(
        /\b(?:assertPathApprovedForIpc|isPathApprovedForIpc|approvePathForIpc|approveApplicationHomeForIpc|assertRealpathSatisfies|realpathOfLongestExistingPrefix|assertWithinRoot)\s*\(/
      );
    }
    const fsIpc = await readFile(join(process.cwd(), 'src/main/ipc/fs.ts'), 'utf8');
    expect(fsIpc).not.toMatch(/\b(?:\w+Sync|validatePath)\s*\(/);
  });
});
