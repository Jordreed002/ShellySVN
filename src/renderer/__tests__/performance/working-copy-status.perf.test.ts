import { describe, expect, it } from 'vitest';

import { parseSvnStatusXml } from '@main/svn/parsers';
import {
  compileIgnorePatterns,
  filterAndSortEntries,
} from '../../src/features/files/fileListTransforms';

const LARGE_WORKING_COPY_ENTRY_COUNT = 25000;
const LARGE_REMOTE_STATUS_ENTRY_COUNT = 15000;

const PERFORMANCE_TARGETS = {
  STATUS_XML_PARSE_MS: 4000,
  REMOTE_STATUS_XML_PARSE_MS: 5000,
  FILTER_AND_SORT_MS: 500,
  REPEATED_REFRESH_MS: 6000,
};

const PERF_BUDGET_MULTIPLIER =
  process.env.npm_lifecycle_event === 'test:coverage' || process.argv.includes('--coverage')
    ? 3
    : 1;

const STATUS_ITEMS = [
  'normal',
  'modified',
  'added',
  'deleted',
  'conflicted',
  'unversioned',
  'missing',
  'ignored',
] as const;

function measureTime<T>(fn: () => T): { result: T; durationMs: number } {
  const startedAt = performance.now();
  const result = fn();
  return {
    result,
    durationMs: performance.now() - startedAt,
  };
}

function expectWithinPerfBudget(durationMs: number, budgetMs: number): void {
  expect(durationMs).toBeLessThan(budgetMs * PERF_BUDGET_MULTIPLIER);
}

function statusEntryXml(index: number, includeRemoteStatus = false): string {
  const item = STATUS_ITEMS[index % STATUS_ITEMS.length];
  const props = index % 13 === 0 ? 'modified' : 'none';
  const switched = index % 97 === 0 ? ' switched="true"' : '';
  const lock =
    index % 211 === 0
      ? '<lock><owner>alice</owner><comment>release edit</comment><creationdate>2026-04-30T10:00:00.000000Z</creationdate></lock>'
      : '';
  const reposStatus =
    includeRemoteStatus && index % 17 === 0
      ? `<repos-status item="modified" props="none"><commit revision="${90000 + index}"><author>remote-${index % 5}</author><date>2026-04-30T11:00:00.000000Z</date></commit></repos-status>`
      : '';

  return `<entry path="C:/work/project/src/module-${index % 100}/file-${index}.ts"><wc-status item="${item}" props="${props}" revision="${50000 + index}"${switched}><commit revision="${60000 + index}"><author>dev-${index % 8}</author><date>2026-04-30T10:00:00.000000Z</date></commit>${lock}</wc-status>${reposStatus}</entry>`;
}

function generateStatusXml(entryCount: number, includeRemoteStatus = false): string {
  const entries = Array.from({ length: entryCount }, (_, index) =>
    statusEntryXml(index, includeRemoteStatus)
  ).join('');

  return `<?xml version="1.0"?><status><target path="C:/work/project">${entries}</target></status>`;
}

describe('Working copy status performance benchmarks', () => {
  it('parses a large working-copy status response within budget', () => {
    const xml = generateStatusXml(LARGE_WORKING_COPY_ENTRY_COUNT);

    const { result, durationMs } = measureTime(() => parseSvnStatusXml(xml, 'C:/work/project'));

    console.log(
      `[PERF] Parsed ${LARGE_WORKING_COPY_ENTRY_COUNT} working-copy status entries: ${durationMs.toFixed(2)}ms`
    );
    expect(result.parseError).toBeUndefined();
    expect(result.entries).toHaveLength(LARGE_WORKING_COPY_ENTRY_COUNT);
    expect(result.entries.some((entry) => entry.status === 'M')).toBe(true);
    expect(result.entries.some((entry) => entry.lock)).toBe(true);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.STATUS_XML_PARSE_MS);
  });

  it('parses remote status metadata for a large working copy within budget', () => {
    const xml = generateStatusXml(LARGE_REMOTE_STATUS_ENTRY_COUNT, true);

    const { result, durationMs } = measureTime(() => parseSvnStatusXml(xml, 'C:/work/project'));

    console.log(
      `[PERF] Parsed ${LARGE_REMOTE_STATUS_ENTRY_COUNT} remote status entries: ${durationMs.toFixed(2)}ms`
    );
    expect(result.parseError).toBeUndefined();
    expect(result.remoteChecked).toBe(true);
    expect(result.entries.filter((entry) => entry.remoteStatus).length).toBeGreaterThan(0);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.REMOTE_STATUS_XML_PARSE_MS);
  });

  it('filters and sorts parsed large status results within budget', () => {
    const xml = generateStatusXml(LARGE_WORKING_COPY_ENTRY_COUNT);
    const parsed = parseSvnStatusXml(xml, 'C:/work/project');

    const { result, durationMs } = measureTime(() =>
      filterAndSortEntries({
        entries: parsed.entries,
        searchQuery: 'module-4',
        ignoreRegexes: compileIgnorePatterns(['*.generated.ts', 'file-100.ts']),
        sortColumn: 'revision',
        sortDirection: 'desc',
      })
    );

    console.log(
      `[PERF] Filtered and sorted ${LARGE_WORKING_COPY_ENTRY_COUNT} status entries: ${durationMs.toFixed(2)}ms`
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => entry.path.includes('module-4'))).toBe(true);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.FILTER_AND_SORT_MS);
  });

  it('keeps repeated large status refresh parsing within budget', () => {
    const xml = generateStatusXml(10000, true);

    const { result, durationMs } = measureTime(() =>
      Array.from({ length: 3 }, () => parseSvnStatusXml(xml, 'C:/work/project'))
    );

    console.log(`[PERF] Repeated large status refresh parse: ${durationMs.toFixed(2)}ms`);
    expect(result.every((status) => status.entries.length === 10000)).toBe(true);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.REPEATED_REFRESH_MS);
  });
});
