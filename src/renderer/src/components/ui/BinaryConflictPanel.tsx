import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Binary,
  CheckCircle,
  Loader2,
  ShieldAlert,
  Wrench,
} from 'lucide-react';

/**
 * Binary-conflict resolution flow (#56).
 *
 * Textual merge is impossible for binary files, so this panel shows both
 * sides' metadata (revision / size / modified time where available), makes the
 * user pick mine or theirs with an explicit destructive-action confirmation,
 * offers the external merge tool when one is configured, and lets a manual
 * edit end in "mark resolved (working)".
 */

export interface BinarySideMetadata {
  label: string;
  detail: string;
  size?: number;
  modifiedTime?: string;
  revision?: number;
}

interface BinaryConflictPanelProps {
  conflictPath: string;
  isProcessing: boolean;
  /** Configured external merge tool id ('' when none). */
  externalMergeTool: string;
  isLaunchingExternalTool: boolean;
  /** Launches the shared external merge flow (artifact discovery + openMergeTool). */
  onOpenExternalMergeTool: () => Promise<void> | void;
  /** Runs the chosen accept mode through the wizard's resolve pipeline. */
  onResolve: (mode: 'mine-full' | 'theirs-full' | 'base' | 'working') => Promise<void> | void;
}

function formatSize(size: number | undefined): string {
  if (size === undefined) return 'unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function BinaryConflictPanel({
  conflictPath,
  isProcessing,
  externalMergeTool,
  isLaunchingExternalTool,
  onOpenExternalMergeTool,
  onResolve,
}: BinaryConflictPanelProps) {
  const [mine, setMine] = useState<BinarySideMetadata | null>(null);
  const [base, setBase] = useState<BinarySideMetadata | null>(null);
  const [theirs, setTheirs] = useState<BinarySideMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const filename = conflictPath.split(/[/\\]/).pop() || conflictPath;

  useEffect(() => {
    setMine(null);
    setBase(null);
    setTheirs(null);
    setLoadError(null);
  }, [conflictPath]);

  const handleLoadMetadata = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const lastSepIndex = Math.max(conflictPath.lastIndexOf('/'), conflictPath.lastIndexOf('\\'));
      const dirPath = lastSepIndex >= 0 ? conflictPath.substring(0, lastSepIndex) : conflictPath;
      const baseName = lastSepIndex >= 0 ? conflictPath.substring(lastSepIndex + 1) : conflictPath;

      const files = await window.api.fs.listDirectory(dirPath);
      const byName = new Map(files.map((file) => [file.name, file]));

      const revisionSuffix = /^\.r(\d+)$/;
      const revisionArtifacts = files
        .filter((file) => file.name.startsWith(`${baseName}.r`))
        .map((file) => ({
          file,
          revision: parseInt(revisionSuffix.exec(file.name.substring(baseName.length))?.[1] ?? '', 10),
        }))
        .filter((entry) => Number.isFinite(entry.revision))
        .toSorted((a, b) => a.revision - b.revision);

      const working = byName.get(baseName);
      setMine({
        label: 'Mine (working copy)',
        detail: 'Your local file, as it is on disk right now',
        size: working?.size,
        modifiedTime: working?.modifiedTime,
      });

      const baseArtifact = revisionArtifacts[0];
      setBase(
        baseArtifact
          ? {
              label: `Base (r${baseArtifact.revision})`,
              detail: 'Common ancestor both sides started from',
              size: baseArtifact.file.size,
              modifiedTime: baseArtifact.file.modifiedTime,
              revision: baseArtifact.revision,
            }
          : {
              label: 'Base',
              detail: 'No base snapshot found on disk',
            }
      );

      const theirsArtifact = revisionArtifacts[revisionArtifacts.length - 1];
      setTheirs(
        theirsArtifact
          ? {
              label: `Theirs (repository r${theirsArtifact.revision})`,
              detail: 'Incoming version from the repository',
              size: theirsArtifact.file.size,
              modifiedTime: theirsArtifact.file.modifiedTime,
              revision: theirsArtifact.revision,
            }
          : {
              label: 'Theirs (repository)',
              detail: 'Incoming version from the repository',
            }
      );
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to load file metadata');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmAndResolve = async (mode: 'mine-full' | 'theirs-full') => {
    const choice = mode === 'mine-full' ? 'your version' : 'the incoming version';
    const discarded = mode === 'mine-full' ? 'the incoming changes' : 'your local changes';
    let confirmed = true;
    try {
      confirmed = await window.api.dialog.confirm({
        type: 'warning',
        title: 'Resolve binary conflict',
        message: `Keep ${choice} for ${filename}?`,
        detail: `Binary files cannot be merged line by line. This discards ${discarded} permanently.`,
        confirmLabel: mode === 'mine-full' ? 'Keep mine' : 'Take theirs',
        cancelLabel: 'Cancel',
      });
    } catch {
      // Native dialog unavailable (tests, odd platforms): proceed — the user
      // already clicked an explicit "keep/take" button to get here.
    }
    if (!confirmed) return;
    await onResolve(mode);
  };

  const busy = isProcessing || isLaunchingExternalTool;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary p-4 space-y-4" data-testid="binary-conflict-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-medium text-text flex items-center gap-2">
            <Binary className="w-4 h-4 text-warning" />
            Binary conflict
          </h5>
          <p className="text-xs text-text-secondary mt-1">
            {filename} is binary, so the two versions cannot be merged line by line — one side
            wins. Pick a side below, or open an external merge tool that understands this file
            type.
          </p>
        </div>
        {!mine && (
          <button
            type="button"
            onClick={handleLoadMetadata}
            disabled={isLoading || busy}
            className="btn btn-secondary btn-sm flex-shrink-0"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Binary className="w-4 h-4" />}
            Load file details
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {mine && (
        <div className="grid grid-cols-3 gap-2">
          <SideCard metadata={mine} />
          <SideCard metadata={base ?? { label: 'Base', detail: '' }} />
          <SideCard metadata={theirs ?? { label: 'Theirs', detail: '' }} highlight />
        </div>
      )}

      {externalMergeTool !== '' && (
        <div className="rounded-lg border border-border bg-bg-secondary p-3">
          <h6 className="text-xs font-medium text-text mb-1">External merge tool</h6>
          <p className="text-xs text-text-secondary mb-2">
            Launch {externalMergeTool} to resolve the binary conflict outside ShellySVN.
          </p>
          <button
            type="button"
            onClick={() => void onOpenExternalMergeTool()}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            {isLaunchingExternalTool ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wrench className="w-4 h-4" />
            )}
            Open {externalMergeTool}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void confirmAndResolve('mine-full')}
          disabled={busy}
          className="btn btn-secondary h-auto flex-col items-start py-2.5"
        >
          <span className="font-medium">Keep my file</span>
          <span className="text-xs text-text-muted">Discards the incoming version</span>
        </button>
        <button
          type="button"
          onClick={() => void confirmAndResolve('theirs-full')}
          disabled={busy}
          className="btn btn-secondary h-auto flex-col items-start py-2.5"
        >
          <span className="font-medium">Take their file</span>
          <span className="text-xs text-text-muted">Discards your local version</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => void onResolve('working')}
        disabled={busy}
        className="btn btn-ghost w-full text-xs text-text-muted"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        Mark resolved, keep the current file (after an external tool edit)
      </button>

      <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
        <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
        Whichever side you drop is gone — there is no per-hunk recovery for binary content.
      </p>
    </div>
  );
}

function SideCard({ metadata, highlight }: { metadata: BinarySideMetadata; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        highlight ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-secondary'
      }`}
    >
      <p className="text-xs font-medium text-text">{metadata.label}</p>
      <p className="mt-0.5 text-[10px] text-text-faint">{metadata.detail}</p>
      <dl className="mt-1.5 space-y-0.5 text-[10px] text-text-secondary">
        <div className="flex justify-between gap-2">
          <dt>Size</dt>
          <dd>{formatSize(metadata.size)}</dd>
        </div>
        {metadata.revision !== undefined && (
          <div className="flex justify-between gap-2">
            <dt>Revision</dt>
            <dd>r{metadata.revision}</dd>
          </div>
        )}
        {metadata.modifiedTime && (
          <div className="flex justify-between gap-2">
            <dt>Modified</dt>
            <dd title={metadata.modifiedTime}>
              {new Date(metadata.modifiedTime).toLocaleDateString()}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
