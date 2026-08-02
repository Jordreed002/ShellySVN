import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertCircle,
  CheckCircle,
  Cloud,
  FileDiff,
  FileText,
  Filter,
  Folder,
  History,
  LocateFixed,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { SvnStatusChar, SvnStatusEntry, SvnStatusResult } from '@shared/types';
import { assertSuccessfulSvnRead } from '@renderer/utils/svnReadResult';
import { AccessibleDialog } from '../AccessibleDialog';
import { StatusIcon } from './StatusIcon';

interface ModificationsViewProps {
  path: string;
  onClose: () => void;
  onDiff: (path: string) => void;
  onLog: (path: string) => void;
  onReveal: (path: string) => void;
  onResolve: (entry: SvnStatusEntry) => void;
}

type ModificationFilter =
  | 'all'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'missing'
  | 'conflicted'
  | 'obstructed'
  | 'unversioned'
  | 'switched'
  | 'locked'
  | 'remote';

const LOCAL_CHANGE_STATUSES = new Set<SvnStatusChar>(['M', 'R', 'A', 'D', 'C', '?', '!', '~']);

export function hasLocalChange(entry: SvnStatusEntry): boolean {
  return (
    LOCAL_CHANGE_STATUSES.has(entry.status) ||
    (!!entry.propsStatus && entry.propsStatus !== ' ') ||
    !!entry.switched ||
    !!entry.lock ||
    !!entry.treeConflict
  );
}

export function hasRemoteChange(entry: SvnStatusEntry): boolean {
  return !!entry.remoteStatus && entry.remoteStatus !== ' ';
}

function relativePath(root: string, target: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = target.replace(/\\/g, '/');
  return normalizedTarget.startsWith(`${normalizedRoot}/`)
    ? normalizedTarget.slice(normalizedRoot.length + 1)
    : normalizedTarget;
}

