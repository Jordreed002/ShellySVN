import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, List, Plus, AlertCircle, Loader2, FileText } from 'lucide-react'

interface ChangelistDialogProps {
  isOpen: boolean
  onClose: () => void
  path: string
  selectedFiles?: string[]
}

export function ChangelistDialog({ isOpen, onClose, path, selectedFiles = [] }: ChangelistDialogProps) {
  const queryClient = useQueryClient()
  const [newChangelistName, setNewChangelistName] = useState('')
  const [selectedChangelist, setSelectedChangelist] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Fetch existing changelists
  const { data: changelistData, isLoading } = useQuery({
    queryKey: ['svn:changelist:list', path],
    queryFn: () => window.api.svn.changelist.list(path),
    enabled: isOpen && !!path
  })
  
  // Add to changelist mutation
  const addToChangelist = useMutation({
    mutationFn: ({ files, changelist }: { files: string[], changelist: string }) =>
      window.api.svn.changelist.add(files, changelist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['svn:changelist:list', path] })
      queryClient.invalidateQueries({ queryKey: ['svn:status', path] })
      onClose()
    },
    onError: (err) => {
      setError((err as Error).message || 'Failed to add to changelist')
    }
  })
  
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSelectedChangelist(null)
      setNewChangelistName('')
      setIsCreating(false)
    }
  }, [isOpen])
  
  if (!isOpen) return null
  
  const handleAddToChangelist = () => {
    if (!selectedChangelist || selectedFiles.length === 0) {
      setError('Please select a changelist and files')
      return
    }
    
    addToChangelist.mutate({ 
      files: selectedFiles, 
      changelist: selectedChangelist 
    })
  }
  
  const handleCreateAndAdd = () => {
    if (!newChangelistName.trim()) {
      setError('Changelist name is required')
      return
    }
    
    if (selectedFiles.length === 0) {
      setError('No files selected')
      return
    }
    
    addToChangelist.mutate({ 
      files: selectedFiles, 
      changelist: newChangelistName.trim() 
    })
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px] max-h-[80vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <List className="w-5 h-5 text-accent" />
            Changelists
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-auto space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <>
              {/* Selected files info */}
              {selectedFiles.length > 0 && (
                <div className="bg-bg-tertiary rounded-lg p-3">
                  <p className="text-sm text-text-secondary mb-1">
                    Adding {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} to changelist:
                  </p>
                  <div className="max-h-20 overflow-auto text-xs text-text-faint font-mono">
                    {selectedFiles.map(f => (
                      <div key={f} className="truncate">{f}</div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Existing changelists */}
              {changelistData?.changelists && changelistData.changelists.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-text-secondary mb-2 block">
                    Existing Changelists
                  </label>
                  <div className="space-y-2">
                    {changelistData.changelists.map(cl => (
                      <div 
                        key={cl.name}
                        className={`border rounded-lg p-3 cursor-pointer transition-fast ${
                          selectedChangelist === cl.name 
                            ? 'border-accent bg-accent/10' 
                            : 'border-border hover:border-accent/50'
                        }`}
                        onClick={() => setSelectedChangelist(cl.name)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-text">{cl.name}</span>
                          <span className="text-xs text-text-faint">
                            {cl.files.length} file{cl.files.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {cl.files.slice(0, 3).map(f => (
                            <span 
                              key={f} 
                              className="text-xs bg-bg-secondary px-1.5 py-0.5 rounded flex items-center gap-1"
                            >
                              <FileText className="w-3 h-3" />
                              {f.split(/[/\\]/).pop()}
                            </span>
                          ))}
                          {cl.files.length > 3 && (
                            <span className="text-xs text-text-faint">
                              +{cl.files.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Create new changelist */}
              <div>
                <button
                  onClick={() => setIsCreating(!isCreating)}
                  className="text-sm text-accent hover:underline flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Create new changelist
                </button>
                
                {isCreating && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={newChangelistName}
                      onChange={(e) => setNewChangelistName(e.target.value)}
                      placeholder="Changelist name (e.g., 'feature-x')"
                      className="input"
                      autoFocus
                    />
                    <p className="text-xs text-text-faint">
                      Changelists are local only - they help you organize your changes for committing.
                    </p>
                  </div>
                )}
              </div>
              
              {/* Default files (not in any changelist) */}
              {changelistData?.defaultFiles && changelistData.defaultFiles.length > 0 && (
                <div className="text-xs text-text-faint">
                  <p>{changelistData.defaultFiles.length} file{changelistData.defaultFiles.length !== 1 ? 's' : ''} not in any changelist</p>
                </div>
              )}
              
              {error && (
                <div className="text-sm text-error flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          
          {isCreating ? (
            <button
              onClick={handleCreateAndAdd}
              disabled={!newChangelistName.trim() || selectedFiles.length === 0}
              className="btn btn-primary"
            >
              {addToChangelist.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Create & Add
            </button>
          ) : (
            <button
              onClick={handleAddToChangelist}
              disabled={!selectedChangelist || selectedFiles.length === 0}
              className="btn btn-primary"
            >
              {addToChangelist.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <List className="w-4 h-4" />
              )}
              Add to Changelist
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
