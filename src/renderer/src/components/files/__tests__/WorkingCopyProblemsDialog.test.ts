import { describe, expect, it } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';

import {
  limitVisibleProblems,
  needsAttention,
  relativePath,
} from '../WorkingCopyProblemsDialog';

function entry(status: SvnStatusEntry['status'], path = 'C:\\wc\\file.txt'): SvnStatusEntry {
  return { path, status, isDirectory: false } as SvnStatusEntry;
}

describe('WorkingCopyProblemsDialog helpers', () => {
  it('selects blocking status, tree-conflict, and lock entries', () => {
    expect(needsAttention(entry('C'))).toBe(true);
    expect(needsAttention(entry('!'))).toBe(true);
    expect(needsAttention({ ...entry('M'), treeConflict: true })).toBe(true);
    expect(needsAttention({ ...entry('M'), lock: {} as SvnStatusEntry['lock'] })).toBe(true);
    expect(needsAttention(entry('M'))).toBe(false);
  });

  it('normalizes Windows separators when producing a relative path', () => {
    expect(relativePath('C:\\LineIndustries', 'C:\\LineIndustries\\Clients\\site')).toBe(
      'Clients/site'
    );
    expect(relativePath('C:\\LineIndustries\\', 'C:\\LineIndustries\\Tools')).toBe('Tools');
  });

  it('leaves paths outside the working-copy root intact', () => {
    expect(relativePath('C:\\wc', 'D:\\other\\file.txt')).toBe('D:/other/file.txt');
  });

  it('caps rendered problems at 1,000 rows without mutating the source', () => {
    const entries = Array.from({ length: 1_005 }, (_, index) => entry('!', `C:\\wc\\${index}`));
    const visible = limitVisibleProblems(entries);

    expect(visible).toHaveLength(1_000);
    expect(entries).toHaveLength(1_005);
    expect(visible[999]?.path).toBe('C:\\wc\\999');
  });
});
