/**
 * What these tests defend is the menu's one promise: **the second line under an
 * item is the command that item runs.**
 *
 * A wrong command hint is the worst possible failure here, because it is
 * checkable — a user who reads `svn blame -v`, runs it, and gets different
 * output has been told a lie by a tool whose entire pitch is that it does not
 * tell them. So the command table is pinned exactly, including the items that
 * deliberately carry no command at all.
 *
 * The second rule pinned here: an operation that needs a checkout must not look
 * available when there is none. Outside a working copy `svn switch`, `svn merge`
 * and a diff "against working copy" have no second side to work on.
 */

import { describe, it, expect, vi } from 'vitest';

import { MENU_SHORTCUTS, matchMenuShortcut, buildRepoBrowserMenu, localPathForEntry, type RepoBrowserMenuHandlers } from '../repoBrowserMenu';
import type { ContextMenuItem } from '@renderer/components/ui/ContextMenu';
import type { RepoEntry, WorkingCopyState } from '../types';

const dirEntry = (over: Partial<RepoEntry> = {}): RepoEntry => ({
  name: 'trunk',
  path: 'clients/acme-corp/website/trunk',
  url: 'svn://svn.example.com/atlas/clients/acme-corp/website/trunk',
  kind: 'dir',
  revision: 4838,
  author: 'mira.k',
  date: '2026-07-27T09:00:00Z',
  ...over,
});

const fileEntry = (over: Partial<RepoEntry> = {}): RepoEntry =>
  dirEntry({
    name: 'package.json',
    path: 'clients/acme-corp/website/trunk/package.json',
    url: 'svn://svn.example.com/atlas/clients/acme-corp/website/trunk/package.json',
    kind: 'file',
    ...over,
  });

const workingCopy = (over: Partial<WorkingCopyState> = {}): WorkingCopyState => ({
  localPath: '/Users/jordan/wc/acme-website',
  repoPath: 'clients/acme-corp/website/trunk',
  url: 'svn://svn.example.com/atlas/clients/acme-corp/website/trunk',
  baseRevision: 4820,
  headRevision: 4838,
  mixedRevisions: { lowest: 4820, highest: 4838 },
  rollup: { modified: 0, added: 0, conflicted: 0 },
  eligibleRevisions: 0,
  incomingRevisions: 0,
  depth: 'infinity',
  ...over,
});

/** Every handler as a spy, so a click can be traced to exactly one call. */
function spyHandlers(): RepoBrowserMenuHandlers & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onOpen: vi.fn(),
    onCheckout: vi.fn(),
    onAddToWorkingCopy: vi.fn(),
    onExport: vi.fn(),
    onSwitch: vi.fn(),
    onMerge: vi.fn(),
    onOpenShelf: vi.fn(),
    onShowLog: vi.fn(),
    onDiff: vi.fn(),
    onBlame: vi.fn(),
    onProperties: vi.fn(),
    onCompare: vi.fn(),
    onSearchHere: vi.fn(),
    onCopyTo: vi.fn(),
    onCreateFolder: vi.fn(),
    onManageLocks: vi.fn(),
    onRemoveFromWorkingCopy: vi.fn(),
    onDelete: vi.fn(),
    onBookmark: vi.fn(),
    onCopyUrl: vi.fn(),
  } as RepoBrowserMenuHandlers & Record<string, ReturnType<typeof vi.fn>>;
}

interface MenuOver {
  entry?: RepoEntry;
  workingCopy?: WorkingCopyState | null;
  headRevision?: number | null;
  shelfName?: string | null;
}

function build(over: MenuOver = {}) {
  const handlers = spyHandlers();
  const menu = buildRepoBrowserMenu({
    entry: over.entry ?? fileEntry(),
    workingCopy: over.workingCopy === undefined ? workingCopy() : over.workingCopy,
    headRevision: over.headRevision === undefined ? 4838 : over.headRevision,
    shelfName: over.shelfName ?? null,
    handlers,
  });
  return { ...menu, handlers };
}

/** Items and submenu items, flattened; dividers dropped. */
function commands(items: ContextMenuItem[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const item of items) {
    if (item.divider) continue;
    out[item.id] = item.command;
    if (item.submenu) Object.assign(out, commands(item.submenu));
  }
  return out;
}

