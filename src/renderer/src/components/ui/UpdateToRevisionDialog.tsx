import { useState, useEffect, useCallback } from 'react'
import { X, Download, Loader2, CheckCircle, AlertCircle, FolderOpen } from 'lucide-react'
import { ChooseItemsDialog } from './ChooseItemsDialog'
import type { AuthCredential } from '@shared/types'

type UpdateDepth = 'empty' | 'files' | 'immediates' | 'infinity'

interface UpdateToRevisionDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete?: () => void
  itemName: string
  onConfirm: (depth: UpdateDepth, setDepthSticky: boolean) => Promise<{ success: boolean; revision: number; error?: string }>
  repoUrl?: string
  credentials?: AuthCredential
  workingCopyRoot?: string
}

export function UpdateToRevisionDialog({ 
  isOpen, 
  onClose, 
  onComplete, 
  itemName,
  onConfirm,
  repoUrl,
  credentials,
  workingCopyRoot
}: UpdateToRevisionDialogProps) {
  const [depth, setDepth] = useState<UpdateDepth>('infinity')
  const [setDepthSticky, setSetDepthSticky] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number } | null>(null)
  
  // State for ChooseItemsDialog integration
  const [showChooseItemsDialog, setShowChooseItemsDialog] = useState(false)
  const [isUpdatingMultiple, setIsUpdatingMultiple] = useState(false)
  const [selectedPathsForSparseUpdate, setSelectedPathsForSparseUpdate] = useState<string[]>([])

  // Handle sparse checkout selection from ChooseItemsDialog
  const handleSparseCheckoutSelection = useCallback(async (paths: string[]) => {
    if (!repoUrl || !workingCopyRoot || paths.length === 0) {
      setSelectedPathsForSparseUpdate([])
      setShowChooseItemsDialog(false)
      return
    }

    setIsUpdatingMultiple(true)
    setError(null)
    
    try {
      // Update each selected path individually
      const results = await Promise.allSettled(
        paths.map(path => 
          window.api.svn.updateToRevision(workingCopyRoot, repoUrl, path, depth, setDepthSticky)
        )
      )
      
      // Check if all updates were successful
      const allSuccessful = results.every(result => result.status === 'fulfilled' && (result.value as any).success)
      
      if (allSuccessful) {
        // Show success for individual updates
        const lastSuccessful = results[results.length - 1] as PromiseFulfilledResult<any>
        setSuccess({ revision: lastSuccessful.value.revision })
      } else {
        // Show error if any update failed
        const firstError = results.find(result => result.status === 'rejected' || !(result.value as any).success)
        if (firstError) {
          if (firstError.status === 'rejected') {
            setError((firstError.reason as Error).message || 'Sparse checkout update failed')
          } else {
            setError((firstError.value as any).error || 'Sparse checkout update failed')
          }
        } else {
          setError('Sparse checkout update failed')
        }
      }
    } catch (err) {
      setError((err as Error).message || 'Sparse checkout update failed')
    } finally {
      setIsUpdatingMultiple(false)
      setSelectedPathsForSparseUpdate([])
      setShowChooseItemsDialog(false)
    }
  }, [repoUrl, workingCopyRoot, depth, setDepthSticky])

  useEffect(() => {
    if (isOpen) {
      setDepth('infinity')
      setSetDepthSticky(false)
      setError(null)
      setSuccess(null)
      setIsUpdating(false)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setIsUpdating(true)
    setError(null)
    
    try {
      const result = await onConfirm(depth, setDepthSticky)
      
      if (result.success) {
        setSuccess({ revision: result.revision })
      } else {
        setError(result.error || 'Update failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Update failed')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleClose = () => {
    if (!isUpdating) {
      if (success && onComplete) {
        onComplete()
      }
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <>
      <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[450px]" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <Download className="w-5 h-5 text-accent" />
            Update to Working Copy
          </h2>
          <button 
            type="button"
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isUpdating}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Update Complete</h3>
              <p className="text-text-secondary mb-4">
                Updated to revision {success.revision}
              </p>
              <p className="text-text-faint text-sm mb-6 break-all">
                {itemName}
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-4">
              <div>
                <p className="text-sm text-text-secondary mb-3">
                  Update depth for:
                </p>
                <p className="text-sm font-medium text-text bg-bg-tertiary px-3 py-2 rounded break-all">
                  {itemName}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-text mb-2">
                    Update Depth
                  </label>
                  {repoUrl && workingCopyRoot && (
                    <button
                      type="button"
                      onClick={() => setShowChooseItemsDialog(true)}
                      className="btn btn-secondary text-sm gap-2"
                      disabled={isUpdating || isUpdatingMultiple}
                    >
                      <FolderOpen className="w-4 h-4" />
                      Choose items...
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer">
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
                  <label className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer">
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
                      <p className="text-xs text-text-muted">Download files and empty folders one level deep</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer">
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
                      <p className="text-xs text-text-muted">Download only files in this folder, no subfolders</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer">
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
                      <p className="text-xs text-text-muted">Only create the folder, download nothing</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <label className="flex items-center gap-3 p-2 rounded hover:bg-bg-tertiary cursor-pointer">
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
              <button
                type="submit"
                className="btn btn-primary gap-2"
                disabled={isUpdating}
              >
{isUpdating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Updating...
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
       </div>
     </div>

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
  )
}
