/**
 * Miller (column) browsing of the working copy.
 *
 * Design source: `prototypes/12-browser.html`. Each column is a narrow `.clist`:
 * a 32px `.chead` naming the folder, then 38px `.crow`s with a hairline rule and
 * the same `RepoStatusFlag` the list view and the repository browser use, so the
 * two view modes read as one product rather than two.
 */

import { useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, CloudOff, File, Folder } from 'lucide-react';
import type { FileInfo, SvnStatusChar, SvnStatusEntry } from '@shared/types';

import {
  RepoRollupFlags,
  RepoStatusFlag,
} from '../../features/repo-browser/components/RepoStatusFlag';
import type { RepoRollup, RepoStatusCode } from '../../features/repo-browser/types';
import { appendExcludedChildren } from '../../features/files/excludedChildren';
import { ContextMenu, useContextMenu } from '../ui/ContextMenu';
import { buildSvnContextMenuItems, type FileRowActions } from '../ui/FileRow';

/** Codes with a spelled-out flag; `' '` (clean) and `'O'` (not fetched) have none. */
const FLAGGED_STATUS = new Set<string>(['M', 'A', 'D', 'C', 'R', 'X', '?', 'I', '!', '~']);

function toRepoStatusCode(status: SvnStatusChar | undefined): RepoStatusCode | null {
  if (!status) return null;
  return FLAGGED_STATUS.has(status) ? (status as RepoStatusCode) : null;
}

/**
 * A clean folder holding changed files is the most useful thing a column can
 * tell you — it is how you find your own edits without opening every directory.
 * `svn status` gives one recursive count per directory, so conflicts are not
 * separable here; the count is reported as modified rather than guessed at.
 */
export function toRollup(entry: FileInfo): RepoRollup | null {
  if (!entry.isDirectory) return null;
  const changed = entry.svnStatus?.childChangeCount ?? 0;
  if (changed === 0) return null;
  return { modified: changed, added: 0, deleted: 0, conflicted: 0 };
}

const FILE_CACHE_TIME = 5 * 60 * 1000;

function toEntry(file: FileInfo): SvnStatusEntry {
  return {
    path: file.path,
    // Carried through so an excluded folder's context menu can resolve the
    // repository target it needs to be fetched back.
    remoteUrl: file.svnStatus?.remoteUrl,
    status: file.svnStatus?.status ?? ' ',
    isDirectory: file.isDirectory,
    revision: file.svnStatus?.revision,
    author: file.svnStatus?.author,
  };
}

function detectSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

/**
 * Build the chain of directory paths to render as columns, from `baseRoot`
 * (or the filesystem root) down to and including `path`.
 */
function buildColumnPaths(path: string, baseRoot: string | null): string[] {
  if (!path) return baseRoot ? [baseRoot] : [];
  const sep = detectSeparator(path);
  const clean = path.replace(/[\\/]+$/, '');

  if (baseRoot && (clean === baseRoot || clean.startsWith(baseRoot.replace(/[\\/]+$/, '') + sep))) {
    const base = baseRoot.replace(/[\\/]+$/, '');
    const cols = [base];
    const remainder = clean.slice(base.length).split(/[\\/]/).filter(Boolean);
    let acc = base;
    for (const seg of remainder) {
      acc = `${acc}${sep}${seg}`;
      cols.push(acc);
    }
    return cols;
  }

  // Fallback: full ancestor chain from the root.
  const segments = clean.split(/[\\/]/).filter(Boolean);
  const cols: string[] = [];
  let acc = clean.startsWith('/') ? '' : '';
  segments.forEach((seg, index) => {
    if (sep === '\\' && index === 0) {
      acc = `${seg}\\`;
    } else {
      acc = acc ? `${acc}${sep}${seg}` : `${sep}${seg}`;
    }
    cols.push(acc);
  });
  return cols.length > 0 ? cols : [clean];
}

interface MillerColumnsProps {
  path: string;
  baseRoot: string | null;
  selectedPath?: string;
  onNavigate: (path: string) => void;
  onSelect: (entry: SvnStatusEntry) => void;
  actions: FileRowActions;
  workingCopyRoot?: string;
}

