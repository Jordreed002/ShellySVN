import { useState } from 'react'
import { X, FolderTree, Loader2, AlertCircle, Check } from 'lucide-react'

interface SparseCheckoutDialogProps {
  isOpen: boolean
  repoUrl: string
  targetPath: string
  onClose: () => void
  onCheckout: (url: string, path: string, depth: DepthOption, includePaths: string[]) => Promise<{ success: boolean; error?: string }>
}

type DepthOption = 'empty' | 'files' | 'immediates' | 'infinity'

interface PathItem {
  path: string
  selected: boolean
  hasChildren: boolean
}

const DEPTH_OPTIONS: { value: DepthOption; label: string; description: string }[] = [
  { value: 'empty', label: 'Empty', description: 'No files or folders, only the root' },
  { value: 'files', label: 'Files Only', description: 'Only immediate files, no subdirectories' },
  { value: 'immediates', label: 'Immediate', description: 'Files and empty subdirectories' },
  { value: 'infinity', label: 'Full', description: 'All files and subdirectories recursively' },
]

export function SparseCheckoutDialog({ 
  isOpen, 
  repoUrl, 
  targetPath, 
  onClose, 
  onCheckout 
}: SparseCheckoutDialogProps) {
  const [depth, setDepth] = useState<DepthOption>('immediates')
  const [includePaths, setIncludePaths] = useState<PathItem[]>([
    { path: 'trunk', selected: true, hasChildren: true },
    { path: 'branches', selected: false, hasChildren: true },
    { path: 'tags', selected: false, hasChildren: true },
  ])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  if (!isOpen) return null
  
  const handleTogglePath = (path: string) => {
    setIncludePaths(prev => 
      prev.map(item => 
        item.path === path ? { ...item, selected: !item.selected } : item
      )
    )
  }
  
  const handleSelectAll = () => {
    setIncludePaths(prev => prev.map(item => ({ ...item, selected: true })))
  }
  
  const handleDeselectAll = () => {
    setIncludePaths(prev => prev.map(item => ({ ...item, selected: false })))
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setIsLoading(true)
    setError(null)
    
    const selectedPaths = includePaths.filter(p => p.selected).map(p => p.path)
    const result = await onCheckout(repoUrl, targetPath, depth, selectedPaths)
    
    if (result.success) {
      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      setError(result.error || 'Checkout failed')
      setIsLoading(false)
    }
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[600px]" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <FolderTree className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Sparse Checkout</h2>
          </div>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {success ? (
          <div className="modal-body flex flex-col items-center justify-center py-12">
            <Check className="w-12 h-12 text-success mb-4" />
            <p className="text-lg font-medium text-text">Checkout Complete!</p>
            <p className="text-sm text-text-secondary mt-2">{targetPath}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body space-y-6">
              {/* Repository URL */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">Repository URL</label>
                <input
                  type="text"
                  value={repoUrl}
                  readOnly
                  className="input bg-bg-tertiary"
                />
              </div>
              
              {/* Target Path */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">Target Path</label>
                <input
                  type="text"
                  value={targetPath}
                  readOnly
                  className="input bg-bg-tertiary"
                />
              </div>
              
              {/* Depth Selection */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">Initial Depth</label>
                <div className="grid grid-cols-2 gap-2">
                  {DEPTH_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      className={`
                        p-3 rounded-lg border text-left transition-fast
                        ${depth === opt.value
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border-focus'
                        }
                      `}
                    >
                      <div className="font-medium text-sm text-text">{opt.label}</div>
                      <div className="text-xs text-text-muted mt-1">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Include Paths */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text">Include Paths</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      Select All
                    </button>
                    <span className="text-text-muted">|</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="border border-border rounded-lg divide-y divide-border">
                  {includePaths.map(item => (
                    <label
                      key={item.path}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-tertiary transition-fast"
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => handleTogglePath(item.path)}
                        className="checkbox"
                      />
                      <span className="text-sm text-text">{item.path}</span>
                      {item.hasChildren && (
                        <span className="text-xs text-text-muted">/</span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-2">
                  Selected paths will be checked out. You can update individual paths later using "Update to Revision".
                </p>
              </div>
              
              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-error text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking out...</span>
                  </>
                ) : (
                  <span>Checkout</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
