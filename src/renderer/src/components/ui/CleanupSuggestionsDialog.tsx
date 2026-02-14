import { useState } from 'react'
import { X, Wrench, AlertTriangle, CheckCircle, Loader2, RefreshCw } from 'lucide-react'

interface CleanupIssue {
  type: 'warning' | 'error' | 'info'
  title: string
  description: string
  action?: () => Promise<void>
  actionLabel?: string
  autoFixable?: boolean
}

interface CleanupSuggestionsDialogProps {
  isOpen: boolean
  onClose: () => void
  workingCopyPath: string
  issues?: CleanupIssue[]
  onRefresh?: () => void
}

export function CleanupSuggestionsDialog({
  isOpen,
  onClose,
  workingCopyPath,
  issues: propIssues,
  onRefresh
}: CleanupSuggestionsDialogProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [runResults, setRunResults] = useState<Map<string, 'success' | 'error'>>(new Map())
  
  // Default issues if none provided
  const issues: CleanupIssue[] = propIssues || [
    {
      type: 'warning',
      title: 'Working copy locked',
      description: 'A previous operation may have left the working copy in an inconsistent state.',
      actionLabel: 'Run Cleanup',
      autoFixable: true
    },
    {
      type: 'info',
      title: 'Unversioned files detected',
      description: 'There are unversioned files that might need to be added or ignored.',
      autoFixable: false
    },
    {
      type: 'warning',
      title: 'Switched paths detected',
      description: 'Some paths may be switched to different repository URLs.',
      autoFixable: false
    }
  ]
  
  if (!isOpen) return null
  
  const handleFixAll = async () => {
    setIsRunning(true)
    setRunResults(new Map())
    
    const results = new Map<string, 'success' | 'error'>()
    
    try {
      // Run cleanup first
      try {
        await window.api.svn.cleanup(workingCopyPath)
        results.set('cleanup', 'success')
      } catch {
        results.set('cleanup', 'error')
      }
      
      onRefresh?.()
    } finally {
      setIsRunning(false)
      setRunResults(results)
    }
  }
  
  const autoFixableCount = issues.filter(i => i.autoFixable).length
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Wrench className="w-5 h-5 text-accent" />
            Working Copy Status
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Path info */}
          <div className="bg-bg-tertiary rounded-lg p-3">
            <p className="text-xs text-text-faint mb-1">Working Copy:</p>
            <p className="text-sm font-mono text-text-secondary truncate">{workingCopyPath}</p>
          </div>
          
          {/* Issues list */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-text">Detected Issues</h4>
            
            {issues.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle className="w-10 h-10 text-success mx-auto mb-3" />
                <p className="text-sm text-text-secondary">No issues detected</p>
                <p className="text-xs text-text-faint mt-1">Your working copy is in good state</p>
              </div>
            ) : (
              issues.map((issue, index) => (
                <div 
                  key={index}
                  className={`p-3 rounded-lg border ${
                    issue.type === 'error' 
                      ? 'border-error/30 bg-error/5' 
                      : issue.type === 'warning'
                        ? 'border-warning/30 bg-warning/5'
                        : 'border-border bg-bg-tertiary'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {issue.type === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-error mt-0.5 flex-shrink-0" />
                    ) : issue.type === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-text">{issue.title}</p>
                        {issue.autoFixable && (
                          <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded">
                            Auto-fix
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary mt-1">{issue.description}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {/* What cleanup does */}
          <div className="text-xs text-text-faint bg-bg-tertiary rounded-lg p-3">
            <p className="font-medium mb-1">SVN Cleanup will:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Release working copy locks</li>
              <li>Complete unfinished operations</li>
              <li>Repair working copy metadata</li>
            </ul>
          </div>
          
          {/* Results */}
          {runResults.size > 0 && (
            <div className="rounded-lg border border-border p-3">
              {Array.from(runResults.entries()).map(([key, status]) => (
                <div key={key} className="flex items-center gap-2">
                  {status === 'success' ? (
                    <CheckCircle className="w-4 h-4 text-success" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-error" />
                  )}
                  <span className="text-sm">
                    {status === 'success' ? 'Cleanup completed successfully' : 'Cleanup failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
          
          {autoFixableCount > 0 && (
            <button
              onClick={handleFixAll}
              disabled={isRunning}
              className="btn btn-primary"
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wrench className="w-4 h-4" />
              )}
              Fix {autoFixableCount} Issue{autoFixableCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Check for common working copy issues
 */
export async function checkWorkingCopyHealth(path: string): Promise<CleanupIssue[]> {
  const issues: CleanupIssue[] = []
  
  try {
    // Check if we can get status
    const status = await window.api.svn.status(path)
    
    // Check for conflicts
    const conflicts = status.entries.filter(e => e.status === 'C')
    if (conflicts.length > 0) {
      issues.push({
        type: 'error',
        title: `${conflicts.length} conflicted file${conflicts.length !== 1 ? 's' : ''}`,
        description: 'Resolve conflicts before committing.',
        autoFixable: false
      })
    }
    
    // Check for missing files
    const missing = status.entries.filter(e => e.status === '!')
    if (missing.length > 0) {
      issues.push({
        type: 'warning',
        title: `${missing.length} missing file${missing.length !== 1 ? 's' : ''}`,
        description: 'Some files are missing from the working copy.',
        autoFixable: false
      })
    }
    
  } catch (err) {
    // If status fails, might need cleanup
    issues.push({
      type: 'warning',
      title: 'Working copy may need cleanup',
      description: 'Unable to read working copy status. A cleanup might help.',
      autoFixable: true
    })
  }
  
  return issues
}
