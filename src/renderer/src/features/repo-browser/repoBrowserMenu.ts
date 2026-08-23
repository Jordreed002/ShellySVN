/**
 * The repository browser's context menu, as a pure function.
 *
 * Design source: `prototypes/12-browser.html` — the `.ctx` block. Two rules
 * come from it and are the reason this is a function rather than JSX:
 *
 * 1. **The second line is the `svn` command the item actually runs.** Not a
 *    family of commands, not a plausible-looking one: the one that runs. An
 *    item with no single command (Open, Search, Bookmark, Copy URL) carries
 *    none, because a wrong command hint is worse than no hint at all.
 * 2. **What needs a checkout says so by being disabled**, never by being
 *    absent and never by looking available. `svn ls` describes the server;
 *    `svn switch`, `svn merge` and a working-copy diff describe your disk, and
 *    outside a checkout there is no disk side to describe.
 *
 * Being pure, the whole table above is testable without a repository, which is
 * the only way "the command shown is the command run" can be held to over time.
 */

import {
  Braces,
  Copy,
  CornerDownLeft,
  Download,
  FileDiff,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  GitBranch,
  GitCompare,
  GitMerge,
  History,
  Lock,
  Search,
  Star,
  Trash2,
  Upload,
  User,
  Archive,
  FolderDown,
  FolderMinus,
} from 'lucide-react';

import type { ContextMenuHeader, ContextMenuItem } from '@renderer/components/ui/ContextMenu';

import { containsPath } from './adapters';
import type { RepoCopyToRequest, RepoEntry, WorkingCopyState } from './types';

/**
 * Where this entry lives on disk, or `null` when it does not live there.
 *
 * A repository listing is not a directory listing: most of what it shows has
 * never been checked out. Operations that take a *path* — locks, bookmarks —
 * need this answer, and "no answer" is the common one.
 */
export function localPathForEntry(
  entry: Pick<RepoEntry, 'path'>,
  workingCopy: Pick<WorkingCopyState, 'localPath' | 'repoPath'> | null | undefined
): string | null {
  if (!workingCopy) return null;
  const root = workingCopy.repoPath.replace(/^\/+|\/+$/g, '');
  if (!containsPath(root, entry.path)) return null;
  const relative = root ? entry.path.slice(root.length).replace(/^\/+/, '') : entry.path;
  const base = workingCopy.localPath.replace(/[/\\]+$/, '');
  return relative ? `${base}/${relative}` : base;
}

/**
 * Everything the menu can set in motion. Each one is wired to something that
 * exists — a dialog, a detail-pane tab, the filter field or a prop the route
 * supplies. An item with nowhere to go is not in the menu.
 */
export interface RepoBrowserMenuHandlers {
  /** Directories open in the listing; files open in the detail pane. */
  onOpen: (entry: RepoEntry) => void;
  onCheckout: (entry: RepoEntry) => void;
  /**
   * Fetch a directory that is *not* on disk into the checkout that already
   * contains this path — a sparse-checkout expansion, not a second checkout.
   * Receives the local path the directory will occupy.
   */
  onAddToWorkingCopy: (entry: RepoEntry, localPath: string) => void;
  /**
   * The inverse: drop this path from the checkout on disk while leaving it in
   * the repository. Without it the only removal on offer here is `svn delete`,
   * which schedules a *repository* deletion — a different thing entirely, and
   * one that leaves a change to commit.
   */
  onRemoveFromWorkingCopy: (entry: RepoEntry, localPath: string) => void;
  onExport: (entry: RepoEntry) => void;
  /** Opens the switch dialog with this URL as the target. */
  onSwitch: (entry: RepoEntry) => void;
  /** Opens the merge dialog with this URL as the merge *source*. */
  onMerge: (entry: RepoEntry) => void;
  /** Opens the shelf dialog. Only offered when a shelf exists. */
  onOpenShelf: () => void;
  onShowLog: (entry: RepoEntry) => void;
  onDiff: (entry: RepoEntry) => void;
  onBlame: (entry: RepoEntry) => void;
  onProperties: (entry: RepoEntry) => void;
  onCompare: (entry: RepoEntry) => void;
  /** Narrows the filter to this folder and focuses it. */
  onSearchHere: (entry: RepoEntry) => void;
  onCopyTo: (entry: RepoEntry, request: RepoCopyToRequest) => void;
  /**
   * Move this path elsewhere in the repository (#68). `svn move` on URLs is an
   * immediate commit, so the handler opens a confirmation rather than acting.
   */
  onMoveTo: (entry: RepoEntry) => void;
  onCreateFolder: (entry: RepoEntry) => void;
  /** Locks are read from a checkout, so the resolved local path comes with it. */
  onManageLocks: (entry: RepoEntry, localPath: string) => void;
  onDelete: (entry: RepoEntry) => void;
  /** Bookmarks are locations on disk; the resolved local path comes with it. */
  onBookmark: (entry: RepoEntry, localPath: string) => void;
  onCopyUrl: (entry: RepoEntry) => void;
}

