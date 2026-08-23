import { useState, useEffect, useRef } from 'react';
import {
  GitMerge,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { getTextConflictPathsFromSvnOutput } from '@renderer/utils/conflictDetection';
import { DialogBase } from './DialogBase';
import type {
  MergeReadinessReport,
  SvnMergeInfoResult,
  SvnMergeOptions,
  SvnOperationProgress,
} from '@shared/types';

interface MergeWizardProps {
  isOpen: boolean;
  onClose: () => void;
  targetPath: string;
  onComplete?: () => void;
}

type MergeType = 'range' | 'reintegrate' | 'tree';
type MergePage = 1 | 2 | 3;

interface MergeOptions {
  type: MergeType;
  sourceUrl: string;
  secondSourceUrl: string;
  revisions: string;
  depth: 'empty' | 'files' | 'immediates' | 'infinity';
  ignoreAncestry: boolean;
  allowMixedRevisions: boolean;
  onlyRecordMerge: boolean;
}

export function formatMergeReadinessReport(input: {
  readiness: MergeReadinessReport;
  revisions: string;
  conflicts: string[];
  previewOutput: string;
}): string {
  const { readiness, revisions, conflicts, previewOutput } = input;
  const findings =
    readiness.findings.length > 0
      ? readiness.findings
          .map((finding) => {
            const evidence = finding.paths.length > 0 ? ` — ${finding.paths.join(', ')}` : '';
            return `- **${finding.severity.toUpperCase()} · ${finding.kind}**: ${finding.detail}${evidence}`;
          })
          .join('\n')
      : '- No deterministic findings.';
  const conflictLines =
    conflicts.length > 0
      ? conflicts.map((conflict) => `- ${conflict} — unresolved in latest merge output`).join('\n')
      : '- No text conflicts detected in the latest preview or execution output.';
  return `# ShellySVN Merge Readiness Report

- Source: ${readiness.sourceUrl}
- Target working copy: ${readiness.targetPath}
- Target URL: ${readiness.targetUrl}
- Repository UUID: ${readiness.repositoryUuid}
- Requested revisions: ${revisions || 'all eligible'}
- Readiness: ${readiness.ready ? 'READY — no deterministic blockers' : 'BLOCKED'}
- Evidence truncated: ${readiness.truncated ? 'yes' : 'no'}

## Findings

${findings}

## Mergeinfo

- Eligible revisions: ${readiness.eligibleRevisions.length > 0 ? readiness.eligibleRevisions.map((revision) => `r${revision}`).join(', ') : 'none'}
- Already merged: ${readiness.mergedRevisions.length > 0 ? readiness.mergedRevisions.map((revision) => `r${revision}`).join(', ') : 'none'}

## Conflicts and resolution state

${conflictLines}

## Verification

- Repository identity: ${readiness.findings.some((finding) => finding.kind === 'repository-mismatch') ? 'failed' : 'verified'}
- Working-copy conflict check: ${readiness.findings.some((finding) => finding.kind === 'conflicts') ? 'failed' : 'passed'}
- Dry-run evidence captured: ${previewOutput.trim() ? 'yes' : 'no'}
- Final status refresh required after merge: yes
`;
}

export function parseMergeRevisionInput(input: string): {
  revisions?: string[];
  ranges?: Array<{ start: number; end: number }>;
} {
  const revisions: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const part of input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const rangeMatch = part.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (rangeMatch) {
      ranges.push({ start: Number(rangeMatch[1]), end: Number(rangeMatch[2]) });
    } else {
      revisions.push(part);
    }
  }

  return {
    revisions: revisions.length > 0 ? revisions : undefined,
    ranges: ranges.length > 0 ? ranges : undefined,
  };
}

const MERGE_TYPE_OPTIONS = [
  {
    id: 'range' as MergeType,
    title: 'Merge a range of revisions',
    description:
      'Port changes from one branch to another (or trunk). Use this when you want to merge specific revisions.',
    icon: '🔢',
  },
  {
    id: 'reintegrate' as MergeType,
    title: 'Reintegrate a branch',
    description:
      'Merge an entire feature branch back to trunk. All changes from the branch will be merged.',
    icon: '🔀',
  },
  {
    id: 'tree' as MergeType,
    title: 'Merge two different trees',
    description:
      'Advanced: Compare and merge two arbitrary trees. Use for vendor branches or complex scenarios.',
    icon: '🌳',
  },
];

