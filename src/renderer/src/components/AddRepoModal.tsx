import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, GitBranch, Clock, X, ChevronRight, Loader2 } from 'lucide-react'

interface AddRepoModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenRepo: (path: string) => void
  onCheckout?: (url: string, path: string) => void
  recentRepos?: string[]
}

export function AddRepoModal({ 
  isOpen, 
  onClose, 
  onOpenRepo,
  onCheckout,
  recentRepos = []
}: AddRepoModalProps) {
  const [mode, setMode] = useState<'open' | 'checkout'>('open')
  const [selectedPath, setSelectedPath] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [checkoutPath, setCheckoutPath] = useState('')
  const [isCheckingOut, setIsCheckingOut] = useState(false)

  const handleBrowse = useCallback(async () => {
    const path = await window.api.dialog.openDirectory()
    if (path) {
      if (mode === 'open') {
        setSelectedPath(path)
      } else {
        setCheckoutPath(path)
      }
    }
  }, [mode])

  const handleOpen = useCallback(() => {
    if (selectedPath) {
      onOpenRepo(selectedPath)
      onClose()
    }
  }, [selectedPath, onOpenRepo, onClose])

  const handleCheckout = useCallback(async () => {
    if (checkoutUrl && checkoutPath && onCheckout) {
      setIsCheckingOut(true)
      try {
        await onCheckout(checkoutUrl, checkoutPath)
        onOpenRepo(checkoutPath)
        onClose()
      } catch (error) {
        console.error('Checkout failed:', error)
      } finally {
        setIsCheckingOut(false)
      }
    }
  }, [checkoutUrl, checkoutPath, onCheckout, onOpenRepo, onClose])

  const handleRecentClick = useCallback((path: string) => {
    onOpenRepo(path)
    onClose()
  }, [onOpenRepo, onClose])

  if (!isOpen) return null
  
  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      {/* Modal */}
      <div 
        className="modal w-[520px] max-h-[85vh] flex flex-col" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            {mode === 'open' ? 'Open Working Copy' : 'Checkout from Repository'}
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => setMode('open')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-fast ${
              mode === 'open' 
                ? 'text-accent border-accent' 
                : 'text-text-secondary border-transparent hover:text-text'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            Open Working Copy
          </button>
          <button
            onClick={() => setMode('checkout')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-fast ${
              mode === 'checkout' 
                ? 'text-accent border-accent' 
                : 'text-text-secondary border-transparent hover:text-text'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            Checkout
          </button>
        </div>

        {/* Body */}
        <div className="modal-body flex-1 overflow-auto min-h-0">
          {mode === 'open' ? (
            <>
              {/* Browse Section */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Working Copy Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={selectedPath}
                      onChange={(e) => setSelectedPath(e.target.value)}
                      placeholder="Select a folder..."
                      className="input flex-1"
                    />
                    <button 
                      onClick={handleBrowse}
                      className="btn btn-secondary"
                    >
                      Browse...
                    </button>
                  </div>
                </div>

                {/* Recent Repositories */}
                {recentRepos.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">
                      Recent
                    </label>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {recentRepos.map((repo) => (
                        <button
                          key={repo}
                          onClick={() => handleRecentClick(repo)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-md hover:bg-bg-tertiary transition-fast group"
                        >
                          <Clock className="w-4 h-4 text-text-muted flex-shrink-0" />
                          <span className="flex-1 text-sm text-text-secondary group-hover:text-text truncate">
                            {repo}
                          </span>
                          <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-fast" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Checkout Section */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Repository URL
                  </label>
                  <input
                    type="text"
                    value={checkoutUrl}
                    onChange={(e) => setCheckoutUrl(e.target.value)}
                    placeholder="https://example.com/svn/repo"
                    className="input"
                  />
                </div>

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
                    />
                    <button 
                      onClick={handleBrowse}
                      className="btn btn-secondary"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Drop Zone */}
          <div 
            className="drop-zone mt-4"
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.classList.add('drop-zone-active')
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('drop-zone-active')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('drop-zone-active')
              const files = e.dataTransfer.files
              if (files.length > 0) {
                // In Electron, we can access the path via the webkitRelativePath or use the file object
                const file = files[0] as File & { path?: string }
                const path = file.path || file.webkitRelativePath || file.name
                if (path) {
                  if (mode === 'open') {
                    setSelectedPath(path)
                  } else {
                    setCheckoutPath(path)
                  }
                }
              }
            }}
          >
            <FolderOpen className="drop-zone-icon" />
            <p className="drop-zone-text">
              Drop a folder here or{' '}
              <span 
                className="drop-zone-text-highlight cursor-pointer"
                onClick={handleBrowse}
              >
                browse
              </span>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer flex-shrink-0">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          {mode === 'open' ? (
            <button 
              onClick={handleOpen}
              disabled={!selectedPath}
              className="btn btn-primary"
            >
              Open
            </button>
          ) : (
            <button 
              onClick={handleCheckout}
              disabled={!checkoutUrl || !checkoutPath || isCheckingOut}
              className="btn btn-primary"
            >
              {isCheckingOut ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking out...
                </>
              ) : (
                'Checkout'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
  
  // Render at document body level using portal for proper centering
  return createPortal(modalContent, document.body)
}
