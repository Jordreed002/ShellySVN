import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileOutput,
  FolderOpen,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FolderSearch,
  Globe,
  HardDrive,
} from 'lucide-react';
import { formatBytes } from '@shared/utils/formatBytes';
import { DialogBase } from './DialogBase';
import { ErrorPanel } from './ErrorPanel';
import { ProgressIndicator } from './ProgressIndicator';
import { assertSuccessfulSvnRead } from '../../utils/svnReadResult';
import { withIpcTimeout } from '../../lib/queryTimeout';
import {
  describeExportRevision,
  formatWizardDuration,
  isRepoUrlSource,
  normalizeExportRevision,
  summarizeRepoEntries,
  type ExportEstimate,
  type ExportRevisionPin,
} from '../../lib/progressWizard';
import { useWizardOperation } from '../../hooks/useWizardOperation';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (path: string) => void;
  initialPath?: string;
}

type ExportResult = {
  success: boolean;
  revision: number | null;
  error?: string;
  output?: string;
};

type WizardStep = 0 | 1 | 2;

const STEP_LABELS = ['Source', 'Options', 'Review'] as const;

/** Depth choices the wizard offers. The IPC payload has no depth field yet,
 * so the selector renders disabled ("pending backend") and exports always run
 * with SVN's default (fully recursive). */
const DEPTH_CHOICES = [
  { value: 'infinity', label: 'Fully recursive' },
  { value: 'immediates', label: 'Immediate children only' },
  { value: 'files', label: 'File only' },
] as const;

type EstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done' } & ExportEstimate
  | { status: 'failed' };

const ESTIMATE_TIMEOUT_MS = 20_000;