export function ModificationsView({
  path,
  onClose,
  onDiff,
  onLog,
  onReveal,
  onResolve,
}: ModificationsViewProps) {
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<ModificationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeRemote, setIncludeRemote] = useState(false);

  const queryKey = ['svn:modifications', path, includeRemote] as const;
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<SvnStatusResult> => {
      const result = includeRemote
        ? await window.api.svn.statusRemote(path, { signal })
        : await window.api.svn.status(path, { signal });
      if (result.entries.length > 0 && result.partial) return result;
      return assertSuccessfulSvnRead(result);
    },
    staleTime: 10_000,
  });

  const relevantEntries = useMemo(
    () => data?.entries.filter((entry) => hasLocalChange(entry) || hasRemoteChange(entry)) ?? [],
    [data]
  );

  const stats = useMemo(() => {
    const result = {
      all: relevantEntries.length,
      modified: 0,
      added: 0,
      deleted: 0,
      missing: 0,
      conflicted: 0,
      obstructed: 0,
      unversioned: 0,
      switched: 0,
      locked: 0,
      remote: 0,
    };
    for (const entry of relevantEntries) {
      if (entry.status === 'M' || entry.status === 'R' || entry.propsStatus === 'M')
        result.modified++;
      if (entry.status === 'A') result.added++;
      if (entry.status === 'D') result.deleted++;
      if (entry.status === '!') result.missing++;
      if (entry.status === 'C' || entry.treeConflict) result.conflicted++;
      if (entry.status === '~') result.obstructed++;
      if (entry.status === '?') result.unversioned++;
      if (entry.switched) result.switched++;
      if (entry.lock) result.locked++;
      if (hasRemoteChange(entry)) result.remote++;
    }
    return result;
  }, [relevantEntries]);

  const filteredEntries = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return relevantEntries.filter((entry) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'modified' &&
          (entry.status === 'M' || entry.status === 'R' || entry.propsStatus === 'M')) ||
        (filter === 'added' && entry.status === 'A') ||
        (filter === 'deleted' && entry.status === 'D') ||
        (filter === 'missing' && entry.status === '!') ||
        (filter === 'conflicted' && (entry.status === 'C' || !!entry.treeConflict)) ||
        (filter === 'obstructed' && entry.status === '~') ||
        (filter === 'unversioned' && entry.status === '?') ||
        (filter === 'switched' && !!entry.switched) ||
        (filter === 'locked' && !!entry.lock) ||
        (filter === 'remote' && hasRemoteChange(entry));
      return matchesFilter && (!needle || entry.path.toLowerCase().includes(needle));
    });
  }, [filter, relevantEntries, searchQuery]);

  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    getItemKey: (index) => filteredEntries[index]?.path ?? index,
    overscan: 12,
  });

  const checkRepository = () => {
    if (includeRemote) {
      void queryClient.invalidateQueries({ queryKey });
    } else {
      setIncludeRemote(true);
      setFilter('all');
    }
  };

  const filters: Array<{ id: ModificationFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: stats.all },
    { id: 'modified', label: 'Modified', count: stats.modified },
    { id: 'added', label: 'Added', count: stats.added },
    { id: 'deleted', label: 'Deleted', count: stats.deleted },
    { id: 'missing', label: 'Missing', count: stats.missing },
    { id: 'conflicted', label: 'Conflicts', count: stats.conflicted },
    { id: 'obstructed', label: 'Obstructed', count: stats.obstructed },
    { id: 'unversioned', label: 'Unversioned', count: stats.unversioned },
    { id: 'switched', label: 'Switched', count: stats.switched },
    { id: 'locked', label: 'Locked', count: stats.locked },
    ...(data?.remoteChecked
      ? [{ id: 'remote' as const, label: 'Repository', count: stats.remote }]
      : []),
  ];

  return (
    <AccessibleDialog
      isOpen
      onClose={onClose}
      title="Check for modifications"
      description={`Local working-copy truth for ${path}. Repository changes are checked only when requested.`}
      icon={FileDiff}
      size="full"
      className="h-[82vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-tertiary/45 px-5 py-3">
          <Filter className="h-4 w-4 text-text-muted" aria-hidden="true" />
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`btn-sm ${filter === item.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {item.label} <span className="font-mono text-[10px] opacity-75">{item.count}</span>
            </button>
          ))}
          <div className="min-w-[180px] flex-1" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter paths…"
            aria-label="Filter modified paths"
            className="input h-8 w-56"
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isFetching}
            onClick={checkRepository}
          >
            <Cloud className="h-4 w-4" />
            Check repository
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div
          role="table"
          aria-label="Working-copy modifications"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            role="row"
            className="grid grid-cols-[minmax(260px,1fr)_110px_110px_90px_90px] gap-3 border-b border-border px-5 py-2 font-mono text-2xs uppercase tracking-[0.08em] text-text-faint"
          >
            <span role="columnheader">Path</span>
            <span role="columnheader">Local</span>
            <span role="columnheader">Repository</span>
            <span role="columnheader">BASE</span>
            <span role="columnheader">HEAD</span>
          </div>

          <div
            ref={parentRef}
            role="rowgroup"
            className="min-h-0 flex-1 overflow-auto"
            aria-busy={isFetching}
          >
            {isLoading ? (
              <EmptyState icon={RefreshCw} spinning title="Reading working-copy status…" />
            ) : error ? (
              <EmptyState
                icon={ShieldAlert}
                tone="danger"
                title="Status could not be read"
                detail={error instanceof Error ? error.message : 'The SVN status request failed.'}
                action={
                  <button className="btn btn-secondary" onClick={() => void refetch()}>
                    Try again
                  </button>
                }
              />
            ) : filteredEntries.length === 0 ? (
              <EmptyState
                icon={CheckCircle}
                title={filter === 'all' ? 'Working copy is clean' : `No ${filter} paths`}
                detail={
                  data?.remoteChecked
                    ? 'No matching local or repository changes were found.'
                    : 'Use “Check repository” to include incoming changes from the server.'
                }
              />
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = filteredEntries[virtualRow.index];
                  return (
                    <ModificationRow
                      key={entry.path}
                      root={path}
                      entry={entry}
                      onDiff={onDiff}
                      onLog={onLog}
                      onReveal={onReveal}
                      onResolve={onResolve}
                      style={{
                        position: 'absolute',
                        insetInline: 0,
                        top: 0,
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-bg-tertiary/35 px-5 py-2 text-xs text-text-muted">
          <span>{filteredEntries.length} matching paths</span>
          <span className="truncate">
            {data?.partial || data?.parseError
              ? `Partial result${data.parseError ? ` — ${data.parseError}` : ''}`
              : data?.remoteChecked
                ? 'Local and repository status checked'
                : 'Local status only'}
          </span>
        </div>
      </div>
    </AccessibleDialog>
  );
}

function EmptyState({
  icon: Icon,
  spinning = false,
  tone = 'muted',
  title,
  detail,
  action,
}: {
  icon: typeof AlertCircle;
  spinning?: boolean;
  tone?: 'muted' | 'danger';
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[280px] place-items-center px-8 text-center">
      <div>
        <Icon
          className={`mx-auto mb-3 h-8 w-8 ${spinning ? 'animate-spin' : ''} ${tone === 'danger' ? 'text-danger' : 'text-text-muted'}`}
          aria-hidden="true"
        />
        <p className="font-semibold text-text">{title}</p>
        {detail ? <p className="mx-auto mt-1 max-w-xl text-sm text-text-muted">{detail}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function ModificationRow({
  root,
  entry,
  onDiff,
  onLog,
  onReveal,
  onResolve,
  style,
}: {
  root: string;
  entry: SvnStatusEntry;
  onDiff: (path: string) => void;
  onLog: (path: string) => void;
  onReveal: (path: string) => void;
  onResolve: (entry: SvnStatusEntry) => void;
  style: React.CSSProperties;
}) {
  const canDiff = !entry.isDirectory && ['M', 'R', 'A', 'C'].includes(entry.status);
  const isVersioned = entry.status !== '?';
  const revealOrDiff = () => (canDiff ? onDiff(entry.path) : onReveal(entry.path));

  return (
    <div
      role="row"
      tabIndex={0}
      aria-label={`${relativePath(root, entry.path)}, local status ${entry.status || 'none'}, repository status ${entry.remoteStatus || 'none'}`}
      className="group grid grid-cols-[minmax(260px,1fr)_110px_110px_90px_90px] items-center gap-3 border-b border-border-muted px-5 text-sm hover:bg-bg-tertiary/55"
      style={style}
      onDoubleClick={revealOrDiff}
      onKeyDown={(event) => {
        if (event.key === 'Enter') revealOrDiff();
      }}
    >
      <div role="cell" className="flex min-w-0 items-center gap-2.5">
        {entry.isDirectory ? (
          <Folder className="h-4 w-4 flex-none text-accent" />
        ) : (
          <FileText className="h-4 w-4 flex-none text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
          {relativePath(root, entry.path)}
        </span>
        {entry.changelist ? <span className="badge">{entry.changelist}</span> : null}
        {entry.switched ? <span className="badge">switched</span> : null}
        {entry.lock ? <span className="badge">locked</span> : null}
        <span className="hidden items-center gap-1 group-hover:flex group-focus-within:flex">
          {canDiff ? (
            <RowAction label="Diff" icon={FileDiff} onClick={() => onDiff(entry.path)} />
          ) : null}
          {isVersioned ? (
            <RowAction label="History" icon={History} onClick={() => onLog(entry.path)} />
          ) : null}
          {entry.status === 'C' || entry.treeConflict ? (
            <RowAction label="Resolve" icon={AlertCircle} onClick={() => onResolve(entry)} />
          ) : null}
          <RowAction label="Reveal" icon={LocateFixed} onClick={() => onReveal(entry.path)} />
        </span>
      </div>
      <div role="cell" className="flex items-center gap-2">
        {hasLocalChange(entry) ? <StatusIcon status={entry.status} size="sm" /> : <span>—</span>}
        {entry.propsStatus && entry.propsStatus !== ' ' ? (
          <span className="text-2xs">props</span>
        ) : null}
      </div>
      <div role="cell">
        {hasRemoteChange(entry) ? (
          <StatusIcon status={entry.remoteStatus!} size="sm" />
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>
      <span role="cell" className="font-mono text-xs text-text-muted">
        {entry.revision ?? '—'}
      </span>
      <span role="cell" className="font-mono text-xs text-text-muted">
        {entry.remoteRevision ?? '—'}
      </span>
    </div>
  );
}

function RowAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof FileDiff;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-icon-sm"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
