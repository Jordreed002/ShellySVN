import { useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, File, Folder } from 'lucide-react';
import type { FileInfo, SvnStatusEntry } from '@shared/types';

import { ContextMenu, useContextMenu } from '../ui/ContextMenu';
import { buildSvnContextMenuItems, type FileRowActions } from '../ui/FileRow';

const FILE_CACHE_TIME = 5 * 60 * 1000;

function toEntry(file: FileInfo): SvnStatusEntry {
  return { path: file.path, status: ' ', isDirectory: file.isDirectory };
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
    <div ref={scrollRef} className="flex-1 min-w-0 flex overflow-x-auto overflow-y-hidden">
      {columns.map((dirPath, index) => (
        <MillerColumn
          key={index}
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
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function ColumnSkeleton() {
  return (
    <div className="space-y-1 px-1 pt-0.5">
      {[82, 64, 90, 58, 74, 86, 60].map((w, i) => (
        <div
          key={i}
          className="h-7 rounded-lg bg-bg-elevated/50 animate-pulse"
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

  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const entries = useMemo(() => sortEntries(data || []), [data]);
  const showSkeleton = isLoading && entries.length === 0;
  // Columns along the active trail (all but the deepest) get a faint tint.
  const onActiveTrail = activeChildPath !== undefined;

  return (
    <div
      className={`w-64 flex-shrink-0 h-full border-r border-border-muted flex flex-col ${
        onActiveTrail ? 'bg-bg-secondary/25' : ''
      }`}
    >
      {/* Column header — the folder this column lists */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 flex-shrink-0">
        <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-text-muted truncate">
          {basename(dirPath)}
        </span>
        {!showSkeleton && entries.length > 0 && (
          <span className="ml-auto text-2xs text-text-faint tabular-nums">{entries.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-overlay px-1.5 pb-2 space-y-0.5">
        {showSkeleton ? (
          <ColumnSkeleton />
        ) : entries.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-text-faint">Empty folder</div>
        ) : (
          entries.map((entry) => {
            const isActive = activeChildPath === entry.path;
            const isSelected = !isActive && selectedPath === entry.path;
            const Icon = entry.isDirectory ? Folder : File;
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() =>
                  entry.isDirectory ? onNavigate(entry.path) : onSelect(toEntry(entry))
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  showContextMenu(e, toEntry(entry));
                }}
                className={`group relative flex items-center gap-2.5 w-full pl-3.5 pr-2.5 py-1.5 rounded-lg text-sm text-left transition-fast ${
                  isActive
                    ? 'bg-accent/10 text-accent font-medium'
                    : isSelected
                      ? 'bg-bg-elevated text-text'
                      : 'text-text-secondary hover:bg-bg-elevated hover:text-text'
                }`}
              >
                {isActive && (
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-accent" />
                )}
                <Icon
                  className={`w-4 h-4 flex-shrink-0 ${
                    entry.isDirectory
                      ? isActive
                        ? 'text-accent'
                        : 'text-accent/70'
                      : 'text-text-muted'
                  }`}
                />
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.isDirectory && (
                  <ChevronRight
                    className={`w-3.5 h-3.5 flex-shrink-0 transition-opacity ${
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
