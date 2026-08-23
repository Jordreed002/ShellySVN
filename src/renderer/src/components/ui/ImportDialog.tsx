import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  FolderOpen,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ArrowUp,
  Folder,
  FileText,
} from 'lucide-react';
import { formatBytes } from '@shared/utils/formatBytes';
import type { SvnRepoEntry } from '@shared/types';
import { DialogBase } from './DialogBase';
import { ErrorPanel } from './ErrorPanel';
import { ProgressIndicator } from './ProgressIndicator';
import { assertSuccessfulSvnRead } from '../../utils/svnReadResult';
import { withIpcTimeout } from '../../lib/queryTimeout';
import {
  findJunkEntries,
  formatWizardDuration,
  JUNK_SIZE_LOOKUP_CAP,
  parentRepoUrl,
} from '../../lib/progressWizard';
import { useWizardOperation } from '../../hooks/useWizardOperation';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (revision: number) => void;
  initialPath?: string;
}

type ImportResult = {
  success: boolean;
  revision: number | null;
  error?: string;
  output?: string;
};

type WizardStep = 0 | 1 | 2;

const STEP_LABELS = ['Source', 'Destination', 'Review'] as const;

interface JunkEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

type JunkScan =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'done'; entries: JunkEntry[] }
  | { status: 'unavailable' };

interface BrowserState {
  open: boolean;
  url: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  entries: SvnRepoEntry[];
}

const LIST_TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 10_000;
const JUNK_ADVISORY_LIMIT = 5;

