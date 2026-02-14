import { useState } from 'react'
import { X, Move, FileText, FolderOpen, AlertCircle, Loader2 } from 'lucide-react'

interface MoveRenameDialogProps {
  isOpen: boolean
  onClose: () => void
  sourcePath: string
  mode: 'move' | 'rename'
  onSuccess?: () => void
}

export function MoveRenameDialog({ isOpen, onClose, sourcePath, mode, onSuccess }: MoveRenameDialogProps) {
  const [destination, setDestination] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  if (!isOpen) return null
  
  const sourceName = sourcePath.split(/[/\\]/).pop() || sourcePath
  const isDirectory = !sourceName.includes('.') || sourcePath.endsWith('/') || sourcePath.endsWith('\\')
  
  const handleBrowse = async () => {
    if (isDirectory) {
      const result = await window.api.dialog.openDirectory()
      if (result) {
        setDestination(result)
      }
    } else {
      const result = await window.api.dialog.saveFile(sourceName)
      if (result) {
        setDestination(result)
      }
    }
  }
  
  const handleSubmit = async () => {
    if (!destination.trim()) {
      setError('Destination path is required')
      return
    }
    
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await window.api.svn.move(sourcePath, destination)
      
      if (result.success) {
        onSuccess?.()
        onClose()
      } else {
        setError(result.output || 'Failed to move/rename')
      }
    } catch (err) {
      setError((err as Error).message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }
  
  const title = mode === 'rename' ? 'Rename' : 'Move'
  const icon = mode === 'rename' ? <FileText className="w-5 h-5 text-accent" /> : <Move className="w-5 h-5 text-accent" />
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            {icon}
            {title}
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Source info */}
          <div className="bg-bg-tertiary rounded-lg p-3">
            <p className="text-xs text-text-faint mb-1">Source:</p>
            <p className="text-sm font-mono text-text-secondary truncate">{sourcePath}</p>
          </div>
          
          {/* Destination input */}
          <div>
            <label className="text-sm font-medium text-text-secondary mb-1.5 block">
              Destination
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={mode === 'rename' ? 'Enter new name...' : 'Enter destination path...'}
                className="input flex-1"
                autoFocus
              />
              <button
                onClick={handleBrowse}
                className="btn btn-secondary"
                title="Browse"
              >
                {isDirectory ? (
                  <FolderOpen className="w-4 h-4" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          
          {/* Info */}
          <div className="text-xs text-text-faint space-y-1">
            <p>This operation preserves the file's history in the repository.</p>
            <p>The change will be committed to the repository when you commit.</p>
          </div>
          
          {error && (
            <div className="text-sm text-error flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !destination.trim()}
            className="btn btn-primary"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Move className="w-4 h-4" />
            )}
            {title}
          </button>
        </div>
      </div>
    </div>
  )
}
