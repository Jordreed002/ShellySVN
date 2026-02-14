import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Archive, Plus, Trash2, Play, Loader2, Clock } from 'lucide-react'

interface ShelveDialogProps {
  isOpen: boolean
  onClose: () => void
  workingCopyPath: string
}

export function ShelveDialog({ isOpen, onClose, workingCopyPath }: ShelveDialogProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [shelveName, setShelveName] = useState('')
  const [shelveMessage, setShelveMessage] = useState('')
  
  // Fetch shelves
  const { data: shelveData, isLoading } = useQuery({
    queryKey: ['svn:shelve:list', workingCopyPath],
    queryFn: () => window.api.svn.shelve.list(workingCopyPath),
    enabled: isOpen && !!workingCopyPath
  })
  
  // Create shelve mutation
  const createMutation = useMutation({
    mutationFn: () => window.api.svn.shelve.save(shelveName.trim(), workingCopyPath, shelveMessage.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['svn:shelve:list', workingCopyPath] })
      setShelveName('')
      setShelveMessage('')
      setShowCreate(false)
    }
  })
  
  // Apply shelve mutation
  const applyMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.apply(name, workingCopyPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['svn:status', workingCopyPath] })
    }
  })
  
  // Delete shelve mutation
  const deleteMutation = useMutation({
    mutationFn: (name: string) => window.api.svn.shelve.delete(name, workingCopyPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['svn:shelve:list', workingCopyPath] })
    }
  })
  
  const handleCreate = () => {
    if (!shelveName.trim()) return
    createMutation.mutate()
  }
  
  if (!isOpen) return null
  
  const shelves = shelveData?.shelves || []
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Archive className="w-5 h-5 text-accent" />
            Shelves
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Info */}
          <div className="bg-info/10 border border-info/20 rounded-lg p-3 text-sm text-info">
            <p>Shelving allows you to temporarily save your local changes without committing them.</p>
            <p className="mt-1 text-xs text-info/80">Requires SVN 1.10 or later.</p>
          </div>
          
          {/* Create new shelve */}
          {showCreate ? (
            <div className="bg-bg-tertiary rounded-lg p-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Shelve Name <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={shelveName}
                  onChange={(e) => setShelveName(e.target.value)}
                  placeholder="feature-xyz-work-in-progress"
                  className="input"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Message (optional)
                </label>
                <textarea
                  value={shelveMessage}
                  onChange={(e) => setShelveMessage(e.target.value)}
                  placeholder="Describe the shelved changes..."
                  className="input h-20 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCreate(false)
                    setShelveName('')
                    setShelveMessage('')
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!shelveName.trim() || createMutation.isPending}
                  className="btn btn-primary btn-sm"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Archive className="w-4 h-4" />
                  )}
                  Shelve Changes
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-accent transition-fast"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Shelve Current Changes
            </button>
          )}
          
          {/* Shelves list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : shelves.length === 0 ? (
            <div className="text-center py-8">
              <Archive className="w-12 h-12 text-text-faint mx-auto mb-3" />
              <p className="text-text-secondary">No shelves found</p>
              <p className="text-xs text-text-faint mt-1">
                Create a shelf to save your local changes temporarily
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text">Existing Shelves</h4>
              {shelves.map((shelve) => (
                <div
                  key={shelve.name}
                  className="bg-bg-tertiary rounded-lg p-3"
                >
                  <div className="flex items-start gap-3">
                    <Archive className="w-5 h-5 text-accent mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text">{shelve.name}</span>
                      </div>
                      {shelve.message && (
                        <p className="text-sm text-text-secondary mt-1">{shelve.message}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-text-faint">
                        <Clock className="w-3 h-3" />
                        {new Date(shelve.date).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => applyMutation.mutate(shelve.name)}
                        disabled={applyMutation.isPending}
                        className="btn btn-secondary btn-sm"
                        title="Apply this shelve (unshelve)"
                      >
                        {applyMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        Apply
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete shelve "${shelve.name}"?`)) {
                            deleteMutation.mutate(shelve.name)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="btn-icon-sm hover:text-error"
                        title="Delete shelve"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-xs text-text-faint">
            {shelves.length} shelf{shelves.length !== 1 ? 'ves' : 'f'}
          </div>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