export function ImportDialog({ isOpen, onClose, onComplete, initialPath = '' }: ImportDialogProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [sourcePath, setSourcePath] = useState(initialPath);
  const [destUrl, setDestUrl] = useState('');
  const [message, setMessage] = useState('');
  const [junk, setJunk] = useState<JunkScan>({ status: 'idle' });
  const [browser, setBrowser] = useState<BrowserState>({
    open: false,
    url: '',
    status: 'idle',
    entries: [],
  });

  const op = useWizardOperation<ImportResult>({ label: 'Import' });
  const { reset: resetOperation } = op;

  const scannedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setSourcePath(initialPath);
      setDestUrl('');
      setMessage('');
      setJunk({ status: 'idle' });
      setBrowser({ open: false, url: '', status: 'idle', entries: [] });
      scannedPathRef.current = null;
      resetOperation();
    }
  }, [isOpen, initialPath, resetOperation]);

  const scanJunk = useCallback(async (path: string) => {
    setJunk({ status: 'scanning' });
    try {
      const entries = await withIpcTimeout(
        () => window.api.fs.listDirectory(path),
        SCAN_TIMEOUT_MS,
        'fs:listDirectory'
      );
      const candidates = findJunkEntries(entries);
      if (candidates.length === 0) {
        setJunk({ status: 'done', entries: [] });
        return;
      }
      const dirPaths = candidates
        .filter((candidate) => candidate.isDirectory)
        .slice(0, JUNK_SIZE_LOOKUP_CAP)
        .map((candidate) => candidate.path);
      let sizes: Record<string, number> = {};
      if (dirPaths.length > 0) {
        try {
          sizes = await withIpcTimeout(
            () => window.api.fs.getFolderSizes(dirPaths),
            LIST_TIMEOUT_MS,
            'fs:getFolderSizes'
          );
        } catch {
          // Sizes are advisory decoration; scan stays "done" without them.
        }
      }
      setJunk({
        status: 'done',
        entries: candidates.map((candidate) => ({
          name: candidate.name,
          isDirectory: candidate.isDirectory,
          size: candidate.isDirectory ? sizes[candidate.path] : candidate.size,
        })),
      });
    } catch {
      // Honest fallback: an unreadable folder must not block the import.
      setJunk({ status: 'unavailable' });
    }
  }, []);

  // Pre-flight junk scan whenever a new source folder is entered.
  useEffect(() => {
    if (!isOpen) return;
    const path = sourcePath.trim();
    if (!path || scannedPathRef.current === path) return;
    scannedPathRef.current = path;
    void scanJunk(path);
  }, [isOpen, sourcePath, scanJunk]);

  const loadListing = useCallback(async (url: string) => {
    setBrowser({ open: true, url, status: 'loading', entries: [] });
    try {
      const listing = assertSuccessfulSvnRead(
        await withIpcTimeout(
          () => window.api.svn.list(url, undefined, 'immediates'),
          LIST_TIMEOUT_MS,
          'svn:list'
        )
      );
      const entries = listing.entries.toSorted((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setBrowser({ open: true, url, status: 'done', entries });
    } catch {
      setBrowser((previous) => ({ ...previous, status: 'error' }));
    }
  }, []);

  const handleBrowseSource = async () => {
    const result = await window.api.dialog.openDirectory(sourcePath.trim() || undefined);
    if (result) setSourcePath(result);
  };

  const handleToggleBrowser = () => {
    const url = destUrl.trim();
    if (!url) return;
    if (browser.open) {
      setBrowser((previous) => ({ ...previous, open: false }));
      return;
    }
    void loadListing(url);
  };

  const handleUseFolder = () => {
    setDestUrl(browser.url);
    setBrowser((previous) => ({ ...previous, open: false }));
  };

  const startImport = () => {
    op.start((onProgress) =>
      window.api.svn.importWithProgress(sourcePath.trim(), destUrl.trim(), message.trim(), onProgress)
    );
  };

  const handleClose = () => {
    if (op.phase === 'running') return; // cancellation is the only way out mid-run
    if (op.phase === 'completed' && op.result && onComplete) {
      // Preserve the historical callback contract: a number, 0 when svn did
      // not report one (the summary above already says "not reported").
      onComplete(typeof op.result.revision === 'number' ? op.result.revision : 0);
    }
    onClose();
  };

  if (!isOpen) return null;

  const running = op.phase === 'running';
  const source = sourcePath.trim();
  const destination = destUrl.trim();
  const canAdvanceSource = source.length > 0;
  const canAdvanceDestination = destination.length > 0 && message.trim().length > 0;
  const parentUrl = browser.open ? parentRepoUrl(browser.url) : null;

  const stepStrip = (
    <ol className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Import wizard steps">
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

  const junkAdvisory = (() => {
    if (junk.status === 'idle' || junk.status === 'scanning') {
      return (
        <p className="text-xs text-text-faint" role="status">
          {junk.status === 'scanning' ? 'Scanning for unversioned junk…' : null}
        </p>
      );
    }
    if (junk.status === 'unavailable') {
      return (
        <p className="text-xs text-text-faint">
          Could not scan this folder, so junk detection is unavailable — everything it contains will
          be uploaded.
        </p>
      );
    }
    if (junk.entries.length === 0) {
      return <p className="text-xs text-success">No obvious junk folders found at the top level.</p>;
    }
    return (
      <div
        className="rounded border border-warning/40 bg-warning/10 p-2.5 text-xs"
        role="alert"
        data-testid="import-junk-advisory"
      >
        <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Unversioned junk detected — all of it will be uploaded
        </div>
        <ul className="space-y-0.5 text-text-secondary">
          {junk.entries.slice(0, JUNK_ADVISORY_LIMIT).map((entry) => (
            <li key={entry.name} className="flex justify-between gap-3">
              <span className="break-all font-mono">
                {entry.name}
                {entry.isDirectory ? '/' : ''}
              </span>
              <span className="flex-none text-text-faint">
                {typeof entry.size === 'number' ? formatBytes(entry.size) : 'size unknown'}
              </span>
            </li>
          ))}
        </ul>
        {junk.entries.length > JUNK_ADVISORY_LIMIT ? (
          <p className="mt-1 text-text-faint">…and {junk.entries.length - JUNK_ADVISORY_LIMIT} more</p>
        ) : null}
        <p className="mt-1.5 text-text-faint">
          Pending backend — the import IPC has no exclude/ignore field yet, so nothing can be
          filtered out client-side.
        </p>
      </div>
    );
  })();

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={handleClose}
      dialogId="import-dialog"
      className="w-[600px]"
      title={
        <>
          <Upload className="w-5 h-5 text-accent" />
          Import to Repository
        </>
      }
    >
      {op.phase === 'completed' && op.result ? (
        <div className="modal-body">
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-text">Import complete</h3>
            <dl className="mb-4 w-full space-y-1.5 text-left text-sm" data-testid="import-summary">
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Imported revision</dt>
                <dd className="font-mono text-text">
                  {typeof op.result.revision === 'number' ? `r${op.result.revision}` : 'not reported'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Duration</dt>
                <dd className="font-mono text-text">{formatWizardDuration(op.elapsedMs) ?? '—'}</dd>
              </div>
              {op.progress && op.progress.filesProcessed > 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Paths reported</dt>
                  <dd className="font-mono text-text">{op.progress.filesProcessed}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Repository URL</dt>
                <dd className="break-all text-right text-text">{destination}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : op.phase === 'cancelled' ? (
        <div className="modal-body space-y-4">
          <div role="status" className="rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Import cancelled{op.error ? ` — ${op.error}` : ''}. Nothing was committed.
          </div>
        </div>
      ) : op.phase === 'error' ? (
        <div className="modal-body">
          <ErrorPanel
            title="Import failed"
            message={op.error ?? 'The svn import command reported an error.'}
            onRetry={op.reset}
            retryLabel="Retry"
          />
        </div>
      ) : running ? (
        <div className="modal-body">
          <ProgressIndicator
            status="running"
            operationType="upload"
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
            else if (step === 1 && canAdvanceDestination) setStep(2);
            else if (step === 2) startImport();
          }}
        >
          <div className="modal-body space-y-4">
            {stepStrip}

            {step === 0 ? (
              <section aria-labelledby="import-step-source" className="space-y-3">
                <h3 id="import-step-source" className="text-sm font-medium text-text">
                  Which folder should be imported?
                </h3>
                <p className="text-sm text-text-secondary">
                  Import commits an unversioned folder into the repository as a new tree.
                </p>
                <div>
                  <label
                    htmlFor="import-source-path"
                    className="mb-1.5 block text-sm font-medium text-text-secondary"
                  >
                    Source folder <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="import-source-path"
                      type="text"
                      value={sourcePath}
                      onChange={(event) => setSourcePath(event.target.value)}
                      placeholder="C:\Projects\my-project"
                      className="input flex-1"
                    />
                    <button type="button" onClick={handleBrowseSource} className="btn btn-secondary">
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </button>
                  </div>
                </div>
                {source ? junkAdvisory : null}
              </section>
            ) : null}

            {step === 1 ? (
              <section aria-labelledby="import-step-destination" className="space-y-4">
                <h3 id="import-step-destination" className="text-sm font-medium text-text">
                  Where should it land, and why?
                </h3>

                <div>
                  <label
                    htmlFor="import-destination-url"
                    className="mb-1.5 block text-sm font-medium text-text-secondary"
                  >
                    Repository URL <span className="text-error">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="import-destination-url"
                      type="text"
                      value={destUrl}
                      onChange={(event) => setDestUrl(event.target.value)}
                      placeholder="svn://example.com/repo/trunk/my-folder"
                      className="input flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleToggleBrowser}
                      className="btn btn-secondary"
                      disabled={!destination}
                      aria-expanded={browser.open}
                    >
                      <Folder className="h-4 w-4" />
                      {browser.open ? 'Hide browser' : 'Browse'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-text-faint">
                    The tree is committed <em>at</em> this URL — append a new folder name if the
                    destination should not already exist.
                  </p>
                </div>

                {browser.open ? (
                  <div className="rounded border border-border bg-bg-secondary" data-testid="import-repo-browser">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm text-xs"
                        disabled={!parentUrl}
                        onClick={() => parentUrl && void loadListing(parentUrl)}
                        aria-label="Up one level"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" title={browser.url}>
                        {browser.url}
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm text-xs" onClick={handleUseFolder}>
                        Use this folder
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1 text-sm">
                      {browser.status === 'loading' ? (
                        <p className="px-2 py-3 text-xs text-text-secondary" role="status">
                          Listing repository…
                        </p>
                      ) : browser.status === 'error' ? (
                        <div className="p-2">
                          <ErrorPanel
                            variant="banner"
                            message="Could not list this URL. Check the address or type the destination directly."
                            retryLabel="Retry"
                            onRetry={() => void loadListing(browser.url)}
                          />
                        </div>
                      ) : browser.entries.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-text-faint">Empty folder.</p>
                      ) : (
                        browser.entries.map((entry) => (
                          <button
                            key={entry.url}
                            type="button"
                            disabled={entry.kind !== 'dir'}
                            onClick={() => entry.kind === 'dir' && void loadListing(entry.url)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-tertiary disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                          >
                            {entry.kind === 'dir' ? (
                              <Folder className="h-4 w-4 flex-none text-accent" aria-hidden="true" />
                            ) : (
                              <FileText className="h-4 w-4 flex-none text-text-faint" aria-hidden="true" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                            {entry.kind === 'file' && typeof entry.size === 'number' ? (
                              <span className="flex-none text-xs text-text-faint">{formatBytes(entry.size)}</span>
                            ) : null}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="import-log-message"
                    className="mb-1.5 block text-sm font-medium text-text-secondary"
                  >
                    Log message <span className="text-error">*</span>
                  </label>
                  <textarea
                    id="import-log-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Initial import of project files…"
                    className="input h-24 resize-none"
                  />
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section aria-labelledby="import-step-review" className="space-y-4">
                <h3 id="import-step-review" className="text-sm font-medium text-text">
                  Review and import
                </h3>

                <dl
                  className="space-y-1.5 rounded border border-border bg-bg-secondary p-3 text-sm"
                  data-testid="import-recap"
                >
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Source folder</dt>
                    <dd className="break-all text-right text-text">{source}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-secondary">Repository URL</dt>
                    <dd className="break-all text-right text-text">{destination}</dd>
                  </div>
                  <div className="gap-4">
                    <dt className="text-text-secondary">Log message</dt>
                    <dd className="mt-0.5 break-words text-text">{message.trim()}</dd>
                  </div>
                </dl>

                {junkAdvisory}
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
                <Upload className="h-4 w-4" />
                Start import
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={step === 0 ? !canAdvanceSource : !canAdvanceDestination}
              >
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
