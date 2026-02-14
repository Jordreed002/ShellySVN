import { useState, useEffect } from 'react'
import { X, Settings, Plus, Trash2, AlertCircle, Loader2, Check, Save } from 'lucide-react'

interface PropertiesDialogProps {
  isOpen: boolean
  onClose: () => void
  path: string
}

interface SvnProperty {
  name: string
  value: string
}

const COMMON_PROPERTIES = [
  { name: 'svn:ignore', description: 'List of file patterns to ignore' },
  { name: 'svn:global-ignores', description: 'Recursive ignore patterns' },
  { name: 'svn:externals', description: 'External repository references' },
  { name: 'svn:keywords', description: 'Keywords to expand (Id, Rev, Date, etc.)' },
  { name: 'svn:eol-style', description: 'Line ending style (LF, CRLF, native)' },
  { name: 'svn:mime-type', description: 'MIME type of the file' },
  { name: 'svn:needs-lock', description: 'Require lock before editing' },
  { name: 'svn:executable', description: 'Set executable bit' },
]

export function PropertiesDialog({ isOpen, onClose, path }: PropertiesDialogProps) {
  const [properties, setProperties] = useState<SvnProperty[]>([])
  const [originalProperties, setOriginalProperties] = useState<SvnProperty[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newPropName, setNewPropName] = useState('')
  const [newPropValue, setNewPropValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  useEffect(() => {
    if (isOpen) {
      loadProperties()
    }
  }, [isOpen, path])
  
  const loadProperties = async () => {
    setIsLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const props = await window.api.svn.proplist(path)
      const propList: SvnProperty[] = props.map(p => ({
        name: p.name,
        value: p.value
      }))
      setProperties(propList)
      setOriginalProperties(propList)
    } catch (err) {
      setError((err as Error).message || 'Failed to load properties')
      setProperties([])
      setOriginalProperties([])
    } finally {
      setIsLoading(false)
    }
  }
  
  const hasChanges = () => {
    if (properties.length !== originalProperties.length) return true
    return properties.some((prop, index) => 
      prop.name !== originalProperties[index]?.name ||
      prop.value !== originalProperties[index]?.value
    )
  }
  
  const handleEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(properties[index].value)
  }
  
  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      const newProps = [...properties]
      newProps[editingIndex].value = editValue
      setProperties(newProps)
      setEditingIndex(null)
      setEditValue('')
    }
  }
  
  const handleCancelEdit = () => {
    setEditingIndex(null)
    setEditValue('')
  }
  
  const handleDelete = async (index: number) => {
    if (confirm(`Delete property "${properties[index].name}"?`)) {
      const propName = properties[index].name
      setIsSaving(true)
      setError(null)
      
      try {
        await window.api.svn.propdel(path, propName)
        const newProps = properties.filter((_, i) => i !== index)
        setProperties(newProps)
        setOriginalProperties(newProps)
        setSuccess(`Property "${propName}" deleted`)
      } catch (err) {
        setError((err as Error).message || 'Failed to delete property')
      } finally {
        setIsSaving(false)
      }
    }
  }
  
  const handleAddProperty = () => {
    if (!newPropName.trim()) {
      setError('Property name is required')
      return
    }
    
    if (properties.some(p => p.name === newPropName.trim())) {
      setError('Property already exists')
      return
    }
    
    setProperties([...properties, { name: newPropName.trim(), value: newPropValue }])
    setNewPropName('')
    setNewPropValue('')
    setIsAdding(false)
    setError(null)
  }
  
  const handleSaveAll = async () => {
    setIsSaving(true)
    setError(null)
    setSuccess(null)
    
    try {
      // Find properties to add/update
      for (const prop of properties) {
        const original = originalProperties.find(o => o.name === prop.name)
        if (!original) {
          // New property
          await window.api.svn.propset(path, prop.name, prop.value)
        } else if (original.value !== prop.value) {
          // Updated property
          await window.api.svn.propset(path, prop.name, prop.value)
        }
      }
      
      // Find properties to delete
      for (const original of originalProperties) {
        if (!properties.find(p => p.name === original.name)) {
          await window.api.svn.propdel(path, original.name)
        }
      }
      
      setOriginalProperties([...properties])
      setSuccess('All properties saved successfully')
    } catch (err) {
      setError((err as Error).message || 'Failed to save properties')
    } finally {
      setIsSaving(false)
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
            <Settings className="w-5 h-5 text-accent" />
            Properties
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Path */}
        <div className="px-4 py-2 bg-bg-tertiary border-b border-border text-sm text-text-secondary truncate">
          {path}
        </div>
        
        {/* Content */}
        <div className="modal-body overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Existing properties */}
              {properties.map((prop, index) => (
                <div key={prop.name} className="bg-bg-tertiary rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-text">{prop.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(index)}
                        className="btn-icon-sm"
                        title="Edit"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(index)}
                        className="btn-icon-sm hover:text-error"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  
                  {editingIndex === index ? (
                    <div className="space-y-2">
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="input h-24 resize-none text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="btn btn-secondary btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="btn btn-primary btn-sm"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono bg-bg-secondary rounded p-2 max-h-32 overflow-auto">
                      {prop.value || '(empty)'}
                    </pre>
                  )}
                </div>
              ))}
              
              {/* Add property form */}
              {isAdding ? (
                <div className="bg-bg-tertiary rounded-lg p-3 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-text-secondary mb-1 block">
                      Property name
                    </label>
                    <input
                      type="text"
                      value={newPropName}
                      onChange={(e) => setNewPropName(e.target.value)}
                      placeholder="svn:ignore"
                      className="input text-sm"
                      list="common-properties"
                    />
                    <datalist id="common-properties">
                      {COMMON_PROPERTIES.map(p => (
                        <option key={p.name} value={p.name} />
                      ))}
                    </datalist>
                  </div>
                  
                  <div>
                    <label className="text-xs font-medium text-text-secondary mb-1 block">
                      Value
                    </label>
                    <textarea
                      value={newPropValue}
                      onChange={(e) => setNewPropValue(e.target.value)}
                      placeholder="Enter property value..."
                      className="input h-24 resize-none text-sm"
                    />
                  </div>
                  
                  {error && (
                    <div className="text-xs text-error flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}
                  
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setIsAdding(false)
                        setNewPropName('')
                        setNewPropValue('')
                        setError(null)
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddProperty}
                      className="btn btn-primary btn-sm"
                    >
                      Add Property
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-accent transition-fast"
                >
                  <Plus className="w-4 h-4 inline mr-1" />
                  Add Property
                </button>
              )}
              
              {/* Common properties help */}
              <div className="text-xs text-text-faint">
                <p className="font-medium mb-1">Common properties:</p>
                <ul className="space-y-1">
                  {COMMON_PROPERTIES.slice(0, 4).map(p => (
                    <li key={p.name}>
                      <span className="text-text-secondary">{p.name}</span> - {p.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          {success && (
            <span className="text-sm text-success flex items-center gap-1">
              <Check className="w-4 h-4" />
              {success}
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
            <button 
              onClick={handleSaveAll}
              disabled={!hasChanges() || isSaving}
              className="btn btn-primary"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
