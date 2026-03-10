import { useState, useEffect, useRef, useCallback } from 'react';
import { X, FolderTree, AlertCircle, Check } from 'lucide-react';
import { ProgressIndicator } from './ProgressIndicator';

interface SparseCheckoutDialogProps {
  isOpen: boolean;
  repoUrl: string;
  targetPath: string;
  onClose: () => void;
  onCheckout: (
    url: string,
    path: string,
    depth: DepthOption,
    includePaths: string[],
    onProgress?: ProgressCallback
  ) => Promise<{ success: boolean; error?: string }>;
}

type DepthOption = 'empty' | 'files' | 'immediates' | 'infinity';

interface PathItem {
  path: string;
  selected: boolean;
  hasChildren: boolean;
}

export interface SparseCheckoutProgress {
  status: 'running' | 'completed' | 'cancelled' | 'error';
  currentItem?: string;
  itemsCompleted: number;
  totalItems: number;
  bytesTransferred: number;
  totalBytes: number;
}

export type ProgressCallback = (progress: SparseCheckoutProgress) => void;

const DEPTH_OPTIONS: { value: DepthOption; label: string; description: string }[] = [
  { value: 'empty', label: 'Empty', description: 'No files or folders, only the root' },
  { value: 'files', label: 'Files Only', description: 'Only immediate files, no subdirectories' },
  { value: 'immediates', label: 'Immediate', description: 'Files and empty subdirectories' },
  { value: 'infinity', label: 'Full', description: 'All files and subdirectories recursively' },
];

export function SparseCheckoutDialog({
  isOpen,
  repoUrl,
  targetPath,
  onClose,
  onCheckout,
}: SparseCheckoutDialogProps) {
  const [depth, setDepth] = useState<DepthOption>('immediates');
  const [includePaths, setIncludePaths] = useState<PathItem[]>([
    { path: 'trunk', selected: true, hasChildren: true },
    { path: 'branches', selected: false, hasChildren: true },
    { path: 'tags', selected: false, hasChildren: true },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  const [progress, setProgress] = useState<SparseCheckoutProgress>({
    status: 'running',
    itemsCompleted: 0,
    totalItems: 0,
    bytesTransferred: 0,
    totalBytes: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDepth('immediates');
      setIncludePaths([
        { path: 'trunk', selected: true, hasChildren: true },
        { path: 'branches', selected: false, hasChildren: true },
        { path: 'tags', selected: false, hasChildren: true },
      ]);
      setIsProcessing(false);
      setError(null);
      setSuccess(false);
      setIsCancelled(false);
      setProgress({
        status: 'running',
        itemsCompleted: 0,
        totalItems: 0,
        bytesTransferred: 0,
        totalBytes: 0,
      });
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTogglePath = (path: string) => {
    setIncludePaths((prev) =>
      prev.map((item) => (item.path === path ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleSelectAll = () => {
    setIncludePaths((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const handleDeselectAll = () => {
    setIncludePaths((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const handleProgress = useCallback(
    (p: SparseCheckoutProgress) => {
      if (!isCancelled) {
        setProgress(p);
      }
    },
    [isCancelled]
  );

  const handleCancel = useCallback(() => {
    setIsCancelled(true);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setProgress((prev) => ({ ...prev, status: 'cancelled' }));
    setIsProcessing(false);
  }, []);

  const handleClose = () => {
    if (isProcessing && !isCancelled) {
      handleCancel();
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsProcessing(true);
    setError(null);
    setIsCancelled(false);
    setProgress({
      status: 'running',
      itemsCompleted: 0,
      totalItems: 0,
      bytesTransferred: 0,
      totalBytes: 0,
    });

    abortControllerRef.current = new AbortController();

    const selectedPaths = includePaths.filter((p) => p.selected).map((p) => p.path);

    try {
      const result = await onCheckout(repoUrl, targetPath, depth, selectedPaths, handleProgress);

      if (isCancelled) {
        return;
      }

      if (result.success) {
        setProgress((prev) => ({ ...prev, status: 'completed' }));
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setProgress((prev) => ({ ...prev, status: 'error' }));
        setError(result.error || 'Checkout failed');
        setIsProcessing(false);
      }
    } catch (err) {
      if (isCancelled) {
        return;
      }
      setProgress((prev) => ({ ...prev, status: 'error' }));
      setError((err as Error).message || 'Checkout failed');
      setIsProcessing(false);
    }
  };

  const selectedCount = includePaths.filter((p) => p.selected).length;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal w-[560px]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <FolderTree className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Sparse Checkout</h2>
          </div>
          <button type="button" onClick={handleClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="modal-body flex flex-col items-center justify-center py-12">
            <Check className="w-12 h-12 text-success mb-4" />
            <p className="text-lg font-medium text-text">Checkout Complete!</p>
            <p className="text-sm text-text-secondary mt-2">{targetPath}</p>
          </div>
        ) : isProcessing ? (
          <div className="modal-body py-6">
            <ProgressIndicator
              status={progress.status}
              currentItem={progress.currentItem}
              itemsCompleted={progress.itemsCompleted}
              totalItems={progress.totalItems}
              bytesTransferred={progress.bytesTransferred}
              totalBytes={progress.totalBytes}
              canCancel={true}
              onCancel={handleCancel}
              onClose={handleClose}
              operationType="download"
              error={error || undefined}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Repository URL</label>
                <input type="text" value={repoUrl} readOnly className="input bg-bg-tertiary" />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Target Path</label>
                <input type="text" value={targetPath} readOnly className="input bg-bg-tertiary" />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Initial Depth</label>
                <div className="grid grid-cols-2 gap-2">
                  {DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      className={`
                        p-3 rounded-lg border text-left transition-fast
                        ${
                          depth === opt.value
                            ? 'border-accent bg-accent/10'
                            : 'border-border hover:border-border-focus'
                        }
                      `}
                    >
                      <div className="font-medium text-sm text-text">{opt.label}</div>
                      <div className="text-xs text-text-muted mt-1">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text">Include Paths</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      Select All
                    </button>
                    <span className="text-text-muted">|</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="border border-border rounded-lg divide-y divide-border">
                  {includePaths.map((item) => (
                    <label
                      key={item.path}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-tertiary transition-fast"
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => handleTogglePath(item.path)}
                        className="checkbox"
                      />
                      <span className="text-sm text-text">{item.path}</span>
                      {item.hasChildren && <span className="text-xs text-text-muted">/</span>}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-2">
                  Selected paths will be checked out. You can update individual paths later using
                  "Update to Revision".
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-error text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-secondary"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing || selectedCount === 0}
                className="btn btn-primary"
              >
                Checkout ({selectedCount})
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
