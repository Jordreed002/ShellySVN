import { useState, useEffect } from 'react'
import { X, GitMerge, AlertCircle, CheckCircle, Loader2, ChevronRight, ChevronLeft } from 'lucide-react'

interface MergeWizardProps {
  isOpen: boolean
  onClose: () => void
  targetPath: string
  onComplete?: () => void
}

type MergeType = 'range' | 'reintegrate' | 'tree'
type MergePage = 1 | 2 | 3

interface MergeOptions {
  type: MergeType
  sourceUrl: string
  revisions: string
  depth: 'empty' | 'files' | 'immediates' | 'infinity'
  ignoreAncestry: boolean
  allowMixedRevisions: boolean
  onlyRecordMerge: boolean
}

const MERGE_TYPE_OPTIONS = [
  {
    id: 'range' as MergeType,
    title: 'Merge a range of revisions',
    description: 'Port changes from one branch to another (or trunk). Use this when you want to merge specific revisions.',
    icon: '🔢'
  },
  {
    id: 'reintegrate' as MergeType,
    title: 'Reintegrate a branch',
    description: 'Merge an entire feature branch back to trunk. All changes from the branch will be merged.',
    icon: '🔀'
  },
  {
    id: 'tree' as MergeType,
    title: 'Merge two different trees',
    description: 'Advanced: Compare and merge two arbitrary trees. Use for vendor branches or complex scenarios.',
    icon: '🌳'
  }
]

export function MergeWizard({ isOpen, onClose, targetPath, onComplete }: MergeWizardProps) {
  const [page, setPage] = useState<MergePage>(1)
  const [options, setOptions] = useState<MergeOptions>({
    type: 'range',
    sourceUrl: '',
    revisions: '',
    depth: 'infinity',
    ignoreAncestry: false,
    allowMixedRevisions: false,
    onlyRecordMerge: false
  })
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  useEffect(() => {
    if (isOpen) {
      setPage(1)
      setOptions({
        type: 'range',
        sourceUrl: '',
        revisions: '',
        depth: 'infinity',
        ignoreAncestry: false,
        allowMixedRevisions: false,
        onlyRecordMerge: false
      })
      setError(null)
      setSuccess(false)
      setIsMerging(false)
    }
  }, [isOpen])
  
  const handleNext = () => {
    if (page === 1 && !options.sourceUrl.trim()) {
      setError('Please enter a source URL')
      return
    }
    setError(null)
    setPage((p) => Math.min(p + 1, 3) as MergePage)
  }
  
  const handleBack = () => {
    setPage((p) => Math.max(p - 1, 1) as MergePage)
  }
  
  const handleMerge = async () => {
    setIsMerging(true)
    setError(null)
    
    try {
      // Parse revisions
      const revisions = options.revisions 
        ? options.revisions.split(',').map(r => r.trim()).filter(Boolean)
        : undefined
      
      const result = await window.api.svn.merge(
        options.sourceUrl,
        targetPath,
        revisions
      )
      
      if (result.success) {
        setSuccess(true)
      } else {
        setError('Merge failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Merge failed')
    } finally {
      setIsMerging(false)
    }
  }
  
  const handleClose = () => {
    if (!isMerging) {
      if (success && onComplete) {
        onComplete()
      }
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[600px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <GitMerge className="w-5 h-5 text-accent" />
            Merge
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isMerging}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 py-3 bg-bg-tertiary border-b border-border">
          {[1, 2, 3].map((p) => (
            <div key={p} className="flex items-center gap-2">
              <div 
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                  ${page >= p 
                    ? 'bg-accent text-white' 
                    : 'bg-bg-elevated text-text-muted'
                  }`}
              >
                {p}
              </div>
              {p < 3 && (
                <div className={`w-12 h-0.5 ${page > p ? 'bg-accent' : 'bg-bg-elevated'}`} />
              )}
            </div>
          ))}
        </div>
        
        {/* Content */}
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Merge Complete</h3>
              <p className="text-text-secondary mb-6">
                The merge has been completed. Review the changes and commit when ready.
              </p>
              <button
                onClick={handleClose}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal-body">
              {/* Page 1: Merge Type */}
              {page === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    Select the type of merge you want to perform:
                  </p>
                  
                  <div className="space-y-2">
                    {MERGE_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setOptions({ ...options, type: opt.id })}
                        className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-fast text-left
                          ${options.type === opt.id 
                            ? 'border-accent bg-accent/10' 
                            : 'border-border hover:border-accent/50 hover:bg-bg-tertiary'}
                        `}
                      >
                        <span className="text-2xl">{opt.icon}</span>
                        <div>
                          <div className="font-medium text-text">{opt.title}</div>
                          <div className="text-xs text-text-secondary">{opt.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Page 2: Source and Revisions */}
              {page === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                      From URL <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={options.sourceUrl}
                      onChange={(e) => setOptions({ ...options, sourceUrl: e.target.value })}
                      placeholder="svn://example.com/repo/branches/feature-x"
                      className="input"
                    />
                  </div>
                  
                  {options.type === 'range' && (
                    <div>
                      <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                        Revision range
                      </label>
                      <input
                        type="text"
                        value={options.revisions}
                        onChange={(e) => setOptions({ ...options, revisions: e.target.value })}
                        placeholder="e.g., 100-150 or 100,105,110"
                        className="input"
                      />
                      <p className="text-xs text-text-faint mt-1">
                        Leave empty to merge all unmerged revisions
                      </p>
                    </div>
                  )}
                  
                  <div>
                    <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                      Working copy path
                    </label>
                    <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
                      {targetPath}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Page 3: Options */}
              {page === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                      Depth
                    </label>
                    <select
                      value={options.depth}
                      onChange={(e) => setOptions({ ...options, depth: e.target.value as typeof options.depth })}
                      className="input"
                    >
                      <option value="infinity">Fully recursive</option>
                      <option value="immediates">Immediate children</option>
                      <option value="files">Files only</option>
                      <option value="empty">Only this item</option>
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.ignoreAncestry}
                        onChange={(e) => setOptions({ ...options, ignoreAncestry: e.target.checked })}
                      />
                      <span className="text-sm">Ignore ancestry</span>
                    </label>
                    
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.allowMixedRevisions}
                        onChange={(e) => setOptions({ ...options, allowMixedRevisions: e.target.checked })}
                      />
                      <span className="text-sm">Allow mixed revisions</span>
                    </label>
                    
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.onlyRecordMerge}
                        onChange={(e) => setOptions({ ...options, onlyRecordMerge: e.target.checked })}
                      />
                      <span className="text-sm">Only record merge (don't change working copy)</span>
                    </label>
                  </div>
                  
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-warning">
                        Merge will modify your working copy. Make sure to review the changes 
                        before committing.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2 mt-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="modal-footer">
              <button
                type="button"
                onClick={page === 1 ? handleClose : handleBack}
                className="btn btn-secondary"
                disabled={isMerging}
              >
                {page === 1 ? 'Cancel' : (
                  <>
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </>
                )}
              </button>
              
              {page < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn btn-primary"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleMerge}
                  className="btn btn-primary"
                  disabled={isMerging}
                >
                  {isMerging ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    <>
                      <GitMerge className="w-4 h-4" />
                      Merge
                    </>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
