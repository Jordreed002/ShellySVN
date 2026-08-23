/**
 * Pristine-store disk usage panel (#61, renderer).
 *
 * Shows what Track A's pristine analyzer (`svn:analyzePristine`) measured for
 * one working copy — pristine bytes vs. payload size, orphan estimates, the
 * largest files, a size histogram — and offers the one reclaim operation SVN
 * actually has: `svn cleanup --vacuum-pristines` (via the existing
 * `svn:cleanup` IPC with `vacuumPristines`).
 *
 * Adapter contract: everything renders from `PristineAnalysisResult`
 * (`packages/shared/src/types.ts`). If the IPC is not present in the preload
 * (older build), the panel degrades to what is derivable today — the working
 * copy's on-disk size via `fs.getFolderSizes` plus the cleanup action — and
 * marks the pristine breakdown as pending-backend.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Brush,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { PristineAnalysisResult } from '@shared/types';

import { DialogBase } from './DialogBase';
import { confirmAppAction } from '@renderer/utils/dialogs';
import { formatDiskSize } from '@renderer/components/sidebar/sidebarData';
import { describeRepo } from '@renderer/components/sidebar/workingCopyOverview';

/** Query key for one working copy's pristine analysis. */
export function pristineAnalysisKey(workingCopyPath: string) {
  return ['pristine:analysis', workingCopyPath] as const;
}

function analyzerAvailable(): boolean {
  return typeof window.api.svn?.analyzePristine === 'function';
}

function vacuumReasonLabel(reason: string): string {
  if (reason === 'PRISTINE_ABSOLUTE_SIZE') return 'The pristine store is large in absolute terms.';
  if (reason === 'PRISTINE_TO_WC_RATIO') return 'The pristine store is large relative to the working copy.';
  if (reason === 'ORPHANED_STORE') return 'The pristine store is no longer referenced by a working copy.';
  return reason;
}

interface DiskUsagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  workingCopyPath: string;
}

