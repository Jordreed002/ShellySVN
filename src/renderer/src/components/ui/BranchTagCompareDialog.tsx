import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, GitCompare, Loader2, X } from 'lucide-react';
import type { BranchComparisonReport, SvnDiffResult } from '@shared/types';
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
  const [summary, setSummary] = useState<BranchComparisonReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLeftUrl(sourceUrl);
    setRightUrl(suggestComparisonUrl(sourceUrl));
    setDiff(null);
    setSummary(null);
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
    setSummary(null);

    try {
      const result = await window.api.svn.compareBranches(leftUrl.trim(), rightUrl.trim());
      setDiff(result.diff);
      setSummary(result.summary);
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

        <div className="flex flex-1 flex-col overflow-hidden bg-bg">
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

          {!isLoading && summary && (
            <section className="flex-shrink-0 border-b border-border bg-bg-sunk px-4 py-3">
              <div className="grid grid-cols-[auto_auto_1fr] items-start gap-4">
                <SummaryMetric label="Changed paths" value={summary.changedFiles.length} />
                <SummaryMetric
                  label="Unique revisions"
                  value={summary.leftOnlyRevisions.length + summary.rightOnlyRevisions.length}
                />
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                    Deterministic impact evidence
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.impactGroups.map((group) => (
                      <span
                        key={group.category}
                        className="rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary"
                        title={group.evidence
                          .slice(0, 10)
                          .map((item) => `r${item.revision} ${item.action} ${item.path}`)
                          .join('\n')}
                      >
                        {impactLabel(group.category)} · {group.evidence.length}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {(summary.leftOnlyRevisions.length > 0 || summary.rightOnlyRevisions.length > 0) && (
                <div className="mt-2 flex gap-4 font-mono text-[10px] text-text-muted">
                  <span title={summary.leftOnlyRevisions.join(', ')}>
                    Base only: {formatRevisions(summary.leftOnlyRevisions)}
                  </span>
                  <span title={summary.rightOnlyRevisions.join(', ')}>
                    Compare only: {formatRevisions(summary.rightOnlyRevisions)}
                  </span>
                </div>
              )}
            </section>
          )}

          {!isLoading &&
            diff &&
            diff.hasChanges &&
            (getDiffLineCount(diff) > 2000 ? (
              <VirtualizedDiffViewer diff={diff} className="min-h-0 flex-1" />
            ) : (
              <EnhancedDiffViewer
                diff={diff}
                filePath={`${leftUrl.trim()} -> ${rightUrl.trim()}`}
                className="min-h-0 flex-1"
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

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 border-l-2 border-accent pl-2">
      <div className="font-mono text-lg font-semibold text-text">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-faint">{label}</div>
    </div>
  );
}

function impactLabel(category: BranchComparisonReport['impactGroups'][number]['category']) {
  return category.replace('branch-or-tag', 'branches / tags').replace('documentation', 'docs');
}

function formatRevisions(revisions: number[]): string {
  if (revisions.length === 0) return 'none';
  const visible = revisions.slice(0, 8).map((revision) => `r${revision}`);
  return `${visible.join(', ')}${revisions.length > visible.length ? ` +${revisions.length - visible.length}` : ''}`;
}
