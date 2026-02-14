import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  X, FolderOpen, Plus, Trash2, RefreshCw, AlertCircle, 
  CheckCircle, Loader2
} from 'lucide-react'

interface ProjectMonitorPanelProps {
  isOpen: boolean
  onClose: () => void
  onSelectWorkingCopy?: (path: string) => void
}

export function ProjectMonitorPanel({ isOpen, onClose, onSelectWorkingCopy }: ProjectMonitorPanelProps) {
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)
  const [newPath, setNewPath] = useState('')
  
  // Fetch monitored working copies
  const { data: workingCopies, isLoading, refetch } = useQuery({
    queryKey: ['monitor:workingCopies'],
    queryFn: () => window.api.monitor.getWorkingCopies(),
    enabled: isOpen
  })
  
  // Add working copy mutation
  const addMutation = useMutation({
    mutationFn: (path: string) => window.api.monitor.addWorkingCopy(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor:workingCopies'] })
      setNewPath('')
      setIsAdding(false)
    }
  })
  
  // Remove working copy mutation
  const removeMutation = useMutation({
    mutationFn: (path: string) => window.api.monitor.removeWorkingCopy(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor:workingCopies'] })
    }
  })
  
  // Refresh status mutation
  const refreshMutation = useMutation({
    mutationFn: (path: string) => window.api.monitor.refreshStatus(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor:workingCopies'] })
    }
  })
  
  // Start monitoring on mount
  useEffect(() => {
    if (isOpen) {
      window.api.monitor.startMonitoring()
    }
  }, [isOpen])
  
  const handleBrowse = async () => {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      setNewPath(result)
    }
  }
  
  const handleAdd = () => {
    if (newPath.trim()) {
      addMutation.mutate(newPath.trim())
    }
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[600px] max-h-[80vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <FolderOpen className="w-5 h-5 text-accent" />
            Project Monitor
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-auto space-y-4">
          {/* Add new working copy */}
          {isAdding ? (
            <div className="bg-bg-tertiary rounded-lg p-3 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="Enter working copy path..."
                  className="input flex-1"
                />
                <button onClick={handleBrowse} className="btn btn-secondary">
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setIsAdding(false)
                    setNewPath('')
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newPath.trim() || addMutation.isPending}
                  className="btn btn-primary btn-sm"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-accent transition-fast"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Working Copy
            </button>
          )}
          
          {/* Working copies list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : !workingCopies || workingCopies.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen className="w-12 h-12 text-text-faint mx-auto mb-3" />
              <p className="text-text-secondary">No working copies being monitored</p>
              <p className="text-xs text-text-faint mt-1">
                Add working copies to track their status
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {workingCopies.map((wc) => (
                <div
                  key={wc.path}
                  className="bg-bg-tertiary rounded-lg p-3 hover:bg-bg-elevated cursor-pointer transition-fast"
                  onClick={() => onSelectWorkingCopy?.(wc.path)}
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className="mt-0.5">
                      {wc.hasChanges ? (
                        <AlertCircle className="w-5 h-5 text-warning" />
                      ) : (
                        <CheckCircle className="w-5 h-5 text-success" />
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-text truncate">
                          {wc.path.split(/[/\\]/).pop()}
                        </span>
                        <span className="text-xs text-text-faint">
                          r{wc.revision}
                        </span>
                      </div>
                      <p className="text-xs text-text-faint truncate">{wc.path}</p>
                      {wc.url && (
                        <p className="text-xs text-text-muted truncate mt-1">{wc.url}</p>
                      )}
                      <p className="text-xs text-text-faint mt-1">
                        Last checked: {new Date(wc.lastChecked).toLocaleString()}
                      </p>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          refreshMutation.mutate(wc.path)
                        }}
                        className="btn-icon-sm"
                        title="Refresh"
                      >
                        <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          window.api.external.openFolder(wc.path)
                        }}
                        className="btn-icon-sm"
                        title="Open in Explorer"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeMutation.mutate(wc.path)
                        }}
                        className="btn-icon-sm hover:text-error"
                        title="Remove from monitor"
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
            {workingCopies?.length || 0} working copy{(workingCopies?.length || 0) !== 1 ? 'ies' : ''} monitored
          </div>
          <button onClick={() => refetch()} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh All
          </button>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
