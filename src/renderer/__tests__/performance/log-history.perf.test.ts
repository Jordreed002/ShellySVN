import { describe, expect, it } from 'vitest';

import { parseSvnLogXml } from '@main/svn/parsers';
import type { SvnLogEntry } from '@shared/types';
import {
  EMPTY_LOG_FILTERS,
  filterLogEntries,
  type LogFilterState,
} from '../../src/utils/logFilters';

const LARGE_LOG_ENTRY_COUNT = 20000;
const LOG_PAGE_SIZE = 25;

const PERFORMANCE_TARGETS = {
  LOG_XML_PARSE_MS: 3000,
  MULTI_FIELD_FILTER_MS: 500,
  PAGE_WINDOWING_MS: 150,
};

const PERF_BUDGET_MULTIPLIER =
  process.env.npm_lifecycle_event === 'test:coverage' || process.argv.includes('--coverage')
    ? 3
    : 1;

const ISSUE_TRACKER_CONFIG = {
  enabled: true,
  issueIdPattern: '[A-Z]+-\\d+',
  issueUrlTemplate: '',
};

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

function generateLogEntryXml(index: number): string {
  const revision = 200000 - index;
  const issuePrefix = index % 5 === 0 ? 'SVN' : index % 7 === 0 ? 'OPS' : 'UI';
  const branch = index % 11 === 0 ? 'branches/release' : 'trunk';
  const area = index % 3 === 0 ? 'src' : index % 3 === 1 ? 'docs' : 'tests';

  return `<logentry revision="${revision}"><author>author-${index % 17}</author><date>2026-04-${((index % 28) + 1).toString().padStart(2, '0')}T10:00:00.000000Z</date><msg>${issuePrefix}-${revision} Update ${area} module ${index}</msg><paths><path action="M" kind="file">/${branch}/${area}/file-${index}.ts</path><path action="A" kind="file">/${branch}/${area}/generated-${index}.ts</path><path action="D" kind="file">/${branch}/legacy/old-${index}.ts</path></paths></logentry>`;
}

function generateLogXml(entryCount: number): string {
  const entries = Array.from({ length: entryCount }, (_, index) => generateLogEntryXml(index)).join(
    ''
  );

  return `<?xml version="1.0"?><log>${entries}</log>`;
}

function paginate(entries: SvnLogEntry[], page: number): SvnLogEntry[] {
  const start = (page - 1) * LOG_PAGE_SIZE;
  return entries.slice(start, start + LOG_PAGE_SIZE);
}

describe('Large log history performance benchmarks', () => {
  it('parses a large SVN log XML response within budget', () => {
    const xml = generateLogXml(LARGE_LOG_ENTRY_COUNT);

    const { result, durationMs } = measureTime(() => parseSvnLogXml(xml));

    console.log(`[PERF] Parsed ${LARGE_LOG_ENTRY_COUNT} log entries: ${durationMs.toFixed(2)}ms`);
    expect(result.entries).toHaveLength(LARGE_LOG_ENTRY_COUNT);
    expect(result.startRevision).toBe(200000 - LARGE_LOG_ENTRY_COUNT + 1);
    expect(result.endRevision).toBe(200000);
    expect(result.entries[0].paths).toHaveLength(3);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.LOG_XML_PARSE_MS);
  });

  it('filters a large log history with author, message, path, revision, date, and issue filters', () => {
    const entries = parseSvnLogXml(generateLogXml(LARGE_LOG_ENTRY_COUNT)).entries;
    const filters: LogFilterState = {
      ...EMPTY_LOG_FILTERS,
      author: 'author-1',
      message: 'update',
      path: '/trunk/src',
      issueId: 'SVN',
      revisionFrom: '180000',
      revisionTo: '199999',
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    };

    const { result, durationMs } = measureTime(() =>
      filterLogEntries(entries, filters, ISSUE_TRACKER_CONFIG)
    );

    console.log(
      `[PERF] Filtered ${LARGE_LOG_ENTRY_COUNT} log entries with active filters: ${durationMs.toFixed(2)}ms`
    );
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (entry) =>
          entry.author.includes('author-1') &&
          entry.message.includes('SVN-') &&
          entry.paths.some((path) => path.path.toLowerCase().includes('/trunk/src'))
      )
    ).toBe(true);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.MULTI_FIELD_FILTER_MS);
  });

  it('keeps repeated pagination over a large filtered history within budget', () => {
    const entries = parseSvnLogXml(generateLogXml(LARGE_LOG_ENTRY_COUNT)).entries;
    const filteredEntries = filterLogEntries(entries, {
      ...EMPTY_LOG_FILTERS,
      message: 'update',
      revisionFrom: '180000',
    });
    const totalPages = Math.ceil(filteredEntries.length / LOG_PAGE_SIZE);

    const { result, durationMs } = measureTime(() =>
      Array.from({ length: totalPages }, (_, index) => paginate(filteredEntries, index + 1))
    );

    console.log(
      `[PERF] Paged ${filteredEntries.length} filtered log entries across ${totalPages} pages: ${durationMs.toFixed(2)}ms`
    );
    expect(result).toHaveLength(totalPages);
    expect(result[0]).toHaveLength(LOG_PAGE_SIZE);
    expect(result.at(-1)?.length).toBeGreaterThan(0);
    expectWithinPerfBudget(durationMs, PERFORMANCE_TARGETS.PAGE_WINDOWING_MS);
  });
});
