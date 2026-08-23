import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, Settings2, ShieldAlert, X } from 'lucide-react';
import { ErrorPanel } from '../ui/ErrorPanel';
import {
  DEFAULT_OVERSIZED_THRESHOLD_BYTES,
  DEFAULT_PRE_COMMIT_CHECK_CONFIG,
  loadPreCommitCheckConfig,
  runPreCommitChecks,
  savePreCommitCheckConfig,
  type PreCommitCheckConfig,
  type PreCommitFinding,
  type PreCommitProgress,
  type PreCommitRunResult,
} from './preCommitChecks';

/**
 * Collapsible pre-commit checklist panel (#75).
 *
 * Scans the selected (committable) files client-side — debug leftovers,
 * TODO/FIXME/HACK markers, user-configurable forbidden patterns, oversized
 * files — and surfaces the server-side secret scanner when the main process
 * exposes one. Runs on demand ("Run checks"); results are memoized against
 * the file selection and marked stale when it changes. Findings are
 * dismissible rows and never block the commit: the summary reads
 * "N warnings — commit anyway".
 */

export interface PreCommitChecklistProps {
  /** Selected, committable files from the commit dialog. */
  files: Array<{ path: string; isDirectory?: boolean }>;
  disabled?: boolean;
  className?: string;
}

const CHECK_LABELS: Record<PreCommitFinding['check'], string> = {
  'debug-leftover': 'Debug leftover',
  'todo-marker': 'Marker',
  'forbidden-pattern': 'Forbidden',
  'oversized-file': 'Oversized',
  secret: 'Secret',
};

const SEVERITY_DOT: Record<PreCommitFinding['severity'], string> = {
  danger: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
};

