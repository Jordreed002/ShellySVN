import { describe, expect, it } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';

import {
  deriveProblemRows,
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

  it('classifies a locally missing path deleted in the repository as deleted upstream', () => {
    const local = entry('!', 'C:\\wc\\old');
    const remote = { ...local, remoteStatus: 'D' as const };

    expect(deriveProblemRows([local], [remote])).toEqual([
      { entry: local, upstreamDeleted: true, collapsedDescendants: 0 },
    ]);
  });

  it('does not call a plain missing path a repository deletion', () => {
    const missing = entry('!', 'C:\\wc\\missing.txt');

    expect(deriveProblemRows([missing], [])).toEqual([
      { entry: missing, upstreamDeleted: false, collapsedDescendants: 0 },
    ]);
  });

  it('collapses missing descendants beneath their missing parent', () => {
    const parent = entry('!', 'C:\\wc\\old');
    const child = entry('!', 'C:\\wc\\old\\child.txt');
    const grandchild = entry('!', 'C:\\wc\\old\\nested\\file.txt');

    expect(deriveProblemRows([parent, child, grandchild])).toEqual([
      { entry: parent, upstreamDeleted: false, collapsedDescendants: 2 },
    ]);
  });

  it('collapses independently of SVN ordering without hiding nested conflicts', () => {
    const parent = entry('!', 'C:\\wc\\old');
    const child = entry('!', 'C:\\wc\\old\\child.txt');
    const conflict = entry('C', 'C:\\wc\\old\\conflict.txt');

    expect(deriveProblemRows([child, conflict, parent])).toEqual([
      { entry: conflict, upstreamDeleted: false, collapsedDescendants: 0 },
      { entry: parent, upstreamDeleted: false, collapsedDescendants: 1 },
    ]);
  });

  it('hides missing descendants explained by a parent tree conflict', () => {
    const conflict = {
      ...entry('C', 'C:\\wc\\old'),
      treeConflict: {} as NonNullable<SvnStatusEntry['treeConflict']>,
    };
    const child = entry('!', 'C:\\wc\\old\\child.txt');

    expect(deriveProblemRows([child, conflict])).toEqual([
      { entry: conflict, upstreamDeleted: false, collapsedDescendants: 0 },
    ]);
  });
});
