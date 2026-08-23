import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, CheckCircle, AlertCircle, FolderOpen } from 'lucide-react';
import { ChooseItemsDialog } from './ChooseItemsDialog';
import { DialogBase } from './DialogBase';
import type { AuthSession, SvnOperationRevision } from '@shared/types';

type UpdateDepth = 'empty' | 'files' | 'immediates' | 'infinity';

interface UpdateResult {
  success: boolean;
  revision: SvnOperationRevision;
  error?: string;
}

type ConfirmUpdate = (depth: UpdateDepth, setDepthSticky: boolean) => Promise<UpdateResult>;

interface UpdateToRevisionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  itemName: string;
  onConfirm: ConfirmUpdate;
  /**
   * Fetch the given repository URLs into their matching local paths. The mapping
   * from URL to working-copy path depends on which folder is open (and on any
   * switched subtree or external below it), so it is the caller's to make — this
   * dialog only knows the URLs the tree handed back.
   */
  onConfirmUrls?: (
    repoUrls: string[],
    depth: UpdateDepth,
    setDepthSticky: boolean
  ) => Promise<UpdateResult>;
  repoUrl?: string;
  credentials?: AuthSession;
  workingCopyRoot?: string;
}

export function UpdateToRevisionDialog({
  isOpen,
  onClose,
  onComplete,
  itemName,
  onConfirm,
  onConfirmUrls,
  repoUrl,
  credentials,
  workingCopyRoot,
}: UpdateToRevisionDialogProps) {
  const [depth, setDepth] = useState<UpdateDepth>('infinity');
  const [setDepthSticky, setSetDepthSticky] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ revision: number } | null>(null);

  // State for ChooseItemsDialog integration
  const [showChooseItemsDialog, setShowChooseItemsDialog] = useState(false);
  const [isUpdatingMultiple, setIsUpdatingMultiple] = useState(false);
  const [_selectedPathsForSparseUpdate, setSelectedPathsForSparseUpdate] = useState<string[]>([]);

  // Handle sparse checkout selection from ChooseItemsDialog
  const handleSparseCheckoutSelection = useCallback(
    async (paths: string[]) => {
      if (!repoUrl || !workingCopyRoot || paths.length === 0) {
        setSelectedPathsForSparseUpdate([]);
        setShowChooseItemsDialog(false);
        return;
      }

      setIsUpdatingMultiple(true);
      setError(null);

      try {
        // The tree yields repository URLs; only the caller can say which local
        // path each one belongs to, so it does the fetching.
        if (!onConfirmUrls) {
          setError('Choosing items is not available for this working copy.');
          return;
        }

        const result = await onConfirmUrls(paths, depth, setDepthSticky);
        if (result.success) {
          setSuccess({ revision: result.revision ?? 0 });
        } else {
          setError(result.error || 'Sparse checkout update failed');
        }
      } catch (err) {
        setError((err as Error).message || 'Sparse checkout update failed');
      } finally {
        setIsUpdatingMultiple(false);
        setSelectedPathsForSparseUpdate([]);
        setShowChooseItemsDialog(false);
      }
    },
    [repoUrl, workingCopyRoot, depth, setDepthSticky, onConfirmUrls]
  );

  useEffect(() => {
    if (isOpen) {
      setDepth('infinity');
      setSetDepthSticky(false);
      setError(null);
      setSuccess(null);
      setIsUpdating(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsUpdating(true);
    setError(null);

    try {
      const result = await onConfirm(depth, setDepthSticky);

      if (result.success) {
        setSuccess({ revision: result.revision ?? 0 });
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
      if (success && onComplete) {
        onComplete();
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <DialogBase
        isOpen={isOpen}
        onClose={handleClose}
        dialogId="update-to-revision-dialog"
        className="w-[450px]"
        title={
          <>
            <Download className="w-5 h-5 text-accent" />
            Update to Working Copy
          </>
        }
      >
        {success ? (
            <div className="modal-body">
              <div className="flex flex-col items-center py-6 text-center">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                  <CheckCircle className="w-6 h-6 text-success" />
                </div>
                <h3 className="text-lg font-medium text-text mb-2">Update Complete</h3>
                <p className="text-text-secondary mb-4">Updated to revision {success.revision}</p>
                <p className="text-text-faint text-sm mb-6 break-all">{itemName}</p>
                <button type="button" onClick={handleClose} className="btn btn-primary">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div>
                  <p className="text-sm text-text-secondary mb-3">Update depth for:</p>
                  <p className="text-sm font-medium text-text bg-bg-tertiary px-3 py-2 rounded break-all">
                    {itemName}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <div className="block text-sm font-medium text-text mb-2">Update Depth</div>
                    {repoUrl && workingCopyRoot && (
                      <button
                        type="button"
                        onClick={() => setShowChooseItemsDialog(true)}
                        className="btn btn-secondary text-sm gap-2"
                        disabled={isUpdating || isUpdatingMultiple}
                      >
                        <FolderOpen className="w-4 h-4" />
                        Choose items…
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label
                      className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer"
                      aria-label="Fully recursive update depth"
                    >
                      <input
                        type="radio"
                        name="depth"
                        value="infinity"
                        checked={depth === 'infinity'}
                        onChange={() => setDepth('infinity')}
                        className="mt-1"
                      />
                      <div>
                        <span className="text-sm font-medium text-text">Fully recursive</span>
                        <p className="text-xs text-text-muted">Download all files and subfolders</p>
                      </div>
                    </label>
                    <label
                      className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer"
                      aria-label="Immediate children update depth"
                    >
                      <input
                        type="radio"
                        name="depth"
                        value="immediates"
                        checked={depth === 'immediates'}
                        onChange={() => setDepth('immediates')}
                        className="mt-1"
                      />
                      <div>
                        <span className="text-sm font-medium text-text">Immediate children</span>
                        <p className="text-xs text-text-muted">
                          Download files and empty folders one level deep
                        </p>
                      </div>
                    </label>
                    <label
                      className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer"
                      aria-label="Files only update depth"
                    >
                      <input
                        type="radio"
                        name="depth"
                        value="files"
                        checked={depth === 'files'}
                        onChange={() => setDepth('files')}
                        className="mt-1"
                      />
                      <div>
                        <span className="text-sm font-medium text-text">Files only</span>
                        <p className="text-xs text-text-muted">
                          Download only files in this folder, no subfolders
                        </p>
                      </div>
                    </label>
                    <label
                      className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer"
                      aria-label="Empty only update depth"
                    >
                      <input
                        type="radio"
                        name="depth"
                        value="empty"
                        checked={depth === 'empty'}
                        onChange={() => setDepth('empty')}
                        className="mt-1"
                      />
                      <div>
                        <span className="text-sm font-medium text-text">Empty only</span>
                        <p className="text-xs text-text-muted">
                          Only create the folder, download nothing
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <label
                    className="flex items-center gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer"
                    aria-label="Make depth sticky"
                  >
                    <input
                      type="checkbox"
                      checked={setDepthSticky}
                      onChange={(e) => setSetDepthSticky(e.target.checked)}
                    />
                    <div>
                      <span className="text-sm font-medium text-text">Make depth sticky</span>
                      <p className="text-xs text-text-muted">Future updates will use this depth</p>
                    </div>
                  </label>
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-error/10 text-error rounded text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={handleClose}
                  className="btn btn-secondary"
                  disabled={isUpdating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary gap-2" disabled={isUpdating}>
                  {isUpdating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Update
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
      </DialogBase>

      {showChooseItemsDialog && repoUrl && workingCopyRoot && (
        <ChooseItemsDialog
          isOpen={showChooseItemsDialog}
          repoUrl={repoUrl}
          credentials={credentials}
          onSelect={handleSparseCheckoutSelection}
          onCancel={() => setShowChooseItemsDialog(false)}
          title="Choose Items to Update in Sparse Checkout"
        />
      )}
    </>
  );
}