function itemById(items: ContextMenuItem[], id: string): ContextMenuItem {
  for (const item of items) {
    if (!item.divider && item.id === id) return item;
    const nested = item.submenu?.find((sub) => sub.id === id);
    if (nested) return nested;
  }
  throw new Error(`No context-menu item with id "${id}"`);
}

describe('buildRepoBrowserMenu — the command under each item', () => {
  it('names exactly the command each item runs, and nothing for items that run none', () => {
    const { items } = build();

    expect(commands(items)).toEqual({
      // Navigation, not Subversion.
      open: undefined,

      checkout: 'svn checkout',
      // Fills a sparse checkout in place — deliberately not `svn checkout`,
      // which would make a second working copy of the same subtree.
      'add-to-working-copy': 'svn update --set-depth infinity',
      export: 'svn export',
      switch: 'svn switch',
      merge: 'svn merge',

      log: 'svn log -v',
      diff: 'svn diff',
      // The blame worker runs `svn blame --xml`; `-v` would be a different call.
      blame: 'svn blame',
      compare: 'svn diff --old --new',
      // Filtering a listing is ours.
      search: undefined,

      branch: 'svn copy',
      // The submenu chooses arguments for the parent's `svn copy`; it repeats
      // no command of its own.
      'copy-to-branch': undefined,
      'copy-to-tag': undefined,
      'copy-to-location': undefined,
      'copy-from-head': undefined,
      'copy-from-revision': undefined,

      mkdir: 'svn mkdir',
      properties: 'svn proplist -v',
      locks: 'svn lock / unlock',
      'remove-from-working-copy': 'svn update --set-depth exclude',
      delete: 'svn delete',

      // Ours, not Subversion's.
      bookmark: undefined,
      'copy-url': undefined,
    });
  });

  it('adds no command to the shelf item, whose dialog offers three different ones', () => {
    const { items } = build({ shelfName: 'payments-wip' });
    const shelf = itemById(items, 'shelf');
    expect(shelf.label).toBe('Shelf: payments-wip…');
    expect(shelf.command).toBeUndefined();
  });

  it('offers no shelf item when `svn shelf-list` returned nothing', () => {
    expect(() => itemById(build().items, 'shelf')).toThrow();
  });

  it('keeps the same command whichever entry the menu was opened on', () => {
    const onFile = commands(build({ entry: fileEntry() }).items);
    const onDir = commands(build({ entry: dirEntry() }).items);
    expect(onDir).toEqual(onFile);
  });
});

const disabledIds = (items: ContextMenuItem[]): string[] =>
  items.filter((item) => !item.divider && item.disabled).map((item) => item.id);

describe('buildRepoBrowserMenu — what a missing checkout disables', () => {
  it('disables every working-copy operation when nothing is checked out', () => {
    // Same entry either way, so the only thing that changes is the checkout.
    // A file, so `Diff against working copy` is not already disabled for being
    // a directory.
    const inside = disabledIds(build({ entry: fileEntry() }).items);
    const outside = disabledIds(
      build({ entry: fileEntry(), workingCopy: null, headRevision: null }).items
    );

    expect(outside.filter((id) => !inside.includes(id)).toSorted()).toEqual(
      ['bookmark', 'diff', 'locks', 'merge', 'remove-from-working-copy', 'switch'].toSorted()
    );
    // Nothing becomes *more* available for want of a checkout.
    expect(inside.filter((id) => !outside.includes(id))).toEqual([]);
  });

  it('enables them inside a checkout', () => {
    const { items } = build();
    for (const id of ['switch', 'merge', 'diff', 'locks', 'bookmark']) {
      expect(itemById(items, id).disabled).toBeFalsy();
    }
  });

  it('still shows the disabled items rather than hiding them', () => {
    const withCheckout = build().items.filter((item) => !item.divider).map((item) => item.id);
    const without = build({ workingCopy: null })
      .items.filter((item) => !item.divider)
      .map((item) => item.id);
    expect(without).toEqual(withCheckout);
  });

  it('disables the working-copy diff for a directory even inside a checkout', () => {
    const { items } = build({ entry: dirEntry() });
    expect(itemById(items, 'diff').disabled).toBe(true);
    expect(itemById(items, 'blame').disabled).toBe(true);
  });

  it('disables checkout and mkdir on a file, and enables them on a directory', () => {
    const onFile = build({ entry: fileEntry() }).items;
    expect(itemById(onFile, 'checkout').disabled).toBe(true);
    expect(itemById(onFile, 'mkdir').disabled).toBe(true);

    const onDir = build({ entry: dirEntry() }).items;
    expect(itemById(onDir, 'checkout').disabled).toBe(false);
    expect(itemById(onDir, 'mkdir').disabled).toBe(false);
  });

  it('disables locks and bookmark for a path outside the checkout, even though one exists', () => {
    const { items } = build({
      entry: dirEntry({ name: 'globex', path: 'clients/globex' }),
    });
    expect(itemById(items, 'locks').disabled).toBe(true);
    expect(itemById(items, 'bookmark').disabled).toBe(true);
    // The switch dialog targets the checkout, so it is still available.
    expect(itemById(items, 'switch').disabled).toBe(false);
  });

  it('does nothing when a disabled path item is invoked anyway', () => {
    const { items, handlers } = build({ workingCopy: null });
    itemById(items, 'locks').onClick?.();
    itemById(items, 'bookmark').onClick?.();
    expect(handlers.onManageLocks).not.toHaveBeenCalled();
    expect(handlers.onBookmark).not.toHaveBeenCalled();
  });
});