export interface RepoBrowserMenuOptions {
  /** The entry the menu was opened on. */
  entry: RepoEntry;
  /** The checkout containing the path on screen, or `null` when there is none. */
  workingCopy: WorkingCopyState | null;
  /**
   * Server HEAD for this path, when something has actually measured it. A
   * missing value is rendered as a missing revision, never as a guess.
   */
  headRevision?: number | null;
  /** Newest shelf in that checkout, when `svn shelf-list` returned one. */
  shelfName?: string | null;
  handlers: RepoBrowserMenuHandlers;
}

export interface RepoBrowserMenu {
  header: ContextMenuHeader;
  items: ContextMenuItem[];
}

function divider(id: string, label = ''): ContextMenuItem {
  return { id, label, divider: true };
}

/**
 * Build the menu for one entry.
 *
 * The order is the prototype's: what you can get locally, how you can inspect
 * it, what you can do to the repository, and then the two clipboard-ish
 * conveniences that belong to no group.
 */
export function buildRepoBrowserMenu({
  entry,
  workingCopy,
  headRevision = null,
  shelfName = null,
  handlers,
}: RepoBrowserMenuOptions): RepoBrowserMenu {
  const isDir = entry.kind === 'dir';
  const hasWorkingCopy = Boolean(workingCopy);
  const localPath = localPathForEntry(entry, workingCopy);

  /*
   * `svn copy` with no `-r` copies whatever HEAD is at the moment it runs.
   * Offering "From HEAD (r4838)" means something stronger — pinning the copy to
   * that revision — so it may only be offered when the number is known. When it
   * is not, the label drops the number and the request stays unpinned rather
   * than naming a revision nobody measured.
   */
  const knownHead = typeof headRevision === 'number' && headRevision > 0 ? headRevision : null;

  const items: ContextMenuItem[] = [
    {
      id: 'open',
      label: 'Open',
      icon: CornerDownLeft,
      shortcut: '↵',
      // Opening is navigation, not a Subversion operation. No command line.
      onClick: () => handlers.onOpen(entry),
    },

    divider('sep-working-copy'),
    divider('section-working-copy', 'Working copy'),
    {
      id: 'checkout',
      label: 'Checkout…',
      icon: Download,
      command: 'svn checkout',
      shortcut: '⌘⇧O',
      // `svn checkout` takes a directory URL; on a file it is an error, not a
      // slow path, so the item says so instead of failing later.
      disabled: !isDir,
      onClick: () => handlers.onCheckout(entry),
    },
    {
      /*
       * The counterpart to the presence flag in the listing: the browser can say
       * "this folder is not on disk", so it must also be able to bring it in.
       * `--set-depth infinity` fills a sparse checkout in place; a plain
       * `svn checkout` would make a *second*, unrelated working copy.
       */
      id: 'add-to-working-copy',
      label: 'Add to working copy…',
      icon: FolderDown,
      command: 'svn update --set-depth infinity',
      disabled: !isDir || localPath === null || entry.presence === 'full',
      onClick: () => {
        if (localPath) handlers.onAddToWorkingCopy(entry, localPath);
      },
    },
    {
      id: 'export',
      label: 'Export…',
      icon: Upload,
      command: 'svn export',
      onClick: () => handlers.onExport(entry),
    },
    {
      id: 'switch',
      label: 'Switch working copy here…',
      icon: GitBranch,
      command: 'svn switch',
      // Nothing to switch without a checkout.
      disabled: !hasWorkingCopy,
      onClick: () => handlers.onSwitch(entry),
    },
    {
      id: 'merge',
      label: 'Merge from here…',
      icon: GitMerge,
      command: 'svn merge',
      // `svn merge` writes into a working copy; there is no server-side merge.
      disabled: !hasWorkingCopy,
      onClick: () => handlers.onMerge(entry),
    },
    /*
     * Not in the prototype, but the app has shelves and the dialog is reachable
     * from nowhere else here. It is a working-copy operation, so it sits in this
     * group, and only appears when `svn shelf-list` actually returned a shelf.
     * The dialog offers unshelve, patch export and drop, so no single command.
     */
    ...(shelfName
      ? [
          {
            id: 'shelf',
            label: `Shelf: ${shelfName}…`,
            icon: Archive,
            onClick: () => handlers.onOpenShelf(),
          } satisfies ContextMenuItem,
        ]
      : []),

    divider('sep-inspect'),
    divider('section-inspect', 'Inspect'),
    {
      id: 'log',
      label: 'Show log',
      icon: History,
      // The log worker runs `svn log --xml -v -l N`; `-v` is the part a reader
      // can see the effect of (changed paths), so that is what is named.
      command: 'svn log -v',
      shortcut: '⌘L',
      onClick: () => handlers.onShowLog(entry),
    },
    {
      id: 'diff',
      label: 'Diff against working copy',
      icon: FileDiff,
      command: 'svn diff',
      shortcut: '⌥D',
      // Directories have no diff view, and "against working copy" is a promise
      // that cannot be kept without one.
      disabled: isDir || !hasWorkingCopy,
      onClick: () => handlers.onDiff(entry),
    },
    {
      id: 'blame',
      label: 'Blame',
      icon: User,
      // The blame worker runs `svn blame --xml` — not `-v`.
      command: 'svn blame',
      shortcut: '⌥B',
      disabled: isDir,
      onClick: () => handlers.onBlame(entry),
    },
    {
      id: 'compare',
      label: 'Compare with another path…',
      icon: GitCompare,
      // What CompareDialog builds: `svn diff [--summarize] --old=… --new=…`.
      command: 'svn diff --old --new',
      onClick: () => handlers.onCompare(entry),
    },
    {
      id: 'search',
      label: 'Search inside this folder…',
      icon: Search,
      // Filtering a listing is ours, not Subversion's. No command line.
      shortcut: '⌘⇧F',
      onClick: () => handlers.onSearchHere(entry),
    },

    divider('sep-repository'),
    divider('section-repository', 'Repository'),
    {
      id: 'branch',
      label: 'Copy to…',
      icon: GitBranch,
      command: 'svn copy',
      onClick: () => handlers.onCopyTo(entry, { destination: 'prompt', fromRevision: 'HEAD' }),
      submenu: [
        divider('copy-to-heading', 'Copy this path to'),
        {
          id: 'copy-to-branch',
          label: 'A new branch…',
          onClick: () => handlers.onCopyTo(entry, { destination: 'branch', fromRevision: 'HEAD' }),
        },
        {
          id: 'copy-to-tag',
          label: 'A new tag…',
          onClick: () => handlers.onCopyTo(entry, { destination: 'tag', fromRevision: 'HEAD' }),
        },
        {
          id: 'copy-to-location',
          label: 'Another location…',
          onClick: () => handlers.onCopyTo(entry, { destination: 'prompt', fromRevision: 'HEAD' }),
        },
        divider('copy-from-sep'),
        {
          id: 'copy-from-head',
          label: knownHead ? `From HEAD (r${knownHead})` : 'From HEAD',
          onClick: () =>
            handlers.onCopyTo(entry, {
              destination: 'prompt',
              fromRevision: knownHead ?? 'HEAD',
            }),
        },
        {
          id: 'copy-from-revision',
          label: 'From a specific revision…',
          onClick: () =>
            handlers.onCopyTo(entry, { destination: 'prompt', fromRevision: 'prompt' }),
        },
      ],
    },
    {
      /*
       * Companion to "Copy to…" (#68): same destination prompt, but the source
       * path stops existing where it was — one commit, straight to the
       * repository. The handler confirms affected paths before running.
       */
      id: 'move',
      label: 'Move to…',
      icon: FolderInput,
      command: 'svn move',
      onClick: () => handlers.onMoveTo(entry),
    },
    {
      id: 'mkdir',
      label: 'Create folder here…',
      icon: FolderPlus,
      command: 'svn mkdir',
      // A folder is created *inside* a directory; a file has no inside.
      disabled: !isDir,
      onClick: () => handlers.onCreateFolder(entry),
    },
    {
      id: 'properties',
      label: 'Properties…',
      icon: Braces,
      command: 'svn proplist -v',
      onClick: () => handlers.onProperties(entry),
    },
    {
      id: 'locks',
      label: 'Locks…',
      icon: Lock,
      command: 'svn lock / unlock',
      /*
       * Locks are listed with `svn status --show-updates` against a working
       * copy, so a path with nothing on disk has no lock view to open — the
       * repository knows the lock, but this dialog reaches it through the
       * checkout.
       */
      disabled: localPath === null,
      onClick: () => {
        if (localPath) handlers.onManageLocks(entry, localPath);
      },
    },
    {
      /*
       * Paired with "Add to working copy…" above, and offered before Delete so
       * the local-only removal is the one you meet first: it is what people mean
       * by "get this off my disk", and it costs nothing to undo.
       */
      id: 'remove-from-working-copy',
      label: 'Remove from working copy…',
      icon: FolderMinus,
      command: 'svn update --set-depth exclude',
      // Nothing to remove unless this path is actually in the checkout on disk.
      disabled: localPath === null || entry.presence === 'none',
      onClick: () => {
        if (localPath) handlers.onRemoveFromWorkingCopy(entry, localPath);
      },
    },
    {
      id: 'delete',
      label: 'Delete from repository…',
      icon: Trash2,
      command: 'svn delete',
      danger: true,
      onClick: () => handlers.onDelete(entry),
    },

    divider('sep-bookmark'),
    {
      id: 'bookmark',
      label: 'Bookmark',
      icon: Star,
      shortcut: '⌘D',
      /*
       * Bookmarks in the rail are places on disk — they navigate the file
       * browser. A repository path that is not checked out is not such a place,
       * so the item is disabled rather than storing a URL the rail cannot open.
       */
      disabled: localPath === null,
      onClick: () => {
        if (localPath) handlers.onBookmark(entry, localPath);
      },
    },
    {
      id: 'copy-url',
      label: 'Copy URL',
      icon: Copy,
      shortcut: '⇧⌘C',
      onClick: () => handlers.onCopyUrl(entry),
    },
  ];

  return {
    header: {
      icon: isDir ? Folder : FileText,
      name: entry.name,
      path: `^/${entry.path}`,
    },
    items,
  };
}

