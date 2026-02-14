import { useState, useCallback } from 'react'
import { FileText, Plus, Trash2, Edit2, Check, X, Star } from 'lucide-react'
import { useCommitTemplates, applyTemplateString, type CommitTemplate } from '../../hooks/useCommitTemplates'

interface CommitTemplateManagerProps {
  onSelectTemplate?: (template: string) => void
  repositoryPath?: string
  className?: string
}

/**
 * UI for managing commit message templates
 */
export function CommitTemplateManager({ 
  onSelectTemplate, 
  repositoryPath,
  className = '' 
}: CommitTemplateManagerProps) {
  const {
    templates,
    isLoading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getDefaultTemplate,
    setDefaultTemplate
  } = useCommitTemplates()
  
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<CommitTemplate>>({})
  const [showNewForm, setShowNewForm] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null)
  
  const relevantTemplates = repositoryPath 
    ? templates.filter(t => t.repositoryPath === repositoryPath || !t.repositoryPath)
    : templates.filter(t => !t.repositoryPath)
  
  const defaultTemplate = getDefaultTemplate(repositoryPath)
  
  const handleEdit = useCallback((template: CommitTemplate) => {
    setEditingId(template.id)
    setEditForm(template)
  }, [])
  
  const handleSave = useCallback(async () => {
    if (!editingId) return
    await updateTemplate(editingId, editForm)
    setEditingId(null)
    setEditForm({})
  }, [editingId, editForm, updateTemplate])
  
  const handleCancel = useCallback(() => {
    setEditingId(null)
    setEditForm({})
    setShowNewForm(false)
  }, [])
  
  const handleAdd = useCallback(async () => {
    if (!editForm.name || !editForm.template) return
    
    await addTemplate({
      name: editForm.name,
      description: editForm.description,
      template: editForm.template,
      repositoryPath
    })
    
    setShowNewForm(false)
    setEditForm({})
  }, [editForm, addTemplate, repositoryPath])
  
  const handleDelete = useCallback(async (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      await deleteTemplate(id)
    }
  }, [deleteTemplate])
  
  const handleSetDefault = useCallback(async (id: string) => {
    await setDefaultTemplate(id)
  }, [setDefaultTemplate])
  
  const handlePreview = useCallback(async (template: CommitTemplate) => {
    const preview = await applyTemplateString(template.template, {
      description: 'Example commit description',
      files: 'file1.ts\nfile2.ts',
      type: 'feat',
      scope: 'core'
    })
    setPreviewTemplate(preview)
  }, [])
  
  const handleSelect = useCallback(async (template: CommitTemplate) => {
    const applied = await applyTemplateString(template.template)
    onSelectTemplate?.(applied)
  }, [onSelectTemplate])
  
  if (isLoading) {
    return (
      <div className={`p-4 text-center text-slate-500 ${className}`}>
        Loading templates...
      </div>
    )
  }
  
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-lg ${className}`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Commit Templates
        </h3>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>
      
      {/* Template List */}
      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {relevantTemplates.map(template => (
          <div 
            key={template.id}
            className={`p-4 ${template.isDefault ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
          >
            {editingId === template.id ? (
              // Edit Form
              <div className="space-y-3">
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Template name"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                />
                <textarea
                  value={editForm.template || ''}
                  onChange={e => setEditForm(prev => ({ ...prev, template: e.target.value }))}
                  placeholder="Template content with {{variables}}"
                  rows={6}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              // Template Display
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {template.name}
                    </span>
                    {template.isDefault && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-300 rounded">
                        Default
                      </span>
                    )}
                    {template.isDefault && defaultTemplate?.id === template.id && (
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!template.isDefault && (
                      <button
                        onClick={() => handleSetDefault(template.id)}
                        className="p-1.5 text-slate-400 hover:text-yellow-500 rounded"
                        title="Set as default"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handlePreview(template)}
                      className="p-1.5 text-slate-400 hover:text-blue-500 rounded"
                      title="Preview"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleEdit(template)}
                      className="p-1.5 text-slate-400 hover:text-blue-500 rounded"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {template.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {template.description}
                  </p>
                )}
                <pre className="mt-2 p-2 bg-slate-100 dark:bg-slate-900 rounded text-xs text-slate-600 dark:text-slate-400 font-mono overflow-x-auto">
                  {template.template.slice(0, 150)}
                  {template.template.length > 150 && '...'}
                </pre>
                {onSelectTemplate && (
                  <button
                    onClick={() => handleSelect(template)}
                    className="mt-2 px-3 py-1 text-sm text-blue-500 hover:text-blue-600"
                  >
                    Use this template
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        
        {relevantTemplates.length === 0 && !showNewForm && (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            No templates yet. Click "New Template" to create one.
          </div>
        )}
      </div>
      
      {/* New Template Form */}
      {showNewForm && (
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-3">New Template</h4>
          <div className="space-y-3">
            <input
              type="text"
              value={editForm.name || ''}
              onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Template name"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
            />
            <textarea
              value={editForm.template || ''}
              onChange={e => setEditForm(prev => ({ ...prev, template: e.target.value }))}
              placeholder="Template content with {{variables}}"
              rows={6}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono text-sm"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Available variables: {`{{date}}, {{time}}, {{datetime}}, {{username}}, {{branch}}, {{files}}`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md"
              >
                Add Template
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-lg w-full mx-4">
            <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-3">Preview</h4>
            <pre className="p-4 bg-slate-100 dark:bg-slate-900 rounded text-sm text-slate-700 dark:text-slate-300 font-mono whitespace-pre-wrap">
              {previewTemplate}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setPreviewTemplate(null)}
                className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CommitTemplateManager
