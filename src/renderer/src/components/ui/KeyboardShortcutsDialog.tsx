import { X, Keyboard } from 'lucide-react'

interface ShortcutGroup {
  title: string
  shortcuts: { keys: string[]; description: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Navigate files' },
      { keys: ['Enter'], description: 'Open folder' },
      { keys: ['Backspace'], description: 'Go to parent folder' },
      { keys: ['Tab'], description: 'Switch panes (dual-pane mode)' },
    ]
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Ctrl', 'A'], description: 'Select all files' },
      { keys: ['Ctrl', 'Click'], description: 'Toggle selection' },
      { keys: ['Shift', 'Click'], description: 'Range select' },
      { keys: ['Esc'], description: 'Clear selection' },
    ]
  },
  {
    title: 'SVN Actions',
    shortcuts: [
      { keys: ['Ctrl', 'U'], description: 'Update working copy' },
      { keys: ['Ctrl', 'S'], description: 'Commit changes' },
      { keys: ['Ctrl', 'R'], description: 'Revert changes' },
      { keys: ['Ctrl', 'L'], description: 'Show log' },
      { keys: ['Ctrl', 'D'], description: 'Show diff' },
    ]
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['F5'], description: 'Refresh' },
      { keys: ['Ctrl', 'F'], description: 'Focus search' },
      { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
      { keys: ['Ctrl', 'P'], description: 'Toggle preview panel' },
    ]
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', ','], description: 'Open settings' },
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Command palette' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ]
  },
]

interface KeyboardShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[600px] max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <Keyboard className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="modal-body overflow-auto">
          <div className="grid grid-cols-2 gap-6">
            {SHORTCUT_GROUPS.map(group => (
              <div key={group.title}>
                <h3 className="text-sm font-medium text-text mb-3 pb-2 border-b border-border">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="text-text-secondary">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <span key={keyIndex}>
                            <kbd className="px-2 py-0.5 bg-bg-elevated border border-border rounded text-xs font-mono text-text">
                              {key}
                            </kbd>
                            {keyIndex < shortcut.keys.length - 1 && (
                              <span className="text-text-muted mx-0.5">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="modal-footer">
          <p className="text-xs text-text-muted">
            Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-text-faint">?</kbd> anytime to show this dialog
          </p>
        </div>
      </div>
    </div>
  )
}
