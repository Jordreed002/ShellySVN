import { useState, useEffect } from 'react'
import { X, FileOutput, FolderOpen, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete?: (path: string) => void
  initialPath?: string
}

export function ExportDialog({ isOpen, onClose, onComplete, initialPath = '' }: ExportDialogProps) {
  const [sourceUrl, setSourceUrl] = useState(initialPath)
  const [destPath, setDestPath] = useState('')
  const [revision, setRevision] = useState('HEAD')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number; path: string } | null>(null)
  
  useEffect(() => {
    if (isOpen) {
      setSourceUrl(initialPath)
      setDestPath('')
      setRevision('HEAD')
      setError(null)
      setSuccess(null)
      setIsExporting(false)
    }
  }, [isOpen, initialPath])
  
  const handleBrowseDest = async () => {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      setDestPath(result)
    }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!sourceUrl.trim()) {
      setError('Please enter a source URL or path')
      return
    }
    
    if (!destPath.trim()) {
      setError('Please select a destination folder')
      return
    }
    
    setIsExporting(true)
    setError(null)
    
    try {
      const result = await window.api.svn.export(
        sourceUrl.trim(),
        destPath.trim(),
        revision === 'HEAD' ? undefined : revision
      )
      
      if (result.success) {
        setSuccess({ revision: result.revision, path: destPath.trim() })
      } else {
        setError('Export failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }
  
  const handleClose = () => {
    if (!isExporting) {
      if (success && onComplete) {
        onComplete(success.path)
      }
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <FileOutput className="w-5 h-5 text-accent" />
            Export Clean Copy
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isExporting}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Export Complete</h3>
              <p className="text-text-secondary mb-2">
                Exported revision {success.revision}
              </p>
              <p className="text-text-faint text-sm mb-6 break-all">
                {success.path}
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
          <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-4">
              <p className="text-sm text-text-secondary">
                Export creates a clean copy without .svn folders.
              </p>
              
              {/* Source URL/Path */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Source URL or path <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="svn://example.com/repo/trunk or C:\working-copy"
                  className="input"
                  disabled={isExporting}
                />
              </div>
              
              {/* Destination Path */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Export to directory <span className="text-error">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={destPath}
                    onChange={(e) => setDestPath(e.target.value)}
                    placeholder="C:\Exports\my-project"
                    className="input flex-1"
                    disabled={isExporting}
                  />
                  <button
                    type="button"
                    onClick={handleBrowseDest}
                    className="btn btn-secondary"
                    disabled={isExporting}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>
              
              {/* Revision */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Revision
                </label>
                <input
                  type="text"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  placeholder="HEAD"
                  className="input w-32"
                  disabled={isExporting}
                />
                <span className="text-xs text-text-faint ml-2">HEAD = latest</span>
              </div>
              
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="modal-footer">
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-secondary"
                disabled={isExporting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isExporting || !sourceUrl.trim() || !destPath.trim()}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <FileOutput className="w-4 h-4" />
                    Export
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
