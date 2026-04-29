import { describe, expect, it } from 'vitest';
import type { SvnStatusChar } from '@shared/types';
import { getStatusDisplay } from '../useIncrementalStatus';

describe('getStatusDisplay', () => {
  it('returns display metadata for every SVN status character', () => {
    const expectedLabels: Record<SvnStatusChar, string> = {
      ' ': 'Normal',
      A: 'Added',
      C: 'Conflicted',
      D: 'Deleted',
      I: 'Ignored',
      M: 'Modified',
      R: 'Replaced',
      X: 'External',
      '?': 'Unversioned',
      '!': 'Missing',
      '~': 'Obstructed',
      O: 'Remote Only',
    };

    for (const [status, label] of Object.entries(expectedLabels)) {
      expect(getStatusDisplay(status as SvnStatusChar)).toEqual(
        expect.objectContaining({ label })
      );
    }
  });
});
