import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Keyboard, Pencil, RotateCcw, X } from 'lucide-react';
import { useShortcutBindings } from '../../hooks/useShortcutBindings';
import { normalizeShortcutKey } from '../../lib/shortcutStore';

/**
 * A row of the cheat sheet. Rows whose action is user-remappable carry the
 * binding id, so the sheet always shows the *current* key, not the default.
 */
interface ShortcutRow {
  keys: string[];
  description: string;
  bindingId?: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutRow[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Navigate files' },
      { keys: ['Enter'], description: 'Open folder' },
      { keys: ['Backspace'], description: 'Go to parent folder', bindingId: 'go-up' },
      { keys: ['Tab'], description: 'Switch panes (dual-pane mode)' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Ctrl', 'A'], description: 'Select all files', bindingId: 'select-all' },
      { keys: ['Ctrl', 'Click'], description: 'Toggle selection' },
      { keys: ['Shift', 'Click'], description: 'Range select' },
      { keys: ['Delete'], description: 'Delete selected files', bindingId: 'delete' },
      { keys: ['Esc'], description: 'Clear selection' },
    ],
  },
  {
    title: 'SVN Actions',
    shortcuts: [
      { keys: ['Ctrl', 'U'], description: 'Update working copy', bindingId: 'update' },
      { keys: ['Ctrl', 'S'], description: 'Commit changes', bindingId: 'commit' },
      { keys: ['Ctrl', 'R'], description: 'Revert changes', bindingId: 'revert' },
      { keys: ['Ctrl', 'L'], description: 'Show log', bindingId: 'log' },
      { keys: ['Ctrl', 'D'], description: 'Show diff', bindingId: 'diff' },
    ],
  },
  {
    title: 'Conflicts',
    shortcuts: [
      { keys: ['F3'], description: 'Next conflict' },
      { keys: ['Shift', 'F3'], description: 'Previous conflict' },
      { keys: ['Ctrl', 'S'], description: 'Save merge result' },
      { keys: ['Esc'], description: 'Close conflict editor' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['F5'], description: 'Refresh', bindingId: 'refresh' },
      { keys: ['Ctrl', 'F'], description: 'Focus search', bindingId: 'search' },
      { keys: ['Ctrl', 'B'], description: 'Toggle sidebar', bindingId: 'toggle-sidebar' },
      { keys: ['Ctrl', 'P'], description: 'Toggle preview panel' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['Ctrl', ','], description: 'Open settings', bindingId: 'settings' },
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Command palette', bindingId: 'command-palette' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Dialogs',
    shortcuts: [
      { keys: ['Enter'], description: 'Confirm focused action' },
      { keys: ['Esc'], description: 'Close dialog' },
      { keys: ['Tab'], description: 'Move focus forward' },
      { keys: ['Shift', 'Tab'], description: 'Move focus backward' },
    ],
  },
];

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** Split a canonical combo (`Ctrl+Shift+K`) into display parts. */
function keyParts(key: string): string[] {
  return key.split('+').filter(Boolean);
}

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  const [tab, setTab] = useState<'cheatsheet' | 'customize'>('cheatsheet');
  const {
    bindings,
    categories,
    isLoading,
    isRecording,
    conflictWarning,
    conflicts,
    updateBinding,
    setBindingEnabled,
    resetBinding,
    resetAllBindings,
    getByCategory,
    startRecording,
    stopRecording,
    clearConflictWarning,
  } = useShortcutBindings();

  const bindingById = useMemo(
    () => new Map(bindings.map((binding) => [binding.id, binding])),
    [bindings]
  );

