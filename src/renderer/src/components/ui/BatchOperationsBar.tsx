import { useState } from 'react'
import { 
  Upload, Undo2, Plus, Trash2, AlertCircle, 
  Loader2, Check, X, Layers, Lock, Unlock, 
  FileText, FolderSync, ShieldAlert
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
  onLock?: () => Promise<void>
  onUnlock?: () => Promise<void>
  onResolve?: () => Promise<void>
  onDiff?: () => void
  onExport?: () => void
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
  onLock,
  onUnlock,
  onResolve,
  onDiff,
  onExport,
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
  const hasConflicts = selectedFiles.some(f => f.status === 'C')
  const hasLockable = selectedFiles.some(f => !f.status.startsWith('?'))
  const allConflicted = selectedFiles.every(f => f.status === 'C')
  const canRevert = hasModified
  const canAdd = hasUnversioned
  const canResolve = hasConflicts
  
  // Get status breakdown
  const statusBreakdown: Record<SvnStatusChar, number> = {} as Record<SvnStatusChar, number>
  for (const file of selectedFiles) {
    statusBreakdown[file.status] = (statusBreakdown[file.status] || 0) + 1
  }
  
  const handleOperation = async (name: string, operationFn: () => Promise<void>) => {
    setOperation(name)
    setError(null)
    setSuccess(null)
    
    try {
      await operationFn()
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
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg-secondary border-t border-border shadow-lg animate-slide-up">
      <div className="flex items-center gap-4 px-4 py-2">
        {/* Selection info */}
        <div className="flex items-center gap-2">
          <div className={`
            flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-medium
            ${hasConflicts ? 'bg-warning' : 'bg-accent'}
          `}>
            {selectedCount}
          </div>
          <span className="text-sm text-text-secondary">
            {selectedCount} file{selectedCount > 1 ? 's' : ''} selected
          </span>
        </div>
        
        {/* Status breakdown badges */}
        {Object.entries(statusBreakdown).length > 0 && (
          <div className="flex items-center gap-1">
            {Object.entries(statusBreakdown).map(([status, count]) => (
              <span 
                key={status}
                className={`
                  px-1.5 py-0.5 rounded text-xs font-medium
                  ${status === 'M' ? 'bg-svn-modified/20 text-svn-modified' :
                    status === 'A' ? 'bg-svn-added/20 text-svn-added' :
                    status === 'D' ? 'bg-svn-deleted/20 text-svn-deleted' :
                    status === 'C' ? 'bg-warning/20 text-warning' :
                    status === '?' ? 'bg-svn-unversioned/20 text-svn-unversioned' :
                    'bg-bg-tertiary text-text-muted'}
                `}
              >
                {status}: {count}
              </span>
            ))}
          </div>
        )}
        
        <div className="h-5 w-px bg-border" />
        
        {/* Primary Operations */}
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
                <Check className="w-3.5 h-3.5 text-svn-added" />
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
                <Check className="w-3.5 h-3.5 text-svn-added" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Add</span>
            </button>
          )}
          
          {/* Resolve conflicts */}
          {canResolve && onResolve && (
            <button
              onClick={() => handleOperation('Resolved', onResolve)}
              disabled={isLoading || operation !== null}
              className="btn btn-secondary btn-sm gap-1.5 hover:text-warning"
            >
              {operation === 'Resolved' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : success?.startsWith('Resolved') ? (
                <Check className="w-3.5 h-3.5 text-svn-added" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
              <span>Resolve{allConflicted ? ' All' : ''}</span>
            </button>
          )}
        </div>
        
        <div className="h-5 w-px bg-border" />
        
        {/* Secondary Operations */}
        <div className="flex items-center gap-1">
          {/* Diff */}
          {onDiff && (
            <button
              onClick={onDiff}
              disabled={isLoading}
              className="btn btn-ghost btn-sm gap-1.5"
              title="View diff for selected files"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Diff</span>
            </button>
          )}
          
          {/* Add to Changelist */}
          <button
            onClick={onAddToChangelist}
            disabled={isLoading}
            className="btn btn-ghost btn-sm gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Changelist</span>
          </button>
          
          {/* Lock */}
          {onLock && hasLockable && (
            <button
              onClick={() => handleOperation('Locked', onLock)}
              disabled={isLoading || operation !== null}
              className="btn btn-ghost btn-sm gap-1.5"
              title="Lock selected files"
            >
              {operation === 'Locked' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span>Lock</span>
            </button>
          )}
          
          {/* Unlock */}
          {onUnlock && (
            <button
              onClick={() => handleOperation('Unlocked', onUnlock)}
              disabled={isLoading || operation !== null}
              className="btn btn-ghost btn-sm gap-1.5"
              title="Unlock selected files"
            >
              {operation === 'Unlocked' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Unlock className="w-3.5 h-3.5" />
              )}
              <span>Unlock</span>
            </button>
          )}
          
          {/* Export */}
          {onExport && (
            <button
              onClick={onExport}
              disabled={isLoading}
              className="btn btn-ghost btn-sm gap-1.5"
              title="Export selected files"
            >
              <FolderSync className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          )}
          
          {/* Delete */}
          <button
            onClick={() => handleOperation('Deleted', onDelete)}
            disabled={isLoading || operation !== null}
            className="btn btn-ghost btn-sm gap-1.5 hover:text-error hover:bg-error/10"
            title="Delete selected files"
          >
            {operation === 'Deleted' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : success?.startsWith('Deleted') ? (
              <Check className="w-3.5 h-3.5 text-svn-added" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>Delete</span>
          </button>
        </div>
        
        {/* Status/Error/Success */}
        <div className="flex-1" />
        
        {error && (
          <div className="flex items-center gap-2 text-error text-sm animate-fade-in">
            <AlertCircle className="w-4 h-4" />
            <span className="max-w-xs truncate">{error}</span>
            <button 
              onClick={() => setError(null)}
              className="hover:text-error/80"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        
        {success && (
          <div className="flex items-center gap-2 text-svn-added text-sm animate-fade-in">
            <Check className="w-4 h-4" />
            <span>{success}</span>
          </div>
        )}
        
        {/* Clear selection */}
        <button
          onClick={onClearSelection}
          className="btn-icon-sm"
          title="Clear selection (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
