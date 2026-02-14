import { useState, useEffect } from 'react'
import { X, ExternalLink, Plus, Trash2, Loader2, RefreshCw } from 'lucide-react'

interface ExternalEntry {
  path: string
  url: string
  revision?: string
  pegRevision?: string
  localPath: string
}

interface ExternalsManagerProps {
  isOpen: boolean
  workingCopyPath: string
  onClose: () => void
}

export function ExternalsManager({ isOpen, workingCopyPath, onClose }: ExternalsManagerProps) {
  const [externals, setExternals] = useState<ExternalEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newExternal, setNewExternal] = useState<Partial<ExternalEntry>>({
    path: '',
    url: '',
    localPath: ''
  })
  
  // Load externals from svn:externals property
  useEffect(() => {
    if (isOpen && workingCopyPath) {
      loadExternals()
    }
  }, [isOpen, workingCopyPath])
  
  const loadExternals = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.svn.externals.list(workingCopyPath)
      
      const parsed: ExternalEntry[] = result.map(ext => ({
        path: ext.path,
        url: ext.url,
        revision: ext.revision?.toString(),
        pegRevision: ext.pegRevision?.toString(),
        localPath: ext.name
      }))
      
      setExternals(parsed)
    } catch (err) {
      console.error('Failed to load externals:', err)
      setExternals([])
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleAddExternal = async () => {
    if (!newExternal.url || !newExternal.localPath) return
    
    setIsLoading(true)
    try {
      await window.api.svn.externals.add(workingCopyPath, {
        url: newExternal.url,
        path: newExternal.localPath,
        name: newExternal.localPath,
        revision: newExternal.revision ? parseInt(newExternal.revision, 10) : undefined
      })
      
      setNewExternal({ path: '', url: '', localPath: '' })
      setIsAdding(false)
      await loadExternals()
    } catch (err) {
      console.error('Failed to add external:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleRemoveExternal = async (external: ExternalEntry) => {
    if (!confirm('Remove this external?')) return
    
    setIsLoading(true)
    try {
      await window.api.svn.externals.remove(workingCopyPath, external.localPath)
      await loadExternals()
    } catch (err) {
      console.error('Failed to remove external:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[700px]" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <ExternalLink className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Externals Manager</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadExternals}
              className="btn-icon-sm"
              title="Refresh"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="modal-body">
          <p className="text-sm text-text-secondary mb-4">
            Manage svn:externals definitions for this working copy.
          </p>
          
          {/* Current Externals */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-bg-tertiary px-4 py-2 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium text-text">Defined Externals</span>
              <button
                onClick={() => setIsAdding(true)}
                className="btn btn-secondary btn-sm gap-1.5"
                disabled={isAdding}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
              </div>
            ) : externals.length === 0 && !isAdding ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ExternalLink className="w-8 h-8 text-text-muted mb-2" />
                <p className="text-sm text-text-secondary">No externals defined</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {externals.map((external, index) => (
                  <div key={index} className="px-4 py-3 hover:bg-bg-tertiary">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text">{external.localPath}</span>
                          {external.revision && (
                            <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                              r{external.revision}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-text-muted truncate mt-1">
                          {external.url}
                        </div>
                      </div>
                       <div className="flex items-center gap-1 ml-4">
                         <button
                           onClick={() => handleRemoveExternal(external)}
                           className="btn-icon-sm text-text-muted hover:text-error"
                           title="Remove"
                         >
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </div>
                    </div>
                  </div>
                ))}
                
                {/* Add New External Form */}
                {isAdding && (
                  <div className="px-4 py-4 bg-bg-tertiary">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Local Path</label>
                        <input
                          type="text"
                          value={newExternal.localPath || ''}
                          onChange={e => setNewExternal(prev => ({ ...prev, localPath: e.target.value }))}
                          placeholder="e.g., lib/external-lib"
                          className="input text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">Repository URL</label>
                        <input
                          type="text"
                          value={newExternal.url || ''}
                          onChange={e => setNewExternal(prev => ({ ...prev, url: e.target.value }))}
                          placeholder="https://example.com/svn/repo/path"
                          className="input text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-text-muted mb-1">Revision (optional)</label>
                          <input
                            type="text"
                            value={newExternal.revision || ''}
                            onChange={e => setNewExternal(prev => ({ ...prev, revision: e.target.value }))}
                            placeholder="e.g., 12345"
                            className="input text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          onClick={() => {
                            setIsAdding(false)
                            setNewExternal({ path: '', url: '', localPath: '' })
                          }}
                          className="btn btn-secondary btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddExternal}
                          disabled={!newExternal.url || !newExternal.localPath || isLoading}
                          className="btn btn-primary btn-sm"
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add External'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <p className="text-xs text-text-muted mt-4">
            Changes to externals will take effect on the next update.
          </p>
        </div>
      </div>
    </div>
  )
}
