import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ArrowRightLeft, AlertCircle, CheckCircle, Loader2, Info } from 'lucide-react'

interface RelocateDialogProps {
  isOpen: boolean
  onClose: () => void
  workingCopyPath: string
  currentUrl?: string
  onSuccess?: () => void
}

export function RelocateDialog({ isOpen, onClose, workingCopyPath, currentUrl, onSuccess }: RelocateDialogProps) {
  const [fromUrl, setFromUrl] = useState('')
  const [toUrl, setToUrl] = useState('')
  const [isRelocating, setIsRelocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  // Get current repository info
  const { data: repoInfo } = useQuery({
    queryKey: ['svn:info', workingCopyPath],
    queryFn: () => window.api.svn.info(workingCopyPath),
    enabled: isOpen && !!workingCopyPath
  })
  
  useEffect(() => {
    if (isOpen) {
      setFromUrl(repoInfo?.repositoryRoot || currentUrl || '')
      setToUrl('')
      setError(null)
      setSuccess(false)
      setIsRelocating(false)
    }
  }, [isOpen, repoInfo, currentUrl])
  
  const handleRelocate = async () => {
    if (!fromUrl.trim() || !toUrl.trim()) {
      setError('Both URLs are required')
      return
    }
    
    setIsRelocating(true)
    setError(null)
    
    try {
      const result = await window.api.svn.relocate(fromUrl.trim(), toUrl.trim(), workingCopyPath)
      
      if (result.success) {
        setSuccess(true)
        onSuccess?.()
      } else {
        setError(result.output || 'Relocate failed')
      }
    } catch (err) {
      setError((err as Error).message || 'Relocate failed')
    } finally {
      setIsRelocating(false)
    }
  }
  
  const handleClose = () => {
    if (!isRelocating) {
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
            <ArrowRightLeft className="w-5 h-5 text-accent" />
            Relocate
          </h2>
          <button onClick={handleClose} className="btn-icon-sm" disabled={isRelocating}>
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
              <h3 className="text-lg font-medium text-text mb-2">Relocate Complete</h3>
              <p className="text-text-secondary mb-6">
                Working copy now points to the new repository location
              </p>
              <button
                onClick={onClose}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body space-y-4">
            {/* Warning */}
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                <div className="text-sm text-warning">
                  <p className="font-medium">Use with caution</p>
                  <p className="mt-1 text-warning/80">
                    Relocate changes the repository URL for your working copy. 
                    Use this when the repository server has moved to a new URL.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Working copy info */}
            <div className="bg-bg-tertiary rounded-lg p-3">
              <p className="text-xs text-text-faint mb-1">Working copy:</p>
              <p className="text-sm font-mono text-text-secondary truncate">{workingCopyPath}</p>
              {repoInfo?.repositoryRoot && (
                <>
                  <p className="text-xs text-text-faint mt-2 mb-1">Current repository root:</p>
                  <p className="text-sm font-mono text-text-secondary truncate">{repoInfo.repositoryRoot}</p>
                </>
              )}
            </div>
            
            {/* From URL */}
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                From URL <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={fromUrl}
                onChange={(e) => setFromUrl(e.target.value)}
                placeholder="https://old-server.com/svn/repo"
                className="input"
                disabled={isRelocating}
              />
              <p className="text-xs text-text-faint mt-1">
                The old repository root URL (prefix to replace)
              </p>
            </div>
            
            {/* To URL */}
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                To URL <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={toUrl}
                onChange={(e) => setToUrl(e.target.value)}
                placeholder="https://new-server.com/svn/repo"
                className="input"
                disabled={isRelocating}
              />
              <p className="text-xs text-text-faint mt-1">
                The new repository root URL
              </p>
            </div>
            
            {/* Visual representation */}
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 truncate font-mono text-text-secondary">
                  {fromUrl || 'old-url'}
                </div>
                <ArrowRightLeft className="w-4 h-4 text-accent flex-shrink-0" />
                <div className="flex-1 truncate font-mono text-accent">
                  {toUrl || 'new-url'}
                </div>
              </div>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}
        
        {/* Footer */}
        {!success && (
          <div className="modal-footer">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary"
              disabled={isRelocating}
            >
              Cancel
            </button>
            <button
              onClick={handleRelocate}
              disabled={isRelocating || !fromUrl.trim() || !toUrl.trim()}
              className="btn btn-primary"
            >
              {isRelocating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Relocating...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  Relocate
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
