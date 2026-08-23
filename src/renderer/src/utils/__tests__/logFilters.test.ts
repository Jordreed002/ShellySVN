import { describe, expect, it } from 'vitest';
import type { SvnLogEntry } from '@shared/types';
import {
  DEFAULT_LOG_SORT,
  EMPTY_LOG_FILTERS,
  compileLogFilters,
  countActiveLogFilters,
  filterLogEntries,
  logFiltersRegexError,
  parseLogFilterState,
  parseLogSortState,
  sortLogEntries,
  toggleLogSort,
} from '../logFilters';
import { normalizeIssueTrackerConfig } from '../issueTracker';

const entries: SvnLogEntry[] = [
  {
    revision: 120,
    author: 'alice',
    date: '2026-04-25T10:00:00.000Z',
    message: 'SVN-120 Fix checkout progress',
    paths: [{ action: 'M', path: '/trunk/src/checkout.ts' }],
  },
  {
    revision: 121,
    author: 'bob',
    date: '2026-04-26T12:00:00.000Z',
    message: 'APP-9 Update lock manager',
    paths: [{ action: 'M', path: '/trunk/src/locks.ts' }],
  },
  {
    revision: 122,
    author: 'alice',
    date: '2026-04-27T14:00:00.000Z',
    message: 'Refactor log viewer',
    paths: [{ action: 'M', path: '/trunk/src/log.tsx' }],
  },
  {
    revision: 123,
    author: 'carol',
    date: '2026-04-28T09:00:00.000Z',
    message: 'Merge branch feature-x into trunk',
    paths: [{ action: 'M', path: '/trunk/src/log.tsx' }],
  },
];

describe('logFilters', () => {
  it('filters by author, message, and path', () => {
    expect(
      filterLogEntries(entries, {
        ...EMPTY_LOG_FILTERS,
        author: 'alice',
        message: 'checkout',
        path: 'checkout.ts',
      }).map((entry) => entry.revision)
    ).toEqual([120]);
  });

  it('filters by revision and date ranges', () => {
    expect(
      filterLogEntries(entries, {
        ...EMPTY_LOG_FILTERS,
        revisionFrom: '121',
        revisionTo: '122',
        dateFrom: '2026-04-26',
        dateTo: '2026-04-27',
      }).map((entry) => entry.revision)
    ).toEqual([121, 122]);
  });

  it('filters by issue id using the configured issue pattern', () => {
    const issueTrackerConfig = normalizeIssueTrackerConfig({
      enabled: true,
      issueIdPattern: '[A-Z]+-\\d+',
    });

    expect(
      filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, issueId: 'app-9' }, issueTrackerConfig).map(
        (entry) => entry.revision
      )
    ).toEqual([121]);
  });

  it('counts active filters', () => {
    expect(
      countActiveLogFilters({
        ...EMPTY_LOG_FILTERS,
        author: 'alice',
        message: 'checkout',
      })
    ).toBe(2);
  });

  it('does not count the regex toggle itself as an active filter', () => {
    expect(countActiveLogFilters({ ...EMPTY_LOG_FILTERS, useRegex: true })).toBe(0);
  });
});

describe('logFilters — full-text search (#66)', () => {
  it('matches author, message or changed path case-insensitively', () => {
    expect(
      filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: 'alice' }).map((e) => e.revision)
    ).toEqual([120, 122]);
    expect(
      filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: 'LOCK MANAGER' }).map((e) => e.revision)
    ).toEqual([121]);
    expect(
      filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: 'log.tsx' }).map((e) => e.revision)
    ).toEqual([122, 123]);
  });

  it('combines with field filters', () => {
    expect(
      filterLogEntries(entries, { ...EMPTY_LOG_FILTERS, search: 'log', author: 'carol' }).map(
        (e) => e.revision
      )
    ).toEqual([123]);
  });
});