export function ExportDialog({ isOpen, onClose, onComplete, initialPath = '' }: ExportDialogProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [sourceUrl, setSourceUrl] = useState(initialPath);
  const [destPath, setDestPath] = useState('');
  const [revisionPin, setRevisionPin] = useState<ExportRevisionPin>('head');
  const [revisionNumber, setRevisionNumber] = useState('');
  // Kept (disabled) until the export IPC grows the matching fields — see the
  // "pending backend" notes in the Options step.
  const [depth, setDepth] = useState<(typeof DEPTH_CHOICES)[number]['value']>('infinity');
  const [ignoreExternals, setIgnoreExternals] = useState(false);
  const [nativeEol, setNativeEol] = useState(false);
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' });

  const op = useWizardOperation<ExportResult>({ label: 'Export' });
  const { reset: resetOperation } = op;

  const estimateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setSourceUrl(initialPath);
      setDestPath('');
      setRevisionPin('head');
      setRevisionNumber('');
      setDepth('infinity');
      setIgnoreExternals(false);
      setNativeEol(false);
      setEstimate({ status: 'idle' });
      estimateKeyRef.current = null;
      resetOperation();
    }
  }, [isOpen, initialPath, resetOperation]);

  const source = sourceUrl.trim();
  const destination = destPath.trim();
  const isUrl = isRepoUrlSource(source);
  const revision = normalizeExportRevision(revisionPin, revisionNumber);

  const handleBrowseSource = async () => {
    const result = await window.api.dialog.openDirectory(source || undefined);
    if (result) setSourceUrl(result);
  };

  const handleBrowseDest = async () => {
    const result = await window.api.dialog.openDirectory(destination || undefined);
    if (result) setDestPath(result);
  };

  const runEstimate = useCallback(
    async (key: string) => {
      estimateKeyRef.current = key;
      setEstimate({ status: 'loading' });
      try {
        const listing = assertSuccessfulSvnRead(
          await withIpcTimeout(
            () => window.api.svn.list(source, revision ?? undefined, 'infinity'),
            ESTIMATE_TIMEOUT_MS,
            'svn:list'
          )
        );
        setEstimate({ status: 'done', ...summarizeRepoEntries(listing.entries) });
      } catch {
        // Honest unknown: a failed or slow listing must not block the export.
        setEstimate({ status: 'failed' });
      }
    },
    [source, revision]
  );

  // Dry-run once per source/revision combination when the review step opens.
  useEffect(() => {
    if (!isOpen || step !== 2 || op.phase !== 'idle') return;
    const key = `${source}|${revision ?? 'HEAD'}`;
    if (estimateKeyRef.current === key) return;
    void runEstimate(key);
  }, [isOpen, step, source, revision, op.phase, runEstimate]);

  const startExport = () => {
    op.start((onProgress) =>
      window.api.svn.exportWithProgress(source, destination, onProgress, revision ?? undefined)
    );
  };

  const handleReveal = () => {
    void window.api.external.revealPath(destination);
  };

  const handleClose = () => {
    if (op.phase === 'running') return; // cancellation is the only way out mid-run
    if (op.phase === 'completed' && onComplete) onComplete(destination);
    onClose();
  };

  if (!isOpen) return null;

  const running = op.phase === 'running';
  const canAdvanceSource = source.length > 0;
  const canAdvanceOptions = destination.length > 0 && revision !== null && !(revisionPin === 'base' && isUrl);
  const revisionInvalid = revisionPin === 'number' && revision === null;

  const stepStrip = (
    <ol className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Export wizard steps">
      {STEP_LABELS.map((label, index) => {
        const state = index < step ? 'done' : index === step ? 'current' : 'todo';
        return (
          <li
            key={label}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              state === 'current'
                ? 'border-accent/50 bg-accent/15 text-accent'
                : state === 'done'
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-border bg-bg-tertiary text-text-faint'
            }`}
          >
            <span className="font-mono">{index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );

  const sourceKindBadge = (
    <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
      {isUrl ? <Globe className="h-3.5 w-3.5" aria-hidden="true" /> : <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />}
      {isUrl ? 'Repository URL' : 'Working copy path'}
    </span>
  );

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={handleClose}
      dialogId="export-dialog"
      className="w-[560px]"
      title={
        <>
          <FileOutput className="w-5 h-5 text-accent" />
          Export Clean Copy
        </>
      }
    >
      {op.phase === 'completed' && op.result ? (
        <div className="modal-body">
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-text">Export complete</h3>
            <dl className="mb-4 w-full space-y-1.5 text-left text-sm" data-testid="export-summary">
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Revision</dt>
                <dd className="font-mono text-text">
                  {typeof op.result.revision === 'number' ? `r${op.result.revision}` : 'not reported'}
                </dd>
              </div>
              {op.progress && op.progress.filesProcessed > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Paths reported</dt>
                  <dd className="font-mono text-text">{op.progress.filesProcessed}</dd>
                </div>
              ) : null}
              {op.progress && op.progress.bytesTransferred ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Transferred</dt>
                  <dd className="font-mono text-text">{formatBytes(op.progress.bytesTransferred)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Duration</dt>
                <dd className="font-mono text-text">{formatWizardDuration(op.elapsedMs) ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Destination</dt>
                <dd className="break-all text-right text-text">{destination}</dd>
              </div>
            </dl>
            <button type="button" onClick={handleReveal} className="btn btn-secondary mb-2">
              <FolderSearch className="h-4 w-4" />
              Reveal in folder
            </button>
          </div>
        </div>
      ) : op.phase === 'cancelled' ? (
        <div className="modal-body space-y-4">
          <div role="status" className="rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Export cancelled{op.error ? ` — ${op.error}` : ''}. The destination folder may be partially written.
          </div>
        </div>
      ) : op.phase === 'error' ? (
        <div className="modal-body">
          <ErrorPanel
            title="Export failed"
            message={op.error ?? 'The svn export command reported an error.'}
            onRetry={op.reset}
            retryLabel="Retry"
          />
        </div>
      ) : running ? (
        <div className="modal-body">
          <ProgressIndicator
            status="running"
            operationType="download"
            currentItem={op.progress?.currentFile}
            itemsCompleted={op.progress?.filesProcessed ?? 0}
            totalItems={op.progress?.totalFiles ?? 0}
            bytesTransferred={op.progress?.bytesTransferred ?? 0}
            totalBytes={op.progress?.totalBytes ?? 0}
            indeterminate={
              !op.progress?.totalFiles && !op.progress?.totalBytes && op.progress?.percentage === undefined
            }
            canCancel
            onCancel={op.cancel}
          />
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 0 && canAdvanceSource) setStep(1);
            else if (step === 1 && canAdvanceOptions) setStep(2);
            else if (step === 2) startExport();
          }}
        >
          <div className="modal-body space-y-4">
            {stepStrip}

            {step === 0 ? (
              <section aria-labelledby="export-step-source" className="space-y-3">
                <h3 id="export-step-source" className="text-sm font-medium text-text">
                  What do you want to export?
                </h3>
                <p className="text-sm text-text-secondary">
                  Export writes a clean copy without .svn folders, from a repository URL or a working copy.
                </p>
                <div>
                  <label
                    htmlFor="export-source-url"
                    className="mb-1.5 block text-sm font-medium text-text-secondary"
                  >
                    Source URL or path <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="export-source-url"
                      type="text"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="svn://example.com/repo/trunk or C:\working-copy"
                      className="input flex-1"
                    />
                    <button type="button" onClick={handleBrowseSource} className="btn btn-secondary">
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </button>
                  </div>
                  {source ? <div className="mt-1.5">{sourceKindBadge}</div> : null}
                </div>
              </section>
            ) : null}

            {step === 1 ? (
              <section aria-labelledby="export-step-options" className="space-y-4">
                <h3 id="export-step-options" className="text-sm font-medium text-text">
                  Export options
                </h3>

                <div>
                  <label
                    htmlFor="export-destination-path"
                    className="mb-1.5 block text-sm font-medium text-text-secondary"
                  >
                    Export to directory <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="export-destination-path"
                      type="text"
                      value={destPath}
                      onChange={(event) => setDestPath(event.target.value)}
                      placeholder="C:\Exports\my-project"
                      className="input flex-1"
                    />
                    <button type="button" onClick={handleBrowseDest} className="btn btn-secondary">
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-text-faint">
                    svn export refuses to write into an existing directory and this build cannot pass
                    --force (pending backend) — choose a new or empty folder.
                  </p>
                </div>

                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-text-secondary">Revision</legend>
                  <div className="space-y-1.5 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="export-revision-pin"
                        value="head"
                        checked={revisionPin === 'head'}
                        onChange={() => setRevisionPin('head')}
                      />
                      HEAD — latest
                    </label>
                    <label className={`flex items-center gap-2 ${isUrl ? 'opacity-50' : ''}`}>
                      <input
                        type="radio"
                        name="export-revision-pin"
                        value="base"
                        checked={revisionPin === 'base'}
                        disabled={isUrl}
                        onChange={() => setRevisionPin('base')}
                      />
                      BASE — pristine revision of the working copy
                    </label>
                    {!isUrl ? null : (
                      <p className="text-xs text-text-faint">BASE only exists for working copy sources.</p>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="export-revision-pin"
                        value="number"
                        checked={revisionPin === 'number'}
                        onChange={() => setRevisionPin('number')}
                      />
                      Specific revision
                      <input
                        id="export-revision-number"
                        type="text"
                        inputMode="numeric"
                        value={revisionNumber}
                        onChange={(event) => setRevisionNumber(event.target.value)}
                        placeholder="123"
                        aria-label="Specific revision number"
                        aria-invalid={revisionInvalid}
                        className="input w-24 py-1"
                        disabled={revisionPin !== 'number'}
                      />
                    </label>
                    {revisionInvalid ? (
                      <p role="alert" className="text-xs text-error">
                        Enter the revision as a positive number.
                      </p>
                    ) : null}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-text-secondary">Depth</legend>
                  <div className="space-y-1.5 text-sm opacity-60">
                    {DEPTH_CHOICES.map((choice) => (
                      <label key={choice.value} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="export-depth"
                          value={choice.value}
                          checked={depth === choice.value}
                          disabled
                          onChange={() => setDepth(choice.value)}
                        />
                        {choice.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-text-faint">
                    Pending backend — <code>svn:exportWithProgress</code> has no depth field yet, so
                    exports always run fully recursive.
                  </p>
                </fieldset>

                <div className="space-y-1.5 opacity-60">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ignoreExternals}
                      disabled
                      onChange={() => setIgnoreExternals(!ignoreExternals)}
                    />
                    Ignore externals
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={nativeEol} disabled onChange={() => setNativeEol(!nativeEol)} />
                    Convert line endings to native EOL
                  </label>
                  <p className="text-xs text-text-faint">
                    Pending backend — the export IPC cannot receive --ignore-externals or --native-eol
                    yet; externals are included with original line endings.
                  </p>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section aria-labelledby="export-step-review" className="space-y-4">
                <h3 id="export-step-review" className="text-sm font-medium text-text">
                  Review and export
                </h3>

                <dl className="space-y-1.5 rounded border border-border bg-bg-secondary p-3 text-sm" data-testid="export-recap">
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Source</dt>
                    <dd className="break-all text-right text-text">{source}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Destination</dt>
                    <dd className="break-all text-right text-text">{destination}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Revision</dt>
                    <dd className="text-text">{describeExportRevision(revisionPin, revisionNumber)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Depth</dt>
                    <dd className="text-text">
                      {DEPTH_CHOICES.find((choice) => choice.value === depth)?.label}{' '}
                      <span className="text-xs text-text-faint">(pending backend)</span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Externals</dt>
                    <dd className="text-text">
                      Included <span className="text-xs text-text-faint">(pending backend)</span>
                    </dd>
                  </div>
                </dl>

                <div className="rounded border border-border bg-bg-secondary p-3" data-testid="export-estimate">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-text-secondary">Dry-run estimate</span>
                    {estimate.status === 'failed' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm text-xs"
                        onClick={() => estimateKeyRef.current && void runEstimate(estimateKeyRef.current)}
                      >
                        Retry estimate
                      </button>
                    ) : null}
                  </div>
                  {estimate.status === 'idle' || estimate.status === 'loading' ? (
                    <p className="text-sm text-text-secondary" role="status">
                      Counting files in the source tree…
                    </p>
                  ) : estimate.status === 'failed' ? (
                    <ErrorPanel
                      variant="banner"
                      className="border-0 bg-transparent px-0 py-0"
                      message="Unknown — repository listing unavailable. The export can still run."
                    />
                  ) : (
                    <p className="text-sm text-text" aria-live="polite">
                      ≈ {estimate.fileCount.toLocaleString()} file{estimate.fileCount === 1 ? '' : 's'}
                      {estimate.totalBytes !== null
                        ? ` · ${formatBytes(estimate.totalBytes)} of file content`
                        : ' · size unknown'}
                      {estimate.truncated ? ' or more' : ''}
                    </p>
                  )}
                </div>
              </section>
            ) : null}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => (step === 0 ? handleClose() : setStep((step - 1) as WizardStep))}
            >
              {step === 0 ? 'Cancel' : <><ChevronLeft className="h-4 w-4" />Back</>}
            </button>
            {step === 2 ? (
              <button type="submit" className="btn btn-primary">
                <FileOutput className="h-4 w-4" />
                Start export
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={step === 0 ? !canAdvanceSource : !canAdvanceOptions}>
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>
      )}

      {(op.phase === 'completed' || op.phase === 'cancelled' || op.phase === 'error') && (
        <div className="modal-footer">
          {op.phase !== 'completed' ? (
            <button type="button" className="btn btn-secondary" onClick={op.reset}>
              Back to review
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={handleClose}>
            Done
          </button>
        </div>
      )}
    </DialogBase>
  );
}
