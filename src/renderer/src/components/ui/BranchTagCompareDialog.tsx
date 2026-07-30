import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, GitCompare, Loader2, X } from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { EnhancedDiffViewer } from './EnhancedDiffViewer';
import { VirtualizedDiffViewer } from './VirtualizedDiffViewer';

interface BranchTagCompareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sourceUrl?: string;
}

export function suggestComparisonUrl(sourceUrl: string): string {
  const trimmedUrl = sourceUrl.trim().replace(/\/+$/, '');
  if (!trimmedUrl) return '';

  const trunkMatch = trimmedUrl.match(/^(.*)\/trunk$/);
  if (trunkMatch) return `${trunkMatch[1]}/branches/`;

  const branchMatch = trimmedUrl.match(/^(.*)\/branches\/[^/]+$/);
  if (branchMatch) return `${branchMatch[1]}/trunk`;

  const tagMatch = trimmedUrl.match(/^(.*)\/tags\/[^/]+$/);
  if (tagMatch) return `${tagMatch[1]}/trunk`;

  return trimmedUrl;
}

function getDiffLineCount(diff: SvnDiffResult): number {
  let count = 0;
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      count += hunk.lines.length;
    }
  }
  return count;
}

export function BranchTagCompareDialog({
  isOpen,
  onClose,
  sourceUrl = '',
}: BranchTagCompareDialogProps) {
  const [leftUrl, setLeftUrl] = useState('');
  const [rightUrl, setRightUrl] = useState('');
  const [diff, setDiff] = useState<SvnDiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLeftUrl(sourceUrl);
    setRightUrl(suggestComparisonUrl(sourceUrl));
    setDiff(null);
    setError(null);
    setIsLoading(false);
  }, [isOpen, sourceUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const canCompare = useMemo(() => leftUrl.trim() && rightUrl.trim(), [leftUrl, rightUrl]);

  const handleCompare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCompare) return;

    setIsLoading(true);
    setError(null);
    setDiff(null);

    try {
      const result = await window.api.svn.diffUrls(leftUrl.trim(), rightUrl.trim());
      setDiff(result);
    } catch (err) {
      setError((err as Error).message || 'Failed to compare branches or tags');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal flex h-[82vh] w-[1100px] max-w-[96vw] flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <GitCompare className="h-5 w-5 text-accent" />
            Compare Branches or Tags
          </h2>
          <button type="button" onClick={onClose} className="btn-icon-sm" disabled={isLoading}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleCompare}
          className="flex-shrink-0 border-b border-border bg-bg-secondary px-4 py-3"
        >
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text-secondary">Base URL</span>
              <input
                type="text"
                value={leftUrl}
                onChange={(event) => setLeftUrl(event.target.value)}
                className="input h-9 text-sm"
                placeholder="https://svn.example.com/repo/trunk"
                disabled={isLoading}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-text-secondary">
                Compare URL
              </span>
              <input
                type="text"
                value={rightUrl}
                onChange={(event) => setRightUrl(event.target.value)}
                className="input h-9 text-sm"
                placeholder="https://svn.example.com/repo/branches/feature"
                disabled={isLoading}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary h-9"
              disabled={isLoading || !canCompare}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comparing
                </>
              ) : (
                <>
                  <GitCompare className="h-4 w-4" />
                  Compare
                </>
              )}
            </button>
          </div>
        </form>

        <div className="flex-1 overflow-hidden bg-bg">
          {error && (
            <div className="m-4 flex items-center gap-2 rounded border border-error/30 bg-error/10 p-3 text-sm text-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && (
            <div className="flex h-full items-center justify-center text-text-muted">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
              Comparing repository URLs…
            </div>
          )}

          {!isLoading &&
            diff &&
            diff.hasChanges &&
            (getDiffLineCount(diff) > 2000 ? (
              <VirtualizedDiffViewer diff={diff} className="h-full" />
            ) : (
              <EnhancedDiffViewer
                diff={diff}
                filePath={`${leftUrl.trim()} -> ${rightUrl.trim()}`}
                className="h-full"
              />
            ))}

          {!isLoading && diff && !diff.hasChanges && (
            <div className="flex h-full items-center justify-center text-text-muted">
              No differences found
            </div>
          )}

          {!isLoading && !diff && !error && (
            <div className="flex h-full items-center justify-center text-text-muted">
              Enter two branch, tag, or trunk URLs to compare
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
