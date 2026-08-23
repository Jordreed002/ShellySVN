import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderDown, FolderMinus, PanelRightClose } from 'lucide-react';

import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import { ContextMenu, useContextMenu } from '@renderer/components/ui/ContextMenu';
import { LockManagementDialog } from '@renderer/components/ui/LockManagementDialog';
import { useSettings } from '@renderer/hooks/useSettings';

import { RepoAddressBar, type RepoAddressBarHandle } from './components/RepoAddressBar';
import { RepoBrowserShell } from './components/RepoBrowserShell';
import { RepoContents } from './components/RepoContents';
import { DetailMessage, RepoDetailPane } from './components/RepoDetailPane';
import { RepoNavBar } from './components/RepoNavBar';
import { RepoTree } from './components/RepoTree';
import { BlameView } from './components/BlameView';
import { DiffView } from './components/DiffView';
import { PropertiesView } from './components/PropertiesView';
import { RevisionLogView } from './components/RevisionLogView';
import { WorkingCopyBand } from './components/WorkingCopyBand';
import { ProblemsDialog } from './components/ProblemsDialog';
import { MergeDialog, type MergeMode } from './components/MergeDialog';
import { RevisionPickerDialog, type RevisionPickerMode } from './components/RevisionPickerDialog';
import { SwitchDialog, type SwitchSelection } from './components/SwitchDialog';
import { CompareDialog, type CompareMode } from './components/CompareDialog';
import { ShelfDialog, type ShelfAction } from './components/ShelfDialog';
import { RemoteOpDialog, type RemoteOpRequest } from './components/RemoteOpDialog';
import { RevpropEditDialog } from './components/RevpropEditDialog';
import { RevisionDiffDialog } from '../../components/history/RevisionDiffDialog';

import {
  useRepoBlame,
  useRepoDiff,
  useRepoExternals,
  useRepoListing,
  useRepoLog,
  useRepoProperties,
  useRepositoryCheckouts,
  useRepoSort,
  useRepoTreeChildren,
  useWorkingCopyForPath,
  joinRepoUrl,
  REPO_BROWSER_QUERY_ROOT,
} from './hooks';
import { presenceFromCheckouts } from './adapters';
import { buildRepoBrowserMenu, matchMenuShortcut } from './repoBrowserMenu';
import { useRepoBrowserState } from './useRepoBrowserState';
import type { SvnUpdateDepth } from '@shared/types';

import type { LogEntry, RepoCopyToRequest, RepoEntry } from './types';

/**
 * The repository browser, composed.
 *
 * Data comes from the hooks; every component below is presentational. The
 * arrangement enforces the rule the whole design turns on: `useRepoListing`
 * receives `workingCopyRepoPaths` from `useWorkingCopyForPath`, and only paths
 * inside a checkout ever carry local status.
 */

export interface RepoBrowserViewProps {
  /** Repository root URL, e.g. `svn://svn.example.com/atlas`. */
  rootUrl: string;
  /** Local path of a working copy to bind to, when the route knows one. */
  localPath?: string;
  /** Repository-relative path to open at. */
  initialPath?: string;
  /** Merge source for eligible-revision counts, e.g. `^/…/trunk`. */
  mergeSource?: string | null;
  onCheckout?: (entry: RepoEntry | null, url: string) => void;
  onExport?: (entry: RepoEntry) => void;
  /**
   * Copy this path elsewhere in the repository. `request` carries what the user
   * chose in the `Copy to…` submenu — the shape of the destination and which
   * revision of the source to copy — so the route's dialog opens already
   * answering those two questions instead of asking them again.
   */
  onCopyTo?: (entry: RepoEntry, request: RepoCopyToRequest) => void;
  onCreateFolder?: (entry: RepoEntry) => void;
  onDelete?: (entry: RepoEntry) => void;
  onUpdate?: () => void;
  onCommit?: () => void;
  onRevealWorkingCopy?: (localPath: string) => void;
  /**
   * Reports which local checkout, if any, contains the path now on screen —
   * discovered rather than supplied. The route records it so the rest of the
   * shell describes the same working copy the footer does.
   */
  onWorkingCopyBound?: (localPath: string | null) => void;
}

/**
 * Subversion's four depths, worded as every other depth control in the app words
 * them. A folder can be big enough that fetching only its immediate children is
 * the entire reason for a sparse checkout, so this is a real choice, not a knob.
 */
const ADD_TO_WORKING_COPY_DEPTHS: ReadonlyArray<{ value: SvnUpdateDepth; label: string }> = [
  { value: 'infinity', label: 'Fully recursive — this folder and everything inside it' },
  { value: 'immediates', label: 'Immediate children — this folder, its files and subfolders' },
  { value: 'files', label: 'Files only — this folder and the files directly in it' },
  { value: 'empty', label: 'Only this item — the folder itself, nothing inside' },
];

