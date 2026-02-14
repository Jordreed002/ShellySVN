import { useState } from 'react'
import { Zap, X, Loader2 } from 'lucide-react'
import type { SvnStatusChar } from '@shared/types'

interface QuickCommitProps {
  isOpen: boolean
  workingCopyPath: string
  changedFiles: { path: string; status: SvnStatusChar }[]
  onClose: () => void
  onSubmit: (paths: string[], message: string) => Promise<{ success: boolean; message?: string; revision?: number }>
}

// Generate a quick commit message based on file changes
function generateQuickMessage(files: { path: string; status: SvnStatusChar }[]): string {
  if (files.length === 0) return ''
  
  const statusGroups: Record<string, string[]> = {
    modified: [],
    added: [],
    deleted: [],
    other: []
  }
  
  files.forEach(f => {
    const filename = f.path.split(/[/\\]/).pop() || f.path
    if (f.status === 'M' || f.status === 'R') {
      statusGroups.modified.push(filename)
    } else if (f.status === 'A' || f.status === '?') {
      statusGroups.added.push(filename)
    } else if (f.status === 'D') {
      statusGroups.deleted.push(filename)
    } else {
      statusGroups.other.push(filename)
    }
  })
  
  const parts: string[] = []
  
  if (statusGroups.added.length > 0) {
    if (statusGroups.added.length === 1) {
      parts.push(`Add ${statusGroups.added[0]}`)
    } else {
      parts.push(`Add ${statusGroups.added.length} files`)
    }
  }
  
  if (statusGroups.modified.length > 0) {
    if (statusGroups.modified.length === 1) {
      parts.push(`Update ${statusGroups.modified[0]}`)
    } else {
      parts.push(`Update ${statusGroups.modified.length} files`)
    }
  }
  
  if (statusGroups.deleted.length > 0) {
    if (statusGroups.deleted.length === 1) {
      parts.push(`Remove ${statusGroups.deleted[0]}`)
    } else {
      parts.push(`Remove ${statusGroups.deleted.length} files`)
    }
  }
  
  if (parts.length === 0) {
    return `Changes to ${files.length} file${files.length > 1 ? 's' : ''}`
  }
  
  if (parts.length === 1) {
    return parts[0]
  }
  
  // Multiple types of changes
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

export function QuickCommit({ isOpen, changedFiles, onClose, onSubmit }: Omit<QuickCommitProps, 'workingCopyPath'>) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number } | null>(null)
  
  if (!isOpen) return null
  
  const generatedMessage = generateQuickMessage(changedFiles)
  
  const handleSubmit = async () => {
    if (changedFiles.length === 0) return
    
    setIsSubmitting(true)
    setError(null)
    
    const paths = changedFiles.map(f => f.path)
    const result = await onSubmit(paths, generatedMessage)
    
    if (result.success) {
      setSuccess({ revision: result.revision || 0 })
      setTimeout(() => {
        onClose()
        setSuccess(null)
      }, 1500)
    } else {
      setError(result.message || 'Quick commit failed')
      setIsSubmitting(false)
    }
  }
  
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
      <div className="bg-bg-secondary border border-border rounded-lg shadow-lg p-4 max-w-sm">
        {success ? (
          <div className="flex items-center gap-3 text-success">
            <Zap className="w-5 h-5" />
            <span>Committed successfully! (r{success.revision})</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" />
                <span className="font-medium text-text">Quick Commit</span>
              </div>
              <button onClick={onClose} className="btn-icon-sm" disabled={isSubmitting}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <p className="text-sm text-text-secondary mb-2">
              {changedFiles.length} file{changedFiles.length > 1 ? 's' : ''} changed
            </p>
            
            <div className="bg-bg-tertiary rounded px-3 py-2 mb-3 text-sm text-text font-mono">
              {generatedMessage}
            </div>
            
            {error && (
              <p className="text-xs text-error mb-2">{error}</p>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || changedFiles.length === 0}
                className="btn btn-primary btn-sm flex-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Committing...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    <span>Commit</span>
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
