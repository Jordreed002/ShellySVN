import { useState, useEffect, useCallback } from 'react'
import { X, StickyNote, Plus, Trash2, Pin, PinOff } from 'lucide-react'

interface Note {
  id: string
  text: string
  timestamp: number
  pinned: boolean
  path?: string
}

interface QuickNotesPanelProps {
  isOpen: boolean
  currentPath?: string
  onClose: () => void
}

const STORAGE_KEY = 'shellysvn:quick-notes'

export function QuickNotesPanel({ isOpen, currentPath, onClose }: QuickNotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [newNoteText, setNewNoteText] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned' | 'current'>('all')
  
  // Load notes from storage
  useEffect(() => {
    const loadNotes = async () => {
      try {
        const stored = await window.api.store.get<Note[]>(STORAGE_KEY)
        if (stored && Array.isArray(stored)) {
          setNotes(stored)
        }
      } catch (err) {
        console.error('Failed to load notes:', err)
      }
    }
    loadNotes()
  }, [])
  
  // Save notes to storage
  const saveNotes = useCallback(async (newNotes: Note[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newNotes)
      setNotes(newNotes)
    } catch (err) {
      console.error('Failed to save notes:', err)
    }
  }, [])
  
  const addNote = async () => {
    if (!newNoteText.trim()) return
    
    const note: Note = {
      id: `note-${Date.now()}`,
      text: newNoteText.trim(),
      timestamp: Date.now(),
      pinned: false,
      path: currentPath
    }
    
    await saveNotes([note, ...notes])
    setNewNoteText('')
  }
  
  const deleteNote = async (id: string) => {
    const newNotes = notes.filter(n => n.id !== id)
    await saveNotes(newNotes)
  }
  
  const togglePin = async (id: string) => {
    const newNotes = notes.map(n => 
      n.id === id ? { ...n, pinned: !n.pinned } : n
    )
    // Sort: pinned first, then by timestamp
    newNotes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.timestamp - a.timestamp
    })
    await saveNotes(newNotes)
  }
  
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' })
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }
  
  const filteredNotes = notes.filter(note => {
    if (filter === 'pinned') return note.pinned
    if (filter === 'current') return note.path === currentPath
    return true
  })
  
  if (!isOpen) return null
  
  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-bg-secondary border-l border-border z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-accent" />
          <span className="font-medium text-text">Quick Notes</span>
        </div>
        <button onClick={onClose} className="btn-icon-sm">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Filter tabs */}
      <div className="flex border-b border-border">
        {[
          { value: 'all', label: 'All' },
          { value: 'pinned', label: 'Pinned' },
          { value: 'current', label: 'Here' }
        ].map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value as typeof filter)}
            className={`
              flex-1 py-2 text-sm text-center transition-fast
              ${filter === tab.value
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Add note */}
      <div className="p-4 border-b border-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={newNoteText}
            onChange={e => setNewNoteText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNote()}
            placeholder="Add a quick note..."
            className="input flex-1 text-sm"
          />
          <button
            onClick={addNote}
            disabled={!newNoteText.trim()}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {currentPath && (
          <p className="text-xs text-text-muted mt-2">
            Note will be attached to: {currentPath.split(/[/\\]/).pop()}
          </p>
        )}
      </div>
      
      {/* Notes list */}
      <div className="flex-1 overflow-auto">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <StickyNote className="w-8 h-8 text-text-muted mb-2" />
            <p className="text-sm text-text-secondary">
              {filter === 'all' 
                ? 'No notes yet'
                : filter === 'pinned'
                  ? 'No pinned notes'
                  : 'No notes for this location'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredNotes.map(note => (
              <div
                key={note.id}
                className={`
                  p-4 hover:bg-bg-tertiary transition-fast
                  ${note.pinned ? 'bg-accent/5' : ''}
                `}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-text whitespace-pre-wrap break-words flex-1">
                    {note.text}
                  </p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => togglePin(note.id)}
                      className={`btn-icon-sm ${note.pinned ? 'text-accent' : 'text-text-muted'}`}
                      title={note.pinned ? 'Unpin' : 'Pin'}
                    >
                      {note.pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => deleteNote(note.id)}
                      className="btn-icon-sm text-text-muted hover:text-error"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-text-muted">
                    {formatDate(note.timestamp)}
                  </span>
                  {note.path && (
                    <>
                      <span className="text-xs text-text-faint">•</span>
                      <span className="text-xs text-text-faint truncate">
                        {note.path.split(/[/\\]/).pop()}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
