import { useState, useEffect } from 'react'
import { X, Bookmark, Plus, Trash2, FolderOpen, Edit2, Check } from 'lucide-react'
import type { AppSettings } from '@shared/types'

interface BookmarksManagerProps {
  isOpen: boolean
  onClose: () => void
  bookmarks: AppSettings['bookmarks']
  onAddBookmark: (path: string, name: string) => void
  onRemoveBookmark: (path: string) => void
}

export function BookmarksManager({ 
  isOpen, 
  onClose, 
  bookmarks = [], 
  onAddBookmark, 
  onRemoveBookmark 
}: BookmarksManagerProps) {
  const [newPath, setNewPath] = useState('')
  const [newName, setNewName] = useState('')
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  
  useEffect(() => {
    if (isOpen) {
      setNewPath('')
      setNewName('')
      setEditingPath(null)
      setIsAdding(false)
    }
  }, [isOpen])
  
  const handleBrowse = async () => {
    const result = await window.api.dialog.openDirectory()
    if (result) {
      setNewPath(result)
      if (!newName) {
        const name = result.split(/[/\\]/).pop() || result
        setNewName(name)
      }
    }
  }
  
  const handleAdd = () => {
    if (!newPath.trim() || !newName.trim()) return
    
    onAddBookmark(newPath.trim(), newName.trim())
    setNewPath('')
    setNewName('')
    setIsAdding(false)
  }
  
  const handleEdit = (path: string, currentName: string) => {
    setEditingPath(path)
    setEditName(currentName)
  }
  
  const handleSaveEdit = (path: string) => {
    if (!editName.trim()) return
    
    // Remove old bookmark and add new one with updated name
    onRemoveBookmark(path)
    onAddBookmark(path, editName.trim())
    setEditingPath(null)
    setEditName('')
  }
  
  const handleDelete = (path: string) => {
    if (confirm('Remove this bookmark?')) {
      onRemoveBookmark(path)
    }
  }
  
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }
  
  if (!isOpen) return null
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px] max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Bookmark className="w-5 h-5 text-accent" />
            Manage Bookmarks
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          <p className="text-sm text-text-secondary">
            Bookmarks let you quickly access frequently used folders.
          </p>
          
          {/* Add bookmark form */}
          {isAdding ? (
            <div className="bg-bg-tertiary rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="C:\Projects\my-project"
                    className="input flex-1"
                  />
                  <button onClick={handleBrowse} className="btn btn-secondary">
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Project"
                  className="input"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAdding(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newPath.trim() || !newName.trim()}
                  className="btn btn-primary btn-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="btn btn-secondary w-full"
            >
              <Plus className="w-4 h-4" />
              Add Bookmark
            </button>
          )}
          
          {/* Bookmarks list */}
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bookmark className="w-10 h-10 text-text-muted mb-3" />
              <p className="text-sm text-text-secondary">No bookmarks yet</p>
              <p className="text-xs text-text-muted mt-1">
                Add bookmarks to quickly access your favorite folders
              </p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-bg-tertiary px-4 py-2 border-b border-border">
                <span className="text-sm font-medium text-text">
                  {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-border max-h-[300px] overflow-auto">
                {bookmarks.map((bookmark) => (
                  <div 
                    key={bookmark.path}
                    className="px-4 py-3 hover:bg-bg-tertiary"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {editingPath === bookmark.path ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="input flex-1"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(bookmark.path)}
                              className="btn btn-primary btn-sm"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingPath(null)}
                              className="btn btn-secondary btn-sm"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <Bookmark className="w-4 h-4 text-accent flex-shrink-0" />
                              <span className="font-medium text-text">
                                {bookmark.name}
                              </span>
                            </div>
                            <p className="text-xs text-text-muted truncate mt-1 pl-6">
                              {bookmark.path}
                            </p>
                            <p className="text-xs text-text-faint pl-6 mt-1">
                              Added {formatDate(bookmark.addedAt)}
                            </p>
                          </>
                        )}
                      </div>
                      {editingPath !== bookmark.path && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEdit(bookmark.path, bookmark.name)}
                            className="btn-icon-sm text-text-muted hover:text-text"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(bookmark.path)}
                            className="btn-icon-sm text-text-muted hover:text-error"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
