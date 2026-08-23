/**
 * RevisionDiffDialog (#72) — "Show changes" for a single log entry.
 *
 * Runs `svn diff -c REV PATH` (revision against its predecessor) through the
 * existing `svn:diff` IPC and renders the result in the shared
 * VirtualizedDiffViewer — the same surface as the working-copy diff and the
 * DiffWizard. A secondary action reopens the same comparison inside the
 * DiffWizard for the full power treatment (URL operands, saved comparisons).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitCompare, RotateCcw } from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { withIpcTimeout } from '@renderer/lib/queryTimeout';
import { DialogBase } from '@renderer/components/ui/DialogBase';
import { VirtualizedDiffViewer } from '@renderer/components/ui/VirtualizedDiffViewer';
import { DiffWizard } from '@renderer/components/ui/DiffWizard';
import type { DiffComparisonSide } from '@renderer/lib/savedComparisons';

export interface RevisionDiffDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Working-copy path (or repository URL) the revision belongs to. */
  path: string | null;
  /** Revision whose changes are shown; null when closed. */
  revision: number | null;
}

export function RevisionDiffDialog({ isOpen, onClose, path, revision }: RevisionDiffDialogProps) {
  const [diff, setDiff] = useState<SvnDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const cancelledRef = useRef(false);

  const runDiff = useCallback(() => {
    if (!path || revision === null || revision < 1) return;
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);
    setDiff(null);

    withIpcTimeout(
      () => window.api.svn.diff(path, String(revision)),
      undefined,
      'svn:diff'
    )
      .then((result) => {
        if (cancelledRef.current) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setDiff(result);
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : 'svn diff failed');
      })
      .finally(() => {
        if (!cancelledRef.current) setIsLoading(false);
      });
  }, [path, revision]);

  useEffect(() => {
    if (!isOpen) {
      cancelledRef.current = true;
      setWizardOpen(false);
      return;
    }
    runDiff();
    return () => {
      cancelledRef.current = true;
    };
  }, [isOpen, runDiff, nonce]);

  const summary = useMemo(() => {
    if (!diff) return null;
    let additions = 0;
    let deletions = 0;
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added') additions += 1;
          else if (line.type === 'removed') deletions += 1;
        }
      }
    }
    return { files: diff.files.length, additions, deletions };
  }, [diff]);

  // Prefilled sides for the DiffWizard: the same path at REV-1 and REV.
  const wizardSides = useMemo(() => {
    if (!path || revision === null || revision < 2) return null;
    const left: DiffComparisonSide = {
      kind: 'working-copy',
      target: path,
      revision: String(revision - 1),
    };
    const right: DiffComparisonSide = { kind: 'working-copy', target: path, revision: String(revision) };
    return { left, right };
  }, [path, revision]);

  return (
    <>
      <DialogBase
        isOpen={isOpen}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-accent" aria-hidden="true" />
            Changes in r{revision ?? '?'}
            {path ? (
              <span className="truncate font-mono text-xs font-normal text-text-muted" title={path}>
                {path}
              </span>
            ) : null}
          </span>
        }
        dialogId="revision-diff"
        draggable
        resizable
        className="w-[980px] max-w-[95vw] h-[82vh]"
      >
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary">
            <span>
              {summary ? (
                <>
                  {summary.files} file{summary.files !== 1 ? 's' : ''} changed · r
                  {(revision ?? 1) - 1} → r{revision}
                  <span className="ml-2 text-svn-added">+{summary.additions}</span>
                  <span className="ml-1.5 text-svn-deleted">-{summary.deletions}</span>
                </>
              ) : (
                <>svn diff -c {revision ?? '?'} — this revision against its predecessor</>
              )}
            </span>
            {wizardSides && (
              <button
                type="button"
                className="btn btn-secondary btn-sm text-xs"
                onClick={() => setWizardOpen(true)}
                title="Open this comparison in the diff wizard"
              >
                <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                Diff wizard
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 bg-bg">
            {error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="max-w-md text-xs text-error" role="alert">
                  {error}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-xs"
                  onClick={() => setNonce((value) => value + 1)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : (
              <VirtualizedDiffViewer
                diff={diff}
                isLoading={isLoading}
                error={null}
                className="h-full"
              />
            )}
          </div>
        </div>

        <div className="modal-footer flex-shrink-0">
          <span className="flex-1 text-2xs text-text-muted">
            <code className="font-mono">svn diff -c {revision ?? '?'}</code> — the change this
            revision made to {path || 'the selected path'}.
          </span>
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </DialogBase>

      {wizardSides && (
        <DiffWizard
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          defaultLeft={wizardSides.left}
          defaultRight={wizardSides.right}
        />
      )}
    </>
  );
}

export default RevisionDiffDialog;