export function RepoBrowserView({
  rootUrl,
  localPath,
  initialPath = '',
  mergeSource = null,
  onCheckout,
  onExport,
  onCopyTo,
  onCreateFolder,
  onDelete,
  onUpdate,
  onCommit,
  onRevealWorkingCopy,
  onWorkingCopyBound,
}: RepoBrowserViewProps): JSX.Element {
  const state = useRepoBrowserState({ initialPath });
  const { actions } = state;

  const addressRef = useRef<RepoAddressBarHandle>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeMode, setMergeMode] = useState<MergeMode>('sync');
  /**
   * `Merge from here…` merges *from the path you right-clicked*, which is not
   * necessarily the route's configured merge source. Null means "use the
   * configured source", so the band's own Merge button is unaffected.
   */
  const [menuMergeSource, setMenuMergeSource] = useState<string | null>(null);
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  const [locksOpen, setLocksOpen] = useState(false);
  const [locksPath, setLocksPath] = useState<string | null>(null);

  const { addBookmark } = useSettings();

  const [pegOpen, setPegOpen] = useState(false);
  const [pegMode, setPegMode] = useState<RevisionPickerMode>('head');
  const [pegRevisionValue, setPegRevisionValue] = useState('');
  const [pegDateValue, setPegDateValue] = useState('');

  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchSelection, setSwitchSelection] = useState<SwitchSelection>({ kind: 'url' });
  const [switchUrl, setSwitchUrl] = useState('');

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFrom, setCompareFrom] = useState('');
  const [compareTo, setCompareTo] = useState('');
  const [compareMode, setCompareMode] = useState<CompareMode>('summary');

  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfAction, setShelfAction] = useState<ShelfAction>('unshelve');

  /**
   * A pending repository-side write (#68, #69): mkdir / delete / move / copy
   * on URLs, each an immediate commit, each confirmed by `RemoteOpDialog`
   * with the affected-path count before anything runs.
   */
  const [remoteOp, setRemoteOp] = useState<RemoteOpRequest | null>(null);
  /** The revision whose revprops the log view's pencil opened (#70). */
  const [revpropTarget, setRevpropTarget] = useState<LogEntry | null>(null);
  /** The revision whose diff the log view's compare button opened (#72). */
  const [diffRevision, setDiffRevision] = useState<number | null>(null);

  /**
   * A directory the user asked to pull into the existing checkout, with the local
   * path it will occupy. Held as state so the confirmation can name both.
   */
  const [addToWcTarget, setAddToWcTarget] = useState<{
    entry: RepoEntry;
    localPath: string;
  } | null>(null);
  const [addToWcError, setAddToWcError] = useState<string | null>(null);
  const [isAddingToWc, setIsAddingToWc] = useState(false);
  /**
   * How much of the directory to fetch. Fetching everything is the common case
   * and stays the default, but a client folder can be large enough that pulling
   * only its immediate children is the whole point of a sparse checkout.
   */
  const [addToWcDepth, setAddToWcDepth] = useState<SvnUpdateDepth>('infinity');

  /** The inverse: a path to drop from the checkout while leaving the repository alone. */
  const [removeFromWcTarget, setRemoveFromWcTarget] = useState<{
    entry: RepoEntry;
    localPath: string;
  } | null>(null);
  const [removeFromWcError, setRemoveFromWcError] = useState<string | null>(null);
  const [isRemovingFromWc, setIsRemovingFromWc] = useState(false);

  const currentUrl = useMemo(() => joinRepoUrl(rootUrl, state.path), [rootUrl, state.path]);

  /*
   * Column sort, persisted per repository (#68). Navigation state does not
   * own it: it is a preference about *this repository*, and the store key is
   * the root URL.
   */
  const { sort: repoSort, setSortKey: setRepoSortKey } = useRepoSort(rootUrl);
  const queryClient = useQueryClient();

  /** Set below, once `listing` exists; avoids ordering the hooks around it. */
  const listingRefetchRef = useRef<(() => void) | null>(null);

  /*
   * ── which of the user's checkouts is relevant here? ──
   *
   * Browsing `clients/acme-corp/website/trunk` should show local state when
   * that path is checked out, whether or not the route happened to be given a
   * `localPath`. Requiring the caller to supply one meant the browser reported
   * "nothing checked out here" while the user's own checkout sat on disk.
   */
  const checkouts = useRepositoryCheckouts(rootUrl);
  const boundCheckout = useMemo(
    () => checkouts.findCheckoutFor(state.path),
    [checkouts, state.path]
  );
  const effectiveLocalPath = localPath ?? boundCheckout?.localPath;

  /*
   * Announce the binding once resolution has settled. Reporting while it is
   * still in flight would say "nothing checked out here" on every navigation
   * and then correct itself, which reads as a flicker rather than an answer.
   */
  useEffect(() => {
    if (localPath !== undefined || checkouts.isResolving) return;
    onWorkingCopyBound?.(boundCheckout?.localPath ?? null);
  }, [localPath, checkouts.isResolving, boundCheckout?.localPath, onWorkingCopyBound]);

  /* ── local truth first: everything else is gated on it ── */
  const workingCopy = useWorkingCopyForPath(state.path, effectiveLocalPath, {
    mergeSource,
    includeStatus: true,
    includeIncoming: true,
  });

  /*
   * Presence marks the exception: which folders in a *repository* listing have
   * anything on disk at all. Derived from the checkout list rather than from
   * status, because outside a checkout there is no status to derive it from.
   */
  const presenceByPath = useMemo(
    () => presenceFromCheckouts(checkouts.checkouts.map((checkout) => checkout.repoPath)),
    [checkouts.checkouts]
  );

  /* `svn:externals` is a repository property, so this works with no checkout. */
  const externals = useRepoExternals(currentUrl, state.path, state.peg);

  const listing = useRepoListing(currentUrl, state.peg, {
    repoPath: state.path,
    workingCopyRepoPaths: workingCopy.workingCopyRepoPaths,
    statusByPath: workingCopy.statusByPath,
    externalPaths: externals.externalPaths,
    presenceByPath,
  });

  listingRefetchRef.current = listing.refetch;

  /**
   * Fill a sparse checkout in place: `svn update --set-depth infinity` on the
   * local path the directory maps to. Deliberately *not* `svn checkout`, which
   * would create a second, unrelated working copy of the same subtree.
   */
  const runAddToWorkingCopy = useCallback(async () => {
    const target = addToWcTarget;
    const root = workingCopy.workingCopy?.localPath;
    if (!target || !root) return;

    setIsAddingToWc(true);
    setAddToWcError(null);
    try {
      const result = await window.api.svn.updateToRevision(
        root,
        target.entry.url,
        target.localPath,
        addToWcDepth,
        // Sticky, so later updates keep fetching this subtree at the depth
        // chosen here instead of quietly dropping back out.
        true
      );
      if (!result?.success) {
        setAddToWcError(result?.error || 'Subversion did not report why the update failed.');
        return;
      }
      setAddToWcTarget(null);
      // The subtree is on disk now, so status, presence and the listing are stale.
      workingCopy.refetch();
      listingRefetchRef.current?.();
    } catch (error) {
      setAddToWcError((error as Error)?.message ?? String(error));
    } finally {
      setIsAddingToWc(false);
    }
  }, [addToWcTarget, addToWcDepth, workingCopy]);

  /**
   * Drop a path from the checkout on disk with `svn update --set-depth exclude`.
   * The repository is untouched and nothing is scheduled for commit, which is
   * what distinguishes this from `svn delete` — and it is undone by "Add to
   * working copy…" on the same entry.
   */
  const runRemoveFromWorkingCopy = useCallback(async () => {
    const target = removeFromWcTarget;
    if (!target) return;

    setIsRemovingFromWc(true);
    setRemoveFromWcError(null);
    try {
      const result = await window.api.svn.exclude(target.localPath);
      if (!result?.success) {
        setRemoveFromWcError(result?.error || 'Subversion did not report why the removal failed.');
        return;
      }
      setRemoveFromWcTarget(null);
      // Gone from disk, so status, presence and the listing are all stale.
      workingCopy.refetch();
      listingRefetchRef.current?.();
    } catch (error) {
      setRemoveFromWcError((error as Error)?.message ?? String(error));
    } finally {
      setIsRemovingFromWc(false);
    }
  }, [removeFromWcTarget, workingCopy]);

  const expandedPaths = useMemo(() => Array.from(state.expanded), [state.expanded]);
  const tree = useRepoTreeChildren(expandedPaths, state.peg, {
    rootUrl,
    workingCopyRepoPaths: workingCopy.workingCopyRepoPaths,
    statusByPath: workingCopy.statusByPath,
    presenceByPath,
    /* Keyed by full repository path, so this only ever marks the externals of
       the directory it was read from — the tree's other nodes are unaffected
       rather than wrongly cleared. */
    externalPaths: externals.externalPaths,
  });

  /**
   * `svn shelf` is Subversion 1.14+ and can be reported unsupported by older
   * clients; that is a normal answer, not an error, so it is surfaced rather
   * than swallowed.
   */
  const shelves = useQuery({
    queryKey: ['repo-browser:shelves', workingCopy.workingCopy?.localPath ?? null],
    enabled: Boolean(workingCopy.workingCopy?.localPath),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const target = workingCopy.workingCopy?.localPath;
      if (!target) return { shelves: [], unsupportedReason: undefined };
      return window.api.svn.shelve.list(target);
    },
  });
  const latestShelf = shelves.data?.shelves?.[0] ?? null;

  /*
   * Every entry the browser knows about, by repository-relative path — the
   * listing plus whatever the tree pane has expanded. Drag sources are paths;
   * the confirmation dialog needs the entries behind them.
   */
  const entryByPath = useMemo(() => {
    const map = new Map<string, RepoEntry>();
    const addAll = (entries: readonly RepoEntry[] | undefined): void => {
      entries?.forEach((entry) => map.set(entry.path, entry));
    };
    addAll(listing.entries);
    for (const children of Object.values(tree.childrenByPath)) addAll(children);
    return map;
  }, [listing.entries, tree.childrenByPath]);

  /**
   * A drop landed (#68): resolve the dragged paths, open the shared
   * confirmation with the destination the pointer chose. The modifier keys
   * already decided move vs copy before this runs.
   */
  const handleDropEntries = useCallback(
    (sources: readonly string[], target: RepoEntry | null, operation: 'move' | 'copy') => {
      const entries = sources
        .map((path) => entryByPath.get(path))
        .filter((entry): entry is RepoEntry => entry !== undefined);
      if (entries.length === 0) return;
      setRemoteOp({
        kind: operation,
        entries,
        destinationPath: target ? target.path : state.path,
        destinationLocked: true,
      });
    },
    [entryByPath, state.path]
  );

  /** A repository write committed — every listing on screen is now stale. */
  const handleRemoteOpApplied = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [REPO_BROWSER_QUERY_ROOT] });
    workingCopy.refetch();
  }, [queryClient, workingCopy]);

  /** Revprop saved (#70): the log on screen still shows the old value. */
  const handleRevpropSaved = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [REPO_BROWSER_QUERY_ROOT, 'log'] });
  }, [queryClient]);

  /* ── the selected entry drives the detail pane ── */
  const selectedEntry = useMemo(
    () => listing.entries.find((entry) => entry.path === state.selectedPath) ?? null,
    [listing.entries, state.selectedPath]
  );
  const selectedUrl = selectedEntry?.url ?? currentUrl;

  const log = useRepoLog(selectedUrl, state.peg, { enabled: state.detailTab === 'log' });
  const blame = useRepoBlame(selectedUrl, {
    enabled: state.detailTab === 'blame' && selectedEntry?.kind === 'file',
  });
  const diff = useRepoDiff(
    selectedUrl,
    state.comparand,
    workingCopy.workingCopy?.localPath ?? null,
    {
      enabled: state.detailTab === 'diff' && selectedEntry?.kind === 'file',
    }
  );
  const properties = useRepoProperties(selectedUrl, state.peg, {
    enabled: state.detailTab === 'properties',
  });

  /* Repository-wide search widens the listing; folder search filters it. */
  const visibleEntries = useMemo(() => {
    if (!state.filter) return listing.entries;
    const needle = state.filter.toLowerCase();
    return listing.entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [listing.entries, state.filter]);

  const rootEntry = useMemo<RepoEntry>(
    () => ({
      name: rootUrl.split('/').filter(Boolean).pop() ?? 'repository',
      path: '',
      url: rootUrl,
      kind: 'dir',
      revision: workingCopy.workingCopy?.headRevision ?? 0,
      author: '',
      date: '',
    }),
    [rootUrl, workingCopy.workingCopy?.headRevision]
  );

  /**
   * The directory currently being listed, as an entry.
   *
   * Keyboard shortcuts act on the selected row when there is one and on this
   * otherwise — "show the log" with nothing selected means the log of where you
   * are standing. Carries no revision or author of its own: those belong to the
   * listing, and inventing them here would put a made-up number one prop away
   * from something that displays it.
   */
  const currentDirEntry = useMemo<RepoEntry>(
    () =>
      state.path === ''
        ? rootEntry
        : {
            name: state.path.split('/').pop() ?? state.path,
            path: state.path,
            url: currentUrl,
            kind: 'dir',
            revision: 0,
            author: '',
            date: '',
          },
    [state.path, currentUrl, rootEntry]
  );

  const openEntry = useCallback(
    (entry: RepoEntry) => {
      if (entry.kind === 'dir') actions.navigate(entry.path);
      else actions.select(entry.path);
    },
    [actions]
  );

  /**
   * The repository-browser context menu.
   *
   * The structure and the wording are the prototype's; the *table* — which item
   * runs which `svn` command, and which items a missing checkout disables — is
   * `buildRepoBrowserMenu`, kept pure so it can be tested without a repository.
   * This memo does nothing but hand it the facts and the handlers.
   */
  const menuHandlers = useMemo(
    () => ({
      onOpen: openEntry,
      onCheckout: (target) => onCheckout?.(target, target.url),
      onAddToWorkingCopy: (target, targetLocalPath) => {
        setAddToWcDepth('infinity');
        setAddToWcTarget({ entry: target, localPath: targetLocalPath });
      },
      onRemoveFromWorkingCopy: (target, targetLocalPath) => {
        setRemoveFromWcTarget({ entry: target, localPath: targetLocalPath });
      },
      onExport: (target) => onExport?.(target),
      onSwitch: (target) => {
        /*
         * `svn switch` requires the target URL and the working-copy path to be
         * the same node kind, and the path being switched is the checkout root
         * — a directory. Offering a file's own URL produced a command
         * Subversion refuses, so a file switches to the directory holding it.
         */
        setSwitchUrl(target.kind === 'dir' ? target.url : target.url.replace(/\/[^/]+$/, ''));
        setSwitchSelection({ kind: 'url' });
        setSwitchOpen(true);
      },
      onMerge: (target) => {
        setMenuMergeSource(target.url);
        setMergeMode('sync');
        setMergeOpen(true);
      },
      onOpenShelf: () => setShelfOpen(true),
      onShowLog: (target) => {
        actions.select(target.path);
        actions.setDetailTab('log');
      },
      onDiff: (target) => {
        actions.select(target.path);
        actions.setDetailTab('diff');
      },
      onBlame: (target) => {
        actions.select(target.path);
        actions.setDetailTab('blame');
      },
      onProperties: (target) => {
        actions.select(target.path);
        actions.setDetailTab('properties');
      },
      onCompare: (target) => {
        setCompareFrom(`${target.url} @ HEAD`);
        setCompareTo('');
        setCompareOpen(true);
      },
      onSearchHere: (target) => {
        // "Inside this folder" means the folder itself for a directory, and
        // the one you are already looking at for a file.
        if (target.kind === 'dir') actions.navigate(target.path);
        actions.setScope('folder');
        filterRef.current?.focus();
      },
      onCopyTo: (target, request) => onCopyTo?.(target, request),
      /*
       * Repository writes (#68, #69). A route-provided handler keeps priority
       * — it may implement its own flow — and the in-feature confirmation
       * dialog is the default, so the menu items work wherever the route
       * supplies nothing (today it supplies nothing for all three).
       */
      onMoveTo: (target) => setRemoteOp({ kind: 'move', entries: [target] }),
      onCreateFolder: (target) => {
        if (onCreateFolder) onCreateFolder(target);
        else setRemoteOp({ kind: 'mkdir', entries: [target] });
      },
      onManageLocks: (_target, path) => {
        setLocksPath(path);
        setLocksOpen(true);
      },
      onDelete: (target) => {
        if (onDelete) onDelete(target);
        else setRemoteOp({ kind: 'delete', entries: [target] });
      },
      onBookmark: (target, path) => void addBookmark(path, target.name),
      onCopyUrl: (target: RepoEntry) => void navigator.clipboard?.writeText(target.url),
    }),
    [actions, openEntry, addBookmark, onCheckout, onExport, onCopyTo, onCreateFolder, onDelete]
  );

  const buildMenuFor = useCallback(
    (entry: RepoEntry) =>
      buildRepoBrowserMenu({
        entry,
        workingCopy: workingCopy.workingCopy,
        headRevision: workingCopy.workingCopy?.headRevision ?? null,
        shelfName: latestShelf?.name ?? null,
        handlers: menuHandlers,
      }),
    [workingCopy.workingCopy, latestShelf, menuHandlers]
  );

  const menu = useMemo(() => {
    const entry = (contextMenu?.data as RepoEntry | undefined) ?? null;
    return entry ? buildMenuFor(entry) : null;
  }, [contextMenu, buildMenuFor]);

  /**
   * The accelerators the context menu advertises, actually bound.
   *
   * They are dispatched *through the menu itself*: the key finds the item by id
   * and invokes it only when that item is enabled. A shortcut therefore cannot
   * drift from the menu entry it is printed next to, and cannot fire an
   * operation the menu would have refused — the checkout-gating and kind-gating
   * in `buildRepoBrowserMenu` apply to both automatically.
   */
  const shortcutTarget = selectedEntry ?? currentDirEntry;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from a field the user is typing in.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }

      const id = matchMenuShortcut(event);
      if (!id) return;

      const item = buildMenuFor(shortcutTarget).items.find((entry) => entry.id === id);
      // An item that is absent or disabled here is refused in the menu too;
      // let the key fall through rather than silently swallowing it.
      if (!item || item.disabled || !item.onClick) return;

      event.preventDefault();
      item.onClick();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [buildMenuFor, shortcutTarget]);

  const detailBody = (() => {
    switch (state.detailTab) {
      case 'blame':
        return (
          <BlameView
            lines={blame.lines}
            path={state.selectedPath ?? undefined}
            /* The range comparison (#71) re-runs `svn blame` against this target;
               a repo-relative `path` is not something svn accepts. */
            blameUrl={selectedUrl}
            loading={blame.loading}
            error={blame.error}
            onRevisionClick={(revision) => {
              actions.setPeg({ kind: 'revision', revision });
              actions.setDetailTab('log');
            }}
          />
        );
      case 'log':
        return (
          <RevisionLogView
            entries={log.entries}
            path={state.selectedPath ?? state.path}
            loading={log.isLoading}
            error={log.error}
            hasMore={log.hasNextPage}
            loadingMore={log.isFetchingNextPage}
            onLoadMore={log.fetchNextPage}
            onSelectRevision={(revision) => actions.setPeg({ kind: 'revision', revision })}
            onRetry={log.refetch}
            onEditRevprops={setRevpropTarget}
            onShowChanges={setDiffRevision}
          />
        );
      case 'properties':
        return (
          <PropertiesView
            properties={properties.properties}
            path={state.selectedPath ?? state.path}
            loading={properties.loading}
            error={properties.error}
          />
        );
      case 'diff':
      default:
        if (!selectedEntry) {
          return (
            <DetailMessage
              title="Nothing selected"
              detail="Choose a file in the listing to see how it differs from the comparison on the left."
            />
          );
        }
        if (selectedEntry.kind !== 'file') {
          return (
            <DetailMessage
              title="Directories have no diff"
              detail="Pick a file, or use Log to see what changed under this directory."
            />
          );
        }
        return (
          <DiffView
            hunks={diff.hunks}
            path={state.selectedPath ?? undefined}
            isBinary={diff.isBinary}
            comparisonLabel={diff.comparisonLabel}
            loading={diff.loading}
            error={diff.unsupported ? diff.unsupported.reason : diff.error}
          />
        );
    }
  })();

  return (
    <>
      <RepoBrowserShell
        detailOpen={state.detailVisible}
        navBar={
          <RepoNavBar
            canGoBack={state.canGoBack}
            canGoForward={state.canGoForward}
            canGoUp={state.canGoUp}
            onBack={actions.goBack}
            onForward={actions.goForward}
            onUp={actions.goUp}
            onRefresh={listing.refetch}
            isRefreshing={listing.isFetching}
            filterText={state.filter}
            onFilterTextChange={actions.setFilter}
            searchScope={state.scope}
            onSearchScopeChange={actions.setScope}
            filterInputRef={filterRef}
            onCheckout={() => onCheckout?.(selectedEntry, selectedUrl)}
            /* #69: the toolbar's folder button is the same remote mkdir the
               context menu offers, pointed at the directory on screen. */
            onNewFolder={() => setRemoteOp({ kind: 'mkdir', entries: [currentDirEntry] })}
            canCreateFolder
            onToggleDetail={actions.toggleDetail}
            detailVisible={state.detailVisible}
            addressBar={
              <RepoAddressBar
                ref={addressRef}
                path={state.path}
                repositoryName={rootEntry.name}
                repositoryUrl={rootUrl}
                onNavigate={actions.navigate}
                peg={state.peg}
                onPegClick={() => setPegOpen(true)}
                headRevision={workingCopy.workingCopy?.headRevision}
              />
            }
          />
        }
        tree={
          <RepoTree
            showHeader
            onCollapseAll={actions.collapseAll}
            roots={[rootEntry]}
            childrenByPath={tree.childrenByPath}
            loadingPaths={tree.loadingPaths}
            childCountByPath={tree.childCountByPath}
            expandedPaths={state.expanded}
            selectedPath={state.path}
            isLoading={listing.isLoading}
            onToggleExpand={actions.toggleExpanded}
            onSelect={(entry) => actions.navigate(entry.path)}
            onSearchRequest={() => filterRef.current?.focus()}
            onContextMenu={(entry, event) => showContextMenu(event, entry)}
            onDropEntries={handleDropEntries}
            repoRootUrl={rootUrl}
          />
        }
        contents={
          <div className="flex h-full min-h-0 flex-col">
            {/* The band describes YOUR DISK, so it may only appear where the
                current path is actually inside the checkout — otherwise it
                contradicts the scope chip in the footer. */}
            {workingCopy.workingCopy && listing.scope === 'working-copy' ? (
              <WorkingCopyBand
                state={workingCopy.workingCopy}
                problemCount={workingCopy.problems.length}
                blockingProblemCount={
                  workingCopy.problems.filter((problem) => problem.severity === 'blocking').length
                }
                mergeSourceLabel={mergeSource ?? undefined}
                eligibleRevisionsAvailable={workingCopy.eligibleRevisionsAvailable}
                onShowProblems={() => setProblemsOpen(true)}
                onUpdate={() => onUpdate?.()}
                onCommit={() => onCommit?.()}
                onMerge={() => {
                  // The band merges the configured source, not whatever the
                  // context menu last pointed at.
                  setMenuMergeSource(null);
                  setMergeOpen(true);
                }}
                onReveal={
                  onRevealWorkingCopy && workingCopy.workingCopy
                    ? () => onRevealWorkingCopy(workingCopy.workingCopy?.localPath ?? '')
                    : undefined
                }
              />
            ) : null}
            <RepoContents
              entries={visibleEntries}
              scope={listing.scope}
              path={state.path}
              fromCache={listing.fromCache}
              cacheAgeMs={listing.cacheAgeMs}
              totalCount={listing.totalCount}
              sort={repoSort}
              onSortChange={(sort) => setRepoSortKey(sort.key)}
              selectedPaths={Array.from(state.checked)}
              onSelectionChange={(paths) => {
                actions.clearChecked();
                paths.forEach(actions.toggleChecked);
              }}
              activePath={state.selectedPath}
              onActivate={(entry) => actions.select(entry.path)}
              onOpen={openEntry}
              onNavigateUp={actions.goUp}
              filterText={state.filter}
              searchScope={state.scope}
              onWidenSearchScope={() => actions.setScope('repository')}
              onDiff={(entry) => {
                actions.select(entry.path);
                actions.setDetailTab('diff');
              }}
              onBlame={(entry) => {
                actions.select(entry.path);
                actions.setDetailTab('blame');
              }}
              onLog={(entry) => {
                actions.select(entry.path);
                actions.setDetailTab('log');
              }}
              onCheckout={(entry) => onCheckout?.(entry, entry.url)}
              onContextMenu={(entry, event) => showContextMenu(event, entry)}
              onCheckoutSelection={(selected) =>
                onCheckout?.(selected[0] ?? null, selected[0]?.url ?? currentUrl)
              }
              onExportSelection={(selected) => selected.forEach((entry) => onExport?.(entry))}
              onCopyUrls={(selected) =>
                void navigator.clipboard?.writeText(selected.map((entry) => entry.url).join('\n'))
              }
              onBatchDelete={(selected) => setRemoteOp({ kind: 'delete', entries: selected })}
              onBatchMove={(selected) => setRemoteOp({ kind: 'move', entries: selected })}
              onBatchCopy={(selected) => setRemoteOp({ kind: 'copy', entries: selected })}
              onDropEntries={handleDropEntries}
              repoRootUrl={rootUrl}
              error={listing.error}
              onRetry={listing.refetch}
              isRetrying={listing.isFetching}
            />
          </div>
        }
        detail={
          <RepoDetailPane
            path={state.selectedPath ?? state.path}
            tab={state.detailTab}
            onTabChange={actions.setDetailTab}
            comparand={state.comparand}
            onComparandChange={actions.setComparand}
            hasWorkingCopy={workingCopy.isWorkingCopy}
            showComparand={state.detailTab === 'diff'}
            comparandContext={{
              baseRevision: workingCopy.workingCopy?.baseRevision,
              headRevision: workingCopy.workingCopy?.headRevision,
            }}
            /* The prototype's `−`: closing the pane widens the listing enough
               for the author and size columns to come back (see the shell's
               `contentsDensity`). Without this the shell's detail-closed layout
               was unreachable. */
            actions={
              <button
                type="button"
                onClick={actions.toggleDetail}
                className="btn-icon-sm"
                title="Hide the detail pane"
                aria-label="Hide the detail pane"
              >
                <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
          >
            {detailBody}
          </RepoDetailPane>
        }
      />

      {contextMenu && menu ? (
        <ContextMenu
          items={menu.items}
          header={menu.header}
          position={contextMenu.position}
          onClose={hideContextMenu}
        />
      ) : null}

      <RevisionPickerDialog
        isOpen={pegOpen}
        onClose={() => setPegOpen(false)}
        path={`^/${state.path}`}
        headRevision={workingCopy.workingCopy?.headRevision ?? 0}
        currentPeg={state.peg}
        mode={pegMode}
        onModeChange={setPegMode}
        revisionValue={pegRevisionValue}
        onRevisionValueChange={setPegRevisionValue}
        dateValue={pegDateValue}
        onDateValueChange={setPegDateValue}
        recent={log.entries}
        onApply={(peg) => {
          actions.setPeg(peg);
          setPegOpen(false);
        }}
      />

      <CompareDialog
        isOpen={compareOpen}
        onClose={() => setCompareOpen(false)}
        fromValue={compareFrom}
        onFromChange={setCompareFrom}
        toValue={compareTo}
        onToChange={setCompareTo}
        mode={compareMode}
        onModeChange={setCompareMode}
        onCompare={() => setCompareOpen(false)}
      />

      {workingCopy.workingCopy ? (
        <SwitchDialog
          isOpen={switchOpen}
          onClose={() => setSwitchOpen(false)}
          workingCopy={workingCopy.workingCopy}
          /* Branch and tag candidates need a listing of the project's
             branches/ and tags/ folders; until the route supplies them the
             free-text URL field is the honest path. */
          targets={[]}
          selection={switchSelection}
          onSelectionChange={setSwitchSelection}
          customUrl={switchUrl}
          onCustomUrlChange={setSwitchUrl}
          onSwitch={() => setSwitchOpen(false)}
        />
      ) : null}

      {latestShelf ? (
        <ShelfDialog
          isOpen={shelfOpen}
          onClose={() => setShelfOpen(false)}
          shelf={{
            name: latestShelf.name,
            fileCount: 0,
            created: latestShelf.date,
          }}
          /* `svn shelf-list` does not enumerate the patch's files; showing an
             empty manifest is honest, inventing one is not. */
          files={[]}
          action={shelfAction}
          onActionChange={setShelfAction}
          onUnshelve={() => setShelfOpen(false)}
          onShareAsPatch={() => setShelfOpen(false)}
          onExportPatchFile={() => setShelfOpen(false)}
          onDropShelf={() => setShelfOpen(false)}
        />
      ) : null}

      {/* Locks are read with `svn status --show-updates` against a checkout, so
          the dialog only exists where one does — matching the menu item, which
          is disabled otherwise. */}
      {workingCopy.workingCopy ? (
        <LockManagementDialog
          isOpen={locksOpen}
          workingCopyPath={workingCopy.workingCopy.localPath}
          selectedPath={locksPath ?? undefined}
          onClose={() => setLocksOpen(false)}
        />
      ) : null}

      {addToWcTarget ? (
        <AccessibleDialog
          isOpen
          onClose={() => {
            setAddToWcTarget(null);
            setAddToWcError(null);
          }}
          title="Add to working copy"
          icon={FolderDown}
          size="md"
          description="Fetch this directory into the checkout you already have, without creating a second one."
        >
          <AccessibleDialogBody>
            <p className="text-xs leading-relaxed text-text-secondary">
              <b className="font-semibold text-text">{addToWcTarget.entry.name}</b> is in the
              repository but not on your disk. This fills it in inside the checkout you already have
              — it does <b className="font-semibold text-text">not</b> create a second working copy,
              and nothing already on disk is reverted or overwritten.
            </p>

            <dl className="mt-3 space-y-1.5 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <div className="flex gap-2">
                <dt className="eyebrow flex-none pt-px">From</dt>
                <dd
                  className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
                  style={{ direction: 'rtl', textAlign: 'left' }}
                  title={addToWcTarget.entry.url}
                >
                  <bdi>{addToWcTarget.entry.url}</bdi>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="eyebrow flex-none pt-px">Onto</dt>
                <dd
                  className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
                  style={{ direction: 'rtl', textAlign: 'left' }}
                  title={addToWcTarget.localPath}
                >
                  <bdi>{addToWcTarget.localPath}</bdi>
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <label htmlFor="add-to-wc-depth" className="mb-1.5 block text-xs font-bold text-text">
                How much to fetch
              </label>
              <select
                id="add-to-wc-depth"
                className="input"
                value={addToWcDepth}
                onChange={(event) => setAddToWcDepth(event.target.value as SvnUpdateDepth)}
                disabled={isAddingToWc}
              >
                {ADD_TO_WORKING_COPY_DEPTHS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {`svn update --set-depth ${addToWcDepth} "${addToWcTarget.localPath}"`}
              </code>
            </div>

            {addToWcError ? (
              <p className="mt-3 rounded-9 border border-svn-conflict/40 bg-svn-conflict/10 p-3 text-xs leading-relaxed text-text-secondary">
                {addToWcError}
              </p>
            ) : null}
          </AccessibleDialogBody>

          <AccessibleDialogFooter>
            <span className="mr-auto text-2xs text-text-muted">
              Sets the depth permanently, so later updates keep this subtree.
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setAddToWcTarget(null);
                setAddToWcError(null);
              }}
              disabled={isAddingToWc}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runAddToWorkingCopy()}
              disabled={isAddingToWc}
              aria-busy={isAddingToWc}
            >
              <FolderDown className="h-4 w-4" aria-hidden="true" />
              {isAddingToWc ? 'Adding…' : 'Add to working copy'}
            </button>
          </AccessibleDialogFooter>
        </AccessibleDialog>
      ) : null}

      {removeFromWcTarget ? (
        <AccessibleDialog
          isOpen
          onClose={() => {
            setRemoveFromWcTarget(null);
            setRemoveFromWcError(null);
          }}
          title="Remove from working copy"
          icon={FolderMinus}
          size="md"
          description="Drop this path from the checkout on disk. The repository keeps it."
        >
          <AccessibleDialogBody>
            <p className="text-xs leading-relaxed text-text-secondary">
              <b className="font-semibold text-text">{removeFromWcTarget.entry.name}</b> is removed
              from your disk only. The repository is <b className="font-semibold text-text">not</b>{' '}
              changed, nothing is scheduled for commit, and Subversion stops reporting it — later
              updates leave it out until you use{' '}
              <b className="font-semibold text-text">Add to working copy…</b> to fetch it back.
            </p>

            <dl className="mt-3 space-y-1.5 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <div className="flex gap-2">
                <dt className="eyebrow flex-none pt-px">Removes</dt>
                <dd
                  className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
                  style={{ direction: 'rtl', textAlign: 'left' }}
                  title={removeFromWcTarget.localPath}
                >
                  <bdi>{removeFromWcTarget.localPath}</bdi>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="eyebrow flex-none pt-px">Keeps</dt>
                <dd
                  className="min-w-0 flex-1 truncate font-mono text-11 text-text-secondary"
                  style={{ direction: 'rtl', textAlign: 'left' }}
                  title={removeFromWcTarget.entry.url}
                >
                  <bdi>{removeFromWcTarget.entry.url}</bdi>
                </dd>
              </div>
            </dl>

            <div className="mt-3 rounded-9 border border-border bg-bg-tertiary/40 p-3">
              <b className="block text-xs font-bold text-text">Command that will run</b>
              <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text-secondary">
                {`svn update --set-depth exclude "${removeFromWcTarget.localPath}"`}
              </code>
            </div>

            {removeFromWcError ? (
              <p className="mt-3 rounded-9 border border-svn-conflict/40 bg-svn-conflict/10 p-3 text-xs leading-relaxed text-text-secondary">
                {removeFromWcError}
              </p>
            ) : null}
          </AccessibleDialogBody>

          <AccessibleDialogFooter>
            <span className="mr-auto text-2xs text-text-muted">
              Unversioned or ignored files inside go to the trash — SVN has no copy of those.
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setRemoveFromWcTarget(null);
                setRemoveFromWcError(null);
              }}
              disabled={isRemovingFromWc}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runRemoveFromWorkingCopy()}
              disabled={isRemovingFromWc}
              aria-busy={isRemovingFromWc}
            >
              <FolderMinus className="h-4 w-4" aria-hidden="true" />
              {isRemovingFromWc ? 'Removing…' : 'Remove from working copy'}
            </button>
          </AccessibleDialogFooter>
        </AccessibleDialog>
      ) : null}

      <ProblemsDialog
        isOpen={problemsOpen}
        onClose={() => setProblemsOpen(false)}
        problems={workingCopy.problems}
      />

      {/* Repository-side writes (#68, #69): one shared confirmation, counting
          affected paths from the tree data the browser already holds. */}
      {remoteOp ? (
        <RemoteOpDialog
          request={remoteOp}
          rootUrl={rootUrl}
          peg={state.peg}
          childrenByPath={tree.childrenByPath}
          childCountByPath={tree.childCountByPath}
          onClose={() => setRemoteOp(null)}
          onApplied={handleRemoteOpApplied}
        />
      ) : null}

      {/* Revprop editing (#70): pre-filled from the log row, confirmed against
          a stated-permanent-and-logged notice, persisted via svn:revpropset. */}
      {revpropTarget ? (
        <RevpropEditDialog
          revision={revpropTarget.revision}
          path={state.selectedPath ?? state.path}
          targetUrl={selectedUrl}
          current={{
            log: revpropTarget.message,
            author: revpropTarget.author,
            date: revpropTarget.date,
          }}
          onClose={() => setRevpropTarget(null)}
          onSave={(name, value) =>
            window.api.svn.revpropset(selectedUrl, name, value, String(revpropTarget.revision))
          }
          onSaved={handleRevpropSaved}
        />
      ) : null}

      {/* Show-changes (#72): the selected revision diffed against its
          predecessor, shared with the working-copy history surface. */}
      <RevisionDiffDialog
        isOpen={diffRevision !== null}
        onClose={() => setDiffRevision(null)}
        path={state.selectedPath ?? state.path}
        revision={diffRevision}
      />

      {workingCopy.workingCopy ? (
        <MergeDialog
          isOpen={mergeOpen}
          onClose={() => setMergeOpen(false)}
          sourceUrl={menuMergeSource ?? mergeSource ?? ''}
          targetPath={workingCopy.workingCopy.localPath}
          eligible={[]}
          mode={mergeMode}
          onModeChange={setMergeMode}
          onDryRun={() => setMergeOpen(false)}
          onMerge={() => setMergeOpen(false)}
        />
      ) : null}
    </>
  );
}

export default RepoBrowserView;