export function MillerColumns({
  path,
  baseRoot,
  selectedPath,
  onNavigate,
  onSelect,
  actions,
  workingCopyRoot,
}: MillerColumnsProps) {
  const columns = useMemo(() => buildColumnPaths(path, baseRoot), [path, baseRoot]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the deepest (current) column in view as you drill down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  return (
    <div ref={scrollRef} className="absolute inset-0 flex overflow-x-auto overflow-y-hidden">
      {columns.map((dirPath, index) => (
        // Key is position within a base so sibling clicks update a column in
        // place (no remount flash), but changing baseRoot yields fresh columns.
        <MillerColumn
          key={`${baseRoot ?? 'root'}:${index}`}
          dirPath={dirPath}
          activeChildPath={columns[index + 1]}
          selectedPath={selectedPath}
          onNavigate={onNavigate}
          onSelect={onSelect}
          actions={actions}
          workingCopyRoot={workingCopyRoot}
        />
      ))}
    </div>
  );
}

function sortEntries(entries: FileInfo[]): FileInfo[] {
  return entries.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface MillerColumnProps {
  dirPath: string;
  activeChildPath?: string;
  selectedPath?: string;
  onNavigate: (path: string) => void;
  onSelect: (entry: SvnStatusEntry) => void;
  actions: FileRowActions;
  workingCopyRoot?: string;
}

function basename(p: string): string {
  const parts = p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || p;
}

function ColumnSkeleton() {
  return (
    <div className="px-3 pt-2" aria-hidden="true">
      {[82, 64, 90, 58, 74, 86, 60].map((w, i) => (
        <div
          key={i}
          className="mb-[22px] h-4 animate-pulse rounded bg-bg-elevated/50"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

function MillerColumn({
  dirPath,
  activeChildPath,
  selectedPath,
  onNavigate,
  onSelect,
  actions,
  workingCopyRoot,
}: MillerColumnProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['fs:listDirectory', dirPath],
    queryFn: () => window.api.fs.listDirectory(dirPath),
    enabled: !!dirPath,
    staleTime: FILE_CACHE_TIME,
    gcTime: FILE_CACHE_TIME,
    // Keep the column's current entries visible while a sibling/new path loads.
    placeholderData: keepPreviousData,
  });
  const { data: statusData } = useQuery({
    queryKey: ['fs:getStatus', dirPath],
    queryFn: () => window.api.fs.getStatus(dirPath),
    enabled: !!dirPath,
    staleTime: FILE_CACHE_TIME,
  });

  // Folders excluded from the checkout are absent from disk, so `listDirectory`
  // cannot report them and the column would offer no way to fetch them back.
  // This is the same offline `svn info --depth immediates` the list view reads.
  const isInsideWorkingCopy = Boolean(
    workingCopyRoot &&
    (dirPath === workingCopyRoot ||
      dirPath.startsWith(workingCopyRoot.replace(/[\\/]+$/, '') + detectSeparator(dirPath)))
  );
  const { data: childCommits } = useQuery({
    queryKey: ['svn:childCommits', dirPath],
    queryFn: () => window.api.svn.childCommits(dirPath),
    enabled: !!dirPath && isInsideWorkingCopy,
    staleTime: FILE_CACHE_TIME,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const entries = useMemo(() => {
    const files = appendExcludedChildren(data || [], childCommits, dirPath);
    if (
      !statusData ||
      !Array.isArray(statusData.allEntries) ||
      !statusData.directStatus ||
      typeof statusData.directStatus !== 'object'
    ) {
      return sortEntries(files);
    }
    const byPath = new Map(statusData.allEntries.map((entry) => [entry.fullPath, entry]));
    return sortEntries(
      files.map((file) => {
        const status = statusData.directStatus[file.name] ?? byPath.get(file.path);
        // An excluded folder has no `svn status` of its own — keep the
        // not-fetched marker the merge attached instead of blanking it.
        if (!status) return file;
        return {
          ...file,
          svnStatus: {
            ...status,
            path: file.path,
            isDirectory: file.isDirectory,
          },
        };
      })
    );
  }, [data, statusData, childCommits, dirPath]);
  const showSkeleton = isLoading && entries.length === 0;
  // Columns along the active trail (all but the deepest) get a faint tint.
  const onActiveTrail = activeChildPath !== undefined;

  return (
    <div
      className={`flex h-full w-[280px] flex-shrink-0 flex-col border-r border-border ${
        onActiveTrail ? 'bg-bg-secondary/25' : ''
      }`}
    >
      {/* Column header — the folder this column lists (`.chead`) */}
      <div className="flex h-8 flex-none items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-text-faint">
          {basename(dirPath)}
        </span>
        {!showSkeleton && entries.length > 0 && (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-text-faint">
            {entries.length}
          </span>
        )}
      </div>

      <div className="scrollbar-overlay flex-1 overflow-y-auto">
        {showSkeleton ? (
          <ColumnSkeleton />
        ) : entries.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-text-muted">Empty directory.</div>
        ) : (
          entries.map((entry) => {
            const isActive = activeChildPath === entry.path;
            const isSelected = !isActive && selectedPath === entry.path;
            const Icon = entry.isDirectory ? Folder : File;
            const statusCode = toRepoStatusCode(entry.svnStatus?.status);
            const rollup = statusCode ? null : toRollup(entry);
            // Nothing to open: the folder is in the working copy but not on disk.
            const notFetched = entry.svnStatus?.status === 'O';
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() =>
                  entry.isDirectory && !notFetched
                    ? onNavigate(entry.path)
                    : onSelect(toEntry(entry))
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  const svnEntry = toEntry(entry);
                  onSelect(svnEntry);
                  showContextMenu(e, svnEntry);
                }}
                className={`group relative flex h-[38px] w-full items-center gap-2 border-b border-border-muted px-3 text-left transition-fast ${
                  isActive
                    ? 'bg-accent/10'
                    : isSelected
                      ? 'bg-bg-secondary'
                      : 'hover:bg-bg-secondary'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[3px] bg-accent/70"
                  />
                )}
                <Icon
                  className={`h-[17px] w-[17px] flex-shrink-0 ${
                    notFetched
                      ? 'text-text-faint'
                      : entry.isDirectory
                        ? 'text-accent'
                        : 'text-text-muted'
                  }`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${
                    notFetched ? 'text-text-muted' : isActive ? 'text-accent' : 'text-text'
                  }`}
                  title={entry.path}
                >
                  {entry.name}
                </span>
                {notFetched && (
                  <span
                    className="flex-shrink-0 items-center gap-1 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
                    title="Excluded from this working copy — right-click to update it back"
                  >
                    <CloudOff className="mr-1 inline h-3 w-3 shrink-0" aria-hidden="true" />
                    Not checked out
                  </span>
                )}
                {statusCode && <RepoStatusFlag code={statusCode} />}
                {rollup && <RepoRollupFlags rollup={rollup} />}
                {entry.isDirectory && !notFetched && (
                  <ChevronRight
                    className={`h-3.5 w-3.5 flex-shrink-0 transition-opacity ${
                      isActive
                        ? 'text-accent opacity-100'
                        : 'text-text-faint opacity-0 group-hover:opacity-100'
                    }`}
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      {contextMenu && (
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
