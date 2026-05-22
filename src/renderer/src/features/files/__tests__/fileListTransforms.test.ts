import { describe, expect, it } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';

import {
  compileIgnorePatterns,
  filterAndSortEntries,
  filterIgnoredEntries,
  filterSearchEntries,
  getBasename,
  sortEntries,
} from '../fileListTransforms';

const PERF_BUDGET_MULTIPLIER =
  process.env.npm_lifecycle_event === 'test:coverage' || process.argv.includes('--coverage')
    ? 3
    : 1;
const ENFORCE_STRICT_PERF = process.env.SHELLYSVN_STRICT_PERF === '1';

function entry(
  path: string,
  overrides: Partial<SvnStatusEntry> = {}
): SvnStatusEntry {
  return {
    path,
    status: ' ',
    isDirectory: false,
    ...overrides,
  };
}

describe('fileListTransforms', () => {
  it('gets basenames from Windows and POSIX paths', () => {
    expect(getBasename('C:\\work\\src\\index.ts')).toBe('index.ts');
    expect(getBasename('/work/src/index.ts')).toBe('index.ts');
  });

  it('filters ignored files while preserving directories', () => {
    const ignoreRegexes = compileIgnorePatterns(['*.log', 'temp?.txt']);
    const entries = [
      entry('/repo/build', { isDirectory: true }),
      entry('/repo/app.log'),
      entry('/repo/temp1.txt'),
      entry('/repo/temp10.txt'),
      entry('/repo/src/app.ts'),
    ];

    expect(filterIgnoredEntries(entries, ignoreRegexes).map((item) => item.path)).toEqual([
      '/repo/build',
      '/repo/temp10.txt',
      '/repo/src/app.ts',
    ]);
  });

  it('filters search with one normalized query', () => {
    const entries = [
      entry('/repo/src/App.tsx'),
      entry('/repo/docs/readme.md'),
      entry('/repo/test/app.test.ts'),
    ];

    expect(filterSearchEntries(entries, ' APP ').map((item) => item.path)).toEqual([
      '/repo/src/App.tsx',
      '/repo/test/app.test.ts',
    ]);
  });

  it('keeps folders first while sorting by basename', () => {
    const entries = [
      entry('/repo/z-file.ts'),
      entry('/repo/b-folder', { isDirectory: true }),
      entry('/repo/a-file.ts'),
      entry('/repo/a-folder', { isDirectory: true }),
    ];

    expect(sortEntries(entries, 'name', 'asc').map((item) => item.path)).toEqual([
      '/repo/a-folder',
      '/repo/b-folder',
      '/repo/a-file.ts',
      '/repo/z-file.ts',
    ]);
  });

  it('filters and sorts a large list within the target budget', () => {
    const entries = Array.from({ length: 50000 }, (_, index) =>
      entry(`/repo/${index % 5 === 0 ? 'match' : 'other'}/file-${index}.ts`, {
        revision: 50000 - index,
        isDirectory: index % 1000 === 0,
      })
    );

    const startedAt = performance.now();
    const result = filterAndSortEntries({
      entries,
      searchQuery: 'match',
      ignoreRegexes: compileIgnorePatterns(['file-10.ts']),
      sortColumn: 'revision',
      sortDirection: 'asc',
    });
    const durationMs = performance.now() - startedAt;

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.path.toLowerCase().includes('match'))).toBe(true);
    if (ENFORCE_STRICT_PERF) {
      expect(durationMs).toBeLessThan(300 * PERF_BUDGET_MULTIPLIER);
    }
  });
});
