import { describe, expect, it } from 'vitest';

import { forAll, genArray, genConstant, genMap, genOneOf, genPick, genRecord } from '@test-utils/propertyCheck';

import type { SvnLogEntry } from '@shared/types';

import {
  compileLogFilters,
  countActiveLogFilters,
  EMPTY_LOG_FILTERS,
  filterLogEntries,
  type LogFilterState,
} from '../logFilters';

/*
 * Property tests for the log filter model (item #130): a compiled predicate
 * must agree with an independent reference evaluator, an invalid regex is
 * reported (never silently downgraded to substring matching), and empty
 * filters keep everything.
 */

const genWord = genMap(genArray(genPick(['feat', 'fix', 'merge', 'trunk', 'ABC-12'] as const), { min: 1, max: 3 }), (words) =>
  words.join(' ')
);

const genEntry = genRecord({
  revision: genPick([1, 7, 42, 100, 999] as const),
  author: genPick(['alice', 'bob@corp', 'Carol'] as const),
  day: genPick(['2026-01-01', '2026-02-15', '2025-12-31'] as const),
  message: genOneOf(genConstant(''), genWord),
  paths: genArray(
    genRecord({
      action: genPick(['A', 'M', 'D', 'R'] as const),
      path: genOneOf(genConstant('/trunk/src/a.ts'), genConstant('/branches/x/b.ts'), genWord),
    }),
    { min: 0, max: 3 }
  ),
});

function toLogEntry(entry: EntryShape): SvnLogEntry {
  return {
    revision: entry.revision,
    author: entry.author,
    date: `${entry.day}T12:00:00.000Z`,
    message: entry.message,
    paths: entry.paths.map((path) => ({ action: path.action, path: `/${path.path.replace(/^\//, '')}` })),
  };
}

interface EntryShape {
  revision: number;
  author: string;
  day: string;
  message: string;
  paths: Array<{ action: 'A' | 'M' | 'D' | 'R'; path: string }>;
}

/** Filters in substring mode only (useRegex stays false). */
const genSubstringFilters = genRecord({
  search: genOneOf(genConstant(''), genConstant('trunk'), genConstant('alice')),
  author: genOneOf(genConstant(''), genConstant('bob'), genConstant('CAROL')),
  message: genOneOf(genConstant(''), genConstant('merge'), genConstant('feat fix')),
  path: genOneOf(genConstant(''), genConstant('trunk')),
  notMessage: genOneOf(genConstant(''), genConstant('merge')),
  issueId: genConstant(''),
  revisionFrom: genOneOf(genConstant(''), genConstant('7'), genConstant('500')),
  revisionTo: genOneOf(genConstant(''), genConstant('100'), genConstant('9999')),
  dateFrom: genOneOf(genConstant(''), genConstant('2026-01-15'), genConstant('2025-06-01')),
  dateTo: genOneOf(genConstant(''), genConstant('2026-02-01')),
});

/** Fill in any keys the generator omitted (shrink candidates drop keys). */
const asFullFilters = (filters: Partial<LogFilterState>): LogFilterState => ({
  ...EMPTY_LOG_FILTERS,
  ...filters,
  useRegex: false,
});