export function DiskUsagePanel({ isOpen, onClose, workingCopyPath }: DiskUsagePanelProps) {
  const queryClient = useQueryClient();
  const hasAnalyzer = analyzerAvailable();
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const name = describeRepo(workingCopyPath).name;

  const analysis = useQuery<PristineAnalysisResult>({
    queryKey: pristineAnalysisKey(workingCopyPath),
    queryFn: () => window.api.svn.analyzePristine(workingCopyPath, { computeWorkingCopySize: true }),
    enabled: isOpen && hasAnalyzer,
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Fallback fact for builds without the analyzer IPC: folder size via the
  // existing fs channel (gated the same way the sidebar's disk card gates it).
  const folderSize = useQuery<Record<string, number>>({
    queryKey: ['disk-usage:folder-size', workingCopyPath],
    queryFn: () => window.api.fs.getFolderSizes([workingCopyPath]),
    enabled: isOpen && !hasAnalyzer,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const cleanup = useMutation({
    mutationFn: async () => {
      const confirmed = await confirmAppAction({
        type: 'warning',
        message: `Vacuum the pristine store of ${name}?`,
        detail:
          'This runs svn cleanup with --vacuum-pristines, removing unreferenced pristine copies. Nothing in your working files is touched.',
        confirmLabel: 'Vacuum pristine store',
      });
      if (!confirmed) throw new Error('cancelled');
      const result = await window.api.svn.cleanup(workingCopyPath, { vacuumPristines: true });
      if (!result.success) throw new Error('svn cleanup reported failure');
      return result;
    },
    onSuccess: () => {
      setCleanupError(null);
      void queryClient.invalidateQueries({ queryKey: pristineAnalysisKey(workingCopyPath) });
      void queryClient.invalidateQueries({ queryKey: ['disk-usage:folder-size', workingCopyPath] });
    },
    onError: (error: Error) => {
      setCleanupError(error.message === 'cancelled' ? null : error.message);
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: pristineAnalysisKey(workingCopyPath) });
    void queryClient.invalidateQueries({ queryKey: ['disk-usage:folder-size', workingCopyPath] });
  }, [queryClient, workingCopyPath]);

  const result = analysis.data;
  const wcBytes = result?.workingCopySize?.bytes ?? folderSize.data?.[workingCopyPath];
  const pristineRatio =
    result && wcBytes && wcBytes > 0 ? result.totalBytes / wcBytes : null;
  const histogramMax = result
    ? Math.max(1, ...result.histogram.map((bucket) => bucket.totalBytes))
    : 1;

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      title={`Disk usage — ${name}`}
      dialogId="disk-usage-panel"
      className="w-[600px] max-h-[85vh] flex flex-col"
      headerExtras={
        hasAnalyzer ? (
          <button
            type="button"
            className="btn-icon-sm"
            onClick={refresh}
            disabled={analysis.isFetching}
            aria-label="Re-measure disk usage"
            title="Re-measure"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${analysis.isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        ) : undefined
      }
    >
      <div className="modal-body space-y-4 overflow-y-auto">
        <p className="break-all font-mono text-10.5 text-text-faint">{workingCopyPath}</p>

        {!hasAnalyzer && (
          <section
            className="space-y-2 rounded-lg border border-border bg-bg-tertiary/40 p-3"
            aria-label="Pending backend"
            data-testid="disk-usage-pending-backend"
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              Detailed breakdown pending backend
            </p>
            <p className="text-12.5 leading-relaxed text-text-secondary">
              The pristine analyzer IPC (<span className="font-mono">svn:analyzePristine</span>) is
              not available in this build, so per-file pristine figures cannot be shown yet. What
              is measurable today:
            </p>
            <p className="font-mono text-12 text-text">
              {folderSize.isFetching
                ? 'measuring…'
                : wcBytes !== undefined
                  ? `working copy on disk: ${formatDiskSize(wcBytes)}`
                  : 'working-copy size unavailable'}
            </p>
          </section>
        )}

        {hasAnalyzer && analysis.isPending && (
          <p className="flex items-center gap-2 py-6 text-sm text-text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Measuring the pristine
            store…
          </p>
        )}

        {hasAnalyzer && analysis.error && (
          <p
            className="flex items-start gap-2 rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 p-2.5 text-12.5 text-text-secondary"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-svn-conflict" aria-hidden="true" />
            {analysis.error instanceof Error ? analysis.error.message : String(analysis.error)}
          </p>
        )}

        {result && !result.available && (
          <p className="rounded-lg border border-border bg-bg-tertiary/40 p-3 text-12.5 text-text-secondary">
            {result.unavailableReason === 'pristine_store_missing'
              ? 'This working copy has no pristine store on disk.'
              : 'This path is not a working copy, so there is nothing to analyze.'}
          </p>
        )}

        {result?.available && (
          <>
            <section className="grid grid-cols-2 gap-2" aria-label="Totals">
              <div className="rounded-lg border border-border bg-bg-tertiary/40 p-2.5">
                <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  <Database className="h-3 w-3" aria-hidden="true" /> Pristine store
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-text">
                  {formatDiskSize(result.totalBytes)}
                </p>
                <p className="font-mono text-10.5 text-text-faint">
                  {result.fileCount.toLocaleString()} files · largest{' '}
                  {formatDiskSize(result.largestFileBytes)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-tertiary/40 p-2.5">
                <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  <HardDrive className="h-3 w-3" aria-hidden="true" /> Working copy
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-text">
                  {wcBytes !== undefined ? formatDiskSize(wcBytes) : '—'}
                </p>
                {pristineRatio !== null && (
                  <p className="font-mono text-10.5 text-text-faint">
                    pristine ≈ {(pristineRatio * 100).toFixed(0)}% of payload
                    {result.workingCopySize?.truncated ? ' (walk truncated)' : ''}
                  </p>
                )}
              </div>
            </section>

            {result.orphanEstimate.storeOrphaned && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-12.5 text-text-secondary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
                The wc.db that referenced this pristine store is missing — every byte in the store
                is unreferenced.
              </p>
            )}
            {result.orphanEstimate.malformedFileCount > 0 && (
              <p className="font-mono text-10.5 text-text-muted">
                {result.orphanEstimate.malformedFileCount} malformed file
                {result.orphanEstimate.malformedFileCount === 1 ? '' : 's'} ·{' '}
                {formatDiskSize(result.orphanEstimate.malformedBytes)} definitely orphaned.{' '}
                {result.orphanEstimate.limitationNote}
              </p>
            )}

            {result.vacuumRecommendation.recommended && (
              <p className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5 text-12.5 text-text-secondary">
                <Brush className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <strong className="text-text">Vacuum recommended</strong> (
                  {result.vacuumRecommendation.confidence} confidence):{' '}
                  {result.vacuumRecommendation.reasons.map(vacuumReasonLabel).join(' ')}
                </span>
              </p>
            )}

            {result.histogram.length > 0 && (
              <section aria-label="File size distribution">
                <h3 className="mb-1.5 text-2xs font-bold uppercase tracking-[0.13em] text-text-muted">
                  Size distribution
                </h3>
                <ul className="space-y-1">
                  {result.histogram.map((bucket) => (
                    <li key={bucket.label} className="flex items-center gap-2" title={bucket.label}>
                      <span className="w-28 flex-shrink-0 truncate font-mono text-10 text-text-muted">
                        {bucket.label}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg-sunk">
                        <span
                          className="block h-full rounded-full bg-svn-added"
                          style={{ width: `${(bucket.totalBytes / histogramMax) * 100}%` }}
                        />
                      </span>
                      <span className="w-24 flex-shrink-0 text-right font-mono text-10 text-text-muted">
                        {bucket.fileCount} · {formatDiskSize(bucket.totalBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.largestFiles.length > 0 && (
              <section aria-label="Largest pristine files">
                <h3 className="mb-1.5 text-2xs font-bold uppercase tracking-[0.13em] text-text-muted">
                  Largest pristine files
                </h3>
                <ul className="space-y-0.5">
                  {result.largestFiles.slice(0, 5).map((file) => (
                    <li key={file.name} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-10.5 text-text-secondary">
                        {file.name}
                      </span>
                      <span className="flex-shrink-0 font-mono text-10.5 text-text-muted">
                        {formatDiskSize(file.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.cancelled && (
              <p className="text-11 text-warning">The scan was stopped early — figures are partial.</p>
            )}
            {result.errors.length > 0 && (
              <p className="font-mono text-10.5 text-text-faint">
                {result.errors.length} walk error{result.errors.length === 1 ? '' : 's'} (permission
                denials and the like)
              </p>
            )}
          </>
        )}

        {cleanupError && (
          <p className="rounded-lg border border-svn-conflict/40 bg-svn-conflict/10 p-2.5 text-12.5 text-text-secondary" role="alert">
            {cleanupError}
          </p>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary gap-1.5"
          onClick={() => cleanup.mutate()}
          disabled={cleanup.isPending}
          data-testid="disk-usage-vacuum"
        >
          {cleanup.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Brush className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Clean up pristine store
        </button>
      </div>
    </DialogBase>
  );
}

export default DiskUsagePanel;
