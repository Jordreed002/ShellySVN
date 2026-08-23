import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, Folder, ArrowRight, Loader2 } from 'lucide-react';
import { DialogBase } from './DialogBase';
import { applicableAcceptModes, POSTPONE_MODE_INFO } from '@renderer/lib/conflictAcceptModes';

/**
 * Tree-conflict resolution (#55).
 *
 * Offers every `svn resolve --accept` mode applicable to tree conflicts with a
 * plain-language consequence per choice. `postpone` closes the dialog without
 * touching SVN (leaving the conflict in place is not a resolve action).
 */

type TreeConflictResolution =
  | 'mine-conflict'
  | 'theirs-conflict'
  | 'mine-full'
  | 'theirs-full'
  | 'working'
  | 'postpone';

interface ResolutionOption {
  value: TreeConflictResolution;
  label: string;
  description: string;
}

/** Tree-conflict-applicable modes in offer order, with consequence text. */
function treeConflictOptions(): ResolutionOption[] {
  const options: ResolutionOption[] = applicableAcceptModes('tree').map((mode) => ({
    value: mode.value as TreeConflictResolution,
    label:
      mode.value === 'mine-conflict'
        ? 'Resolve conflict using mine'
        : mode.value === 'theirs-conflict'
          ? 'Resolve conflict using theirs'
          : mode.value === 'mine-full'
            ? 'Resolve using mine (full)'
            : mode.value === 'theirs-full'
              ? 'Resolve using theirs (full)'
              : 'Mark resolved, keep working copy',
    description: mode.consequence,
  }));
  options.push({
    value: 'postpone',
    label: POSTPONE_MODE_INFO.label,
    description: POSTPONE_MODE_INFO.consequence,
  });
  return options;
}

interface TreeConflictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  conflictPath: string;
  conflictDescription?: string;
  onResolve?: (resolution: TreeConflictResolution) => void;
}

export function TreeConflictDialog({
  isOpen,
  onClose,
  conflictPath,
  conflictDescription,
  onResolve,
}: TreeConflictDialogProps) {
  const [selectedResolution, setSelectedResolution] = useState<TreeConflictResolution | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedResolution(null);
      setIsResolving(false);
      setError(null);
    }
  }, [isOpen, conflictPath]);

  if (!isOpen) return null;

  const filename = conflictPath.split(/[/\\]/).pop() || conflictPath;
  const isDirectory = !filename.includes('.');
  const resolutions = treeConflictOptions();

  const handleResolve = async () => {
    if (!selectedResolution) return;

    // Leaving the conflict unresolved is not an `svn resolve` action — just close.
    if (selectedResolution === 'postpone') {
      onResolve?.(selectedResolution);
      onClose();
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      if (onResolve) {
        onResolve(selectedResolution);
      } else {
        // Default behavior: resolve via SVN
        await window.api.svn.resolve(conflictPath, selectedResolution);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to resolve the tree conflict');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <DialogBase
      isOpen={isOpen}
      onClose={onClose}
      dialogId="tree-conflict-dialog"
      className="w-[550px]"
      title={
        <>
          <AlertTriangle className="w-5 h-5 text-warning" />
          Tree Conflict
        </>
      }
    >
      {/* Content */}
      <div className="modal-body space-y-4">
          {/* Conflict info */}
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
            <div className="flex items-center gap-3 mb-2">
              {isDirectory ? (
                <Folder className="w-5 h-5 text-warning" />
              ) : (
                <FileText className="w-5 h-5 text-warning" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text truncate">{filename}</p>
                <p className="text-xs text-text-faint truncate">{conflictPath}</p>
              </div>
            </div>
            {conflictDescription && (
              <p className="text-sm text-text-secondary">{conflictDescription}</p>
            )}
          </div>

          {/* Conflict type explanation */}
          <div className="bg-bg-tertiary rounded-lg p-3 text-sm text-text-secondary">
            <p className="font-medium mb-1">What is a tree conflict?</p>
            <p>
              A tree conflict occurs when there's a conflict at the directory level, such as a file
              being deleted locally but modified in the repository, or both sides renaming a file
              differently.
            </p>
          </div>

          {/* Resolution options */}
          <div>
            <div className="text-sm font-medium text-text-secondary mb-2">Resolution</div>
            <div className="space-y-2">
              {resolutions.map((resolution) => (
                <label
                  key={resolution.value}
                  aria-label={resolution.label}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-fast ${
                    selectedResolution === resolution.value
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution"
                    value={resolution.value}
                    checked={selectedResolution === resolution.value}
                    onChange={() =>
                      setSelectedResolution(resolution.value as TreeConflictResolution)
                    }
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-text">{resolution.label}</p>
                    <p className="text-xs text-text-faint">{resolution.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Warning */}
          <div className="text-xs text-text-faint flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Tree conflicts may require manual intervention after resolution.
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary" disabled={isResolving}>
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={!selectedResolution || isResolving}
            className="btn btn-primary"
          >
            {isResolving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            Resolve
          </button>
        </div>
    </DialogBase>
  );
}
