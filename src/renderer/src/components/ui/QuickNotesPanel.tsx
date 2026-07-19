import { useState, useEffect, useCallback } from 'react';
import { X, StickyNote, Plus, Trash2, Pin, PinOff } from 'lucide-react';

import { m, springs, useMotionEnabled, variants } from '../../lib/motion';

interface Note {
  id: string;
  text: string;
  timestamp: number;
  pinned: boolean;
  path?: string;
}

interface QuickNotesPanelProps {
  isOpen: boolean;
  currentPath?: string;
  onClose: () => void;
}

const STORAGE_KEY = 'shellysvn:quick-notes';

function formatNoteDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function QuickNotesPanel({ isOpen, currentPath, onClose }: QuickNotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [filter, setFilter] = useState<'all' | 'pinned' | 'current'>('all');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load notes from storage
  useEffect(() => {
    const loadNotes = async () => {
      try {
        const stored = await window.api.store.get<Note[]>(STORAGE_KEY);
        if (stored && Array.isArray(stored)) {
          setNotes(stored);
        }
      } catch (err) {
        console.error('Failed to load notes:', err);
      }
    };
    loadNotes();
  }, []);

  // Save notes to storage
  const saveNotes = useCallback(async (newNotes: Note[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newNotes);
      setNotes(newNotes);
    } catch (err) {
      console.error('Failed to save notes:', err);
    }
  }, []);

  const addNote = async () => {
    if (!newNoteText.trim()) return;

    const note: Note = {
      id: `note-${Date.now()}`,
      text: newNoteText.trim(),
      timestamp: Date.now(),
      pinned: false,
      path: currentPath,
    };

    await saveNotes([note, ...notes]);
    setNewNoteText('');
  };

  const deleteNote = async (id: string) => {
    const newNotes = notes.filter((n) => n.id !== id);
    await saveNotes(newNotes);
  };

  const togglePin = async (id: string) => {
    const newNotes = notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n));
    // Sort: pinned first, then by timestamp
    newNotes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.timestamp - a.timestamp;
    });
    await saveNotes(newNotes);
  };

  const filteredNotes = notes.filter((note) => {
    if (filter === 'pinned') return note.pinned;
    if (filter === 'current') return note.path === currentPath;
    return true;
  });

  const motionEnabled = useMotionEnabled();

  if (!isOpen) return null;

  const tabs = [
    { value: 'all', label: 'All' },
    { value: 'pinned', label: 'Pinned' },
    { value: 'current', label: 'Here' },
  ] as const;

  return (
    <m.div
      className="fixed right-0 top-[--topbar-height] bottom-0 w-80 z-50 flex flex-col glass-strong border-l border-border"
      style={{ boxShadow: 'var(--shadow-overlay)' }}
      initial={motionEnabled ? { x: 28, opacity: 0 } : false}
      animate={{ x: 0, opacity: 1 }}
      transition={springs.smooth}
      role="complementary"
      aria-label="Quick notes"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[--topbar-height] border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent/15 text-accent">
            <StickyNote className="w-4 h-4" />
          </div>
          <span className="font-semibold text-text">Quick Notes</span>
        </div>
        <button onClick={onClose} className="btn-icon-sm" aria-label="Close quick notes">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Segmented filter */}
      <div className="px-3 pt-3">
        <div className="flex gap-1 p-1 bg-bg-tertiary/60 rounded-lg">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-fast ${
                filter === tab.value
                  ? 'bg-bg-elevated text-text shadow-sm'
                  : 'text-text-secondary hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Add note */}
      <div className="px-3 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()}
            placeholder="Add a quick note…"
            className="input flex-1 text-sm"
          />
          <button
            onClick={addNote}
            disabled={!newNoteText.trim()}
            className="btn btn-primary btn-sm px-3 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {currentPath && (
          <p className="text-2xs text-text-muted mt-2 truncate">
            Attaches to{' '}
            <span className="text-text-secondary font-medium">
              {currentPath.split(/[/\\]/).pop()}
            </span>
          </p>
        )}
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-auto scrollbar-overlay px-3 pb-3">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-bg-tertiary/70 mb-3">
              <StickyNote className="w-6 h-6 text-text-faint" />
            </div>
            <p className="text-sm text-text-secondary">
              {filter === 'all'
                ? 'No notes yet'
                : filter === 'pinned'
                  ? 'No pinned notes'
                  : 'No notes for this location'}
            </p>
            <p className="text-xs text-text-muted mt-1">Jot down anything worth remembering</p>
          </div>
        ) : (
          <m.div
            className="space-y-2"
            variants={variants.staggerList}
            initial={motionEnabled ? 'initial' : false}
            animate="animate"
          >
            {filteredNotes.map((note) => (
              <m.div
                key={note.id}
                variants={variants.listItem}
                className={`group rounded-xl border p-3 transition-fast ${
                  note.pinned
                    ? 'border-accent/30 bg-accent/5'
                    : 'border-border bg-bg-secondary/50 hover:border-border-focus/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-text whitespace-pre-wrap break-words flex-1">
                    {note.text}
                  </p>
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => togglePin(note.id)}
                      className={`btn-icon-sm ${note.pinned ? 'text-accent opacity-100' : 'text-text-muted'}`}
                      title={note.pinned ? 'Unpin' : 'Pin'}
                    >
                      {note.pinned ? (
                        <Pin className="w-3.5 h-3.5" />
                      ) : (
                        <PinOff className="w-3.5 h-3.5" />
                      )}
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
                  {note.pinned && <Pin className="w-3 h-3 text-accent flex-shrink-0" />}
                  <span className="text-2xs text-text-muted">{formatNoteDate(note.timestamp)}</span>
                  {note.path && (
                    <>
                      <span className="text-2xs text-text-faint">•</span>
                      <span className="text-2xs text-text-faint truncate">
                        {note.path.split(/[/\\]/).pop()}
                      </span>
                    </>
                  )}
                </div>
              </m.div>
            ))}
          </m.div>
        )}
      </div>
    </m.div>
  );
}
