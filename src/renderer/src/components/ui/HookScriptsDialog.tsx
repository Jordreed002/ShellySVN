import { useState, useEffect } from 'react'
import { X, Terminal, Plus, Trash2, FolderOpen, Info } from 'lucide-react'

interface HookScript {
  id: string
  name: string
  type: 'pre-commit' | 'post-commit' | 'pre-update' | 'post-update' | 'start-commit' | 'pre-lock' | 'pre-unlock'
  path: string
  enabled: boolean
  waitForResult: boolean
  showConsole: boolean
}

interface HookScriptsDialogProps {
  isOpen: boolean
  onClose: () => void
  workingCopyPath: string
}

const HOOK_TYPES = [
  { value: 'start-commit', label: 'Start Commit', description: 'Runs before the commit dialog is shown' },
  { value: 'pre-commit', label: 'Pre-Commit', description: 'Runs before the commit is executed' },
  { value: 'post-commit', label: 'Post-Commit', description: 'Runs after the commit is completed' },
  { value: 'pre-update', label: 'Pre-Update', description: 'Runs before an update' },
  { value: 'post-update', label: 'Post-Update', description: 'Runs after an update' },
  { value: 'pre-lock', label: 'Pre-Lock', description: 'Runs before locking a file' },
  { value: 'pre-unlock', label: 'Pre-Unlock', description: 'Runs before unlocking a file' },
] as const

const STORAGE_KEY = 'shellysvn:hook-scripts'