/** Case-insensitive substring containment; a blank needle matches anything. */
function contains(haystack: string, needle: string): boolean {
  return needle.trim() === '' || haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

/** Independent reference evaluator for the substring-mode semantics. */
function referenceMatches(entry: SvnLogEntry, filters: LogFilterState): boolean {
  if (!contains(entry.author, filters.author)) return false;
  if (!contains(entry.message, filters.message)) return false;
  if (filters.notMessage.trim() !== '' && entry.message.toLowerCase().includes(filters.notMessage.trim().toLowerCase())) {
    return false;
  }
  if (filters.path.trim() !== '' && !entry.paths.some((changed) => changed.path.toLowerCase().includes(filters.path.trim().toLowerCase()))) {
    return false;
  }
  if (filters.search.trim() !== '') {
    const needle = filters.search.trim().toLowerCase();
    const found =
      entry.author.toLowerCase().includes(needle) ||
      entry.message.toLowerCase().includes(needle) ||
      entry.paths.some((changed) => changed.path.toLowerCase().includes(needle));
    if (!found) return false;
  }
  const from = filters.revisionFrom.trim() === '' ? null : Number.parseInt(filters.revisionFrom, 10);
  const to = filters.revisionTo.trim() === '' ? null : Number.parseInt(filters.revisionTo, 10);
  if (from !== null && entry.revision < from) return false;
  if (to !== null && entry.revision > to) return false;
  const date = new Date(entry.date);
  if (filters.dateFrom.trim() !== '' && date < new Date(`${filters.dateFrom}T00:00:00`)) return false;
  if (filters.dateTo.trim() !== '' && date > new Date(`${filters.dateTo}T23:59:59.999`)) return false;
  return true;
}

describe('compileLogFilters properties', () => {
  it('the compiled predicate agrees with an independent reference evaluator', () => {
    forAll(
      genRecord({ filters: genSubstringFilters, entry: genEntry }),
      ({ filters, entry }) => {
        if (typeof filters.search !== 'string') return true; // shrunk record
        const state = asFullFilters(filters);
        const logEntry = toLogEntry(entry);
        const { predicate, regexError } = compileLogFilters(state);
        expect(regexError).toBeNull();
        expect(predicate(logEntry)).toBe(referenceMatches(logEntry, state));
        return true;
      },
      { runs: 400 }
    );
  });

  it('empty filters accept every entry and count zero active', () => {
    forAll(
      genEntry,
      (entry) => {
        const { predicate, activeCount } = compileLogFilters(EMPTY_LOG_FILTERS);
        expect(predicate(toLogEntry(entry))).toBe(true);
        expect(activeCount).toBe(0);
        expect(countActiveLogFilters(EMPTY_LOG_FILTERS)).toBe(0);
        return true;
      },
      { runs: 100 }
    );
  });

  it('activeCount is exactly the number of non-blank text filters', () => {
    forAll(
      genSubstringFilters,
      (filters) => {
        if (typeof filters.search !== 'string') return true; // shrunk record
        const state = asFullFilters(filters);
        const nonBlank = (Object.keys(EMPTY_LOG_FILTERS) as Array<keyof LogFilterState>).filter(
          (key) => key !== 'useRegex' && state[key].trim() !== ''
        ).length;
        expect(countActiveLogFilters(state)).toBe(nonBlank);
        expect(compileLogFilters(state).activeCount).toBe(nonBlank);
        return true;
      },
      { runs: 200 }
    );
  });

  it('invalid regexes are reported, and the offending filter is skipped (never substring-downgraded)', () => {
    forAll(
      genRecord({
        // All of these really are SyntaxErrors for `new RegExp(...)` (note:
        // 'a{1,' is a VALID literal-brace regex in JS, so it is excluded).
        bad: genPick(['(', '[unclosed', '*star', 'a{2,1}'] as const),
        entry: genEntry,
      }),
      ({ bad, entry }) => {
        const filters: LogFilterState = {
          ...EMPTY_LOG_FILTERS,
          useRegex: true,
          message: bad,
        };
        void filters;
        const compiled = compileLogFilters(filters);
        expect(compiled.regexError).toContain('Message');
        // The invalid message filter is skipped entirely: every entry passes it.
        expect(compiled.predicate(toLogEntry(entry))).toBe(true);
        return true;
      },
      { runs: 200 }
    );
  });

  it('filterLogEntries keeps exactly the entries the predicate accepts', () => {
    forAll(
      genRecord({ entries: genArray(genEntry, { min: 0, max: 8 }), filters: genSubstringFilters }),
      ({ entries, filters }) => {
        if (typeof filters.search !== 'string') return true; // shrunk record
        const state = asFullFilters(filters);
        const logEntries = entries.map(toLogEntry);
        const kept = filterLogEntries(logEntries, state);
        const reference = logEntries.filter((logEntry) => referenceMatches(logEntry, state));
        expect(kept).toEqual(reference);
        // Every kept entry individually matches the spec.
        return kept.every((logEntry) => referenceMatches(logEntry, state));
      },
      { runs: 200 }
    );
  });
});
