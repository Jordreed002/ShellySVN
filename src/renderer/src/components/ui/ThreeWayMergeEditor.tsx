import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  X,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Save,
  RotateCcw,
  Columns,
  Rows,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { confirmAppAction } from '../../utils/dialogs';

interface ThreeWayMergeEditorProps {
  isOpen: boolean;
  filePath: string;
  mineContent: string;
  theirsContent: string;
  baseContent: string;
  mergedContent?: string;
  onClose: () => void;
  onSave: (mergedContent: string) => Promise<void>;
}

interface ConflictRegion {
  id: string;
  startLine: number;
  endLine: number;
  mineContent: string[];
  theirsContent: string[];
  baseContent: string[];
  resolved: boolean;
  resolution:
    | 'mine'
    | 'theirs'
    | 'base'
    | 'both-mine-first'
    | 'both-theirs-first'
    | 'custom'
    | null;
  customContent?: string;
}

interface MergeLinePaneProps {
  lines: string[];
  showLineNumbers: boolean;
  className?: string;
  lineClassName?: string;
  emptyMessage?: string;
}

function MergeLinePane({
  lines,
  showLineNumbers,
  className = '',
  lineClassName = '',
  emptyMessage,
}: MergeLinePaneProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    getItemKey: (index) => index,
    initialRect: { width: 600, height: 480 },
    overscan: 20,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visibleRows =
    virtualRows.length > 0
      ? virtualRows
      : lines.slice(0, Math.min(lines.length, 40)).map((_, index) => ({
          index,
          key: index,
          size: 22,
          start: index * 22,
        }));

  if (lines.length === 0 && emptyMessage) {
    return (
      <div className={`flex-1 overflow-auto p-2 font-mono text-sm ${className}`}>
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className={`flex-1 overflow-auto p-2 font-mono text-sm ${className}`}>
      <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {visibleRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            className={`absolute left-0 top-0 flex w-full ${lineClassName}`}
            style={{
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {showLineNumbers && (
              <span className="w-8 text-right pr-2 text-text-faint select-none flex-shrink-0">
                {virtualRow.index + 1}
              </span>
            )}
            <span className="text-text whitespace-pre">{escapeHtml(lines[virtualRow.index])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThreeWayMergeEditor({
  isOpen,
  filePath,
  mineContent,
  theirsContent,
  baseContent,
  mergedContent: initialMergedContent,
  onClose,
  onSave,
}: ThreeWayMergeEditorProps) {
  const [viewMode, setViewMode] = useState<'3way' | 'unified'>('3way');
  const [conflicts, setConflicts] = useState<ConflictRegion[]>([]);
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [mergedContent, setMergedContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [editingConflictId, setEditingConflictId] = useState<string | null>(null);
  const [customEditContent, setCustomEditContent] = useState<string>('');
  const [lastSavedContent, setLastSavedContent] = useState(initialMergedContent ?? mineContent);
  const [saveError, setSaveError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceContent = initialMergedContent ?? mineContent;

  // Parse conflict markers from merged content (SVN conflict format).
  useEffect(() => {
    if (!sourceContent) return;

    const lines = sourceContent.split('\n');
    const explicitMineLines =
      mineContent && mineContent !== sourceContent ? mineContent.split('\n') : null;
    const explicitTheirsLines =
      theirsContent && theirsContent !== sourceContent ? theirsContent.split('\n') : null;
    const explicitBaseLines = baseContent ? baseContent.split('\n') : null;
    const parsedConflicts: ConflictRegion[] = [];
    let currentConflict: Partial<ConflictRegion> | null = null;
    let inMineSection = false;
    let inTheirsSection = false;
    let mineLines: string[] = [];
    let theirsLines: string[] = [];
    let baseLines: string[] = [];
    let conflictStartLine = 0;
    let conflictId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect conflict start: <<<<<<< .mine
      if (line.startsWith('<<<<<<<')) {
        currentConflict = {
          id: `conflict-${conflictId++}`,
          startLine: i,
        };
        inMineSection = true;
        inTheirsSection = false;
        mineLines = [];
        theirsLines = [];
        baseLines = [];
        conflictStartLine = i;
        continue;
      }

      // Detect separator: ======= or ------- (with revision info)
      if (line.startsWith('=======') && inMineSection) {
        inMineSection = false;
        inTheirsSection = true;
        continue;
      }

      // Detect conflict end: >>>>>>> .r123
      if (line.startsWith('>>>>>>>')) {
        if (currentConflict) {
          parsedConflicts.push({
            id: currentConflict.id!,
            startLine: conflictStartLine,
            endLine: i,
            mineContent: explicitMineLines ?? mineLines,
            theirsContent: explicitTheirsLines ?? theirsLines,
            baseContent: explicitBaseLines ?? baseLines,
            resolved: false,
            resolution: null,
          });
        }
        currentConflict = null;
        inMineSection = false;
        inTheirsSection = false;
        continue;
      }

      // Collect lines
      if (inMineSection) {
        mineLines.push(line);
      } else if (inTheirsSection) {
        theirsLines.push(line);
      }
    }

    setConflicts(parsedConflicts);
  }, [mineContent, theirsContent, baseContent, sourceContent]);

  // Build merged content based on resolutions
  const buildMergedContent = useCallback(() => {
    const lines = sourceContent.split('\n');
    const result: string[] = [];
    let skipUntil = -1;

    for (let i = 0; i < lines.length; i++) {
      // Skip conflict regions
      if (i < skipUntil) continue;

      const conflict = conflicts.find((c) => c.startLine === i);
      if (conflict) {
        // Find the resolution
        if (conflict.resolved && conflict.resolution) {
          let resolvedLines: string[];

          switch (conflict.resolution) {
            case 'mine':
              resolvedLines = conflict.mineContent;
              break;
            case 'theirs':
              resolvedLines = conflict.theirsContent;
              break;
            case 'base':
              resolvedLines = conflict.baseContent;
              break;
            case 'both-mine-first':
              resolvedLines = [...conflict.mineContent, ...conflict.theirsContent];
              break;
            case 'both-theirs-first':
              resolvedLines = [...conflict.theirsContent, ...conflict.mineContent];
              break;
            case 'custom':
              resolvedLines = conflict.customContent?.split('\n') || [];
              break;
            default:
              resolvedLines = conflict.mineContent;
          }

          result.push(...resolvedLines);
        } else {
          // Unresolved - keep conflict markers
          result.push('<<<<<<< .mine');
          result.push(...conflict.mineContent);
          result.push('=======');
          result.push(...conflict.theirsContent);
          result.push('>>>>>>> .r???');
        }

        skipUntil = conflict.endLine + 1;
        continue;
      }

      // Regular line (not in conflict)
      result.push(lines[i]);
    }

    return result.join('\n');
  }, [sourceContent, conflicts]);

  useEffect(() => {
    setLastSavedContent(sourceContent);
    setSaveError(null);
  }, [sourceContent]);

  // Update merged content when conflicts change
  useEffect(() => {
    setMergedContent(buildMergedContent());
  }, [buildMergedContent]);

  // Handle resolution
  const handleResolve = (conflictId: string, resolution: ConflictRegion['resolution']) => {
    setConflicts((prev) =>
      prev.map((c) => (c.id === conflictId ? { ...c, resolved: true, resolution } : c))
    );
  };

  // Handle custom edit
  const handleCustomEdit = (conflictId: string) => {
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;

    setEditingConflictId(conflictId);
    setCustomEditContent(conflict.mineContent.join('\n'));
  };

  const handleSaveCustomEdit = () => {
    if (!editingConflictId) return;

    setConflicts((prev) =>
      prev.map((c) =>
        c.id === editingConflictId
          ? {
              ...c,
              resolved: true,
              resolution: 'custom' as const,
              customContent: customEditContent,
            }
          : c
      )
    );
    setEditingConflictId(null);
  };

  // Navigation
  const handlePrevConflict = useCallback(() => {
    setCurrentConflictIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextConflict = useCallback(() => {
    setCurrentConflictIndex((prev) => Math.min(conflicts.length - 1, prev + 1));
  }, [conflicts.length]);

  // Auto-resolve all
  const handleAutoResolveMine = () => {
    setConflicts((prev) =>
      prev.map((c) => ({
        ...c,
        resolved: true,
        resolution: 'mine' as const,
      }))
    );
  };

  const handleAutoResolveTheirs = () => {
    setConflicts((prev) =>
      prev.map((c) => ({
        ...c,
        resolved: true,
        resolution: 'theirs' as const,
      }))
    );
  };

  // Reset all
  const handleResetAll = () => {
    setConflicts((prev) =>
      prev.map((c) => ({
        ...c,
        resolved: false,
        resolution: null,
        customContent: undefined,
      }))
    );
    setEditingConflictId(null);
    setSaveError(null);
  };

  const hasUnsavedChanges = mergedContent !== lastSavedContent;

  const requestClose = useCallback(async () => {
    if (isSaving) return;

    if (hasUnsavedChanges) {
      const discard = await confirmAppAction({
        type: 'warning',
        message: 'Discard unsaved merge changes?',
        confirmLabel: 'Discard',
      });
      if (!discard) return;
    }

    onClose();
  }, [hasUnsavedChanges, isSaving, onClose]);

  const handleRevertChanges = async () => {
    if (!hasUnsavedChanges) return;

    const revert = await confirmAppAction({
      type: 'warning',
      message: 'Revert all unsaved merge changes?',
      confirmLabel: 'Revert',
    });
    if (!revert) return;

    handleResetAll();
  };

  // Save
  const handleSave = useCallback(async () => {
    if (isSaving) return;

    const unresolvedCount = conflicts.filter((c) => !c.resolved).length;
    if (unresolvedCount > 0) {
      const proceed = await confirmAppAction({
        type: 'warning',
        message: `There are ${unresolvedCount} unresolved conflicts. Save anyway?`,
        confirmLabel: 'Save',
      });
      if (!proceed) return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(mergedContent);
      setLastSavedContent(mergedContent);
      onClose();
    } catch (err) {
      setSaveError((err as Error).message || 'Failed to save merged content');
    } finally {
      setIsSaving(false);
    }
  }, [conflicts, isSaving, mergedContent, onClose, onSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        if (editingConflictId) {
          setEditingConflictId(null);
        } else {
          void requestClose();
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
          e.preventDefault();
          handleSave();
        }
      }

      if (e.key === 'F3' && !e.shiftKey) {
        e.preventDefault();
        handleNextConflict();
      }
      if (e.shiftKey && e.key === 'F3') {
        e.preventDefault();
        handlePrevConflict();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, editingConflictId, requestClose, handleSave, handleNextConflict, handlePrevConflict]);

  // Statistics
  const resolvedCount = conflicts.filter((c) => c.resolved).length;
  const unresolvedCount = conflicts.length - resolvedCount;
  const currentConflict = conflicts[currentConflictIndex];
  const currentResolvedContent = useMemo(
    () => (currentConflict?.resolved ? getResolvedContent(currentConflict) : []),
    [currentConflict]
  );

  if (!isOpen) return null;

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div className="modal-overlay" onClick={() => void requestClose()}>
      <div
        ref={containerRef}
        className="modal w-[1400px] max-w-[98vw] h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <Columns className="w-5 h-5 text-accent" />
            Merge: {fileName}
          </h2>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center gap-1 border-r border-border pr-2 mr-2">
              <button
                onClick={() => setViewMode('3way')}
                className={`btn-icon-sm ${viewMode === '3way' ? 'bg-accent/20 text-accent' : ''}`}
                title="Three-way view"
              >
                <Columns className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('unified')}
                className={`btn-icon-sm ${viewMode === 'unified' ? 'bg-accent/20 text-accent' : ''}`}
                title="Unified view"
              >
                <Rows className="w-4 h-4" />
              </button>
            </div>

            {/* Line numbers toggle */}
            <button
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              className={`btn-icon-sm ${showLineNumbers ? '' : 'opacity-50'}`}
              title="Toggle line numbers"
            >
              {showLineNumbers ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            <button onClick={() => void requestClose()} disabled={isSaving} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Conflict navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevConflict}
                disabled={currentConflictIndex === 0}
                className="btn-icon-sm"
                title="Previous conflict (Shift+F3)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-text-secondary min-w-[100px] text-center">
                {conflicts.length > 0
                  ? `Conflict ${currentConflictIndex + 1} of ${conflicts.length}`
                  : 'No conflicts'}
              </span>
              <button
                onClick={handleNextConflict}
                disabled={currentConflictIndex >= conflicts.length - 1}
                className="btn-icon-sm"
                title="Next conflict (F3)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Status */}
            <div className="flex items-center gap-3 text-sm">
              <span className="text-svn-added flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {resolvedCount} resolved
              </span>
              {unresolvedCount > 0 && (
                <span className="text-warning flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {unresolvedCount} pending
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Auto-resolve */}
            <button onClick={handleAutoResolveMine} className="btn btn-secondary btn-sm">
              Use All Mine
            </button>
            <button onClick={handleAutoResolveTheirs} className="btn btn-secondary btn-sm">
              Use All Theirs
            </button>
            <button onClick={handleResetAll} className="btn btn-secondary btn-sm">
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {conflicts.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <CheckCircle className="w-12 h-12 text-svn-normal mx-auto mb-4" />
                <p className="text-text font-medium mb-2">No Conflicts Found</p>
                <p className="text-text-secondary text-sm">
                  The file content appears to have no merge conflicts.
                </p>
              </div>
            </div>
          ) : viewMode === '3way' ? (
            /* Three-way view */
            <div className="flex-1 overflow-hidden flex">
              {/* Base (left) */}
              <div className="flex-1 flex flex-col border-r border-border overflow-hidden">
                <div className="flex-shrink-0 px-3 py-2 bg-bg-tertiary border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">
                    Base (Common Ancestor)
                  </span>
                  <button
                    onClick={() => currentConflict && handleResolve(currentConflict.id, 'base')}
                    disabled={!currentConflict || currentConflict.resolved}
                    className="btn btn-secondary btn-sm text-xs py-1 px-2"
                  >
                    <Copy className="w-3 h-3" />
                    Use
                  </button>
                </div>
                <MergeLinePane
                  lines={currentConflict?.baseContent ?? []}
                  showLineNumbers={showLineNumbers}
                  lineClassName="text-text-secondary"
                />
              </div>

              {/* Mine (center-left) */}
              <div className="flex-1 flex flex-col border-r border-border overflow-hidden">
                <div className="flex-shrink-0 px-3 py-2 bg-bg-tertiary border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">
                    Mine (Your Changes)
                  </span>
                  <button
                    onClick={() => currentConflict && handleResolve(currentConflict.id, 'mine')}
                    disabled={!currentConflict || currentConflict.resolved}
                    className="btn btn-primary btn-sm text-xs py-1 px-2"
                  >
                    <Check className="w-3 h-3" />
                    Use Mine
                  </button>
                </div>
                <MergeLinePane
                  lines={currentConflict?.mineContent ?? []}
                  showLineNumbers={showLineNumbers}
                  lineClassName="hover:bg-accent/5"
                />
              </div>

              {/* Theirs (center-right) */}
              <div className="flex-1 flex flex-col border-r border-border overflow-hidden">
                <div className="flex-shrink-0 px-3 py-2 bg-bg-tertiary border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">Theirs (Incoming)</span>
                  <button
                    onClick={() => currentConflict && handleResolve(currentConflict.id, 'theirs')}
                    disabled={!currentConflict || currentConflict.resolved}
                    className="btn btn-primary btn-sm text-xs py-1 px-2"
                  >
                    <Check className="w-3 h-3" />
                    Use Theirs
                  </button>
                </div>
                <MergeLinePane
                  lines={currentConflict?.theirsContent ?? []}
                  showLineNumbers={showLineNumbers}
                  lineClassName="hover:bg-accent/5"
                />
              </div>

              {/* Result (right) */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-3 py-2 bg-bg-tertiary border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">Merged Result</span>
                  <div className="flex items-center gap-1">
                    {currentConflict && !currentConflict.resolved && (
                      <>
                        <button
                          onClick={() => handleResolve(currentConflict.id, 'both-mine-first')}
                          className="btn btn-secondary btn-sm text-xs py-1 px-2"
                        >
                          Mine + Theirs
                        </button>
                        <button
                          onClick={() => handleResolve(currentConflict.id, 'both-theirs-first')}
                          className="btn btn-secondary btn-sm text-xs py-1 px-2"
                        >
                          Theirs + Mine
                        </button>
                        <button
                          onClick={() => handleCustomEdit(currentConflict.id)}
                          className="btn btn-secondary btn-sm text-xs py-1 px-2"
                        >
                          Edit
                        </button>
                      </>
                    )}
                    {currentConflict?.resolved && (
                      <span className="text-xs text-svn-added flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Resolved ({currentConflict.resolution})
                      </span>
                    )}
                  </div>
                </div>
                <MergeLinePane
                  lines={currentResolvedContent}
                  showLineNumbers={showLineNumbers}
                  className="bg-bg-elevated"
                  lineClassName="bg-svn-added/10"
                  emptyMessage="Choose resolution from left panels"
                />
              </div>
            </div>
          ) : (
            /* Unified view */
            <div className="flex-1 overflow-auto p-4 font-mono text-sm">
              <pre className="whitespace-pre-wrap">{mergedContent}</pre>
            </div>
          )}
        </div>

        {/* Custom edit modal */}
        {editingConflictId && (
          <div className="absolute inset-0 bg-bg/80 flex items-center justify-center z-50">
            <div className="bg-bg-elevated border border-border rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-medium text-text">Edit Conflict Resolution</h3>
                <button onClick={() => setEditingConflictId(null)} className="btn-icon-sm">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 p-4">
                <textarea
                  ref={textareaRef}
                  value={customEditContent}
                  onChange={(e) => setCustomEditContent(e.target.value)}
                  className="w-full h-[300px] font-mono text-sm input resize-none"
                  placeholder="Enter custom merged content..."
                />
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                <button onClick={() => setEditingConflictId(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button onClick={handleSaveCustomEdit} className="btn btn-primary">
                  <Check className="w-4 h-4" />
                  Apply Custom Resolution
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 bg-bg-secondary border-t border-border flex items-center justify-between">
          <div className="text-sm text-text-muted">
            {saveError ? (
              <span className="text-error" role="alert">
                {saveError}
              </span>
            ) : (
              <>
                <span>Shortcuts: </span>
                <span className="text-text-secondary">F3</span> next conflict,
                <span className="text-text-secondary"> Shift+F3</span> previous,
                <span className="text-text-secondary"> Ctrl+S</span> save
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleRevertChanges()}
              disabled={!hasUnsavedChanges || isSaving}
              className="btn btn-secondary"
            >
              <RotateCcw className="w-4 h-4" />
              Revert Changes
            </button>
            <button
              onClick={() => void requestClose()}
              disabled={isSaving}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button onClick={handleSave} disabled={isSaving} className="btn btn-primary">
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Merged File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getResolvedContent(conflict: ConflictRegion): string[] {
  switch (conflict.resolution) {
    case 'mine':
      return conflict.mineContent;
    case 'theirs':
      return conflict.theirsContent;
    case 'base':
      return conflict.baseContent;
    case 'both-mine-first':
      return [...conflict.mineContent, ...conflict.theirsContent];
    case 'both-theirs-first':
      return [...conflict.theirsContent, ...conflict.mineContent];
    case 'custom':
      return conflict.customContent?.split('\n') || [];
    default:
      return [];
  }
}

export default ThreeWayMergeEditor;
