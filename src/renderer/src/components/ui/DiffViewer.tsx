import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import {
  X,
  FileText,
  AlertTriangle,
  Loader,
  Image as ImageIcon,
  ExternalLink,
  User,
  Binary,
} from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { isImageFile } from './image-utils';
import { useSettings } from '@renderer/hooks/useSettings';
import { resolveExternalToolForPath } from '@renderer/utils/externalToolOverrides';
import { VirtualizedDiffViewer } from './VirtualizedDiffViewer';
import type { BlameAnnotation } from '@renderer/lib/blameRange';

// Lazy load ImageDiffViewer - only loaded when viewing image files
const ImageDiffViewer = lazy(() =>
  import('./ImageDiffViewer').then((m) => ({ default: m.ImageDiffViewer }))
);

interface DiffViewerProps {
  isOpen: boolean;
  filePath: string;
  onClose: () => void;
  /**
   * Activated when a revision in the blame gutter is clicked. When omitted,
   * the revision's details are revealed inline instead (message, author,
   * date — via the existing `svn log` IPC).
   */
  onRevisionClick?: (revision: number, filePath: string) => void;
}

/** One revision's log entry, for the inline reveal card. */
interface RevisionDetail {
  revision: number;
  author: string;
  date: string;
  message: string;
}

