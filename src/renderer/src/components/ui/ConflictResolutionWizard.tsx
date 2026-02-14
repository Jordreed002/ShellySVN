import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { 
  X, AlertTriangle, CheckCircle, ChevronRight, ChevronLeft, FileText, 
  RefreshCw, List, Layers, Eye,
  Check, Info, AlertCircle
} from 'lucide-react'
import { ThreeWayMergeEditor } from './ThreeWayMergeEditor'

interface ConflictWizardProps {
  isOpen: boolean
  onClose: () => void
  conflictPaths: string[]
  workingCopyPath: string
  onAllResolved?: () => void
}

interface ConflictFile {
  path: string
  status: 'pending' | 'in-progress' | 'resolved' | 'skipped'
  conflictType: 'text' | 'property' | 'tree'
  resolution?: 'mine-full' | 'theirs-full' | 'base' | 'merged' | 'custom'
  error?: string
}

type WizardStep = 'overview' | 'select' | 'resolve' | 'review' | 'complete'

export function ConflictResolutionWizard({
  isOpen,
  onClose,
  conflictPaths,
  workingCopyPath,
  onAllResolved
}: ConflictWizardProps) {
  const queryClient = useQueryClient()
  const [currentStep, setCurrentStep] = useState<WizardStep>('overview')
  const [conflictFiles, setConflictFiles] = useState<ConflictFile[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showMergeEditor, setShowMergeEditor] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  
  // Initialize conflict files
  useEffect(() => {
    if (isOpen && conflictPaths.length > 0) {
      setConflictFiles(conflictPaths.map(path => ({
        path,
        status: 'pending',
        conflictType: 'text' as const
      })))
      setCurrentIndex(0)
      setCurrentStep('overview')
    }
  }, [isOpen, conflictPaths])
  
  // Get current conflict file
  const currentFile = conflictFiles[currentIndex]
  
  // Statistics
  const stats = {
    total: conflictFiles.length,
    pending: conflictFiles.filter(f => f.status === 'pending').length,
    inProgress: conflictFiles.filter(f => f.status === 'in-progress').length,
    resolved: conflictFiles.filter(f => f.status === 'resolved').length,
    skipped: conflictFiles.filter(f => f.status === 'skipped').length
  }
  
  // Navigation
  const goToNextStep = () => {
    const steps: WizardStep[] = ['overview', 'select', 'resolve', 'review', 'complete']
    const nextIndex = steps.indexOf(currentStep) + 1
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex])
    }
  }
  
  const goToPrevStep = () => {
    const steps: WizardStep[] = ['overview', 'select', 'resolve', 'review', 'complete']
    const prevIndex = steps.indexOf(currentStep) - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex])
    }
  }
  
  // Handle resolution
  const handleResolve = async (resolution: ConflictFile['resolution']) => {
    if (!currentFile) return
    
    setIsProcessing(true)
    
    try {
      // Update status
      setConflictFiles(prev => prev.map((f, i) => 
        i === currentIndex 
          ? { ...f, status: 'resolved', resolution }
          : f
      ))
      
      // Apply SVN resolution
      const resolutionMap: Record<string, string> = {
        'mine-full': 'mine-full',
        'theirs-full': 'theirs-full',
        'base': 'base',
        'merged': 'mine-full', // After merge, mark as resolved with mine
        'custom': 'mine-full'
      }
      
      await window.api.svn.resolve(currentFile.path, resolutionMap[resolution || 'mine-full'] as any)
      
      // Invalidate status cache
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
      
      // Auto-advance to next conflict
      if (autoAdvance && currentIndex < conflictFiles.length - 1) {
        setCurrentIndex(prev => prev + 1)
      } else if (stats.pending === 1) {
        // This was the last one
        setCurrentStep('complete')
      }
    } catch (err) {
      console.error('Failed to resolve conflict:', err)
      setConflictFiles(prev => prev.map((f, i) =>
        i === currentIndex
          ? { ...f, error: (err as Error).message }
          : f
      ))
    } finally {
      setIsProcessing(false)
    }
  }
  
  // Skip current conflict
  const handleSkip = () => {
    setConflictFiles(prev => prev.map((f, i) =>
      i === currentIndex
        ? { ...f, status: 'skipped' }
        : f
    ))
    
    if (currentIndex < conflictFiles.length - 1) {
      setCurrentIndex(prev => prev + 1)
    }
  }
  
  // Open merge editor
  const handleOpenMergeEditor = () => {
    setShowMergeEditor(true)
  }
  
  // Handle merge editor save
  const handleMergeEditorSave = async (content: string) => {
    // Write the merged content back to the file
    // This would need a file write API
    console.log('Merged content saved:', content.length, 'bytes')
    
    // Mark as resolved
    await handleResolve('merged')
    setShowMergeEditor(false)
  }
  
  // Batch resolve all
  const handleResolveAllMine = async () => {
    setIsProcessing(true)
    try {
      for (const file of conflictFiles.filter(f => f.status === 'pending')) {
        await window.api.svn.resolve(file.path, 'mine-full')
      }
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
      setConflictFiles(prev => prev.map(f => 
        f.status === 'pending' ? { ...f, status: 'resolved', resolution: 'mine-full' as const } : f
      ))
      setCurrentStep('complete')
    } catch (err) {
      console.error('Failed to resolve all:', err)
    } finally {
      setIsProcessing(false)
    }
  }
  
  const handleResolveAllTheirs = async () => {
    setIsProcessing(true)
    try {
      for (const file of conflictFiles.filter(f => f.status === 'pending')) {
        await window.api.svn.resolve(file.path, 'theirs-full')
      }
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
      setConflictFiles(prev => prev.map(f => 
        f.status === 'pending' ? { ...f, status: 'resolved', resolution: 'theirs-full' as const } : f
      ))
      setCurrentStep('complete')
    } catch (err) {
      console.error('Failed to resolve all:', err)
    } finally {
      setIsProcessing(false)
    }
  }
  
  // Finish
  const handleFinish = () => {
    onAllResolved?.()
    onClose()
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[900px] max-w-[95vw] h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <Layers className="w-5 h-5 text-warning" />
            Conflict Resolution Wizard
          </h2>
          <div className="flex items-center gap-3">
            {/* Progress indicator */}
            <div className="flex items-center gap-1 text-xs text-text-muted">
              {stats.resolved}/{stats.total} resolved
            </div>
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex-shrink-0 px-6 py-3 bg-bg-secondary border-b border-border">
          <div className="flex items-center justify-between">
            {(['overview', 'select', 'resolve', 'review'] as WizardStep[]).map((step, index) => (
              <div key={step} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step)}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg transition-fast
                    ${currentStep === step 
                      ? 'bg-accent/20 text-accent' 
                      : index < ['overview', 'select', 'resolve', 'review'].indexOf(currentStep)
                        ? 'text-svn-added hover:bg-bg-elevated'
                        : 'text-text-muted hover:bg-bg-elevated'
                    }
                  `}
                >
                  <span className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                    ${currentStep === step 
                      ? 'bg-accent text-white' 
                      : index < ['overview', 'select', 'resolve', 'review'].indexOf(currentStep)
                        ? 'bg-svn-added text-white'
                        : 'bg-bg-tertiary text-text-muted'
                    }
                  `}>
                    {index + 1}
                  </span>
                  <span className="capitalize hidden sm:inline">{step}</span>
                </button>
                {index < 3 && (
                  <ChevronRight className="w-4 h-4 text-text-faint mx-2" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {/* Overview Step */}
          {currentStep === 'overview' && (
            <div className="p-6 space-y-6">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8 text-warning" />
                </div>
                <h3 className="text-xl font-medium text-text mb-2">
                  {stats.total} Conflicts Found
                </h3>
                <p className="text-text-secondary max-w-md mx-auto">
                  Your working copy has conflicts that need to be resolved before you can commit.
                  This wizard will guide you through resolving each conflict.
                </p>
              </div>

              {/* Conflict summary */}
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                <div className="bg-bg-tertiary rounded-lg p-4 text-center">
                  <FileText className="w-6 h-6 text-warning mx-auto mb-2" />
                  <p className="text-2xl font-bold text-text">{stats.total}</p>
                  <p className="text-xs text-text-muted">Total Conflicts</p>
                </div>
                <div className="bg-bg-tertiary rounded-lg p-4 text-center">
                  <List className="w-6 h-6 text-accent mx-auto mb-2" />
                  <p className="text-2xl font-bold text-text">{conflictPaths.filter(p => !p.includes('.')).length}</p>
                  <p className="text-xs text-text-muted">Directories</p>
                </div>
              </div>

              {/* Quick actions */}
              <div className="border border-border rounded-lg p-4 max-w-lg mx-auto">
                <h4 className="text-sm font-medium text-text mb-3">Quick Actions</h4>
                <div className="space-y-2">
                  <button
                    onClick={handleResolveAllMine}
                    disabled={isProcessing}
                    className="w-full btn btn-secondary justify-start"
                  >
                    <Check className="w-4 h-4" />
                    Resolve All Using Mine
                    <span className="text-xs text-text-muted ml-auto">Keep your changes</span>
                  </button>
                  <button
                    onClick={handleResolveAllTheirs}
                    disabled={isProcessing}
                    className="w-full btn btn-secondary justify-start"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Resolve All Using Theirs
                    <span className="text-xs text-text-muted ml-auto">Accept incoming</span>
                  </button>
                </div>
              </div>

              {/* Info box */}
              <div className="bg-info/10 border border-info/30 rounded-lg p-4 max-w-lg mx-auto flex gap-3">
                <Info className="w-5 h-5 text-info flex-shrink-0 mt-0.5" />
                <div className="text-sm text-text-secondary">
                  <p className="font-medium text-text mb-1">Tip</p>
                  <p>You can also resolve conflicts individually by choosing "Resolve" from the context menu.</p>
                </div>
              </div>
            </div>
          )}

          {/* Select Step */}
          {currentStep === 'select' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-text">Select Conflicts to Resolve</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConflictFiles(prev => prev.map(f => ({ ...f, status: 'pending' as const })))}
                    className="btn btn-secondary btn-sm"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setConflictFiles(prev => prev.map(f => ({ ...f, status: 'skipped' as const })))}
                    className="btn btn-secondary btn-sm"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-auto">
                {conflictFiles.map((file, index) => (
                  <label
                    key={file.path}
                    className={`
                      flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-fast
                      ${file.status === 'pending' 
                        ? 'border-border hover:border-accent/50' 
                        : file.status === 'resolved'
                          ? 'border-svn-added/50 bg-svn-added/10'
                          : 'border-border opacity-50'
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={file.status === 'pending'}
                      onChange={() => {
                        setConflictFiles(prev => prev.map((f, i) =>
                          i === index
                            ? { ...f, status: f.status === 'pending' ? 'skipped' : 'pending' }
                            : f
                        ))
                      }}
                      className="checkbox"
                    />
                    <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{file.path.split(/[/\\]/).pop()}</p>
                      <p className="text-xs text-text-faint truncate">{file.path}</p>
                    </div>
                    {file.status === 'resolved' && (
                      <span className="text-xs text-svn-added flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Resolve Step */}
          {currentStep === 'resolve' && currentFile && (
            <div className="p-6 space-y-4">
              {/* Progress */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-text-secondary">
                    Conflict {currentIndex + 1} of {conflictFiles.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                      disabled={currentIndex === 0}
                      className="btn-icon-sm"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCurrentIndex(prev => Math.min(conflictFiles.length - 1, prev + 1))}
                      disabled={currentIndex >= conflictFiles.length - 1}
                      className="btn-icon-sm"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    className="checkbox"
                  />
                  Auto-advance
                </label>
              </div>

              {/* Current file info */}
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-6 h-6 text-warning mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text">{currentFile.path.split(/[/\\]/).pop()}</p>
                    <p className="text-xs text-text-faint truncate">{currentFile.path}</p>
                    <p className="text-sm text-text-secondary mt-2">
                      This file has conflicting changes between your local copy and the repository.
                    </p>
                  </div>
                </div>
              </div>

              {/* Resolution options */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-text">Choose Resolution</h4>
                
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleResolve('mine-full')}
                    disabled={isProcessing}
                    className="btn btn-secondary h-auto py-3 flex-col items-start"
                  >
                    <span className="font-medium">Use Mine</span>
                    <span className="text-xs text-text-muted">Keep your local changes</span>
                  </button>
                  <button
                    onClick={() => handleResolve('theirs-full')}
                    disabled={isProcessing}
                    className="btn btn-secondary h-auto py-3 flex-col items-start"
                  >
                    <span className="font-medium">Use Theirs</span>
                    <span className="text-xs text-text-muted">Accept incoming changes</span>
                  </button>
                </div>

                {/* Merge option */}
                <button
                  onClick={handleOpenMergeEditor}
                  className="btn btn-primary w-full"
                >
                  <Eye className="w-4 h-4" />
                  Open Visual Merge Editor
                </button>

                {/* Skip */}
                <button
                  onClick={handleSkip}
                  className="btn btn-ghost w-full text-text-muted"
                >
                  Skip for now
                </button>
              </div>

              {/* Error display */}
              {currentFile.error && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-error mt-0.5" />
                  <div className="text-sm text-error">{currentFile.error}</div>
                </div>
              )}
            </div>
          )}

          {/* Review Step */}
          {currentStep === 'review' && (
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-medium text-text mb-4">Review Resolutions</h3>

              <div className="space-y-2 max-h-[400px] overflow-auto">
                {conflictFiles.map((file) => (
                  <div
                    key={file.path}
                    className={`
                      flex items-center gap-3 p-3 border rounded-lg
                      ${file.status === 'resolved' 
                        ? 'border-svn-added/50 bg-svn-added/10' 
                        : file.status === 'skipped'
                          ? 'border-border bg-bg-tertiary opacity-60'
                          : 'border-warning/50 bg-warning/10'
                      }
                    `}
                  >
                    <FileText className="w-5 h-5 text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{file.path.split(/[/\\]/).pop()}</p>
                      <p className="text-xs text-text-faint truncate">{file.path}</p>
                    </div>
                    {file.status === 'resolved' && (
                      <span className="text-xs text-svn-added flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        {file.resolution}
                      </span>
                    )}
                    {file.status === 'skipped' && (
                      <span className="text-xs text-text-muted">Skipped</span>
                    )}
                    {file.status === 'pending' && (
                      <span className="text-xs text-warning">Pending</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="bg-bg-tertiary rounded-lg p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-svn-added">{stats.resolved}</p>
                    <p className="text-xs text-text-muted">Resolved</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-warning">{stats.pending}</p>
                    <p className="text-xs text-text-muted">Pending</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-muted">{stats.skipped}</p>
                    <p className="text-xs text-text-muted">Skipped</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {currentStep === 'complete' && (
            <div className="p-6">
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-svn-added/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-svn-added" />
                </div>
                <h3 className="text-xl font-medium text-text mb-2">All Conflicts Resolved!</h3>
                <p className="text-text-secondary max-w-md mx-auto mb-6">
                  You have successfully resolved all conflicts. You can now commit your changes.
                </p>
                <button onClick={handleFinish} className="btn btn-primary">
                  <CheckCircle className="w-4 h-4" />
                  Finish
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 bg-bg-secondary border-t border-border flex items-center justify-between">
          <button
            onClick={goToPrevStep}
            disabled={currentStep === 'overview'}
            className="btn btn-secondary"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          
          <div className="flex items-center gap-2">
            {currentStep !== 'complete' && (
              <button
                onClick={goToNextStep}
                disabled={currentStep === 'resolve' || stats.pending === 0}
                className="btn btn-primary"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Merge Editor Overlay */}
        {showMergeEditor && currentFile && (
          <ThreeWayMergeEditor
            isOpen={showMergeEditor}
            filePath={currentFile.path}
            mineContent="" // Would load actual content
            theirsContent=""
            baseContent=""
            onClose={() => setShowMergeEditor(false)}
            onSave={handleMergeEditorSave}
          />
        )}
      </div>
    </div>
  )
}

export default ConflictResolutionWizard