describe('logFilters — regex mode (#66)', () => {
  it('treats text filters as regex when the toggle is on', () => {
    const compiled = compileLogFilters({
      ...EMPTY_LOG_FILTERS,
      useRegex: true,
      message: '^SVN-\\d+',
    });
    expect(entries.filter(compiled.predicate).map((e) => e.revision)).toEqual([120]);
    expect(compiled.regexError).toBeNull();
  });

  it('regex follows the filter convention: case-insensitive', () => {
    const compiled = compileLogFilters({
      ...EMPTY_LOG_FILTERS,
      useRegex: true,
      message: 'SVN-\\d+',
    });
    expect(compiled.predicate({ ...entries[0], message: 'svn-120 fix checkout' })).toBe(true);
    expect(compiled.predicate({ ...entries[0], message: 'no reference here' })).toBe(false);
  });

  it('reports an invalid regex and skips that filter instead of falling back', () => {
    const filters = { ...EMPTY_LOG_FILTERS, useRegex: true, message: '[unclosed' };
    const compiled = compileLogFilters(filters);

    expect(compiled.regexError).toMatch(/^Message:/);
    expect(logFiltersRegexError(filters)).toBe(compiled.regexError);
    // No silent substring fallback: the broken filter is inert, others still apply.
    expect(entries.filter(compiled.predicate).map((e) => e.revision)).toEqual([120, 121, 122, 123]);

    const withAuthor = { ...filters, author: 'alice' };
    expect(
      entries.filter(compileLogFilters(withAuthor).predicate).map((e) => e.revision)
    ).toEqual([120, 122]);
  });

  it('excludes messages matching notMessage (Merge-free semantics)', () => {
    const compiled = compileLogFilters({
      ...EMPTY_LOG_FILTERS,
      useRegex: true,
      notMessage: '\\bmerge\\b',
    });
    expect(entries.filter(compiled.predicate).map((e) => e.revision)).toEqual([120, 121, 122]);
  });
});

describe('logFilters — strict parsing', () => {
  it('accepts a well-formed filter payload and fills omitted fields', () => {
    const parsed = parseLogFilterState({ author: 'alice', useRegex: true });
    expect(parsed).toEqual({ ...EMPTY_LOG_FILTERS, author: 'alice', useRegex: true });
  });

  it('rejects payloads with wrong types', () => {
    expect(parseLogFilterState(null)).toBeNull();
    expect(parseLogFilterState('nope')).toBeNull();
    expect(parseLogFilterState({ author: 5 })).toBeNull();
    expect(parseLogFilterState({ useRegex: 'yes' })).toBeNull();
  });
});

describe('logFilters — column sorting (#66)', () => {
  it('defaults to newest-first like svn log', () => {
    expect(DEFAULT_LOG_SORT).toEqual({ key: 'revision', direction: 'desc' });
    expect(sortLogEntries(entries, DEFAULT_LOG_SORT).map((e) => e.revision)).toEqual([
      123, 122, 121, 120,
    ]);
  });

  it('sorts by each column in both directions', () => {
    expect(
      sortLogEntries(entries, { key: 'author', direction: 'asc' }).map((e) => e.author)
    ).toEqual(['alice', 'alice', 'bob', 'carol']);
    expect(
      sortLogEntries(entries, { key: 'date', direction: 'asc' }).map((e) => e.revision)
    ).toEqual([120, 121, 122, 123]);
    expect(
      sortLogEntries(entries, { key: 'message', direction: 'asc' }).map((e) => e.revision)
    ).toEqual([121, 123, 122, 120]);
  });

  it('flips the active column and switches columns to their natural default', () => {
    expect(toggleLogSort({ key: 'revision', direction: 'desc' }, 'revision')).toEqual({
      key: 'revision',
      direction: 'asc',
    });
    expect(toggleLogSort({ key: 'revision', direction: 'desc' }, 'author')).toEqual({
      key: 'author',
      direction: 'asc',
    });
    expect(toggleLogSort({ key: 'author', direction: 'asc' }, 'date')).toEqual({
      key: 'date',
      direction: 'desc',
    });
  });

  it('strictly parses persisted sort state', () => {
    expect(parseLogSortState({ key: 'date', direction: 'asc' })).toEqual({
      key: 'date',
      direction: 'asc',
    });
    expect(parseLogSortState({ key: 'bogus', direction: 'asc' })).toBeNull();
    expect(parseLogSortState({ key: 'date', direction: 'sideways' })).toBeNull();
    expect(parseLogSortState('x')).toBeNull();
  });
});
