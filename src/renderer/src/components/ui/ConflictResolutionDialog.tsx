import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, CheckCircle, FileText, Loader2, Wrench, ArrowRight } from 'lucide-react'

interface ConflictResolutionDialogProps {
  isOpen: boolean
  onClose: () => void
  conflictPath: string
  workingCopyPath: string
  onResolved?: () => void
}

interface ConflictInfo {
  minePath: string
  theirsPath: string
  basePath: string
  mergedPath: string
  conflictType: 'text' | 'property' | 'tree'
}

export function ConflictResolutionDialog({
  isOpen,
  onClose,
  conflictPath,
  workingCopyPath,
  onResolved
}: ConflictResolutionDialogProps) {
  const queryClient = useQueryClient()
  const [selectedResolution, setSelectedResolution] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [isLaunchingTool, setIsLaunchingTool] = useState(false)
  const [mergeToolError, setMergeToolError] = useState<string | null>(null)
  
  // Fetch settings to get external merge tool
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const stored = await window.api.store.get<{ externalMergeTool?: string }>('settings')
      return stored || {}
    },
    enabled: isOpen
  })
  
  // Get conflict info
  const { data: conflictData, isLoading } = useQuery({
    queryKey: ['conflict:info', conflictPath],
    queryFn: async (): Promise<ConflictInfo> => {
      // In a real implementation, we'd query SVN for conflict file paths
      // SVN creates .mine, .r<rev>, and .r<prev> files
      return {
        minePath: conflictPath + '.mine',
        theirsPath: conflictPath + '.r123',
        basePath: conflictPath + '.r122',
        mergedPath: conflictPath,
        conflictType: 'text'
      }
    },
    enabled: isOpen && !!conflictPath
  })
  
  const resolutions = [
    { 
      value: 'mine-full', 
      label: 'Resolve using mine',
      description: 'Keep your local changes, discard incoming changes'
    },
    { 
      value: 'theirs-full', 
      label: 'Resolve using theirs',
      description: 'Use incoming changes, discard your local changes'
    },
    { 
      value: 'base', 
      label: 'Resolve using base',
      description: 'Use the common ancestor version'
    },
    { 
      value: 'mine-conflict', 
      label: 'Resolve conflicts using mine',
      description: 'Keep mine for conflicts, accept non-conflicting changes'
    },
    { 
      value: 'theirs-conflict', 
      label: 'Resolve conflicts using theirs',
      description: 'Use theirs for conflicts, accept non-conflicting changes'
    }
  ]
  
  const handleResolve = async () => {
    if (!selectedResolution) return
    
    setIsResolving(true)
    
    try {
      await window.api.svn.resolve(conflictPath, selectedResolution as any)
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
      onResolved?.()
      onClose()
    } catch (err) {
      console.error('Failed to resolve conflict:', err)
    } finally {
      setIsResolving(false)
    }
  }
  
  const handleLaunchMergeTool = async () => {
    if (!conflictData) return
    
    const mergeTool = settings?.externalMergeTool
    if (!mergeTool) {
      setMergeToolError('No external merge tool configured. Please set one in Settings > Diff & Merge.')
      return
    }
    
    setIsLaunchingTool(true)
    setMergeToolError(null)
    
    try {
      await window.api.external.openMergeTool(
        mergeTool,
        conflictData.basePath,
        conflictData.minePath,
        conflictData.theirsPath,
        conflictData.mergedPath
      )
    } catch (err) {
      console.error('Failed to launch merge tool:', err)
      setMergeToolError(`Failed to launch merge tool: ${(err as Error).message}`)
    } finally {
      setIsLaunchingTool(false)
    }
  }
  
  const handleMarkResolved = async () => {
    setIsResolving(true)
    
    try {
      await window.api.svn.resolve(conflictPath, 'mine-full')
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
      onResolved?.()
      onClose()
    } catch (err) {
      console.error('Failed to mark resolved:', err)
    } finally {
      setIsResolving(false)
    }
  }
  
  if (!isOpen) return null
  
  const filename = conflictPath.split(/[/\\]/).pop() || conflictPath
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[600px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Resolve Conflict
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <>
              {/* Conflict info */}
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-5 h-5 text-warning" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text truncate">{filename}</p>
                    <p className="text-xs text-text-faint truncate">{conflictPath}</p>
                  </div>
                </div>
                <p className="text-sm text-text-secondary">
                  This file has conflicting changes between your local copy and the repository.
                </p>
              </div>
              
              {/* Merge tool error */}
              {mergeToolError && (
                <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{mergeToolError}</span>
                </div>
              )}
              
              {/* External merge tool option */}
              {settings?.externalMergeTool && (
                <div className="bg-bg-tertiary rounded-lg p-3">
                  <h4 className="text-sm font-medium text-text mb-2">Use External Merge Tool</h4>
                  <p className="text-xs text-text-secondary mb-3">
                    Launch your configured merge tool to visually resolve conflicts.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleLaunchMergeTool}
                      disabled={isLaunchingTool}
                      className="btn btn-primary btn-sm"
                    >
                      {isLaunchingTool ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wrench className="w-4 h-4" />
                      )}
                      Edit Conflicts
                    </button>
                    <button
                      onClick={handleMarkResolved}
                      disabled={isResolving}
                      className="btn btn-secondary btn-sm"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Mark as Resolved
                    </button>
                  </div>
                  <p className="text-xs text-text-faint mt-2">
                    After resolving in the merge tool, click "Mark as Resolved"
                  </p>
                </div>
              )}
              
              {/* Quick resolution options */}
              <div>
                <h4 className="text-sm font-medium text-text mb-2">Quick Resolution</h4>
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
            </>
          )}
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
