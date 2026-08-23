/**
 * The remote write layer (#68, #69): command construction, affected-path
 * counting, drop validation and the sequential adapter.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RepoEntry } from '../types';
import {
  buildRemoteOpCommands,
  canDropRepoPaths,
  computeAffectedCounts,
  defaultLogMessage,
  destinationChildUrl,
  executeRemoteOp,
  formatAffectedSummary,
  planToCalls,
  toRemoteOpItem,
  typedConfirmationFor,
  type RemoteOpsAdapter,
} from '../lib/remoteOps';

function entry(path: string, kind: 'file' | 'dir' = 'file'): RepoEntry {
  const name = path.split('/').pop() ?? path;
  return {
    name,
    path,
    url: `https://svn.example.com/repo/${path}`,
    kind,
    revision: 1,
    author: 'dev',
    date: '2026-08-01T00:00:00Z',
  };
}

const ITEM = (path: string, kind: 'file' | 'dir' = 'file') => toRemoteOpItem(entry(path, kind));

describe('buildRemoteOpCommands', () => {
  it('builds one mkdir command naming the new child and the message', () => {
    const commands = buildRemoteOpCommands({
      kind: 'mkdir',
      items: [ITEM('trunk/releases/2.0', 'dir')],
      destinationUrl: 'https://svn.example.com/repo/trunk/releases',
      folderName: '2.0',
      message: 'Create folder 2.0',
    });
    expect(commands).toEqual([
      'svn mkdir "https://svn.example.com/repo/trunk/releases/2.0" -m "Create folder 2.0"',
    ]);
  });

  it('builds one command per deleted item, in order', () => {
    const commands = buildRemoteOpCommands({
      kind: 'delete',
      items: [ITEM('trunk/a'), ITEM('trunk/b')],
      message: 'Delete 2 paths',
    });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('svn delete "https://svn.example.com/repo/trunk/a"');
    expect(commands[1]).toContain('svn delete "https://svn.example.com/repo/trunk/b"');
  });

  it('moves and copies keep item names inside the destination', () => {
    const move = buildRemoteOpCommands({
      kind: 'move',
      items: [ITEM('trunk/src')],
      destinationUrl: 'https://svn.example.com/repo/branches/x',
      message: 'm',
    });
    expect(move).toEqual(['svn move "https://svn.example.com/repo/trunk/src" "https://svn.example.com/repo/branches/x/src" -m "m"']);

    const copy = buildRemoteOpCommands({
      kind: 'copy',
      items: [ITEM('trunk')],
      destinationUrl: 'https://svn.example.com/repo/tags',
      message: 'tag it',
    });
    expect(copy[0]).toContain('svn copy "https://svn.example.com/repo/trunk" "https://svn.example.com/repo/tags/trunk"');
  });

  it('escapes double quotes in the log message rather than emitting broken shell text', () => {
    const commands = buildRemoteOpCommands({
      kind: 'delete',
      items: [ITEM('x')],
      message: 'say "bye"',
    });
    expect(commands[0]).toContain('-m "say \\"bye\\""');
  });
});

describe('destinationChildUrl', () => {
  it('joins without doubling trailing slashes', () => {
    expect(destinationChildUrl('https://host/repo/trunk/', 'src')).toBe(
      'https://host/repo/trunk/src'
    );
  });
});

describe('defaultLogMessage', () => {
  it('names the single path and the destination', () => {
    expect(defaultLogMessage('move', [ITEM('trunk/a')], 'branches/x')).toBe(
      'Move ^/trunk/a to ^/branches/x'
    );
    expect(defaultLogMessage('copy', [ITEM('trunk')], 'tags')).toBe('Copy ^/trunk to ^/tags');
    expect(defaultLogMessage('delete', [ITEM('trunk/a')])).toBe('Delete ^/trunk/a');
    expect(defaultLogMessage('mkdir', [ITEM('trunk/releases/2.0', 'dir')])).toBe(
      'Create folder 2.0'
    );
  });

  it('counts instead of listing for batches', () => {
    expect(defaultLogMessage('delete', [ITEM('a'), ITEM('b')])).toBe('Delete 2 paths');
    expect(defaultLogMessage('move', [ITEM('a'), ITEM('b')], 'trunk')).toBe(
      'Move 2 paths to ^/trunk'
    );
  });
});

describe('computeAffectedCounts', () => {
  it('counts descendants from loaded tree data', () => {
    const childrenByPath: Record<string, RepoEntry[] | undefined> = {
      trunk: [
        entry('trunk/src', 'dir'),
        entry('trunk/README.md'),
      ],
      'trunk/src': [entry('trunk/src/a.ts'), entry('trunk/src/b.ts')],
    };
    const counts = computeAffectedCounts([ITEM('trunk', 'dir')], { childrenByPath });
    // trunk + src + README + a + b = 4 descendants below the item itself.
    expect(counts).toEqual({ direct: 1, knownDescendants: 4, unloadedDirs: 0 });
  });

  it('marks directories whose children were never listed as unloaded', () => {
    const counts = computeAffectedCounts(
      [ITEM('trunk', 'dir'), ITEM('notes.md')],
      { childrenByPath: {}, childCountByPath: { trunk: 47 } }
    );
    expect(counts.direct).toBe(2);
    expect(counts.knownDescendants).toBe(0);
    expect(counts.unloadedDirs).toBe(1);
  });

  it('treats a loaded-but-empty directory as fully counted', () => {
    const counts = computeAffectedCounts(
      [ITEM('empty-dir', 'dir')],
      { childrenByPath: { 'empty-dir': [] }, childCountByPath: { 'empty-dir': 0 } }
    );
    expect(counts).toEqual({ direct: 1, knownDescendants: 0, unloadedDirs: 0 });
  });

  it('never double-counts an item that is also a descendant of another item', () => {
    const childrenByPath: Record<string, RepoEntry[] | undefined> = {
      trunk: [entry('trunk/lib', 'dir')],
      'trunk/lib': [entry('trunk/lib/x.js')],
    };
    const counts = computeAffectedCounts(
      [ITEM('trunk', 'dir'), ITEM('trunk/lib', 'dir')],
      { childrenByPath }
    );
    // lib is both an item and a descendant of trunk; counted once.
    expect(counts.direct).toBe(2);
    expect(counts.knownDescendants).toBe(1); // just x.js
  });
});

describe('formatAffectedSummary', () => {
  it('states the exact count when everything was loaded', () => {
    expect(formatAffectedSummary({ direct: 3, knownDescendants: 44, unloadedDirs: 0 })).toBe(
      '3 items — 47 paths affected'
    );
  });

  it('says "at least" while folders remain unlisted', () => {
    expect(formatAffectedSummary({ direct: 1, knownDescendants: 46, unloadedDirs: 2 })).toBe(
      'at least 47 paths affected (2 folders not yet listed)'
    );
  });
});

describe('typedConfirmationFor', () => {
  it('asks for the name only of top-level nodes', () => {
    expect(typedConfirmationFor([ITEM('trunk', 'dir'), ITEM('trunk/src')])).toBe('trunk');
    expect(typedConfirmationFor([ITEM('trunk', 'dir'), ITEM('tags', 'dir')])).toBe('trunk, tags');
  });

  it('asks nothing for deep paths', () => {
    expect(typedConfirmationFor([ITEM('trunk/src/a.ts')])).toBeNull();
  });
});

describe('canDropRepoPaths', () => {
  it('allows a drop into a sibling directory', () => {
    expect(canDropRepoPaths(['trunk/src'], 'branches/x')).toBe(true);
  });

  it('refuses dropping onto itself, into own subtree, into the current parent, and the repository root', () => {
    expect(canDropRepoPaths(['trunk/src'], 'trunk/src')).toBe(false);
    expect(canDropRepoPaths(['trunk'], 'trunk/src')).toBe(false);
    expect(canDropRepoPaths(['trunk/src'], 'trunk')).toBe(false);
    expect(canDropRepoPaths(['trunk'], '')).toBe(false);
  });

  it('refuses an empty drag', () => {
    expect(canDropRepoPaths([], 'trunk')).toBe(false);
  });

  it('refuses the whole batch when any source is invalid', () => {
    // `branches` is an ancestor of the destination, so the batch is refused
    // even though `trunk/ok` alone would have been fine.
    expect(canDropRepoPaths(['trunk/ok', 'branches'], 'branches/x')).toBe(false);
  });
});

describe('executeRemoteOp', () => {
  function adapter(overrides: Partial<RemoteOpsAdapter> = {}): RemoteOpsAdapter {
    return {
      remoteCreateFolder: vi.fn(async () => ({ success: true })),
      remoteDelete: vi.fn(async () => ({ success: true })),
      remoteMove: vi.fn(async () => ({ success: true })),
      copy: vi.fn(async () => ({ success: true })),
      ...overrides,
    };
  }

  it('runs one call per item and reports success', async () => {
    const api = adapter();
    const result = await executeRemoteOp(
      {
        kind: 'move',
        items: [ITEM('trunk/a'), ITEM('trunk/b')],
        destinationUrl: 'https://host/repo/branches',
        message: 'm',
      },
      api
    );
    expect(result).toEqual({ success: true, completed: 2 });
    expect(api.remoteMove).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failure and reports how far it got', async () => {
    const api = adapter({
      remoteDelete: vi.fn(async (url: string) =>
        url.endsWith('/a') ? { success: true } : { success: false, error: 'E160013: not found' }
      ),
    });
    const result = await executeRemoteOp(
      {
        kind: 'delete',
        items: [ITEM('trunk/a'), ITEM('trunk/b'), ITEM('trunk/c')],
        message: 'm',
      },
      api
    );
    expect(result.success).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.error).toContain('E160013');
    expect(api.remoteDelete).toHaveBeenCalledTimes(2);
  });

  it('surfaces a thrown error instead of rejecting', async () => {
    const api = adapter({ copy: vi.fn(async () => { throw new Error('socket closed'); }) });
    const result = await executeRemoteOp(
      { kind: 'copy', items: [ITEM('x')], destinationUrl: 'https://host/repo', message: 'm' },
      api
    );
    expect(result).toEqual({ success: false, completed: 0, error: 'socket closed' });
  });

  it('maps a mkdir plan onto remoteCreateFolder with the parent URL', async () => {
    const api = adapter();
    await executeRemoteOp(
      {
        kind: 'mkdir',
        items: [ITEM('trunk/releases/2.0', 'dir')],
        destinationUrl: 'https://host/repo/trunk/releases',
        folderName: '2.0',
        message: 'm',
      },
      api
    );
    expect(api.remoteCreateFolder).toHaveBeenCalledWith(
      'https://host/repo/trunk/releases',
      '2.0',
      'm'
    );
  });

  it('planToCalls orders calls to match the printed commands', () => {
    const api = adapter();
    const calls = planToCalls(
      {
        kind: 'copy',
        items: [ITEM('a'), ITEM('b')],
        destinationUrl: 'https://host/repo/dst',
        message: 'm',
      },
      api
    );
    expect(calls).toHaveLength(2);
  });
});
