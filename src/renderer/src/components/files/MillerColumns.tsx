import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, File, Folder, Loader2 } from 'lucide-react';
import type { FileInfo, SvnStatusEntry } from '@shared/types';

const FILE_CACHE_TIME = 5 * 60 * 1000;

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
}

export function MillerColumns({
  path,
  baseRoot,
  selectedPath,
  onNavigate,
  onSelect,
}: MillerColumnsProps) {
  const columns = useMemo(() => buildColumnPaths(path, baseRoot), [path, baseRoot]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the deepest (current) column in view as you drill down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  return (
    <div ref={scrollRef} className="flex-1 flex overflow-x-auto overflow-y-hidden">
      {columns.map((dirPath, index) => (
        <MillerColumn
          key={dirPath}
          dirPath={dirPath}
          activeChildPath={columns[index + 1]}
          selectedPath={selectedPath}
          onNavigate={onNavigate}
          onSelect={onSelect}
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
}

function MillerColumn({
  dirPath,
  activeChildPath,
  selectedPath,
  onNavigate,
  onSelect,
}: MillerColumnProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['fs:listDirectory', dirPath],
    queryFn: () => window.api.fs.listDirectory(dirPath),
    enabled: !!dirPath,
    staleTime: FILE_CACHE_TIME,
    gcTime: FILE_CACHE_TIME,
  });

  const entries = useMemo(() => sortEntries(data || []), [data]);

  return (
    <div className="w-60 flex-shrink-0 h-full border-r border-border overflow-y-auto scrollbar-overlay py-1">
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-3 py-2 text-xs text-text-muted">Empty</div>
      ) : (
        entries.map((entry) => {
          const isActive = activeChildPath === entry.path;
          const isSelected = selectedPath === entry.path;
          const Icon = entry.isDirectory ? Folder : File;
          return (
            <button
              key={entry.path}
              type="button"
              onClick={() =>
                entry.isDirectory
                  ? onNavigate(entry.path)
                  : onSelect({
                      path: entry.path,
                      status: ' ',
                      isDirectory: false,
                    })
              }
              className={`group flex items-center gap-2 w-full px-2.5 py-1.5 mx-0 text-sm text-left transition-fast ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : isSelected
                    ? 'bg-bg-elevated text-text'
                    : 'text-text-secondary hover:bg-bg-elevated hover:text-text'
              }`}
            >
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${
                  entry.isDirectory ? (isActive ? 'text-accent' : 'text-accent/80') : 'text-text-muted'
                }`}
              />
              <span className="flex-1 truncate">{entry.name}</span>
              {entry.isDirectory && (
                <ChevronRight
                  className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-faint'}`}
                />
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