export function DiffViewer({ isOpen, filePath, onClose, onRevisionClick }: DiffViewerProps) {
  const { settings } = useSettings();
  const [diff, setDiff] = useState<SvnDiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImageDiff, setShowImageDiff] = useState(false);
  const [isOpeningExternal, setIsOpeningExternal] = useState(false);

  // Blame gutter state (#46): loaded lazily on first toggle, one IPC call.
  const [showBlame, setShowBlame] = useState(false);
  const [blameLines, setBlameLines] = useState<readonly BlameAnnotation[] | null>(null);
  const [blameError, setBlameError] = useState<string | null>(null);
  const [revisionDetail, setRevisionDetail] = useState<RevisionDetail | null>(null);
  const [revisionDetailLoading, setRevisionDetailLoading] = useState(false);
  // Check if file is an image
  const isImage = isImageFile(filePath);

  // Check if external diff tool is configured
  const externalDiffTool = resolveExternalToolForPath(settings.diffMerge, filePath, 'diff');
  const hasExternalDiffTool = externalDiffTool !== '';

  // Open in external diff tool
  const handleOpenExternal = async () => {
    if (!hasExternalDiffTool) return;

    setIsOpeningExternal(true);
    try {
      const result = await window.api.external.openWorkingCopyDiff({
        toolId: externalDiffTool,
        workingPath: filePath,
      });

      if (!result.success) {
        setError(result.error || 'Failed to open external diff tool');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to open external diff tool');
    } finally {
      setIsOpeningExternal(false);
    }
  };

  // Reset per-file state when the target changes.
  useEffect(() => {
    setBlameLines(null);
    setBlameError(null);
    setShowBlame(false);
    setRevisionDetail(null);
  }, [filePath]);

  // Blame is fetched once per file, on demand — `svn blame` on a large file
  // is not free, so it never runs for viewers that never open the gutter.
  useEffect(() => {
    if (!isOpen || !showBlame || !filePath || isImage || blameLines || blameError) return;

    let cancelled = false;
    window.api.svn
      .blame(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setBlameError(result.error);
          return;
        }
        // `svn blame` reports uncommitted lines as r0/unknown; they get no
        // revision, exactly like the repo browser's BlameView.
        setBlameLines(
          result.lines.map((line) => ({
            revision: line.revision > 0 ? line.revision : null,
            author: line.revision > 0 ? line.author : '',
            date: line.revision > 0 ? line.date : '',
            lineNumber: line.lineNumber,
            content: line.content,
          }))
        );
      })
      .catch((err) => {
        if (!cancelled) setBlameError((err as Error).message || 'svn blame failed');
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, showBlame, filePath, isImage, blameLines, blameError]);

  // Reveal a revision: hand it to the embedder when it wants to navigate;
  // otherwise fetch the log entry and show it inline.
  const handleBlameRevisionClick = useCallback(
    (revision: number) => {
      if (onRevisionClick) {
        onRevisionClick(revision, filePath);
        return;
      }

      setRevisionDetailLoading(true);
      setRevisionDetail(null);
      window.api.svn
        .log(filePath, 1, revision, revision, false)
        .then((result) => {
          const entry = result.entries.find((candidate) => candidate.revision === revision);
          setRevisionDetail({
            revision,
            author: entry?.author ?? 'unknown',
            date: entry?.date ?? '',
            message: entry?.message?.trim() || '(no log message)',
          });
        })
        .catch(() => {
          setRevisionDetail({
            revision,
            author: 'unknown',
            date: '',
            message: 'Could not read the log entry for this revision.',
          });
        })
        .finally(() => setRevisionDetailLoading(false));
    },
    [onRevisionClick, filePath]
  );

  useEffect(() => {
    if (isOpen && filePath) {
      // If it's an image, show the image diff viewer
      if (isImage) {
        setShowImageDiff(true);
        setIsLoading(false);
        setDiff(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      setShowImageDiff(false);
      const controller = new AbortController();

      window.api.svn
        .diffStreaming(filePath, undefined, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setDiff(result);
          setIsLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err.message || 'Failed to get diff');
          setIsLoading(false);
        });

      return () => controller.abort();
    }
    return undefined;
  }, [isOpen, filePath, isImage]);

  // Keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // For image files, render ImageDiffViewer directly
  if (isImage && showImageDiff) {
    return (
      <Suspense
        fallback={
          <div className="modal-overlay">
            <div className="modal flex items-center justify-center">
              <Loader className="w-6 h-6 animate-spin text-accent" />
            </div>
          </div>
        }
      >
        <ImageDiffViewer isOpen={isOpen} filePath={filePath} onClose={onClose} />
      </Suspense>
    );
  }

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-[900px] max-w-[95vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <FileText className="w-5 h-5 text-accent" />
            Diff: {fileName}
          </h2>
          <div className="flex items-center gap-2">
            {hasExternalDiffTool && (
              <button
                onClick={handleOpenExternal}
                disabled={isOpeningExternal || isLoading}
                className="btn btn-secondary text-sm"
                title={`Open in ${externalDiffTool}`}
              >
                {isOpeningExternal ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                External
              </button>
            )}
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader className="w-8 h-8 text-accent animate-spin" />
                <span className="text-text-secondary">Loading diff…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center p-8">
                <AlertTriangle className="w-10 h-10 text-warning" />
                <div>
                  <p className="text-text font-medium mb-1">Failed to load diff</p>
                  <p className="text-text-secondary text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {diff && !isLoading && !error && (
            <>
              {diff.isBinary ? (
                <div className="flex-1 flex items-center justify-center">
                  {isImageFile(filePath) ? (
                    <div className="flex flex-col items-center gap-3 text-center p-8">
                      <ImageIcon className="w-10 h-10 text-accent" />
                      <div>
                        <p className="text-text font-medium mb-1">Image File</p>
                        <p className="text-text-secondary text-sm mb-3">
                          Visual comparison available
                        </p>
                        <button
                          onClick={() => setShowImageDiff(true)}
                          className="btn btn-primary"
                        >
                          <ImageIcon className="w-4 h-4" />
                          Open Visual Diff
                        </button>
                      </div>
                    </div>
                  ) : (
                    <BinaryFileInfoCard filePath={filePath} />
                  )}
                </div>
              ) : !diff.hasChanges ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-center p-8">
                    <FileText className="w-10 h-10 text-svn-normal" />
                    <div>
                      <p className="text-text font-medium mb-1">No Changes</p>
                      <p className="text-text-secondary text-sm">
                        This file has no local modifications
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col">
                  {/* Blame toggle + status row (#46) */}
                  <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 bg-bg-secondary border-b border-border text-xs">
                    <button
                      type="button"
                      onClick={() => setShowBlame((prev) => !prev)}
                      className={`btn-icon-sm text-xs px-2 ${
                        showBlame ? 'bg-accent/20 text-accent' : ''
                      }`}
                      aria-pressed={showBlame}
                      title="Show who last changed each line (svn blame)"
                    >
                      <User className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                      Blame
                    </button>
                    {showBlame && blameError && (
                      <span className="text-text-muted truncate" title={blameError}>
                        Blame unavailable: {blameError}
                      </span>
                    )}
                    {showBlame && !blameError && !blameLines && (
                      <span className="text-text-muted">Running svn blame…</span>
                    )}
                    {showBlame && blameLines && (
                      <span className="text-text-muted">
                        Colour intensity = age · click a revision to reveal it
                      </span>
                    )}
                  </div>

                  {/* Inline revision reveal (#46): the log entry for the
                      revision clicked in the gutter. */}
                  {(revisionDetail || revisionDetailLoading) && (
                    <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 bg-accent/10 border-b border-border text-xs">
                      <User className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
                      {revisionDetailLoading || !revisionDetail ? (
                        <span className="text-text-secondary">Reading revision…</span>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <b className="font-semibold text-text">r{revisionDetail.revision}</b>
                          <span className="text-text-secondary">
                            {' '}
                            · {revisionDetail.author}
                            {revisionDetail.date ? ` · ${revisionDetail.date}` : ''}
                          </span>
                          <p className="mt-0.5 text-text-secondary whitespace-pre-wrap break-words">
                            {revisionDetail.message}
                          </p>
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn-icon-sm flex-shrink-0"
                        onClick={() => setRevisionDetail(null)}
                        aria-label="Dismiss revision details"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <VirtualizedDiffViewer
                    diff={diff}
                    className="flex-1 min-h-0"
                    blameLines={showBlame ? blameLines : null}
                    onBlameRevisionClick={
                      showBlame && blameLines ? handleBlameRevisionClick : undefined
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer with stats */}
        {diff && diff.hasChanges && !diff.isBinary && (
          <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-t border-border flex items-center gap-4 text-sm">
            <span className="text-text-secondary">
              {diff.files.length} file{diff.files.length !== 1 ? 's' : ''} changed
            </span>
            <span className="text-svn-added">+{countLines(diff, 'added')} additions</span>
            <span className="text-svn-deleted">-{countLines(diff, 'removed')} deletions</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Info card for binary, non-image files (#48): what the file is and how big
 * it is, from `svn list` metadata — no file bytes cross the bridge. Rendered
 * instead of an empty diff; a binary change still has facts worth showing.
 */
function BinaryFileInfoCard({ filePath }: { filePath: string }) {
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const separator = filePath.lastIndexOf('/');
    const parent = separator > 0 ? filePath.slice(0, separator) : '.';
    const name = filePath.slice(separator + 1);

    // `svn list` of the parent directory reports each entry's size without
    // transferring contents. A failure (unversioned parent, offline) simply
    // leaves the size row off.
    window.api.svn
      .list(parent)
      .then((result) => {
        if (cancelled || result.error) return;
        const entry = result.entries.find((candidate) => candidate.name === name);
        if (entry && typeof entry.size === 'number') setSize(entry.size);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const kind = extension ? `.${extension} file` : 'Binary file';

  return (
    <div className="flex flex-col items-center gap-3 text-center p-8 max-w-md">
      <Binary className="w-10 h-10 text-text-muted" aria-hidden="true" />
      <div>
        <p className="text-text font-medium mb-1">Binary File</p>
        <p className="text-text-secondary text-sm mb-3">
          Subversion records that this file changed but has no line-based diff for it. Compare the
          revisions with an external diff tool.
        </p>
        <dl className="text-left text-xs text-text-secondary inline-flex flex-col gap-1 bg-bg-secondary border border-border rounded-lg px-4 py-3">
          <div className="flex gap-2">
            <dt className="text-text-muted w-16 flex-shrink-0">Type</dt>
            <dd className="font-mono break-all">{kind}</dd>
          </div>
          {size !== null && (
            <div className="flex gap-2">
              <dt className="text-text-muted w-16 flex-shrink-0">Size</dt>
              <dd className="font-mono">{formatBytes(size)}</dd>
            </div>
          )}
        </dl>
      </div>
      <button
        onClick={() => window.api.external.openFile(filePath)}
        className="btn btn-secondary mt-1"
      >
        <ExternalLink className="w-4 h-4" />
        Open Externally
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function countLines(diff: SvnDiffResult, type: 'added' | 'removed'): number {
  let count = 0;
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === type) count++;
      }
    }
  }
  return count;
}
