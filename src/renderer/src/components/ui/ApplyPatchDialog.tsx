import { useState, useEffect } from 'react'
import { X, FileInput, FolderOpen, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

interface ApplyPatchDialogProps {
  isOpen: boolean
  onClose: () => void
  targetPath: string
  onComplete?: () => void
}

export function ApplyPatchDialog({ isOpen, onClose, targetPath, onComplete }: ApplyPatchDialogProps) {
  const [patchPath, setPatchPath] = useState('')
  const [patchContent, setPatchContent] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ applied: number; skipped: number } | null>(null)
  const [preview, setPreview] = useState<string[]>([])
  
  useEffect(() => {
    if (isOpen) {
      setPatchPath('')
      setPatchContent('')
      setDryRun(true)
      setError(null)
      setSuccess(null)
      setPreview([])
      setIsApplying(false)
    }
  }, [isOpen])
  
  const handleBrowse = async () => {
    const result = await window.api.dialog.openFile([
      { name: 'Patch Files', extensions: ['patch', 'diff', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    
    if (result) {
      setPatchPath(result)
      // In a real implementation, we'd read the file here
      setPatchContent('') // Would load from file
    }
  }
  
  const handlePreview = async () => {
    if (!patchPath && !patchContent) {
      setError('Please select a patch file or paste patch content')
      return
    }
    
    setIsApplying(true)
    setError(null)
    
    try {
      // If patch content was pasted, we need to save it to a temp file first
      // For now, require a file path
      if (!patchPath) {
        setError('Please select a patch file (pasted content not yet supported)')
        setIsApplying(false)
        return
      }
      
      // Use dry run to preview
      const result = await window.api.svn.patch.apply(patchPath, targetPath, true)
      
      if (result.success) {
        // Parse output to get affected files
        const lines = result.output.split('\n')
        const affectedFiles = lines
          .filter(l => l.includes('Patched') || l.includes('patching'))
          .map(l => l.trim())
        
        setPreview(affectedFiles.length > 0 ? affectedFiles : ['Files will be modified (see output)'])
      } else {
        setError(result.output || 'Failed to preview patch')
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to preview patch')
    } finally {
      setIsApplying(false)
    }
  }
  
  const handleApply = async () => {
    if (!patchPath && !patchContent) {
      setError('Please select a patch file or paste patch content')
      return
    }
    
    if (!patchPath) {
      setError('Please select a patch file (pasted content not yet supported)')
      return
    }
    
    setIsApplying(true)
    setError(null)
    
    try {
      const result = await window.api.svn.patch.apply(patchPath, targetPath, dryRun)
      
      if (result.success) {
        setSuccess({ applied: result.filesPatched, skipped: result.rejects })
        if (onComplete) {
          onComplete()
        }
      } else {
        setError(result.output || 'Failed to apply patch')
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to apply patch')
    } finally {
      setIsApplying(false)
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[600px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <FileInput className="w-5 h-5 text-accent" />
            Apply Patch
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {success ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Patch Applied</h3>
              <p className="text-text-secondary mb-6">
                {success.applied} file{success.applied !== 1 ? 's' : ''} changed
                {success.skipped > 0 && `, ${success.skipped} skipped`}
              </p>
              <button
                onClick={onClose}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Patch file selection */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Patch file
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patchPath}
                    onChange={(e) => setPatchPath(e.target.value)}
                    placeholder="C:\path\to\changes.patch"
                    className="input flex-1"
                  />
                  <button
                    onClick={handleBrowse}
                    className="btn btn-secondary"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>
              
              {/* Or paste content */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Or paste patch content
                </label>
                <textarea
                  value={patchContent}
                  onChange={(e) => setPatchContent(e.target.value)}
                  placeholder="--- file.txt
+++ file.txt
@@ -1,3 +1,4 @@
 line1
+new line
 line2
 line3"
                  className="input h-32 resize-none font-mono text-xs"
                />
              </div>
              
              {/* Target path */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Apply to directory
                </label>
                <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
                  {targetPath}
                </div>
              </div>
              
              {/* Options */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                <span className="text-sm">Dry run (preview changes only)</span>
              </label>
              
              {/* Preview */}
              {preview.length > 0 && (
                <div className="bg-bg-tertiary rounded-lg p-3">
                  <p className="text-sm font-medium text-text-secondary mb-2">
                    Files affected:
                  </p>
                  <ul className="text-sm space-y-1">
                    {preview.map((file, i) => (
                      <li key={i} className="text-text-secondary">{file}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Footer */}
        {!success && (
          <div className="modal-footer">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            {preview.length === 0 ? (
              <button
                onClick={handlePreview}
                className="btn btn-secondary"
                disabled={!patchPath && !patchContent}
              >
                Preview
              </button>
            ) : (
              <button
                onClick={handleApply}
                className="btn btn-primary"
                disabled={isApplying}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <FileInput className="w-4 h-4" />
                    {dryRun ? 'Dry Run' : 'Apply Patch'}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
