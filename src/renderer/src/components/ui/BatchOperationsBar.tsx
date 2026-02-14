import { useState } from 'react'
import { 
  Upload, Undo2, Plus, Trash2, AlertCircle, 
  Loader2, Check, X, Layers
} from 'lucide-react'
import type { SvnStatusChar } from '@shared/types'

interface BatchOperationsBarProps {
  selectedCount: number
  selectedFiles: { path: string; status: SvnStatusChar }[]
  onCommit: () => void
  onRevert: () => Promise<void>
  onAdd: () => Promise<void>
  onDelete: () => Promise<void>
  onAddToChangelist: () => void
  onClearSelection: () => void
  isLoading?: boolean
}

export function BatchOperationsBar({
  selectedCount,
  selectedFiles,
  onCommit,
  onRevert,
  onAdd,
  onDelete,
  onAddToChangelist,
  onClearSelection,
  isLoading = false
}: BatchOperationsBarProps) {
  const [operation, setOperation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  if (selectedCount === 0) return null
  
  // Determine which operations are available
  const hasModified = selectedFiles.some(f => ['M', 'R', 'D'].includes(f.status))
  const hasUnversioned = selectedFiles.some(f => f.status === '?')
  const canRevert = hasModified
  const canAdd = hasUnversioned
  
  const handleOperation = async (name: string, operation: () => Promise<void>) => {
    setOperation(name)
    setError(null)
    setSuccess(null)
    
    try {
      await operation()
      setSuccess(`${name} ${selectedCount} file${selectedCount > 1 ? 's' : ''}`)
      setTimeout(() => {
        setSuccess(null)
        setOperation(null)
      }, 2000)
    } catch (err) {
      setError((err as Error).message)
      setOperation(null)
    }
  }
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg-secondary border-t border-border shadow-lg">
      <div className="flex items-center gap-4 px-4 py-2">
        {/* Selection info */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent text-white text-xs font-medium">
            {selectedCount}
          </div>
          <span className="text-sm text-text-secondary">
            {selectedCount} file{selectedCount > 1 ? 's' : ''} selected
          </span>
        </div>
        
        <div className="h-5 w-px bg-border" />
        
        {/* Operations */}
        <div className="flex items-center gap-1">
          {/* Commit */}
          <button
            onClick={onCommit}
            disabled={isLoading}
            className="btn btn-primary btn-sm gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Commit</span>
          </button>
          
          {/* Revert */}
          {canRevert && (
            <button
              onClick={() => handleOperation('Reverted', onRevert)}
              disabled={isLoading || operation !== null}
              className="btn btn-secondary btn-sm gap-1.5"
            >
              {operation === 'Reverted' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : success?.startsWith('Reverted') ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Undo2 className="w-3.5 h-3.5" />
              )}
              <span>Revert</span>
            </button>
          )}
          
          {/* Add */}
          {canAdd && (
            <button
              onClick={() => handleOperation('Added', onAdd)}
              disabled={isLoading || operation !== null}
              className="btn btn-secondary btn-sm gap-1.5"
            >
              {operation === 'Added' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : success?.startsWith('Added') ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Add</span>
            </button>
          )}
          
          {/* Add to Changelist */}
          <button
            onClick={onAddToChangelist}
            disabled={isLoading}
            className="btn btn-secondary btn-sm gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Changelist</span>
          </button>
          
          {/* Delete */}
          <button
            onClick={() => handleOperation('Deleted', onDelete)}
            disabled={isLoading || operation !== null}
            className="btn btn-secondary btn-sm gap-1.5 hover:text-error"
          >
            {operation === 'Deleted' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : success?.startsWith('Deleted') ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>Delete</span>
          </button>
        </div>
        
        {/* Status/Error/Success */}
        <div className="flex-1" />
        
        {error && (
          <div className="flex items-center gap-2 text-error text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}
        
        {success && (
          <div className="flex items-center gap-2 text-success text-sm">
            <Check className="w-4 h-4" />
            <span>{success}</span>
          </div>
        )}
        
        {/* Clear selection */}
        <button
          onClick={onClearSelection}
          className="btn-icon-sm"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
