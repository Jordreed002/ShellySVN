import { useCallback, useMemo, useRef, useState } from 'react';

import type {
  Comparand,
  DetailTab,
  PegRevision,
  RepoSort,
  SearchScope,
} from './types';

/**
 * Navigation and view state for the repository browser.
 *
 * Deliberately holds no data — only *where you are looking and how*. Fetching
 * belongs to the route so this stays synchronous and testable.
 */

export interface RepoBrowserState {
  /** Repository-relative path of the directory being listed. '' is the repository root. */
  path: string;
  /** Path of the entry selected within the listing, if any. */
  selectedPath: string | null;
  /** Paths expanded in the tree. */
  expanded: ReadonlySet<string>;
  /** Paths ticked for a bulk operation. */
  checked: ReadonlySet<string>;
  sort: RepoSort;
  filter: string;
  scope: SearchScope;
  peg: PegRevision;
  detailTab: DetailTab;
  comparand: Comparand;
  detailVisible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
}

export interface RepoBrowserActions {
  navigate: (path: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  toggleExpanded: (path: string) => void;
  collapseAll: () => void;
  select: (path: string | null) => void;
  toggleChecked: (path: string) => void;
  clearChecked: () => void;
  setSort: (key: RepoSort['key']) => void;
  setFilter: (value: string) => void;
  setScope: (scope: SearchScope) => void;
  setPeg: (peg: PegRevision) => void;
  setDetailTab: (tab: DetailTab) => void;
  setComparand: (comparand: Comparand) => void;
  toggleDetail: () => void;
}

export interface UseRepoBrowserStateOptions {
  initialPath?: string;
  /** Paths expanded on first render — normally the ancestors of `initialPath`. */
  initialExpanded?: readonly string[];
}

/** Every ancestor of a path, including the root and the path itself. */
export function ancestorsOf(path: string): string[] {
  const out = [''];
  if (!path) return out;
  const segments = path.split('/');
  let accumulated = '';
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    out.push(accumulated);
  }
  return out;
}

/** Parent of a repository path, or '' at the root. */
export function parentOf(path: string): string {
  if (!path) return '';
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function useRepoBrowserState(
  options: UseRepoBrowserStateOptions = {}
): RepoBrowserState & { actions: RepoBrowserActions } {
  const { initialPath = '', initialExpanded } = options;

  const [path, setPath] = useState(initialPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(initialExpanded ?? ancestorsOf(initialPath))
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [sort, setSortState] = useState<RepoSort>({ key: 'name', direction: 'asc' });
  const [filter, setFilterState] = useState('');
  const [scope, setScopeState] = useState<SearchScope>('folder');
  const [peg, setPegState] = useState<PegRevision>({ kind: 'head' });
  const [detailTab, setDetailTabState] = useState<DetailTab>('diff');
  const [comparand, setComparandState] = useState<Comparand>('wc-base');
  const [detailVisible, setDetailVisible] = useState(true);

  /** Browser-style history. A ref because pushing must not itself re-render. */
  const history = useRef<string[]>([initialPath]);
  const historyIndex = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);

  /** Everything that is scoped to "the directory I am looking at" resets on navigation. */
  const enterPath = useCallback((next: string) => {
    setPath(next);
    setSelectedPath(null);
    setChecked(new Set<string>());
    setFilterState('');
    setExpanded((previous) => {
      const merged = new Set(previous);
      for (const ancestor of ancestorsOf(next)) merged.add(ancestor);
      return merged;
    });
  }, []);

  const navigate = useCallback(
    (next: string) => {
      if (next === history.current[historyIndex.current]) return;
      // Truncate any forward entries — this is a new branch of history.
      history.current = history.current.slice(0, historyIndex.current + 1);
      history.current.push(next);
      historyIndex.current = history.current.length - 1;
      setHistoryVersion((v) => v + 1);
      enterPath(next);
    },
    [enterPath]
  );

  const goBack = useCallback(() => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    setHistoryVersion((v) => v + 1);
    enterPath(history.current[historyIndex.current]);
  }, [enterPath]);

  const goForward = useCallback(() => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    setHistoryVersion((v) => v + 1);
    enterPath(history.current[historyIndex.current]);
  }, [enterPath]);

  const goUp = useCallback(() => {
    if (!path) return;
    navigate(parentOf(path));
  }, [navigate, path]);

  const toggleExpanded = useCallback((target: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpanded(new Set([''])), []);

  const toggleChecked = useCallback((target: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }, []);

  const clearChecked = useCallback(() => setChecked(new Set<string>()), []);

  /** Clicking the active column reverses it; a new column starts ascending. */
  const setSort = useCallback((key: RepoSort['key']) => {
    setSortState((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  }, []);

  const actions = useMemo<RepoBrowserActions>(
    () => ({
      navigate,
      goBack,
      goForward,
      goUp,
      toggleExpanded,
      collapseAll,
      select: setSelectedPath,
      toggleChecked,
      clearChecked,
      setSort,
      setFilter: setFilterState,
      setScope: setScopeState,
      setPeg: setPegState,
      setDetailTab: setDetailTabState,
      setComparand: setComparandState,
      toggleDetail: () => setDetailVisible((visible) => !visible),
    }),
    [
      navigate,
      goBack,
      goForward,
      goUp,
      toggleExpanded,
      collapseAll,
      toggleChecked,
      clearChecked,
      setSort,
    ]
  );

  // Referenced so history navigation recomputes the can-* flags.
  void historyVersion;

  return {
    path,
    selectedPath,
    expanded,
    checked,
    sort,
    filter,
    scope,
    peg,
    detailTab,
    comparand,
    detailVisible,
    canGoBack: historyIndex.current > 0,
    canGoForward: historyIndex.current < history.current.length - 1,
    canGoUp: path !== '',
    actions,
  };
}