const SEVERITY_TEXT: Record<PreCommitFinding['severity'], string> = {
  danger: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function PreCommitChecklist({ files, disabled = false, className = '' }: PreCommitChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<PreCommitCheckConfig>(DEFAULT_PRE_COMMIT_CHECK_CONFIG);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<PreCommitProgress | null>(null);
  const [result, setResult] = useState<PreCommitRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [configDraft, setConfigDraft] = useState<{ patterns: string; thresholdMb: string }>({
    patterns: '',
    thresholdMb: String(DEFAULT_OVERSIZED_THRESHOLD_BYTES / (1024 * 1024)),
  });

  const runEpochRef = useRef(0);
  const lastRunFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    void loadPreCommitCheckConfig().then((loaded) => {
      setConfig(loaded);
      setConfigDraft({
        patterns: loaded.forbiddenPatterns.join('\n'),
        thresholdMb: String(Math.max(1, Math.round(loaded.oversizedThresholdBytes / (1024 * 1024)))),
      });
    });
  }, []);

  const selectionFingerprint = useMemo(() => files.map((file) => file.path).toSorted().join('\n'), [files]);

  const runChecks = useCallback(async () => {
    if (isRunning || disabled || files.length === 0) return;
    const epoch = ++runEpochRef.current;
    setIsRunning(true);
    setError(null);
    setProgress({ completed: 0, total: files.length });
    setDismissed(new Set());

    try {
      const runResult = await runPreCommitChecks({
        files,
        config,
        readFile: (path) => window.api.fs.readFile(path),
        // The secret-scan IPC is optional — when the main process has not
        // registered it yet, the checklist simply runs without that section.
        scanSecrets:
          typeof window.api.svn?.scanSecrets === 'function'
            ? (paths, options) => window.api.svn.scanSecrets(paths, options)
            : undefined,
        onProgress: (next) => {
          if (runEpochRef.current === epoch) setProgress(next);
        },
      });
      if (runEpochRef.current !== epoch) return;
      setResult(runResult);
      lastRunFingerprintRef.current = selectionFingerprint;
    } catch (runError) {
      if (runEpochRef.current !== epoch) return;
      setError(runError instanceof Error ? runError.message : 'Pre-commit checks failed.');
      // Surface the failure immediately instead of hiding it behind the
      // collapsed header.
      setIsExpanded(true);
    } finally {
      if (runEpochRef.current === epoch) {
        setIsRunning(false);
        setProgress(null);
      }
    }
  }, [config, disabled, files, isRunning, selectionFingerprint]);

  const dismissFinding = (id: string) => {
    setDismissed((previous) => new Set(previous).add(id));
  };

  const applyConfigDraft = async () => {
    const patterns = configDraft.patterns
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const thresholdMb = Math.max(1, Math.floor(Number(configDraft.thresholdMb) || 5));
    const next: PreCommitCheckConfig = {
      ...config,
      forbiddenPatterns: patterns,
      oversizedThresholdBytes: thresholdMb * 1024 * 1024,
    };
    setConfig(next);
    try {
      await savePreCommitCheckConfig(next);
    } catch {
      // Degrade silently; the in-memory config still applies to the next run.
    }
  };

  const visibleFindings = useMemo(
    () => (result ? result.findings.filter((finding) => !dismissed.has(finding.id)) : []),
    [dismissed, result]
  );
  const warningCount = visibleFindings.filter(
    (finding) => finding.severity === 'danger' || finding.severity === 'warning'
  ).length;
  const isStale = result !== null && lastRunFingerprintRef.current !== selectionFingerprint;

  const summaryLabel = isRunning
    ? progress
      ? `Checking ${progress.completed}/${progress.total}…`
      : 'Starting…'
    : error
      ? 'Check failed'
      : !result
        ? 'Not run yet'
        : isStale
          ? 'Selection changed — run again'
          : visibleFindings.length === 0
            ? 'No findings'
            : `${warningCount} warning${warningCount === 1 ? '' : 's'} — commit anyway`;

  return (
    <section
      className={`rounded-lg border border-border bg-bg-secondary/50 ${className}`}
      aria-label="Pre-commit checklist"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-11 font-medium text-text-secondary hover:text-text"
          onClick={() => setIsExpanded((previous) => !previous)}
          aria-expanded={isExpanded}
          aria-controls="pre-commit-checklist-body"
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-accent" aria-hidden="true" />
          ) : (
            <ClipboardCheck
              className={`h-3.5 w-3.5 flex-none ${visibleFindings.length > 0 ? 'text-warning' : 'text-text-faint'}`}
              aria-hidden="true"
            />
          )}
          <span className="shrink-0">Pre-commit checks</span>
          <span
            className={`min-w-0 truncate text-10.5 ${
              visibleFindings.length > 0 ? 'text-warning' : 'text-text-faint'
            }`}
            aria-live="polite"
          >
            {summaryLabel}
          </span>
        </button>
        <button
          type="button"
          className="btn-icon-sm"
          onClick={() => setShowConfig((previous) => !previous)}
          aria-expanded={showConfig}
          aria-label="Configure pre-commit checks"
          title="Forbidden patterns and size threshold"
        >
          <Settings2 className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm text-10.5"
          onClick={() => void runChecks()}
          disabled={disabled || isRunning || files.length === 0}
          aria-label="Run pre-commit checks"
          aria-busy={isRunning}
        >
          Run checks
        </button>
      </div>

      {showConfig && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          <label className="block">
            <span className="text-10.5 font-medium text-text-secondary">
              Forbidden patterns (one regex per line)
            </span>
            <textarea
              value={configDraft.patterns}
              onChange={(event) =>
                setConfigDraft((previous) => ({ ...previous, patterns: event.target.value }))
              }
              className="input mt-1 h-20 w-full font-mono text-11"
              placeholder={'e.g.\\n\\.only(\\s*\\.|\\()\\nprocess\\.env\\.'}
              spellCheck={false}
              aria-label="Forbidden patterns, one regex per line"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="text-10.5 font-medium text-text-secondary">
                Oversized-file threshold (MB)
              </span>
              <input
                type="number"
                min={1}
                max={1024}
                value={configDraft.thresholdMb}
                onChange={(event) =>
                  setConfigDraft((previous) => ({ ...previous, thresholdMb: event.target.value }))
                }
                className="input mt-1 w-24 text-11"
                aria-label="Oversized-file threshold in megabytes"
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm text-10.5"
              onClick={() => void applyConfigDraft()}
            >
              Save settings
            </button>
          </div>
          <p className="text-10 text-text-faint">
            Files above the fs read cap (1 MB) are reported as oversized without a content scan.
            Saved for all working copies.
          </p>
        </div>
      )}

      {isExpanded && (
        <div id="pre-commit-checklist-body" className="border-t border-border px-2.5 py-2">
          {error && (
            <ErrorPanel
              variant="banner"
              title="Pre-commit checks failed"
              message={error}
              onRetry={() => void runChecks()}
              isRetrying={isRunning}
              className="mb-2 rounded-md"
            />
          )}

          {result && result.secretScan.error && (
            <p className="mb-2 text-10.5 text-text-faint" role="status">
              Secret scanner unavailable: {result.secretScan.error}
            </p>
          )}

          {!result && !error && (
            <p className="text-10.5 text-text-faint">
              Run the checks to look for debug leftovers, TODO markers, forbidden patterns, and
              oversized files in the {files.length} selected file{files.length === 1 ? '' : 's'}.
            </p>
          )}

          {result && visibleFindings.length === 0 && !error && (
            <p className="text-10.5 text-success">
              {result.scannedFiles} file{result.scannedFiles === 1 ? '' : 's'} scanned
              {result.secretScan.ran ? ' (secrets included)' : ''} — nothing to flag.
            </p>
          )}

          {visibleFindings.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto" aria-label="Pre-commit findings">
              {visibleFindings.map((finding) => (
                <li
                  key={finding.id}
                  className="flex items-start gap-2 rounded-md border border-border-muted bg-bg-secondary/70 px-2 py-1.5"
                >
                  <span
                    className={`mt-1 h-2 w-2 flex-none rounded-full ${SEVERITY_DOT[finding.severity]}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-11 font-medium ${SEVERITY_TEXT[finding.severity]}`}>
                      {finding.message}
                    </span>
                    <span className="block truncate font-mono text-9.5 text-text-faint" title={finding.file}>
                      {finding.file || '(no file)'}
                      {finding.line !== undefined ? `:${finding.line}` : ''}
                    </span>
                    {finding.snippet && (
                      <span className="block truncate font-mono text-9.5 text-text-muted" title={finding.snippet}>
                        {finding.snippet}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-none items-center gap-1.5">
                    <span className="text-9 uppercase tracking-wider text-text-faint">
                      {CHECK_LABELS[finding.check]}
                    </span>
                    <button
                      type="button"
                      className="btn-icon-sm"
                      onClick={() => dismissFinding(finding.id)}
                      aria-label={`Dismiss finding: ${finding.message}`}
                      title="Dismiss this finding"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {result && (
            <p className="mt-1.5 flex items-center gap-1.5 text-9.5 text-text-faint">
              <ShieldAlert className="h-3 w-3 flex-none" aria-hidden="true" />
              {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} ·{' '}
              {result.scannedFiles} scanned · {formatBytes(config.oversizedThresholdBytes)} threshold
              {result.skipped.unreadable > 0 ? ` · ${result.skipped.unreadable} unreadable` : ''}
              {result.skipped.binary > 0 ? ` · ${result.skipped.binary} binary` : ''}
              {result.skipped.directories > 0 ? ` · ${result.skipped.directories} dirs skipped` : ''}
              {result.cancelled ? ' · cancelled' : ''}
              {' '}— findings never block the commit.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
