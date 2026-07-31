/**
 * The folder tree of the working copy — the pane between the sidebar and the
 * file list on `/files`.
 *
 * Design source: `prototypes/12-browser.html` (`.treepane` / `.tnode`). The rows
 * are the repository browser's `RepoTree`, imported unchanged: one tree
 * component, one keyboard model, one set of badges. This file is only the
 * container that gives it working-copy data and turns a click into navigation.
 *
 * Status is legitimate here. `svn status` describes your disk, and this pane is
 * always inside a checkout, so roll-up badges are shown — sourced from the deep
 * scan the explorer has already run rather than from new `svn` processes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronsDownUp } from 'lucide-react';
import type { FsStatusResult, SvnStatusEntry } from '@shared/types';

import { RepoTree } from '../../features/repo-browser/components/RepoTree';
import type { RepoEntry } from '../../features/repo-browser/types';
import { ContextMenu, useContextMenu } from '../ui/ContextMenu';
import { buildSvnContextMenuItems, type FileRowActions } from '../ui/FileRow';
import { buildAncestorChain, isInsideRoot, useWorkingCopyTree } from './useWorkingCopyTree';

export interface WorkingCopyTreeProps {
  /** Absolute path the tree is rooted at — normally the working-copy root. */
  rootPath: string;
  /** Absolute path the file list is showing; highlighted and revealed. */
  currentPath: string;
  /** Recursive status for the current directory, when the explorer has it. */
  deepStatus?: FsStatusResult;
  /** Immediates-depth status for the current directory. */
  shallowStatus?: FsStatusResult;
  /** Repository URL of `rootPath`. */
  rootUrl?: string;
  /** Working-copy root, for the context menu's path-relative labels. */
  workingCopyRoot?: string;
  /** The file list's own row actions, reused verbatim by the tree's context menu. */
  actions?: FileRowActions;
  onNavigate: (path: string) => void;
}

/** A tree node carries no file facts; the context menu only needs the folder. */
function toSvnStatusEntry(entry: RepoEntry): SvnStatusEntry {
  return { path: entry.path, status: ' ', isDirectory: true };
}

export function WorkingCopyTree({
  rootPath,
  currentPath,
  deepStatus,
  shallowStatus,
  rootUrl,
  workingCopyRoot,
  actions,
  onNavigate,
}: WorkingCopyTreeProps): JSX.Element {
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  // Reveal where the file list currently is: expand the chain from the root down
  // to it, and drop anything left over from a previous working copy so we never
  // list directories that are no longer on screen.
  useEffect(() => {
    const chain = buildAncestorChain(rootPath, currentPath);
    setExpandedPaths((previous) => {
      const kept = Array.from(previous).filter((path) => isInsideRoot(rootPath, path));
      const missing = chain.filter((path) => !previous.has(path));
      if (missing.length === 0 && kept.length === previous.size) return previous;
      return new Set([...kept, ...chain]);
    });
  }, [rootPath, currentPath]);

  const { roots, childrenByPath, childCountByPath, loadingPaths, isLoading } = useWorkingCopyTree({
    rootPath,
    expandedPaths,
    deepStatus,
    shallowStatus,
    rootUrl,
  });

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (entry: RepoEntry) => {
      // Opening a folder in the tree and opening it in the list are the same act.
      setExpandedPaths((previous) =>
        previous.has(entry.path) ? previous : new Set([...previous, entry.path])
      );
      onNavigate(entry.path);
    },
    [onNavigate]
  );

  const handleContextMenu = useCallback(
    (entry: RepoEntry, event: React.MouseEvent<HTMLElement>) => {
      if (!actions) return;
      showContextMenu(event, toSvnStatusEntry(entry));
    },
    [actions, showContextMenu]
  );

  // "… N more — search instead": the search lives in the file list, so open the
  // folder there rather than pretending the tree can filter itself.
  const handleSearchRequest = useCallback(
    (containerPath: string) => onNavigate(containerPath),
    [onNavigate]
  );

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set(rootPath ? [rootPath] : []));
  }, [rootPath]);

  const canCollapse = useMemo(
    () => Array.from(expandedPaths).some((path) => path !== rootPath),
    [expandedPaths, rootPath]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[30px] flex-none items-center gap-2 border-b border-border px-3">
        <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-[0.13em] text-text-muted">
          Working copy
        </span>
        <button
          type="button"
          onClick={collapseAll}
          disabled={!canCollapse}
          className="grid place-items-center text-text-faint hover:text-text-secondary disabled:opacity-40"
          title="Collapse all"
          aria-label="Collapse all folders"
        >
          <ChevronsDownUp aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>

      <RepoTree
        roots={roots}
        childrenByPath={childrenByPath}
        childCountByPath={childCountByPath}
        expandedPaths={expandedPaths}
        loadingPaths={loadingPaths}
        selectedPath={currentPath}
        isLoading={isLoading}
        label="Working copy folders"
        onToggleExpand={handleToggleExpand}
        onSelect={handleSelect}
        onContextMenu={actions ? handleContextMenu : undefined}
        onSearchRequest={handleSearchRequest}
      />

      {contextMenu && actions && (
        <ContextMenu
          items={buildSvnContextMenuItems(
            contextMenu.data as SvnStatusEntry,
            actions,
            workingCopyRoot
          )}
          position={contextMenu.position}
          onClose={hideContextMenu}
        />
      )}
    </div>
  );
}

export default WorkingCopyTree;