describe('buildRepoBrowserMenu — Copy to…', () => {
  it('names the real HEAD revision when it is known', () => {
    const { items } = build({ headRevision: 4838 });
    expect(itemById(items, 'copy-from-head').label).toBe('From HEAD (r4838)');
  });

  it('omits the revision rather than inventing one when HEAD is unknown', () => {
    for (const head of [null, 0]) {
      const { items } = build({ workingCopy: null, headRevision: head });
      const item = itemById(items, 'copy-from-head');
      expect(item.label).toBe('From HEAD');
      expect(item.label).not.toMatch(/r\d/);
    }
  });

  it('pins the copy to the measured revision, and leaves it unpinned when there is none', () => {
    const pinned = build({ headRevision: 4838 });
    itemById(pinned.items, 'copy-from-head').onClick?.();
    expect(pinned.handlers.onCopyTo).toHaveBeenCalledWith(expect.anything(), {
      destination: 'prompt',
      fromRevision: 4838,
    });

    const unpinned = build({ headRevision: null });
    itemById(unpinned.items, 'copy-from-head').onClick?.();
    expect(unpinned.handlers.onCopyTo).toHaveBeenCalledWith(expect.anything(), {
      destination: 'prompt',
      fromRevision: 'HEAD',
    });
  });

  it('asks for each destination distinctly', () => {
    const { items, handlers } = build();
    const entry = fileEntry();

    itemById(items, 'copy-to-branch').onClick?.();
    expect(handlers.onCopyTo).toHaveBeenLastCalledWith(entry, {
      destination: 'branch',
      fromRevision: 'HEAD',
    });

    itemById(items, 'copy-to-tag').onClick?.();
    expect(handlers.onCopyTo).toHaveBeenLastCalledWith(entry, {
      destination: 'tag',
      fromRevision: 'HEAD',
    });

    itemById(items, 'copy-to-location').onClick?.();
    expect(handlers.onCopyTo).toHaveBeenLastCalledWith(entry, {
      destination: 'prompt',
      fromRevision: 'HEAD',
    });

    itemById(items, 'copy-from-revision').onClick?.();
    expect(handlers.onCopyTo).toHaveBeenLastCalledWith(entry, {
      destination: 'prompt',
      fromRevision: 'prompt',
    });
  });

  it('labels the submenu group and separates destination from revision', () => {
    const submenu = itemById(build().items, 'branch').submenu ?? [];
    expect(submenu.filter((item) => item.divider).map((item) => item.label)).toEqual([
      'Copy this path to',
      '',
    ]);
  });
});

