import { useState, useEffect } from 'react'
import { X, FileDiff, Save, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

interface CreatePatchDialogProps {
  isOpen: boolean
  onClose: () => void
  path: string
  selectedPaths?: string[]
}

export function CreatePatchDialog({ isOpen, onClose, path, selectedPaths = [] }: CreatePatchDialogProps) {
  const [patchContent, setPatchContent] = useState('')
  const [filename, setFilename] = useState('changes.patch')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  useEffect(() => {
    if (isOpen) {
      setPatchContent('')
      setFilename('changes.patch')
      setError(null)
      setSuccess(false)
      setIsGenerating(false)
    }
  }, [isOpen])
  
  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    
    try {
      // Get diff for the path(s)
      const paths = selectedPaths.length > 0 ? selectedPaths : [path]
      let fullDiff = ''
      
      for (const p of paths) {
        const result = await window.api.svn.diff(p)
        if (result.rawDiff) {
          fullDiff += result.rawDiff + '\n'
        }
      }
      
      if (!fullDiff.trim()) {
        setError('No changes to create patch from')
      } else {
        setPatchContent(fullDiff)
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to generate patch')
    } finally {
      setIsGenerating(false)
    }
  }
  
  const handleSave = async () => {
    if (!patchContent.trim()) {
      setError('No patch content to save')
      return
    }
    
    try {
      const result = await window.api.dialog.saveFile(filename)
      if (result) {
        // Use the patch create API to save the file
        const paths = selectedPaths.length > 0 ? selectedPaths : [path]
        const saveResult = await window.api.svn.patch.create(paths, result)
        
        if (saveResult.success) {
          setSuccess(true)
        } else {
          setError(saveResult.output || 'Failed to save patch')
        }
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save patch')
    }
  }
  
  const handleCopy = () => {
    navigator.clipboard.writeText(patchContent)
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[700px] max-h-[90vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <FileDiff className="w-5 h-5 text-accent" />
            Create Patch
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
              <h3 className="text-lg font-medium text-text mb-2">Patch Saved</h3>
              <p className="text-text-secondary mb-6">
                {filename}
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
              <p className="text-sm text-text-secondary">
                Create a unified diff patch file from your local changes.
              </p>
              
              {/* Generate button */}
              {!patchContent && (
                <button
                  onClick={handleGenerate}
                  className="btn btn-primary w-full"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileDiff className="w-4 h-4" />
                      Generate Patch
                    </>
                  )}
                </button>
              )}
              
              {/* Filename */}
              {patchContent && (
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                    Filename
                  </label>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="input"
                  />
                </div>
              )}
              
              {/* Patch content */}
              {patchContent && (
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                    Patch content
                  </label>
                  <textarea
                    value={patchContent}
                    onChange={(e) => setPatchContent(e.target.value)}
                    className="input h-64 resize-none font-mono text-xs"
                  />
                  <div className="flex justify-end mt-2 gap-2">
                    <button
                      onClick={handleCopy}
                      className="btn btn-secondary btn-sm"
                    >
                      Copy to Clipboard
                    </button>
                  </div>
                </div>
              )}
              
              {/* Stats */}
              {patchContent && (
                <div className="flex gap-4 text-sm text-text-faint">
                  <span>+{patchContent.split('\n').filter(l => l.startsWith('+')).length} additions</span>
                  <span>-{patchContent.split('\n').filter(l => l.startsWith('-')).length} deletions</span>
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
            <button
              onClick={handleSave}
              className="btn btn-primary"
              disabled={!patchContent.trim()}
            >
              <Save className="w-4 h-4" />
              Save Patch
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
