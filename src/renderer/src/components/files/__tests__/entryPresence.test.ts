import { describe, expect, it } from 'vitest';

import { entryPresence, isNotOnDisk } from '../entryPresence';

describe('entryPresence', () => {
  it('calls a repository entry with nothing on disk presence "none"', () => {
    expect(entryPresence({ status: 'O' })).toBe('none');
    expect(isNotOnDisk({ status: 'O' })).toBe(true);
  });

  it('reports no presence for anything on disk, rather than guessing full or sparse', () => {
    // `svn info` does not expose depth, so "checked out" cannot be told from
    // "partly checked out" here — and an unmeasured presence is not printable.
    for (const status of [' ', 'M', 'A', 'D', 'C', 'R', '?', 'I', '!', '~', 'X'] as const) {
      expect(entryPresence({ status })).toBeUndefined();
      expect(isNotOnDisk({ status })).toBe(false);
    }
  });

  it('never claims presence for an entry it was not given', () => {
    expect(entryPresence(null)).toBeUndefined();
    expect(entryPresence(undefined)).toBeUndefined();
    expect(isNotOnDisk(null)).toBe(false);
  });
});
