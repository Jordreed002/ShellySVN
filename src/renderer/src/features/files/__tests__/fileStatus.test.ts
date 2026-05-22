import { describe, expect, it } from 'vitest';
import type { FileInfo, FsStatusResult, SvnStatusChar } from '@shared/types';

import { applyDeepStatus } from '../fileStatus';

const PERF_BUDGET_MULTIPLIER =
  process.env.npm_lifecycle_event === 'test:coverage' || process.argv.includes('--coverage')
    ? 3
    : 1;

function file(path: string, isDirectory = false): FileInfo {
  return {
    name: path.split(/[/\\]/).pop() || path,
    path,
    isDirectory,
    size: 0,
    modifiedTime: '2026-05-06T00:00:00.000Z',
  };
}

function deepStatus(entries: Array<{ fullPath: string; status: SvnStatusChar }>): FsStatusResult {
  return {
    directStatus: {},
    allEntries: entries,
  };
}

describe('fileStatus', () => {
  it('aggregates descendant status onto visible folders', () => {
    const result = applyDeepStatus(
      [file('C:\\repo\\src', true), file('C:\\repo\\docs', true), file('C:\\repo\\README.md')],
      deepStatus([
        { fullPath: 'C:\\repo\\src\\app.ts', status: 'M' },
        { fullPath: 'C:\\repo\\src\\nested\\conflict.ts', status: 'C' },
        { fullPath: 'C:\\repo\\docs\\guide.md', status: '?' },
      ])
    );

    expect(result[0].svnStatus?.status).toBe('C');
    expect(result[1].svnStatus?.status).toBe('?');
    expect(result[2].svnStatus).toBeUndefined();
  });

  it('indexes large deep-status results within the target budget', () => {
    const folders = Array.from({ length: 250 }, (_, index) => file(`/repo/folder-${index}`, true));
    const files = Array.from({ length: 50000 }, (_, index) => ({
      fullPath: `/repo/folder-${index % folders.length}/nested/file-${index}.ts`,
      status: (index % 997 === 0 ? 'C' : index % 2 === 0 ? 'M' : ' ') as SvnStatusChar,
    }));

    const startedAt = performance.now();
    const result = applyDeepStatus(folders, deepStatus(files));
    const durationMs = performance.now() - startedAt;

    expect(result.some((entry) => entry.svnStatus?.status === 'C')).toBe(true);
    expect(durationMs).toBeLessThan(120 * PERF_BUDGET_MULTIPLIER);
  });
});