  // For each conflicted binding, name the other binding(s) sharing its key.
  const conflictLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const conflict of conflicts) {
      for (const id of conflict.bindingIds) {
        const others = conflict.bindingIds
          .filter((otherId) => otherId !== id)
          .map((otherId) => bindingById.get(otherId)?.name ?? otherId);
        labels.set(id, `Conflicts with ${others.join(', ')} on ${conflict.key}`);
      }
    }
    return labels;
  }, [conflicts, bindingById]);

  // Capture the next real key press as the new binding while recording.
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        stopRecording();
        return;
      }
      // Wait until a non-modifier key completes the combo.
      if (MODIFIER_KEYS.has(event.key)) return;

      const recordingId = isRecording;
      const combo = normalizeShortcutKey(
        [
          ...(event.ctrlKey || event.metaKey ? ['Ctrl'] : []),
          ...(event.altKey ? ['Alt'] : []),
          ...(event.shiftKey ? ['Shift'] : []),
          event.key.length === 1 ? event.key.toLowerCase() : event.key,
        ].join('+')
      );
      if (!combo) return;

      stopRecording();
      void updateBinding(recordingId, combo);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, stopRecording, updateBinding]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-[640px] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <Keyboard className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="btn-icon-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar: read-only sheet vs. remapping */}
        <div className="flex items-center gap-1 px-4 pt-3" role="tablist" aria-label="Shortcut views">
          {(
            [
              ['cheatsheet', 'Cheat sheet'],
              ['customize', 'Customize'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-fast ${
                tab === value
                  ? 'bg-accent/10 text-accent border border-accent/40'
                  : 'text-text-secondary hover:text-text border border-transparent hover:bg-bg-tertiary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body overflow-auto">
          {tab === 'cheatsheet' ? (
            <div className="grid grid-cols-2 gap-6">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-sm font-medium text-text mb-3 pb-2 border-b border-border">
                    {group.title}
                  </h3>
                  <div className="space-y-2">
                    {group.shortcuts.map((shortcut, index) => {
                      const binding = shortcut.bindingId
                        ? bindingById.get(shortcut.bindingId)
                        : undefined;
                      const keys = binding ? keyParts(binding.currentKey) : shortcut.keys;
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between text-sm"
                        >
                          <span
                            className={`text-text-secondary ${
                              binding && !binding.enabled ? 'line-through opacity-60' : ''
                            }`}
                          >
                            {shortcut.description}
                          </span>
                          <div className="flex items-center gap-1">
                            {keys.map((key, keyIndex) => (
                              <span key={keyIndex}>
                                <kbd className="px-2 py-0.5 bg-bg-elevated border border-border rounded text-xs font-mono text-text">
                                  {key}
                                </kbd>
                                {keyIndex < keys.length - 1 && (
                                  <span className="text-text-muted mx-0.5">+</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-5" aria-busy={isLoading}>
              {conflictWarning && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/40 text-sm text-text"
                >
                  <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                  <span className="flex-1">{conflictWarning}</span>
                  <button
                    type="button"
                    onClick={clearConflictWarning}
                    className="btn-icon-sm"
                    aria-label="Dismiss warning"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {categories.map((category) => {
                const categoryBindings = getByCategory(category.id);
                if (categoryBindings.length === 0) return null;
                return (
                  <section key={category.id}>
                    <h3 className="text-sm font-medium text-text mb-3 pb-2 border-b border-border">
                      {category.name}
                    </h3>
                    <div className="space-y-1.5">
                      {categoryBindings.map((binding) => {
                        const isCustomized =
                          normalizeShortcutKey(binding.currentKey) !==
                          normalizeShortcutKey(binding.defaultKey);
                        const conflictLabel = conflictLabels.get(binding.id);
                        const recordingThis = isRecording === binding.id;
                        return (
                          <div
                            key={binding.id}
                            className="flex items-center gap-3 text-sm py-1"
                          >
                            <span
                              className={`flex-1 min-w-0 truncate ${
                                binding.enabled ? 'text-text-secondary' : 'text-text-faint line-through'
                              }`}
                            >
                              {binding.name}
                            </span>

                            {recordingThis ? (
                              <span
                                className="text-xs text-accent animate-pulse"
                                role="status"
                              >
                                Press the new key… Esc cancels
                              </span>
                            ) : (
                              <kbd
                                className={`px-2 py-0.5 bg-bg-elevated border border-border rounded text-xs font-mono ${
                                  binding.enabled ? 'text-text' : 'text-text-faint'
                                }`}
                              >
                                {binding.currentKey}
                              </kbd>
                            )}

                            {conflictLabel && !recordingThis && (
                              <span
                                className="flex items-center gap-1 text-xs text-warning"
                                title={conflictLabel}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                                Conflict
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                recordingThis ? stopRecording() : startRecording(binding.id)
                              }
                              className="btn-icon-sm"
                              aria-label={
                                recordingThis
                                  ? `Cancel recording for ${binding.name}`
                                  : `Record a new key for ${binding.name}`
                              }
                              title={recordingThis ? 'Cancel recording' : 'Record new key'}
                            >
                              {recordingThis ? (
                                <X className="w-3.5 h-3.5" />
                              ) : (
                                <Pencil className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {isCustomized && (
                              <button
                                type="button"
                                onClick={() => void resetBinding(binding.id)}
                                className="btn-icon-sm"
                                aria-label={`Reset ${binding.name} to ${binding.defaultKey}`}
                                title={`Reset to default (${binding.defaultKey})`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <input
                              type="checkbox"
                              checked={binding.enabled}
                              onChange={(event) =>
                                void setBindingEnabled(binding.id, event.target.checked)
                              }
                              aria-label={
                                binding.enabled
                                  ? `Disable ${binding.name}`
                                  : `Enable ${binding.name}`
                              }
                              className="accent-accent"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <div className="pt-2 border-t border-border flex items-center justify-between">
                <p className="text-xs text-text-muted">
                  Bindings are stored as overrides; defaults never change.
                </p>
                <button
                  type="button"
                  onClick={() => void resetAllBindings()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text hover:bg-bg-tertiary transition-fast"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset all to defaults
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <p className="text-xs text-text-muted">
            Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-text-faint">?</kbd>{' '}
            anytime to show this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
