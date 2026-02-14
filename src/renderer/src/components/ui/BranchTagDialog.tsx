import { useState, useEffect } from 'react'
import { X, GitBranch, Tag, FolderOpen, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { RepoBrowser } from './RepoBrowser'

interface BranchTagDialogProps {
  isOpen: boolean
  onClose: () => void
  sourcePath: string
  sourceUrl?: string
  onComplete?: (url: string) => void
  mode?: 'branch' | 'tag'
}

export function BranchTagDialog({ 
  isOpen, 
  onClose, 
  sourcePath, 
  sourceUrl,
  onComplete,
  mode = 'branch'
}: BranchTagDialogProps) {
  const [destUrl, setDestUrl] = useState('')
  const [message, setMessage] = useState('')
  const [sourceRevision, setSourceRevision] = useState<'HEAD' | 'WORKING' | 'number'>('HEAD')
  const [specificRevision, setSpecificRevision] = useState('')
  const [switchToNew, setSwitchToNew] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number; url: string } | null>(null)
  const [showRepoBrowser, setShowRepoBrowser] = useState(false)
  const [repoBaseUrl, setRepoBaseUrl] = useState('')
  
  useEffect(() => {
    if (isOpen) {
      // Initialize destination URL based on source
      if (sourceUrl) {
        // Try to suggest a destination (e.g., trunk -> branches/feature)
        const baseUrl = sourceUrl.replace(/\/(trunk|branches\/[^/]+|tags\/[^/]+)$/, '')
        const newFolder = mode === 'branch' ? 'branches' : 'tags'
        setDestUrl(`${baseUrl}/${newFolder}/`)
        setRepoBaseUrl(baseUrl)
      }
      setMessage(`Created ${mode} from ${sourcePath}`)
      setSourceRevision('HEAD')
      setSpecificRevision('')
      setSwitchToNew(false)
      setError(null)
      setSuccess(null)
      setIsCreating(false)
      setShowRepoBrowser(false)
    }
  }, [isOpen, sourcePath, sourceUrl, mode])
  
  const handleBrowse = () => {
    setShowRepoBrowser(true)
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!destUrl.trim()) {
      setError('Please enter a destination URL')
      return
    }
    
    if (!message.trim()) {
      setError('Please enter a log message')
      return
    }
    
    setIsCreating(true)
    setError(null)
    
    try {
      // For now, use the source path directly
      // In a full implementation, we'd construct the proper source URL with revision
      const result = await window.api.svn.copy(
        sourceUrl || sourcePath,
        destUrl.trim(),
        message.trim()
      )
      
      if (result.success) {
        setSuccess({ revision: result.revision, url: destUrl.trim() })
        if (switchToNew) {
          await window.api.svn.switch(sourcePath, destUrl.trim())
        }
      } else {
        setError('Failed to create ' + mode)
      }
    } catch (err) {
      setError((err as Error).message || `Failed to create ${mode}`)
    } finally {
      setIsCreating(false)
    }
  }
  
  const handleClose = () => {
    if (!isCreating) {
      if (success && onComplete) {
        onComplete(success.url)
      }
      onClose()
    }
  }
  
  if (!isOpen) return null
  
  const Icon = mode === 'branch' ? GitBranch : Tag
  const title = mode === 'branch' ? 'Create Branch' : 'Create Tag'
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Icon className={`w-5 h-5 ${mode === 'branch' ? 'text-accent' : 'text-success'}`} />
            {title}
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isCreating}
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
              <h3 className="text-lg font-medium text-text mb-2">{mode.charAt(0).toUpperCase() + mode.slice(1)} Created</h3>
              <p className="text-text-secondary mb-2">
                Revision {success.revision}
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
              {/* Source */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  From
                </label>
                <div className="bg-bg-tertiary rounded px-3 py-2 text-sm text-text-secondary truncate">
                  {sourceUrl || sourcePath}
                </div>
              </div>
              
              {/* Source Revision */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Revision
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="revision"
                      checked={sourceRevision === 'HEAD'}
                      onChange={() => setSourceRevision('HEAD')}
                      disabled={isCreating}
                    />
                    <span className="text-sm">HEAD revision</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="revision"
                      checked={sourceRevision === 'WORKING'}
                      onChange={() => setSourceRevision('WORKING')}
                      disabled={isCreating}
                    />
                    <span className="text-sm">Working copy</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="revision"
                      checked={sourceRevision === 'number'}
                      onChange={() => setSourceRevision('number')}
                      disabled={isCreating}
                    />
                    <span className="text-sm">Revision:</span>
                    <input
                      type="text"
                      value={specificRevision}
                      onChange={(e) => setSpecificRevision(e.target.value)}
                      className="input w-20"
                      disabled={isCreating || sourceRevision !== 'number'}
                      placeholder="12345"
                    />
                  </label>
                </div>
              </div>
              
              {/* Destination URL */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  To URL <span className="text-error">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={destUrl}
                    onChange={(e) => setDestUrl(e.target.value)}
                    placeholder="svn://example.com/repo/branches/feature-x"
                    className="input flex-1"
                    disabled={isCreating}
                  />
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="btn btn-secondary"
                    disabled={isCreating}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-text-faint mt-1">
                  {mode === 'branch' 
                    ? 'Usually: .../branches/feature-name' 
                    : 'Usually: .../tags/release-x.y.z'}
                </p>
              </div>
              
              {/* Log Message */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                  Log message <span className="text-error">*</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input h-20 resize-none"
                  disabled={isCreating}
                />
              </div>
              
              {/* Switch option */}
              {mode === 'branch' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={switchToNew}
                    onChange={(e) => setSwitchToNew(e.target.checked)}
                    disabled={isCreating}
                  />
                  <span className="text-sm text-text-secondary">
                    Switch working copy to new branch
                  </span>
                </label>
              )}
              
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
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`btn ${mode === 'branch' ? 'btn-primary' : 'bg-success text-white hover:bg-success/90'}`}
                disabled={isCreating || !destUrl.trim() || !message.trim()}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Icon className="w-4 h-4" />
                    Create {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      
      {/* Repository Browser Modal */}
      {showRepoBrowser && (
        <div className="modal-overlay" onClick={() => setShowRepoBrowser(false)} style={{ zIndex: 100 }}>
          <div 
            className="modal w-[700px] h-[500px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                <FolderOpen className="w-5 h-5 text-accent" />
                Browse Repository
              </h2>
              <button 
                onClick={() => setShowRepoBrowser(false)}
                className="btn-icon-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <RepoBrowser 
                isOpen={true}
                repoUrl={repoBaseUrl}
                onNavigate={(url) => {
                  setDestUrl(url)
                }}
                onClose={() => setShowRepoBrowser(false)}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowRepoBrowser(false)}
                className="btn btn-primary"
              >
                Select
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