describe('buildRepoBrowserMenu — the header and the wiring', () => {
  it('names the entry and its repository path, in `^/` form', () => {
    const { header } = build();
    expect(header.name).toBe('package.json');
    expect(header.path).toBe('^/clients/acme-corp/website/trunk/package.json');
  });

  it('hands every enabled item its own entry', () => {
    const entry = fileEntry();
    const { items, handlers } = build({ entry });

    for (const [id, handler] of [
      ['open', handlers.onOpen],
      ['checkout', handlers.onCheckout],
      ['export', handlers.onExport],
      ['switch', handlers.onSwitch],
      ['merge', handlers.onMerge],
      ['log', handlers.onShowLog],
      ['diff', handlers.onDiff],
      ['blame', handlers.onBlame],
      ['compare', handlers.onCompare],
      ['search', handlers.onSearchHere],
      ['properties', handlers.onProperties],
      ['delete', handlers.onDelete],
      ['copy-url', handlers.onCopyUrl],
    ] as const) {
      itemById(items, id).onClick?.();
      expect(handler, `handler for "${id}"`).toHaveBeenCalledWith(entry);
    }
  });

  it('hands the lock dialog and the bookmark the path on disk, not the repository path', () => {
    const entry = fileEntry();
    const { items, handlers } = build({ entry });

    itemById(items, 'locks').onClick?.();
    expect(handlers.onManageLocks).toHaveBeenCalledWith(
      entry,
      '/Users/jordan/wc/acme-website/package.json'
    );

    itemById(items, 'bookmark').onClick?.();
    expect(handlers.onBookmark).toHaveBeenCalledWith(
      entry,
      '/Users/jordan/wc/acme-website/package.json'
    );
  });

  it('marks only Delete as destructive', () => {
    const { items } = build();
    expect(items.filter((item) => item.danger).map((item) => item.id)).toEqual(['delete']);
  });

  it('groups the items the way the prototype does', () => {
    const { items } = build();
    expect(items.filter((item) => item.divider && item.label).map((item) => item.label)).toEqual([
      'Working copy',
      'Inspect',
      'Repository',
    ]);
  });
});

describe('localPathForEntry', () => {
  const wc = workingCopy();

  it('joins the checkout root to the part of the path below it', () => {
    expect(localPathForEntry({ path: `${wc.repoPath}/src/app.ts` }, wc)).toBe(
      '/Users/jordan/wc/acme-website/src/app.ts'
    );
  });

  it('is the checkout root itself for the checked-out path', () => {
    expect(localPathForEntry({ path: wc.repoPath }, wc)).toBe('/Users/jordan/wc/acme-website');
  });

  it('is null outside the checkout, including for a sibling sharing a prefix', () => {
    expect(localPathForEntry({ path: 'clients/globex' }, wc)).toBeNull();
    expect(localPathForEntry({ path: `${wc.repoPath}-archive/src` }, wc)).toBeNull();
  });

  it('is null when nothing is checked out', () => {
    expect(localPathForEntry({ path: 'clients/globex' }, null)).toBeNull();
  });

  it('handles a checkout of the whole repository', () => {
    const root = workingCopy({ repoPath: '', localPath: '/Users/jordan/wc/atlas/' });
    expect(localPathForEntry({ path: 'clients/globex' }, root)).toBe(
      '/Users/jordan/wc/atlas/clients/globex'
    );
    expect(localPathForEntry({ path: '' }, root)).toBe('/Users/jordan/wc/atlas');
  });
});

