import { useState, useEffect } from 'react';
import { X, Download, RefreshCw, AlertCircle, CheckCircle, Loader2, Layers } from 'lucide-react';
import type { CheckoutProgress } from '@shared/types';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
  onComplete?: (revision: number) => void;
}

export function UpdateDialog({ isOpen, onClose, path, onComplete }: UpdateDialogProps) {
  const [revision, setRevision] = useState('HEAD');
  const [depth, setDepth] = useState<'empty' | 'files' | 'immediates' | 'infinity'>('infinity');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ revision: number; filesUpdated: number } | null>(null);
  const [ignoreExternals, setIgnoreExternals] = useState(false);
  const [force, setForce] = useState(false);
  const [progress, setProgress] = useState<CheckoutProgress | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRevision('HEAD');
      setDepth('infinity');
      setError(null);
      setSuccess(null);
      setIsUpdating(false);
      setIgnoreExternals(false);
      setForce(false);
      setProgress(null);
    }
  }, [isOpen]);

  const handleUpdate = async () => {
    setIsUpdating(true);
    setError(null);
    setProgress({ status: 'running', filesProcessed: 0 });
    let filesProcessed = 0;

    try {
      const result = await window.api.svn.updateWithProgress(
        path,
        (updateProgress) => {
          filesProcessed = updateProgress.filesProcessed;
          setProgress(updateProgress);
          if (updateProgress.status === 'error') {
            setError(updateProgress.error || 'Update failed');
          } else if (updateProgress.status === 'cancelled') {
            setError('Update cancelled');
          }
        },
        depth,
        {
          revision,
          ignoreExternals,
          force,
        }
      );

      if (result.success) {
        setSuccess({ revision: result.revision ?? 0, filesUpdated: filesProcessed });
        if (result.revision !== null) {
          onComplete?.(result.revision);
        }
      } else {
        setError(result.error || 'Update failed');
      }
    } catch (err) {
      setError((err as Error).message || 'Update failed');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClose = () => {
    if (!isUpdating) {
      onClose();
    }
  };

  const handleCancel = async () => {
    if (!isUpdating) {
      onClose();
      return;
    }

    await window.api.svn.cancelUpdate(progress?.operationId);
    setProgress((current) => ({
      ...(current || { filesProcessed: 0 }),
      status: 'cancelled',
      error: 'Update cancelled',
    }));
    setError('Update cancelled');
    setIsUpdating(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal w-[500px]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Download className="w-5 h-5 text-accent" />
            Update
          </h2>
          <button onClick={handleClose} className="btn-icon-sm" disabled={isUpdating}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Update Complete</h3>
              <p className="text-text-secondary mb-6">Updated to revision {success.revision}</p>
              <button onClick={onClose} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body space-y-4">
            {/* Path info */}
            <div className="bg-bg-tertiary rounded-lg p-3">
              <p className="text-xs text-text-faint mb-1">Working copy:</p>
              <p className="text-sm font-mono text-text-secondary truncate">{path}</p>
            </div>

            {/* Revision */}
            <div>
              <label
                htmlFor="update-revision"
                className="text-sm font-medium text-text-secondary mb-1.5 block"
              >
                Revision
              </label>
              <input
                id="update-revision"
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="HEAD"
                className="input w-32"
                disabled={isUpdating}
              />
              <span className="text-xs text-text-faint ml-2">
                HEAD = latest, or specify a number
              </span>
            </div>

            {/* Depth */}
            <div>
              <label
                htmlFor="update-depth"
                className="text-sm font-medium text-text-secondary mb-1.5 block"
              >
                <Layers className="w-4 h-4 inline mr-1" />
                Update depth
              </label>
              <select
                id="update-depth"
                value={depth}
                onChange={(e) => setDepth(e.target.value as typeof depth)}
                className="input"
                disabled={isUpdating}
              >
                <option value="infinity">Fully recursive (all files and folders)</option>
                <option value="immediates">Immediate children only</option>
                <option value="files">Files only (no subfolders)</option>
                <option value="empty">Only this item (no children)</option>
              </select>
              <p className="text-xs text-text-faint mt-1">
                Use "immediates" or "files" for sparse update of existing checkout
              </p>
            </div>

            {/* Options */}
            <div className="space-y-2">
              <div className="text-sm font-medium text-text-secondary">Options</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ignoreExternals}
                  onChange={(e) => setIgnoreExternals(e.target.checked)}
                  className="checkbox"
                  disabled={isUpdating}
                />
                <span className="text-sm text-text">Ignore externals</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="checkbox"
                  disabled={isUpdating}
                />
                <span className="text-sm text-text">Force update (overwrite local changes)</span>
              </label>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {isUpdating && progress && (
              <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Updating working copy</span>
                  <span className="text-text-faint">{progress.filesProcessed} items</span>
                </div>
                <div className="h-2 bg-bg-primary rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-accent rounded-full animate-indeterminate-progress" />
                </div>
                {progress.currentFile && (
                  <p className="text-xs text-text-faint truncate">{progress.currentFile}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {!success && (
          <div className="modal-footer">
            <button type="button" onClick={handleCancel} className="btn btn-secondary">
              {isUpdating ? 'Stop' : 'Cancel'}
            </button>
            <button onClick={handleUpdate} disabled={isUpdating} className="btn btn-primary">
              {isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Update
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
