import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X, User, Search, Loader2, ExternalLink } from 'lucide-react';
import { useIssueTrackerConfig } from '@renderer/hooks/useIssueTrackerConfig';
import { extractIssueLinks, type IssueLink } from '@renderer/utils/issueTracker';

interface BlameViewerProps {
  isOpen: boolean;
  filePath: string;
  onClose: () => void;
  startRevision?: string;
  endRevision?: string;
}

interface BlameLine {
  lineNumber: number;
  revision: number;
  author: string;
  date: string;
  content: string;
  isMerged?: boolean;
  mergedFrom?: string;
}

interface RevisionContext {
  message: string;
  issues: IssueLink[];
}

export function BlameViewer({
  isOpen,
  onClose,
  filePath,
  startRevision,
  endRevision,
}: BlameViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightRevision, setHighlightRevision] = useState<number | null>(null);
  const [configPath, setConfigPath] = useState(filePath);
  const listRef = useRef<HTMLDivElement>(null);
  const { config: issueTrackerConfig } = useIssueTrackerConfig(configPath, filePath);

  // Fetch blame data
  const {
    data: blameData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['svn:blame', filePath, startRevision, endRevision],
    queryFn: async ({ signal }): Promise<BlameLine[]> => {
      const startRev = startRevision ? parseInt(startRevision, 10) : undefined;
      const endRev = endRevision ? parseInt(endRevision, 10) : undefined;

      const result = await window.api.svn.blame(filePath, startRev, endRev, { signal });

      return result.lines.map((line) => ({
        lineNumber: line.lineNumber,
        revision: line.revision,
        author: line.author,
        date: line.date,
        content: line.content,
      }));
    },
    enabled: isOpen && !!filePath,
  });

  // Get unique authors for legend
  const authors = useMemo(
    () =>
      blameData
        ? [...new Set(blameData.map((l) => l.author))].map((author) => ({
            author,
            color: getAuthorColor(author),
          }))
        : [],
    [blameData]
  );

  // Get unique revisions
  const revisions = useMemo(
    () =>
      blameData ? [...new Set(blameData.map((l) => l.revision))].toSorted((a, b) => b - a) : [],
    [blameData]
  );

  const { data: logData } = useQuery({
    queryKey: ['svn:log:blame-context', filePath, revisions.join(','), issueTrackerConfig],
    queryFn: ({ signal }) =>
      window.api.svn.log(filePath, Math.max(200, revisions.length), undefined, undefined, false, {
        signal,
      }),
    enabled: isOpen && !!filePath && revisions.length > 0,
  });

  const revisionContext = useMemo(() => {
    const contextMap = new Map<number, RevisionContext>();

    for (const entry of logData?.entries || []) {
      contextMap.set(entry.revision, {
        message: entry.message,
        issues: extractIssueLinks(entry.message, issueTrackerConfig),
      });
    }

    return contextMap;
  }, [logData, issueTrackerConfig]);

  // Filter lines by search
  const filteredLines = useMemo(
    () =>
      blameData?.filter((line) => {
        if (searchQuery === '') return true;

        const normalizedQuery = searchQuery.toLowerCase();
        const context = revisionContext.get(line.revision);
        const issueIds = context?.issues.map((issue) => issue.id.toLowerCase()).join(' ');
        const message = context?.message.toLowerCase();

        return (
          line.content.toLowerCase().includes(normalizedQuery) ||
          line.author.toLowerCase().includes(normalizedQuery) ||
          line.revision.toString().includes(searchQuery) ||
          Boolean(issueIds?.includes(normalizedQuery)) ||
          Boolean(message?.includes(normalizedQuery))
        );
      }) ?? [],
    [blameData, searchQuery, revisionContext]
  );

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 30,
    getItemKey: (index) => filteredLines[index]?.lineNumber ?? index,
    initialRect: { width: 1000, height: 480 },
    overscan: 20,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visibleRows =
    virtualRows.length > 0
      ? virtualRows
      : filteredLines.slice(0, Math.min(filteredLines.length, 25)).map((line, index) => ({
          index,
          key: line.lineNumber,
          size: 30,
          start: index * 30,
        }));

  const hasRevisionMessages = useMemo(
    () => Array.from(revisionContext.values()).some((context) => context.message.trim()),
    [revisionContext]
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveConfigPath() {
      if (!isOpen || !filePath) return;

      try {
        const context = await window.api.svn.getWorkingCopyContext(filePath);
        if (!cancelled) {
          setConfigPath(context?.workingCopyRoot || filePath);
        }
      } catch {
        if (!cancelled) {
          setConfigPath(filePath);
        }
      }
    }

    resolveConfigPath();

    return () => {
      cancelled = true;
    };
  }, [isOpen, filePath]);

  if (!isOpen) return null;

  const filename = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[1000px] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <User className="w-5 h-5 text-accent" />
            Blame: {filename}
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-4 px-4 py-2 bg-bg-tertiary border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search content, author, revision, message, or issue..."
              className="input pl-8"
            />
          </div>

          {highlightRevision && (
            <button onClick={() => setHighlightRevision(null)} className="text-sm text-accent">
              Clear highlight (r{highlightRevision})
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 bg-bg-secondary border-b border-border overflow-x-auto">
          <span className="text-xs text-text-muted">Authors:</span>
          {authors.map(({ author, color }) => (
            <div key={author} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded ${color}`} />
              <span className="text-xs text-text-secondary">{author}</span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div ref={listRef} className="modal-body h-[60vh] overflow-auto font-mono text-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-error">Failed to load blame data</div>
          ) : !filteredLines.length ? (
            <div className="text-center py-8 text-text-muted">No results found</div>
          ) : (
            <div className="min-w-[980px]">
              <div className="sticky top-0 z-10 grid grid-cols-[3rem_4rem_7rem_6rem_8rem_14rem_minmax(18rem,1fr)] bg-bg-primary text-left text-xs text-text-muted">
                <div className="px-2 py-1 border-b border-border">Line</div>
                <div className="px-2 py-1 border-b border-border">Rev</div>
                <div className="px-2 py-1 border-b border-border">Issues</div>
                <div className="px-2 py-1 border-b border-border">Author</div>
                <div className="px-2 py-1 border-b border-border">Date</div>
                <div className="px-2 py-1 border-b border-border">Message</div>
                <div className="px-2 py-1 border-b border-border">Content</div>
              </div>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {visibleRows.map((virtualRow) => {
                  const line = filteredLines[virtualRow.index];
                  const context = revisionContext.get(line.revision);
                  const issueLinks = context?.issues || [];

                  return (
                    <div
                      key={virtualRow.key}
                      className={`absolute left-0 top-0 grid w-full grid-cols-[3rem_4rem_7rem_6rem_8rem_14rem_minmax(18rem,1fr)] hover:bg-bg-tertiary cursor-pointer ${
                        highlightRevision === line.revision ? 'bg-accent/20' : ''
                      }`}
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      onClick={() =>
                        setHighlightRevision(
                          highlightRevision === line.revision ? null : line.revision
                        )
                      }
                    >
                      <div className="px-2 py-0.5 text-text-faint border-r border-border">
                        {line.lineNumber}
                      </div>
                      <div className="px-2 py-0.5 text-accent border-r border-border">
                        r{line.revision}
                      </div>
                      <div className="px-2 py-0.5 border-r border-border">
                        <IssueLinkList issues={issueLinks} onOpen={openIssueUrl} />
                      </div>
                      <div
                        className={`px-2 py-0.5 border-r border-border ${getAuthorColor(line.author).replace('bg-', 'text-')}`}
                      >
                        {line.author}
                      </div>
                      <div className="px-2 py-0.5 text-text-faint border-r border-border">
                        {new Date(line.date).toLocaleDateString()}
                      </div>
                      <div
                        className="max-w-56 truncate px-2 py-0.5 text-text-secondary border-r border-border"
                        title={context?.message || 'No log message available'}
                      >
                        {context?.message?.trim() || (
                          <span className="italic text-text-faint">
                            {hasRevisionMessages ? 'No message' : 'Loading...'}
                          </span>
                        )}
                      </div>
                      <div className="overflow-hidden text-ellipsis whitespace-pre px-2 py-0.5">
                        {line.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-sm text-text-faint">
            {filteredLines.length} lines
            {revisions.length > 0 && `, ${revisions.length} revisions`}
          </div>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function openIssueUrl(url?: string) {
  if (!url) return;
  void window.api.app.openExternal(url);
}

function IssueLinkList({
  issues,
  onOpen,
}: {
  issues: IssueLink[];
  onOpen: (url?: string) => void;
}) {
  if (issues.length === 0) {
    return <span className="text-text-faint">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {issues.slice(0, 2).map((issue) =>
        issue.url ? (
          <button
            key={issue.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(issue.url);
            }}
            className="inline-flex items-center gap-1 rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-xs text-accent hover:bg-bg-tertiary"
            title={issue.url}
          >
            {issue.id}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <span
            key={issue.id}
            className="rounded border border-border bg-bg-secondary px-1.5 py-0.5 text-xs text-text-secondary"
          >
            {issue.id}
          </span>
        )
      )}
    </div>
  );
}

// Generate consistent colors for authors
function getAuthorColor(author: string): string {
  const colors = [
    'bg-red-500/30',
    'bg-blue-500/30',
    'bg-green-500/30',
    'bg-yellow-500/30',
    'bg-purple-500/30',
    'bg-pink-500/30',
    'bg-indigo-500/30',
    'bg-teal-500/30',
  ];

  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = author.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}
