import { useEffect, useState, lazy, Suspense } from 'react';
import { X, FileText, AlertTriangle, Loader, Image as ImageIcon, ExternalLink } from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { isImageFile } from './image-utils';
import { useSettings } from '@renderer/hooks/useSettings';
import { resolveExternalToolForPath } from '@renderer/utils/externalToolOverrides';
import { VirtualizedDiffViewer } from './VirtualizedDiffViewer';

// Lazy load ImageDiffViewer - only loaded when viewing image files
const ImageDiffViewer = lazy(() =>
  import('./ImageDiffViewer').then((m) => ({ default: m.ImageDiffViewer }))
);

interface DiffViewerProps {
  isOpen: boolean;
  filePath: string;
  onClose: () => void;
}

export function DiffViewer({ isOpen, filePath, onClose }: DiffViewerProps) {
  const { settings } = useSettings();
  const [diff, setDiff] = useState<SvnDiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImageDiff, setShowImageDiff] = useState(false);
  const [isOpeningExternal, setIsOpeningExternal] = useState(false);
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
      // For working copy diff, we compare BASE vs working file
      // Export BASE revision to a temp location for comparison
      const tempPath = await window.api.app.getPath('temp');
      const baseFileName = `.svn-tmp-base-${Date.now()}-${filePath.split(/[/\\]/).pop()}`;
      const basePath = `${tempPath}/${baseFileName}`;

      // Export the BASE revision
      await window.api.svn.export(filePath, basePath, 'BASE');

      // Open external diff tool with BASE (left) vs working copy (right)
      const result = await window.api.external.openDiffTool(externalDiffTool, basePath, filePath);

      if (!result.success) {
        setError(result.error || 'Failed to open external diff tool');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to open external diff tool');
    } finally {
      setIsOpeningExternal(false);
    }
  };

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

      window.api.svn
        .diff(filePath)
        .then((result) => {
          setDiff(result);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err.message || 'Failed to get diff');
          setIsLoading(false);
        });
    }
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
                <span className="text-text-secondary">Loading diff...</span>
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
                  <div className="flex flex-col items-center gap-3 text-center p-8">
                    {isImageFile(filePath) ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <FileText className="w-10 h-10 text-text-muted" />
                        <div>
                          <p className="text-text font-medium mb-1">Binary File</p>
                          <p className="text-text-secondary text-sm">
                            Cannot display diff for binary files
                          </p>
                          <button
                            onClick={() => window.api.external.openFile(filePath)}
                            className="btn btn-secondary mt-3"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open Externally
                          </button>
                        </div>
                      </>
                    )}
                  </div>
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
                <VirtualizedDiffViewer diff={diff} className="flex-1 min-h-0" />
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
