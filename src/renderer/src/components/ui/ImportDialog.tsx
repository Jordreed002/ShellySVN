import { useState, useEffect } from 'react'
import { X, Upload, FolderOpen, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

interface ImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete?: (revision: number) => void
  initialPath?: string
}

export function ImportDialog({ isOpen, onClose, onComplete, initialPath = '' }: ImportDialogProps) {
  const [sourcePath, setSourcePath] = useState(initialPath)
  const [destUrl, setDestUrl] = useState('')
  const [message, setMessage] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number } | null>(null)
  
  useEffect(() => {
    if (isOpen) {
      setSourcePath(initialPath)
      setDestUrl('')
      setMessage('')
      setError(null)
      setSuccess(null)
      setIsImporting(false)
    }
  }, [isOpen, initialPath])
  
  const handleBrowseSource = async () => {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      setSourcePath(result)
    }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!sourcePath.trim()) {
      setError('Please select a source folder')
      return
    }
    
    if (!destUrl.trim()) {
      setError('Please enter a destination repository URL')
      return
    }
    
    if (!message.trim()) {
      setError('Please enter a commit message')
      return
    }
    
    setIsImporting(true)
    setError(null)
    
    try {
      const result = await window.api.svn.import(
        sourcePath.trim(),
        destUrl.trim(),
        message.trim()
      )
      
      if (result.success) {
        setSuccess({ revision: result.revision })
      } else {
        setError('Import failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }
  
  const handleClose = () => {
    if (!isImporting) {
      if (success && onComplete) {
        onComplete(success.revision)
      }
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Upload className="w-5 h-5 text-accent" />
            Import to Repository
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isImporting}
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
              <h3 className="text-lg font-medium text-text mb-2">Import Complete</h3>
              <p className="text-text-secondary mb-6">
                Committed revision {success.revision}
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
                Import adds an unversioned folder to the repository.
              </p>
              
              {/* Source Path */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Source folder <span className="text-error">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="C:\Projects\my-project"
                    className="input flex-1"
                    disabled={isImporting}
                  />
                  <button
                    type="button"
                    onClick={handleBrowseSource}
                    className="btn btn-secondary"
                    disabled={isImporting}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>
              
              {/* Destination URL */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Repository URL <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={destUrl}
                  onChange={(e) => setDestUrl(e.target.value)}
                  placeholder="svn://example.com/repo/trunk/my-folder"
                  className="input"
                  disabled={isImporting}
                />
              </div>
              
              {/* Commit Message */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Log message <span className="text-error">*</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Initial import of project files..."
                  className="input h-24 resize-none"
                  disabled={isImporting}
                />
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
                disabled={isImporting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isImporting || !sourcePath.trim() || !destUrl.trim() || !message.trim()}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Import
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
