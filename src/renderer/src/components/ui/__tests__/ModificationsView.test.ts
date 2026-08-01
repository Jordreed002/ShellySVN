import { describe, expect, it } from 'vitest';
import type { SvnStatusEntry } from '@shared/types';
import { hasLocalChange, hasRemoteChange } from '../ModificationsView';

function entry(overrides: Partial<SvnStatusEntry> = {}): SvnStatusEntry {
  return { path: '/wc/file.txt', status: ' ', isDirectory: false, ...overrides };
}

describe('modification status classification', () => {
  it.each(['M', 'R', 'A', 'D', 'C', '?', '!', '~'] as const)(
    'treats %s as a local change',
    (status) => expect(hasLocalChange(entry({ status }))).toBe(true)
  );

  it('includes property, switched, lock, and tree-conflict states', () => {
    expect(hasLocalChange(entry({ propsStatus: 'M' }))).toBe(true);
    expect(hasLocalChange(entry({ switched: true }))).toBe(true);
    expect(hasLocalChange(entry({ lock: { owner: 'me', comment: '', date: '' } }))).toBe(true);
    expect(hasLocalChange(entry({ treeConflict: { action: 'edit' } }))).toBe(true);
  });

  it('keeps repository-only changes distinct from local changes', () => {
    const remote = entry({ remoteStatus: 'M', remoteRevision: 20 });
    expect(hasLocalChange(remote)).toBe(false);
    expect(hasRemoteChange(remote)).toBe(true);
  });
});