describe('menu accelerators', () => {
  const entry: RepoEntry = {
    name: 'package.json',
    path: 'clients/acme/trunk/package.json',
    url: 'svn://example/atlas/clients/acme/trunk/package.json',
    kind: 'file',
    revision: 4838,
    author: 'mira.k',
    date: '2026-07-26T09:12:00Z',
  };

  it('binds every shortcut the menu prints', () => {
    // A printed accelerator that no key invokes is a label that lies.
    const { items } = buildRepoBrowserMenu({ entry, workingCopy: null, handlers: spyHandlers() });

    for (const item of items) {
      if (!item.shortcut || item.shortcut === '↵') continue;
      expect(
        MENU_SHORTCUTS[item.shortcut],
        `no key binding for ${item.shortcut} (${item.id})`
      ).toBe(item.id);
    }
  });

  it('prints a shortcut for every accelerator it binds', () => {
    const { items } = buildRepoBrowserMenu({ entry, workingCopy: null, handlers: spyHandlers() });
    const printed = new Set(items.map((item) => item.shortcut).filter(Boolean));

    for (const label of Object.keys(MENU_SHORTCUTS)) {
      expect(printed.has(label), `${label} is bound but never shown`).toBe(true);
    }
  });

  it('resolves each accelerator to its item, and nothing else', () => {
    expect(matchMenuShortcut({ key: 'l', metaKey: true })).toBe('log');
    expect(matchMenuShortcut({ key: 'd', altKey: true })).toBe('diff');
    expect(matchMenuShortcut({ key: 'b', altKey: true })).toBe('blame');
    expect(matchMenuShortcut({ key: 'o', metaKey: true, shiftKey: true })).toBe('checkout');
    expect(matchMenuShortcut({ key: 'f', metaKey: true, shiftKey: true })).toBe('search');
    expect(matchMenuShortcut({ key: 'c', metaKey: true, shiftKey: true })).toBe('copy-url');
    expect(matchMenuShortcut({ key: 'd', metaKey: true })).toBe('bookmark');

    // ⌘D and ⌥D are different items; the modifier is the whole difference.
    expect(matchMenuShortcut({ key: 'd', metaKey: true })).not.toBe(
      matchMenuShortcut({ key: 'd', altKey: true })
    );
    // A bare letter is typing, not a command.
    expect(matchMenuShortcut({ key: 'd' })).toBeNull();
    expect(matchMenuShortcut({ key: 'l' })).toBeNull();
  });
});

describe('add to working copy — the bridge between the server and your disk', () => {
  const dirEntry: RepoEntry = {
    name: 'media-raw',
    path: 'clients/acme/trunk/media-raw',
    url: 'svn://example/atlas/clients/acme/trunk/media-raw',
    kind: 'dir',
    revision: 4838,
    author: 'mira.k',
    date: '2026-07-26T09:12:00Z',
  };

  const wc: WorkingCopyState = {
    localPath: '/wc/acme',
    repoPath: 'clients/acme/trunk',
    url: 'svn://example/atlas/clients/acme/trunk',
    baseRevision: 4821,
    headRevision: 4838,
    mixedRevisions: { lowest: 4821, highest: 4838 },
    rollup: { modified: 0, added: 0, conflicted: 0 },
    eligibleRevisions: 0,
    incomingRevisions: 0,
    depth: 'unknown',
  };

  const itemFor = (entry: RepoEntry, workingCopy: WorkingCopyState | null) =>
    buildRepoBrowserMenu({ entry, workingCopy, handlers: spyHandlers() }).items.find(
      (item) => item.id === 'add-to-working-copy'
    );

  it('is offered for a directory that is not on disk, with the local path it will fill', () => {
    const handlers = spyHandlers();
    const { items } = buildRepoBrowserMenu({ entry: dirEntry, workingCopy: wc, handlers });
    const item = items.find((entry) => entry.id === 'add-to-working-copy');

    expect(item?.disabled).toBe(false);
    item?.onClick?.();
    // The local path is derived from the checkout, not guessed from the URL.
    expect(handlers.onAddToWorkingCopy).toHaveBeenCalledWith(dirEntry, '/wc/acme/media-raw');
  });

  it('is refused with no checkout to add it to', () => {
    expect(itemFor(dirEntry, null)?.disabled).toBe(true);
  });

  it('is refused for a file — depth applies to subtrees', () => {
    expect(itemFor({ ...dirEntry, kind: 'file' }, wc)?.disabled).toBe(true);
  });

  it('is refused when the directory is already fully present', () => {
    // Nothing to fetch; offering it would imply otherwise.
    expect(itemFor({ ...dirEntry, presence: 'full' }, wc)?.disabled).toBe(true);
  });

  it('is still offered when only part of the subtree is present', () => {
    expect(itemFor({ ...dirEntry, presence: 'sparse' }, wc)?.disabled).toBe(false);
  });

  it('does nothing when invoked while refused', () => {
    const handlers = spyHandlers();
    const { items } = buildRepoBrowserMenu({ entry: dirEntry, workingCopy: null, handlers });
    items.find((item) => item.id === 'add-to-working-copy')?.onClick?.();
    expect(handlers.onAddToWorkingCopy).not.toHaveBeenCalled();
  });
});