/**
 * The accelerators the menu prints, and the item each one runs.
 *
 * A shortcut printed beside an item that no key binding invokes is the same
 * kind of lie as a command line that is not the command that runs — it was
 * true of every accelerator in this menu until these were bound. Keeping the
 * label and the binding in one table, checked by a test, is what stops that
 * happening again. `↵` is deliberately absent: Enter is the listing's own key,
 * handled by the row grid rather than dispatched through the menu.
 */
export const MENU_SHORTCUTS: Readonly<Record<string, string>> = {
  '⌘⇧O': 'checkout',
  '⌘L': 'log',
  '⌥D': 'diff',
  '⌥B': 'blame',
  '⌘⇧F': 'search',
  '⌘D': 'bookmark',
  '⇧⌘C': 'copy-url',
};

/** Just enough of a keyboard event to resolve a shortcut. */
export interface MenuShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Which menu item, if any, a key press invokes.
 *
 * Returns an id rather than an action so the caller can look the item up in a
 * freshly built menu and honour its `disabled` state: a shortcut must never do
 * something the menu itself would have refused.
 */
export function matchMenuShortcut(event: MenuShortcutEvent): string | null {
  const meta = Boolean(event.metaKey || event.ctrlKey);
  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);
  const key = event.key.toLowerCase();

  if (meta && shift && key === 'o') return MENU_SHORTCUTS['⌘⇧O'];
  if (meta && shift && key === 'f') return MENU_SHORTCUTS['⌘⇧F'];
  if (meta && shift && key === 'c') return MENU_SHORTCUTS['⇧⌘C'];
  if (meta && !shift && key === 'l') return MENU_SHORTCUTS['⌘L'];
  if (meta && !shift && key === 'd') return MENU_SHORTCUTS['⌘D'];
  if (alt && !meta && key === 'd') return MENU_SHORTCUTS['⌥D'];
  if (alt && !meta && key === 'b') return MENU_SHORTCUTS['⌥B'];
  return null;
}
