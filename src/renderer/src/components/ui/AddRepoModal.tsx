import { useState } from 'react'
import { createPortal } from 'react-dom'
import { 
  X, 
  FolderOpen, 
  GitBranch, 
  Clock, 
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react'
import type { AppSettings } from '@shared/types'

interface AddRepoModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenRepo: (path: string) => void
  onCheckout?: (url: string, path: string) => void
  recentRepos?: AppSettings['recentRepositories']
}

export function AddRepoModal({
  isOpen,
  onClose,
  onOpenRepo,
  onCheckout,
  recentRepos = []
}: AddRepoModalProps) {
  const [mode, setMode] = useState<'open' | 'checkout'>('open')
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [checkoutUrl, setCheckoutUrl] = useState<string>('')
  const [checkoutPath, setCheckoutPath] = useState<string>('')
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const handleBrowse = async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      setSelectedPath(path)
      setError(null)
    }
  }
  
  const handleBrowseCheckout = async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      setCheckoutPath(path)
      setError(null)
    }
  }
  
  const handleOpen = async () => {
    if (!selectedPath) {
      setError('Please select a folder')
      return
    }
    
    setIsChecking(true)
    setError(null)
    
    try {
      // Verify it's a working copy
      const info = await window.api.svn.info(selectedPath)
      if (info) {
        onOpenRepo(selectedPath)
        onClose()
      }
    } catch (err) {
      setError('Selected folder is not a valid SVN working copy')
    } finally {
      setIsChecking(false)
    }
  }
  
  const handleCheckout = async () => {
    if (!checkoutUrl) {
      setError('Please enter a repository URL')
      return
    }
    if (!checkoutPath) {
      setError('Please select a destination folder')
      return
    }
    
    setIsChecking(true)
    setError(null)
    
    try {
      onCheckout?.(checkoutUrl, checkoutPath)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsChecking(false)
    }
  }
  
  const handleRecentClick = (path: string) => {
    onOpenRepo(path)
    onClose()
  }
  
  if (!isOpen) return null
  
  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      {/* Modal */}
      <div 
        className="modal w-[560px] max-h-[85vh] flex flex-col" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">Add Repository</h2>
              <p className="text-sm text-text-secondary">
                Open an existing working copy or checkout new
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-icon-sm"
            data-testid="modal-close-button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => { setMode('open'); setError(null) }}
            className={`
              flex-1 px-4 py-3 text-sm font-medium transition-fast
              ${mode === 'open' 
                ? 'text-accent border-b-2 border-accent' 
                : 'text-text-secondary hover:text-text'
              }
            `}
          >
            Open Working Copy
          </button>
          <button
            onClick={() => { setMode('checkout'); setError(null) }}
            className={`
              flex-1 px-4 py-3 text-sm font-medium transition-fast
              ${mode === 'checkout' 
                ? 'text-accent border-b-2 border-accent' 
                : 'text-text-secondary hover:text-text'
              }
            `}
          >
            Checkout from URL
          </button>
        </div>
        
        {/* Body */}
        <div className="modal-body flex-1 overflow-auto min-h-0">
          {mode === 'open' ? (
            <div className="space-y-4">
              {/* Browse Section */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Working Copy Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedPath}
                    onChange={(e) => setSelectedPath(e.target.value)}
                    placeholder="Select a folder containing an SVN working copy..."
                    className="input flex-1"
                    readOnly
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
              
              {/* Recent Repositories */}
              {recentRepos.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
                    <Clock className="w-4 h-4" />
                    <span>Recent Repositories</span>
                  </div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-overlay">
                    {recentRepos.map((repo) => (
                      <button
                        key={repo}
                        onClick={() => handleRecentClick(repo)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-bg-tertiary transition-fast group"
                      >
                        <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
                        <span className="flex-1 truncate text-sm text-text-secondary group-hover:text-text">
                          {repo}
                        </span>
                        <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-fast" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Repository URL */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={checkoutUrl}
                  onChange={(e) => setCheckoutUrl(e.target.value)}
                  placeholder="https://example.com/svn/repo/trunk"
                  className="input"
                />
              </div>
              
              {/* Destination Path */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Checkout Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={checkoutPath}
                    onChange={(e) => setCheckoutPath(e.target.value)}
                    placeholder="Select destination folder..."
                    className="input flex-1"
                    readOnly
                  />
                  <button
                    onClick={handleBrowseCheckout}
                    className="btn btn-secondary"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>
              
              {/* Checkout Options */}
              <div className="pt-2">
                <p className="text-xs text-text-muted">
                  The repository will be checked out to the specified directory.
                  Make sure the destination folder is empty.
                </p>
              </div>
            </div>
          )}
          
          {/* Error Message */}
          {error && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-md text-sm text-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer flex-shrink-0">
          <button
            onClick={onClose}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          {mode === 'open' ? (
            <button
              onClick={handleOpen}
              disabled={!selectedPath || isChecking}
              className="btn btn-primary"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Open
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleCheckout}
              disabled={!checkoutUrl || !checkoutPath || isChecking}
              className="btn btn-primary"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking out...
                </>
              ) : (
                <>
                  <GitBranch className="w-4 h-4" />
                  Checkout
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
  
  // Render at document body level using portal
  return createPortal(modalContent, document.body)
}

// Compact "Add Repository" button/trigger
export function AddRepoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg border border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all duration-200 group"
    >
      <div className="w-8 h-8 rounded-md bg-bg-tertiary flex items-center justify-center group-hover:bg-accent/20 transition-fast">
        <GitBranch className="w-4 h-4 text-text-secondary group-hover:text-accent" />
      </div>
      <div>
        <span className="text-sm font-medium text-text-secondary group-hover:text-text">
          Add Repository
        </span>
        <p className="text-xs text-text-muted">
          Open or checkout a working copy
        </p>
      </div>
    </button>
  )
}
