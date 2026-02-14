import { useState, useEffect } from 'react'
import { X, AlertTriangle, CheckCircle, Loader2, FileText, GitMerge } from 'lucide-react'

interface ResolveDialogProps {
  isOpen: boolean
  filePath: string
  status: 'C' | '?' | '!'
  onClose: () => void
  onResolve: (resolution: Resolution) => Promise<void>
}

type Resolution = 'mine-full' | 'theirs-full' | 'mine-conflict' | 'theirs-conflict' | 'base' | 'working'

interface ResolutionOption {
  id: Resolution
  label: string
  description: string
  icon: React.ReactNode
  recommended?: boolean
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  {
    id: 'mine-full',
    label: 'Resolve using mine',
    description: 'Keep all your local changes, discard incoming changes',
    icon: <CheckCircle className="w-4 h-4 text-svn-modified" />
  },
  {
    id: 'theirs-full',
    label: 'Resolve using theirs',
    description: 'Accept all incoming changes, discard your local changes',
    icon: <CheckCircle className="w-4 h-4 text-accent" />
  },
  {
    id: 'mine-conflict',
    label: 'Resolve conflicts using mine',
    description: 'Keep your changes for conflicting sections, accept theirs elsewhere',
    icon: <GitMerge className="w-4 h-4 text-svn-modified" />,
    recommended: true
  },
  {
    id: 'theirs-conflict',
    label: 'Resolve conflicts using theirs',
    description: 'Accept their changes for conflicting sections, keep yours elsewhere',
    icon: <GitMerge className="w-4 h-4 text-accent" />
  },
  {
    id: 'base',
    label: 'Resolve using base',
    description: 'Revert to the common ancestor version',
    icon: <FileText className="w-4 h-4 text-text-muted" />
  }
]

export function ResolveDialog({ isOpen, filePath, status, onClose, onResolve }: ResolveDialogProps) {
  const [selectedResolution, setSelectedResolution] = useState<Resolution | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  useEffect(() => {
    if (isOpen) {
      setSelectedResolution(null)
      setError(null)
      setSuccess(false)
      setIsResolving(false)
    }
  }, [isOpen])
  
  const handleResolve = async () => {
    if (!selectedResolution) return
    
    setIsResolving(true)
    setError(null)
    
    try {
      await onResolve(selectedResolution)
      setSuccess(true)
    } catch (err) {
      setError((err as Error).message || 'Failed to resolve conflict')
    } finally {
      setIsResolving(false)
    }
  }
  
  const handleClose = () => {
    if (!isResolving) {
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  const filename = filePath.split(/[/\\]/).pop() || filePath
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <AlertTriangle className="w-5 h-5 text-svn-conflict" />
            Resolve Conflict
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isResolving}
          >
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
              <h3 className="text-lg font-medium text-text mb-2">Conflict Resolved</h3>
              <p className="text-text-secondary mb-6">
                {filename} has been marked as resolved
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
            {/* File Info */}
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-text-secondary truncate">{filename}</span>
              </div>
              {status === 'C' && (
                <p className="text-xs text-svn-conflict mt-1">
                  This file has conflicts that need to be resolved
                </p>
              )}
            </div>
            
            {/* Resolution Options */}
            <div>
              <label className="text-sm font-medium text-text-secondary mb-2 block">
                Choose resolution method:
              </label>
              <div className="space-y-2">
                {RESOLUTION_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSelectedResolution(option.id)}
                    disabled={isResolving}
                    className={`
                      w-full flex items-start gap-3 p-3 rounded-lg border transition-fast text-left
                      ${selectedResolution === option.id 
                        ? 'border-accent bg-accent/10' 
                        : 'border-border hover:border-accent/50 hover:bg-bg-tertiary'}
                    `}
                  >
                    <div className="mt-0.5">{option.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text">{option.label}</span>
                        {option.recommended && (
                          <span className="text-xs text-accent bg-accent/20 px-1.5 py-0.5 rounded">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {option.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Warning */}
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                <p className="text-xs text-warning">
                  This action will modify the file. Make sure you have a backup if needed.
                </p>
              </div>
            </div>
            
            {/* Error */}
            {error && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                <p className="text-sm text-error">{error}</p>
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
              disabled={isResolving}
            >
              Cancel
            </button>
            <button
              onClick={handleResolve}
              className="btn btn-primary"
              disabled={isResolving || !selectedResolution}
            >
              {isResolving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Resolve
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
