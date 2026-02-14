import { useState } from 'react'
import { X, AlertTriangle, FileText, Folder, ArrowRight, Loader2 } from 'lucide-react'

interface TreeConflictDialogProps {
  isOpen: boolean
  onClose: () => void
  conflictPath: string
  conflictDescription?: string
  onResolve?: (resolution: 'mine-conflict' | 'theirs-conflict' | 'mine-full' | 'theirs-full' | 'postpone') => void
}

export function TreeConflictDialog({ 
  isOpen, 
  onClose, 
  conflictPath, 
  conflictDescription,
  onResolve 
}: TreeConflictDialogProps) {
  const [selectedResolution, setSelectedResolution] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  
  if (!isOpen) return null
  
  const filename = conflictPath.split(/[/\\]/).pop() || conflictPath
  const isDirectory = !filename.includes('.')
  
  const resolutions = [
    { 
      value: 'mine-conflict', 
      label: 'Resolve conflict using mine',
      description: 'Keep your local changes, discard incoming changes'
    },
    { 
      value: 'theirs-conflict', 
      label: 'Resolve conflict using theirs',
      description: 'Use incoming changes, discard your local changes'
    },
    { 
      value: 'mine-full', 
      label: 'Resolve using mine (full)',
      description: 'Prefer your version for all conflicts in this file'
    },
    { 
      value: 'theirs-full', 
      label: 'Resolve using theirs (full)',
      description: 'Prefer their version for all conflicts in this file'
    },
    { 
      value: 'postpone', 
      label: 'Postpone resolution',
      description: 'Leave the conflict unresolved for now'
    }
  ]
  
  const handleResolve = async () => {
    if (!selectedResolution) return
    
    setIsResolving(true)
    
    try {
      if (onResolve) {
        onResolve(selectedResolution as any)
      } else {
        // Default behavior: resolve via SVN
        await window.api.svn.resolve(conflictPath, selectedResolution as any)
      }
      onClose()
    } catch (err) {
      console.error('Failed to resolve conflict:', err)
    } finally {
      setIsResolving(false)
    }
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Tree Conflict
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
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
              A tree conflict occurs when there's a conflict at the directory level, 
              such as a file being deleted locally but modified in the repository, 
              or both sides renaming a file differently.
            </p>
          </div>
          
          {/* Resolution options */}
          <div>
            <label className="text-sm font-medium text-text-secondary mb-2 block">
              Resolution
            </label>
            <div className="space-y-2">
              {resolutions.map((resolution) => (
                <label
                  key={resolution.value}
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
                    onChange={() => setSelectedResolution(resolution.value)}
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
          
          {/* Warning */}
          <div className="text-xs text-text-faint flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Tree conflicts may require manual intervention after resolution.
          </div>
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
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
      </div>
    </div>
  )
}
