import { useState, useEffect } from 'react'
import { X, ArrowRightLeft, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'

interface SwitchDialogProps {
  isOpen: boolean
  onClose: () => void
  currentPath: string
  currentUrl?: string
  onComplete?: (url: string) => void
}

export function SwitchDialog({ 
  isOpen, 
  onClose, 
  currentPath, 
  currentUrl,
  onComplete
}: SwitchDialogProps) {
  const [targetUrl, setTargetUrl] = useState('')
  const [revision, setRevision] = useState('HEAD')
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number; url: string } | null>(null)
  
  useEffect(() => {
    if (isOpen) {
      setTargetUrl(currentUrl || '')
      setRevision('HEAD')
      setError(null)
      setSuccess(null)
      setIsSwitching(false)
    }
  }, [isOpen, currentUrl])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!targetUrl.trim()) {
      setError('Please enter a target URL')
      return
    }
    
    setIsSwitching(true)
    setError(null)
    
    try {
      const result = await window.api.svn.switch(
        currentPath,
        targetUrl.trim(),
        revision === 'HEAD' ? undefined : revision
      )
      
      if (result.success) {
        setSuccess({ revision: result.revision, url: targetUrl.trim() })
      } else {
        setError('Switch failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Switch failed')
    } finally {
      setIsSwitching(false)
    }
  }
  
  const handleClose = () => {
    if (!isSwitching) {
      if (success && onComplete) {
        onComplete(success.url)
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
            <ArrowRightLeft className="w-5 h-5 text-accent" />
            Switch to Branch/Tag
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isSwitching}
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
              <h3 className="text-lg font-medium text-text mb-2">Switch Complete</h3>
              <p className="text-text-secondary mb-2">
                Updated to revision {success.revision}
              </p>
              <p className="text-text-faint text-sm mb-6 break-all">
                {success.url}
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
              {/* Current */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Current URL
                </label>
                <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
                  {currentUrl || currentPath}
                </div>
              </div>
              
              {/* Target URL */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Switch to URL <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="svn://example.com/repo/branches/feature-x"
                  className="input"
                  disabled={isSwitching}
                />
                <p className="text-xs text-text-faint mt-1">
                  Examples: trunk, branches/feature-x, tags/release-1.0
                </p>
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
                  disabled={isSwitching}
                />
                <span className="text-xs text-text-faint ml-2">HEAD = latest</span>
              </div>
              
              {/* Warning */}
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-warning">
                    Local modifications will be merged with the target. If there are conflicts, 
                    you'll need to resolve them after the switch.
                  </p>
                </div>
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
                disabled={isSwitching}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSwitching || !targetUrl.trim()}
              >
                {isSwitching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Switching...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    Switch
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
