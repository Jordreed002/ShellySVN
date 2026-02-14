import { useState, useEffect } from 'react'
import { X, Download, RefreshCw, AlertCircle, CheckCircle, Loader2, Layers } from 'lucide-react'

interface UpdateDialogProps {
  isOpen: boolean
  onClose: () => void
  path: string
  onComplete?: (revision: number) => void
}

export function UpdateDialog({ isOpen, onClose, path, onComplete }: UpdateDialogProps) {
  const [revision, setRevision] = useState('HEAD')
  const [depth, setDepth] = useState<'empty' | 'files' | 'immediates' | 'infinity'>('infinity')
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number; filesUpdated: number } | null>(null)
  const [ignoreExternals, setIgnoreExternals] = useState(false)
  const [force, setForce] = useState(false)
  
  useEffect(() => {
    if (isOpen) {
      setRevision('HEAD')
      setDepth('infinity')
      setError(null)
      setSuccess(null)
      setIsUpdating(false)
      setIgnoreExternals(false)
      setForce(false)
    }
  }, [isOpen])
  
  const handleUpdate = async () => {
    setIsUpdating(true)
    setError(null)
    
    try {
      // For now, use the existing update handler
      // In a full implementation, we'd pass depth and other options
      const result = await window.api.svn.update(path)
      
      if (result.success) {
        setSuccess({ revision: result.revision, filesUpdated: 0 })
        onComplete?.(result.revision)
      } else {
        setError('Update failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Update failed')
    } finally {
      setIsUpdating(false)
    }
  }
  
  const handleClose = () => {
    if (!isUpdating) {
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
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
              <p className="text-text-secondary mb-6">
                Updated to revision {success.revision}
              </p>
              <button
                onClick={onClose}
                className="btn btn-primary"
              >
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
              <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                Revision
              </label>
              <input
                type="text"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="HEAD"
                className="input w-32"
                disabled={isUpdating}
              />
              <span className="text-xs text-text-faint ml-2">HEAD = latest, or specify a number</span>
            </div>
            
            {/* Depth */}
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                <Layers className="w-4 h-4 inline mr-1" />
                Update depth
              </label>
              <select
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
              <label className="text-sm font-medium text-text-secondary block">
                Options
              </label>
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
          </div>
        )}
        
        {/* Footer */}
        {!success && (
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
              onClick={handleUpdate}
              disabled={isUpdating}
              className="btn btn-primary"
            >
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
  )
}