export function MergeWizard({ isOpen, onClose, targetPath, onComplete }: MergeWizardProps) {
  const [page, setPage] = useState<MergePage>(1);
  const [options, setOptions] = useState<MergeOptions>({
    type: 'range',
    sourceUrl: '',
    secondSourceUrl: '',
    revisions: '',
    depth: 'infinity',
    ignoreAncestry: false,
    allowMixedRevisions: false,
    onlyRecordMerge: false,
  });
  const [isMerging, setIsMerging] = useState(false);
  const mergeInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mergeOutput, setMergeOutput] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [progress, setProgress] = useState<SvnOperationProgress | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoadingEligible, setIsLoadingEligible] = useState(false);
  const [eligibleRevisions, setEligibleRevisions] = useState<number[] | null>(null);
  const [mergeInfoProperties, setMergeInfoProperties] = useState<SvnMergeInfoResult['properties']>(
    []
  );
  const [readiness, setReadiness] = useState<MergeReadinessReport | null>(null);
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPage(1);
      setOptions({
        type: 'range',
        sourceUrl: '',
        secondSourceUrl: '',
        revisions: '',
        depth: 'infinity',
        ignoreAncestry: false,
        allowMixedRevisions: false,
        onlyRecordMerge: false,
      });
      setError(null);
      setSuccess(false);
      setIsMerging(false);
      setMergeOutput('');
      setConflicts([]);
      setProgress(null);
      setIsPreviewing(false);
      setIsLoadingEligible(false);
      setEligibleRevisions(null);
      setMergeInfoProperties([]);
      setReadiness(null);
      setIsCheckingReadiness(false);
      setReadinessError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (page !== 3 || !options.sourceUrl.trim() || options.type === 'tree') return;
    let cancelled = false;
    setIsCheckingReadiness(true);
    setReadiness(null);
    setReadinessError(null);
    window.api.svn
      .mergeReadiness(options.sourceUrl.trim(), targetPath)
      .then((report) => {
        if (!cancelled) setReadiness(report);
      })
      .catch((checkError) => {
        if (!cancelled) {
          setReadinessError(
            checkError instanceof Error ? checkError.message : 'Merge readiness check failed.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingReadiness(false);
      });
    return () => {
      cancelled = true;
    };
  }, [options.sourceUrl, options.type, page, targetPath]);

  const handleNext = () => {
    if (
      page === 2 &&
      (!options.sourceUrl.trim() || (options.type === 'tree' && !options.secondSourceUrl.trim()))
    ) {
      setError(
        options.type === 'tree'
          ? 'Please enter both source URLs for a two-tree merge'
          : 'Please enter a source URL'
      );
      return;
    }
    setError(null);
    setPage((p) => Math.min(p + 1, 3) as MergePage);
  };

  const handleBack = () => {
    setPage((p) => Math.max(p - 1, 1) as MergePage);
  };

  const handleLoadEligible = async () => {
    if (!options.sourceUrl.trim()) {
      setError('Please enter a source URL');
      return;
    }
    setIsLoadingEligible(true);
    setError(null);
    try {
      const result = await window.api.svn.mergeInfo(
        options.sourceUrl.trim(),
        targetPath,
        'eligible'
      );
      setEligibleRevisions(result.revisions);
      setMergeInfoProperties(result.properties);
      setOptions((current) => ({ ...current, revisions: result.revisions.join(',') }));
    } catch (err) {
      setError((err as Error).message || 'Failed to load eligible revisions');
    } finally {
      setIsLoadingEligible(false);
    }
  };

  const buildMergeOptions = (dryRun = false): SvnMergeOptions => ({
    ...(options.type === 'tree' ? { secondSource: options.secondSourceUrl.trim() } : {}),
    dryRun,
    depth: options.depth,
    ignoreAncestry: options.ignoreAncestry,
    allowMixedRevisions: options.allowMixedRevisions,
    onlyRecordMerge: options.onlyRecordMerge,
  });

  const handlePreview = async () => {
    setIsPreviewing(true);
    setError(null);
    setMergeOutput('');
    setConflicts([]);

    try {
      const { revisions, ranges } = parseMergeRevisionInput(options.revisions);
      const result = await window.api.svn.merge(
        options.sourceUrl,
        targetPath,
        revisions,
        ranges,
        buildMergeOptions(true)
      );

      const output = result.output || '';
      setMergeOutput(output);
      setConflicts(getTextConflictPathsFromSvnOutput(output));
      if (!result.success) {
        setError('Dry-run preview failed');
      }
    } catch (err) {
      setError((err as Error).message || 'Dry-run preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleMerge = async () => {
    if (options.type !== 'tree' && (!readiness || !readiness.ready)) {
      setError('Resolve merge-readiness blockers before running this merge.');
      return;
    }
    if (mergeInFlightRef.current) return;
    mergeInFlightRef.current = true;
    setIsMerging(true);
    setError(null);
    setMergeOutput('');
    setConflicts([]);
    setProgress(null);

    try {
      const { revisions, ranges } = parseMergeRevisionInput(options.revisions);
      const result = await window.api.svn.mergeWithProgress(
        options.sourceUrl,
        targetPath,
        setProgress,
        revisions,
        ranges,
        buildMergeOptions(false)
      );
      const output = result.output || '';
      setMergeOutput(output);
      setConflicts(getTextConflictPathsFromSvnOutput(output));

      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || 'Merge failed');
      }
    } catch (err) {
      setError((err as Error).message || 'Merge failed');
    } finally {
      mergeInFlightRef.current = false;
      setIsMerging(false);
    }
  };

  const handleCancelMerge = async () => {
    await window.api.svn.cancelOperation(progress?.operationId);
  };

  const handleExportReport = () => {
    if (!readiness) return;
    const markdown = formatMergeReadinessReport({
      readiness,
      revisions: options.revisions,
      conflicts,
      previewOutput: mergeOutput,
    });
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `shellysvn-merge-readiness-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    if (!isMerging) {
      if (success && onComplete) {
        onComplete();
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={handleClose}
      dialogId="merge-wizard"
      className="w-[600px]"
      title={
        <>
          <GitMerge className="w-5 h-5 text-accent" />
          Merge
        </>
      }
    >
      {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 py-3 bg-bg-tertiary border-b border-border">
          {[1, 2, 3].map((p) => (
            <div key={p} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                  ${page >= p ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'}`}
              >
                {p}
              </div>
              {p < 3 && (
                <div className={`w-12 h-0.5 ${page > p ? 'bg-accent' : 'bg-bg-elevated'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Merge Complete</h3>
              <p className="text-text-secondary mb-6">
                The merge has been completed. Review the changes and commit when ready.
              </p>
              {conflicts.length > 0 && (
                <div className="mb-4 w-full rounded border border-warning/30 bg-warning/10 p-3 text-left">
                  <div className="mb-2 text-sm font-medium text-warning">
                    Conflicts detected ({conflicts.length})
                  </div>
                  <ul className="space-y-1 text-xs text-warning">
                    {conflicts.map((conflict) => (
                      <li key={conflict} className="font-mono">
                        {conflict}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {mergeOutput && (
                <pre className="mb-4 max-h-40 w-full overflow-auto rounded bg-bg-secondary p-3 text-left text-xs text-text-secondary">
                  {mergeOutput}
                </pre>
              )}
              <button onClick={handleClose} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-body">
              {/* Page 1: Merge Type */}
              {page === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    Select the type of merge you want to perform:
                  </p>

                  <div className="space-y-2">
                    {MERGE_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setOptions({ ...options, type: opt.id })}
                        className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-fast text-left
                          ${
                            options.type === opt.id
                              ? 'border-accent bg-accent/10'
                              : 'border-border hover:border-accent/50 hover:bg-bg-tertiary'
                          }
                        `}
                      >
                        <span className="text-2xl">{opt.icon}</span>
                        <div>
                          <div className="font-medium text-text">{opt.title}</div>
                          <div className="text-xs text-text-secondary">{opt.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Page 2: Source and Revisions */}
              {page === 2 && (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="merge-source-url"
                      className="text-sm font-medium text-text-secondary mb-1.5 block"
                    >
                      From URL <span className="text-error">*</span>
                    </label>
                    <input
                      id="merge-source-url"
                      type="text"
                      value={options.sourceUrl}
                      onChange={(e) => setOptions({ ...options, sourceUrl: e.target.value })}
                      placeholder="svn://example.com/repo/branches/feature-x"
                      className="input"
                    />
                  </div>

                  {options.type === 'tree' && (
                    <div>
                      <label
                        htmlFor="merge-second-source-url"
                        className="text-sm font-medium text-text-secondary mb-1.5 block"
                      >
                        To URL <span className="text-error">*</span>
                      </label>
                      <input
                        id="merge-second-source-url"
                        type="text"
                        value={options.secondSourceUrl}
                        onChange={(e) =>
                          setOptions({ ...options, secondSourceUrl: e.target.value })
                        }
                        placeholder="svn://example.com/repo/vendor/new"
                        className="input"
                      />
                      <p className="text-xs text-text-faint mt-1">
                        SVN will apply the difference between the two source trees to the working
                        copy.
                      </p>
                    </div>
                  )}

                  {options.type === 'range' && (
                    <div>
                      <label
                        htmlFor="merge-revision-range"
                        className="text-sm font-medium text-text-secondary mb-1.5 block"
                      >
                        Revision range
                      </label>
                      <input
                        id="merge-revision-range"
                        type="text"
                        value={options.revisions}
                        onChange={(e) => setOptions({ ...options, revisions: e.target.value })}
                        placeholder="e.g., 100-150 or 100,105,110"
                        className="input"
                      />
                      <p className="text-xs text-text-faint mt-1">
                        Leave empty to merge all unmerged revisions
                      </p>
                      <button
                        type="button"
                        onClick={handleLoadEligible}
                        disabled={isLoadingEligible}
                        className="btn btn-secondary mt-2 text-xs"
                      >
                        {isLoadingEligible
                          ? 'Loading eligible revisions...'
                          : 'Load eligible revisions'}
                      </button>
                      {eligibleRevisions && (
                        <div className="mt-2 space-y-1 text-xs text-text-secondary">
                          <p>
                            {eligibleRevisions.length > 0
                              ? `${eligibleRevisions.length} eligible revision${eligibleRevisions.length === 1 ? '' : 's'} loaded.`
                              : 'No eligible revisions.'}
                          </p>
                          {mergeInfoProperties.map((property, index) => (
                            <div
                              key={`${property.inheritedFrom || 'explicit'}-${index}`}
                              className="rounded bg-bg-tertiary px-2 py-1"
                            >
                              <span className="font-medium">
                                {property.inherited
                                  ? `Inherited mergeinfo from ${property.inheritedFrom || 'parent'}`
                                  : 'Explicit mergeinfo'}
                              </span>
                              <pre className="mt-1 whitespace-pre-wrap font-mono">
                                {property.value}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="text-sm font-medium text-text-secondary mb-1.5">
                      Working copy path
                    </div>
                    <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
                      {targetPath}
                    </div>
                  </div>
                </div>
              )}

              {/* Page 3: Options */}
              {page === 3 && (
                <div className="space-y-4">
                  {options.type !== 'tree' && (
                    <section className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
                      <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-text">
                          <ShieldCheck className="h-4 w-4 text-accent" /> Merge readiness
                        </div>
                        <span className="text-xs text-text-muted">
                          {isCheckingReadiness
                            ? 'Checking SVN evidence…'
                            : readiness?.ready
                              ? 'No blockers'
                              : 'Review required'}
                        </span>
                      </div>
                      {isCheckingReadiness && (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Inspecting status,
                          ancestry and mergeinfo
                        </div>
                      )}
                      {readinessError && (
                        <p className="px-3 py-3 text-xs text-error">{readinessError}</p>
                      )}
                      {readiness && (
                        <div className="divide-y divide-border">
                          <div className="grid grid-cols-2 gap-3 px-3 py-2 text-xs text-text-secondary">
                            <span>{readiness.eligibleRevisions.length} eligible revisions</span>
                            <span>{readiness.mergedRevisions.length} already merged</span>
                          </div>
                          {readiness.findings.map((finding) => (
                            <div key={finding.kind} className="px-3 py-2">
                              <div className="flex items-center gap-2 text-xs">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    finding.severity === 'blocker'
                                      ? 'bg-error'
                                      : finding.severity === 'warning'
                                        ? 'bg-warning'
                                        : 'bg-accent'
                                  }`}
                                />
                                <span className="font-medium text-text">{finding.detail}</span>
                              </div>
                              {finding.paths.length > 0 && (
                                <p className="mt-1 truncate pl-3.5 font-mono text-[10px] text-text-faint">
                                  {finding.paths.slice(0, 3).join(' · ')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  <div>
                    <label
                      htmlFor="merge-depth"
                      className="text-sm font-medium text-text-secondary mb-1.5 block"
                    >
                      Depth
                    </label>
                    <select
                      id="merge-depth"
                      value={options.depth}
                      onChange={(e) =>
                        setOptions({ ...options, depth: e.target.value as typeof options.depth })
                      }
                      className="input"
                    >
                      <option value="infinity">Fully recursive</option>
                      <option value="immediates">Immediate children</option>
                      <option value="files">Files only</option>
                      <option value="empty">Only this item</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.ignoreAncestry}
                        onChange={(e) =>
                          setOptions({ ...options, ignoreAncestry: e.target.checked })
                        }
                      />
                      <span className="text-sm">Ignore ancestry</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.allowMixedRevisions}
                        onChange={(e) =>
                          setOptions({ ...options, allowMixedRevisions: e.target.checked })
                        }
                      />
                      <span className="text-sm">Allow mixed revisions</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.onlyRecordMerge}
                        onChange={(e) =>
                          setOptions({ ...options, onlyRecordMerge: e.target.checked })
                        }
                      />
                      <span className="text-sm">Only record merge (don't change working copy)</span>
                    </label>
                  </div>

                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-warning">
                        Merge will modify your working copy. Make sure to review the changes before
                        committing.
                      </p>
                    </div>
                  </div>

                  {progress && (
                    <div className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-secondary">
                      <div className="mb-2 flex items-center justify-between">
                        <span>Merge progress</span>
                        <span>{progress.percentage ?? 0}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-bg-tertiary">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${progress.percentage ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {conflicts.length > 0 && (
                    <div className="rounded border border-warning/30 bg-warning/10 p-3">
                      <div className="mb-2 text-sm font-medium text-warning">
                        Conflicts detected ({conflicts.length})
                      </div>
                      <ul className="space-y-1 text-xs text-warning">
                        {conflicts.map((conflict) => (
                          <li key={conflict} className="font-mono">
                            {conflict}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {mergeOutput && (
                    <div>
                      <div className="mb-1.5 text-sm font-medium text-text-secondary">
                        Merge output
                      </div>
                      <pre className="max-h-44 overflow-auto rounded bg-bg-tertiary p-3 text-xs text-text-secondary">
                        {mergeOutput}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2 mt-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button
                type="button"
                onClick={page === 1 ? handleClose : handleBack}
                className="btn btn-secondary"
                disabled={isMerging}
              >
                {page === 1 ? (
                  'Cancel'
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </>
                )}
              </button>

              {page < 3 ? (
                <button type="button" onClick={handleNext} className="btn btn-primary">
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {readiness && (
                    <button
                      type="button"
                      onClick={handleExportReport}
                      className="btn btn-secondary"
                      title="Export deterministic merge evidence as Markdown"
                    >
                      <Download className="h-4 w-4" /> Report
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="btn btn-secondary"
                    disabled={isMerging || isPreviewing}
                  >
                    {isPreviewing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Previewing…
                      </>
                    ) : (
                      'Dry-run Preview'
                    )}
                  </button>
                  {isMerging ? (
                    <button type="button" onClick={handleCancelMerge} className="btn btn-secondary">
                      Cancel Merge
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleMerge}
                      className="btn btn-primary"
                      disabled={
                        options.type !== 'tree' && (isCheckingReadiness || !readiness?.ready)
                      }
                      title={
                        options.type !== 'tree' && !readiness?.ready
                          ? 'Resolve readiness blockers before merging'
                          : undefined
                      }
                    >
                      <GitMerge className="w-4 h-4" />
                      Merge
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
    </DialogBase>
  );
}
