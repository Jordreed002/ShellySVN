import { describe, expect, it } from 'vitest';
import type { SvnLogEntry } from '@shared/types';
import { EMPTY_LOG_FILTERS, countActiveLogFilters, filterLogEntries } from '../logFilters';
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
      filterLogEntries(
        entries,
        { ...EMPTY_LOG_FILTERS, issueId: 'app-9' },
        issueTrackerConfig
      ).map((entry) => entry.revision)
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
});