export function HookScriptsDialog({ isOpen, onClose, workingCopyPath }: HookScriptsDialogProps) {
  const [hooks, setHooks] = useState<HookScript[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [editingHook, setEditingHook] = useState<HookScript | null>(null)
  
  // Form state for new/edit hook
  const [formState, setFormState] = useState({
    name: '',
    type: 'pre-commit' as HookScript['type'],
    path: '',
    enabled: true,
    waitForResult: true,
    showConsole: false
  })
  
  // Load hooks from storage
  useEffect(() => {
    if (isOpen) {
      loadHooks()
    }
  }, [isOpen, workingCopyPath])
  
  const loadHooks = async () => {
    try {
      const stored = await window.api.store.get<Record<string, HookScript[]>>(STORAGE_KEY)
      if (stored && stored[workingCopyPath]) {
        setHooks(stored[workingCopyPath])
      } else {
        setHooks([])
      }
    } catch {
      setHooks([])
    }
  }
  
  const saveHooks = async (newHooks: HookScript[]) => {
    try {
      const stored = await window.api.store.get<Record<string, HookScript[]>>(STORAGE_KEY) || {}
      stored[workingCopyPath] = newHooks
      await window.api.store.set(STORAGE_KEY, stored)
      setHooks(newHooks)
    } catch (err) {
      console.error('Failed to save hooks:', err)
    }
  }
  
  const resetForm = () => {
    setFormState({
      name: '',
      type: 'pre-commit',
      path: '',
      enabled: true,
      waitForResult: true,
      showConsole: false
    })
    setIsAdding(false)
    setEditingHook(null)
  }
  
  const handleBrowse = async () => {
    const result = await window.api.dialog.openFile([
      { name: 'Scripts', extensions: ['exe', 'bat', 'cmd', 'sh', 'ps1', 'py'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    if (result) {
      setFormState(prev => ({ ...prev, path: result }))
    }
  }
  
  const handleAddHook = () => {
    if (!formState.name.trim() || !formState.path.trim()) return
    
    const newHook: HookScript = {
      id: `hook-${Date.now()}`,
      ...formState
    }
    
    saveHooks([...hooks, newHook])
    resetForm()
  }
  
  const handleEditHook = () => {
    if (!editingHook || !formState.name.trim() || !formState.path.trim()) return
    
    const updatedHooks = hooks.map(h => 
      h.id === editingHook.id 
        ? { ...h, ...formState }
        : h
    )
    
    saveHooks(updatedHooks)
    resetForm()
  }
  
  const handleDeleteHook = (id: string) => {
    if (confirm('Delete this hook script?')) {
      saveHooks(hooks.filter(h => h.id !== id))
    }
  }
  
  const handleToggleHook = (id: string) => {
    const updatedHooks = hooks.map(h => 
      h.id === id ? { ...h, enabled: !h.enabled } : h
    )
    saveHooks(updatedHooks)
  }
  
  const startEditing = (hook: HookScript) => {
    setEditingHook(hook)
    setFormState({
      name: hook.name,
      type: hook.type,
      path: hook.path,
      enabled: hook.enabled,
      waitForResult: hook.waitForResult,
      showConsole: hook.showConsole
    })
    setIsAdding(true)
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[650px] max-h-[80vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Terminal className="w-5 h-5 text-accent" />
            Hook Scripts
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-auto space-y-4">
          {/* Info */}
          <div className="bg-info/10 border border-info/20 rounded-lg p-3 text-sm">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
              <div className="text-info">
                <p>Hook scripts are external programs that run automatically during SVN operations.</p>
                <p className="mt-1 text-xs text-info/80">
                  These are client-side hooks specific to ShellySVN, not repository hooks.
                </p>
              </div>
            </div>
          </div>
          
          {/* Add/Edit form */}
          {isAdding ? (
            <div className="bg-bg-tertiary rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-text">
                {editingHook ? 'Edit Hook Script' : 'Add Hook Script'}
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-text-secondary mb-1 block">
                    Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formState.name}
                    onChange={(e) => setFormState(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="My Hook Script"
                    className="input"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-medium text-text-secondary mb-1 block">
                    Hook Type
                  </label>
                  <select
                    value={formState.type}
                    onChange={(e) => setFormState(prev => ({ ...prev, type: e.target.value as HookScript['type'] }))}
                    className="input"
                  >
                    {HOOK_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">
                  Script Path <span className="text-error">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formState.path}
                    onChange={(e) => setFormState(prev => ({ ...prev, path: e.target.value }))}
                    placeholder="C:\Scripts\my-hook.bat"
                    className="input flex-1"
                  />
                  <button onClick={handleBrowse} className="btn btn-secondary">
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.enabled}
                    onChange={(e) => setFormState(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="checkbox"
                  />
                  <span className="text-sm text-text">Enabled</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.waitForResult}
                    onChange={(e) => setFormState(prev => ({ ...prev, waitForResult: e.target.checked }))}
                    className="checkbox"
                  />
                  <span className="text-sm text-text">Wait for script to complete</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.showConsole}
                    onChange={(e) => setFormState(prev => ({ ...prev, showConsole: e.target.checked }))}
                    className="checkbox"
                  />
                  <span className="text-sm text-text">Show console window</span>
                </label>
              </div>
              
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button onClick={resetForm} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
                <button
                  onClick={editingHook ? handleEditHook : handleAddHook}
                  disabled={!formState.name.trim() || !formState.path.trim()}
                  className="btn btn-primary btn-sm"
                >
                  {editingHook ? 'Save Changes' : 'Add Hook'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-accent transition-fast"
            >
              <Plus className="w-4 h-4 inline mr-1" />
              Add Hook Script
            </button>
          )}
          
          {/* Hooks list */}
          {hooks.length === 0 ? (
            <div className="text-center py-8">
              <Terminal className="w-12 h-12 text-text-faint mx-auto mb-3" />
              <p className="text-text-secondary">No hook scripts configured</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hooks.map((hook) => {
                const hookType = HOOK_TYPES.find(t => t.value === hook.type)
                
                return (
                  <div
                    key={hook.id}
                    className={`bg-bg-tertiary rounded-lg p-3 ${!hook.enabled ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={hook.enabled}
                        onChange={() => handleToggleHook(hook.id)}
                        className="checkbox mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-text">{hook.name}</span>
                          <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                            {hookType?.label}
                          </span>
                        </div>
                        <p className="text-xs text-text-faint truncate font-mono">{hook.path}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                          {hook.waitForResult && <span>Waits for completion</span>}
                          {hook.showConsole && <span>Shows console</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(hook)}
                          className="btn-icon-sm"
                          title="Edit"
                        >
                          <Terminal className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteHook(hook.id)}
                          className="btn-icon-sm hover:text-error"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <div className="flex-1 text-xs text-text-faint">
            {hooks.filter(h => h.enabled).length} of {hooks.length} hooks enabled
          </div>
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
