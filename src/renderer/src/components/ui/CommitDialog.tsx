import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  X,
  Upload,
  GitCommitHorizontal,
  FolderGit2,
  AlertCircle,
  CheckCircle,
  Eye,
  ChevronDown,
  Clock,
  FilePlus,
  RotateCcw,
  RefreshCw,
  Loader2,
  Sparkles,
  Wand2,
  AlertTriangle,
  Settings2,
  ExternalLink,
  AlignLeft,
  Columns2,
  ShieldCheck,
  SearchCheck,
  ListTree,
  Lightbulb,
} from 'lucide-react';
import { AutoCompleteInput } from './AutoCompleteInput';
import type { SvnStatusChar } from '@shared/types';
import { useCommitDialogController, type CommitFile } from '../commit/useCommitDialogController';
import { DraftTransformationBar } from '../commit/DraftTransformationBar';
import { IssueTrackerPresetPicker } from '../commit/IssueTrackerPresetPicker';
import { MessageGuide } from '../commit/MessageGuide';
import { OodCheckPanel } from '../commit/OodCheckPanel';
import { PreCommitChecklist } from '../commit/PreCommitChecklist';
import { useOutOfDateCommitGate } from '../../hooks/useWorkingCopyFreshness';
import { useSvnActions } from '../../hooks/useSvnActions';

const EnhancedDiffViewer = lazy(() =>
  import('./EnhancedDiffViewer').then((m) => ({ default: m.EnhancedDiffViewer }))
);
const VirtualizedDiffViewer = lazy(() =>
  import('./VirtualizedDiffViewer').then((m) => ({ default: m.VirtualizedDiffViewer }))
);
const CommitTemplateManager = lazy(() =>
  import('./CommitTemplateManager').then((m) => ({ default: m.CommitTemplateManager }))
);

interface CommitDialogProps {
  isOpen: boolean;
  workingCopyPath: string;
  onClose: () => void;
  onSubmit: (
    paths: string[],
    message: string
  ) => Promise<{ success: boolean; message?: string; revision?: number }>;
}

const STATUS_CONFIG: Record<SvnStatusChar, { label: string; color: string }> = {
  ' ': { label: 'Normal', color: 'text-text-muted' },
  A: { label: 'Added', color: 'text-success' },
  C: { label: 'Conflicted', color: 'text-warning' },
  D: { label: 'Deleted', color: 'text-error' },
  I: { label: 'Ignored', color: 'text-text-faint' },
  M: { label: 'Modified', color: 'text-accent' },
  R: { label: 'Replaced', color: 'text-accent' },
  X: { label: 'External', color: 'text-info' },
  '?': { label: 'Unversioned', color: 'text-text-secondary' },
  '!': { label: 'Missing', color: 'text-error' },
  '~': { label: 'Obstructed', color: 'text-warning' },
  O: { label: 'Remote only', color: 'text-info' },
};

function DiffPreviewLoader() {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted bg-bg-primary">
      <Loader2 className="w-5 h-5 animate-spin text-accent" aria-hidden="true" />
      <span className="sr-only">Loading diff preview...</span>
    </div>
  );
}

function getDiffLineCount(diff: { files?: Array<{ hunks: Array<{ lines: unknown[] }> }> }) {
  let count = 0;
  for (const file of diff.files ?? []) {
    for (const hunk of file.hunks) {
      count += hunk.lines.length;
    }
  }
  return count;
}

interface CommitFileListProps {
  files: CommitFile[];
  selectedDiffFile: string | null;
  onSelectDiffFile: (path: string) => void;
  onToggleFile: (path: string) => void;
  onRevertFile: (path: string) => void;
}

function CommitFileList({
  files,
  selectedDiffFile,
  onSelectDiffFile,
  onToggleFile,
  onRevertFile,
}: CommitFileListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    getItemKey: (index) => files[index]?.path ?? index,
    overscan: 12,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-auto"
      role="listbox"
      aria-label="Files to commit"
      aria-multiselectable="true"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          const statusInfo = STATUS_CONFIG[file.status];
          const filename = file.path.split(/[/\\]/).pop();
          const directory = file.path.slice(
            0,
            Math.max(0, file.path.length - (filename?.length ?? 0))
          );

          return (
            <div
              key={file.path}
              className={`group flex items-center gap-2.5 border-l-2 px-3 py-1.5 cursor-pointer transition-colors ${
                selectedDiffFile === file.path
                  ? 'border-l-accent bg-accent/10'
                  : 'border-l-transparent hover:bg-bg-tertiary/70'
              }`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => onSelectDiffFile(file.path)}
              role="option"
              aria-selected={file.selected}
            >
              <input
                type="checkbox"
                checked={file.selected}
                disabled={!file.committable}
                onChange={() => onToggleFile(file.path)}
                onClick={(e) => e.stopPropagation()}
                className="checkbox"
                title={file.committable ? undefined : 'Not committable from this working copy'}
                aria-label={`${file.selected ? 'Deselect' : 'Select'} ${filename}`}
              />
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-4 bg-bg-sunk text-10 font-mono font-semibold ${statusInfo.color}`}
                aria-label={statusInfo.label}
                title={statusInfo.label}
              >
                {file.status}
              </span>
              <span className="min-w-0 flex-1" title={file.path}>
                <span className="block truncate text-12.5 font-medium text-text">{filename}</span>
                {directory && (
                  <span className="block truncate text-10.5 text-text-faint">{directory}</span>
                )}
              </span>
              {file.propsStatus && (
                <span
                  className="text-[10px] rounded border border-border px-1 text-text-muted"
                  title="Property status"
                >
                  P:{file.propsStatus}
                </span>
              )}
              {file.changelist && (
                <span
                  className="max-w-[90px] truncate text-[10px] rounded border border-border px-1 text-text-muted"
                  title={`Changelist: ${file.changelist}`}
                >
                  {file.changelist}
                </span>
              )}
              {!file.committable && (
                <span className="text-[10px] text-text-faint" title="Display only">
                  Display only
                </span>
              )}
              {file.status !== '?' && file.status !== 'A' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevertFile(file.path);
                  }}
                  className="btn-icon-sm opacity-0 group-hover:opacity-100"
                  title="Revert this file"
                  aria-label={`Revert ${filename}`}
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CommitDialog({ isOpen, workingCopyPath, onClose, onSubmit }: CommitDialogProps) {
  const {
    message,
    handleMessageChange,
    isSubmitting,
    isGeneratingMessage,
    isRunningAiAssistant,
    isLoadingAiProviders,
    aiProviderAvailable,
    aiProviderName,
    aiModelName,
    aiProviderReason,
    showAiConsent,
    setShowAiConsent,
    aiPromptPreview,
    isPreparingAiPrompt,
    aiError,
    aiGenerationNotice,
    enabledDraftTransformations,
    aiReview,
    aiCommitPlan,
    aiDiffExplanation,
    aiExplanationMode,
    setAiExplanationMode,
    error,
    success,
    selectedDiffFile,
    setSelectedDiffFile,
    showTemplates,
    setShowTemplates,
    showHistory,
    setShowHistory,
    showTemplateManager,
    setShowTemplateManager,
    fileFilter,
    setFileFilter,
    diffViewMode,
    setDiffViewMode,
    showSuggestions,
    setShowSuggestions,
    showRules,
    setShowRules,
    validationWarnings,
    commitWarnings,
    textareaRef,
    history,
    recentMessages,
    templates,
    issueTrackerConfig,
    updateIssueTrackerConfig,
    effectiveIssueTrackerConfig,
    issuePatternFromProfile,
    profileSubjectMaxLength,
    rules,
    updateRules,
    isLoadingStatus,
    files,
    refetch,
    aiSuggestions,
    templateRecommendations,
    autocompleteOptions,
    diffData,
    filteredFiles,
    selectedCount,
    committableCount,
    ruleErrors,
    issueLinks,
    modalRef,
    dialogId,
    titleId,
    descriptionId,
    handleToggleFile,
    handleSelectAll,
    handleDeselectAll,
    handleRevertFile,
    handleTemplateSelect,
    handleManagedTemplateSelect,
    handleHistorySelect,
    handleApplySuggestion,
    handleApplyRecommendation,
    handleGenerateMessage,
    handleTransformDraft,
    handleConfirmAiGeneration,
    handleReviewCommit,
    handlePlanCommit,
    handleExplainDiff,
    handleApplyCommitGroup,
    handleCreateGroupChangelist,
    cancelAiAssistant,
    cancelMessageGeneration,
    handleIssuePatternChange,
    handleOpenIssue,
    handleSubmit,
    handleClose,
  } = useCommitDialogController({ isOpen, workingCopyPath, onClose, onSubmit });

  /*
   * Out-of-date gate in front of the controller's submit path. The check is a
   * repository round trip, so it runs only after the dialog's own validation
   * would let a commit start, and every non-conclusive answer (offline, auth,
   * cancelled, skipped) falls straight through to `handleSubmit` untouched.
   * "Update and retry" reuses `useSvnActions().update` — the same action the
   * Files toolbar runs — then re-runs the commit flow exactly once.
   */
  const { update } = useSvnActions();
  const {
    state: oodState,
    gateSubmit,
    updateAndRetry,
    commitAnyway,
    cancel: cancelOodCheck,
    skipCheck,
    reset: resetOodGate,
  } = useOutOfDateCommitGate({
    workingCopyPath,
    isCommitReady: () => Boolean(message.trim()) && selectedCount > 0 && ruleErrors.length === 0,
    /*
     * The visible list; a file hidden by the filter dropdown stays selected
     * for commit, but the working copy's own out-of-date entry (".") is
     * always checked too, which is the case Subversion itself rejects.
     */
    getSelectedPaths: () =>
      filteredFiles.filter((file) => file.selected && file.committable).map((file) => file.path),
    runCommit: (event) => handleSubmit(event),
    runUpdate: () => update(workingCopyPath),
    onUpdated: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (!isOpen) resetOodGate();
  }, [isOpen, resetOodGate]);

  /** Selected, committable files the pre-commit checklist scans (#75). */
  const checklistFiles = useMemo(
    () =>
      files
        .filter((file) => file.selected && file.committable)
        .map((file) => ({ path: file.path, isDirectory: file.isDirectory })),
    [files]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} role="presentation">
      <div
        ref={modalRef}
        className="modal flex h-[min(780px,calc(100vh-48px))] w-[min(1120px,calc(100vw-48px))] max-h-[calc(100vh-48px)] flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        id={dialogId}
      >
        {/* Header */}
        <div className="modal-header bg-bg-secondary/80 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-9 border border-accent/20 bg-accent/10 text-accent">
              <GitCommitHorizontal className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="text-18 font-semibold text-text">
                  Commit changes
                </h2>
                <span className="rounded-pill border border-border bg-bg-sunk px-2 py-0.5 text-10.5 font-medium text-text-muted">
                  {selectedCount} selected
                </span>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-11 text-text-faint">
                <FolderGit2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" title={workingCopyPath}>
                  {workingCopyPath}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Screen reader description */}
        <p id={descriptionId} className="sr-only">
          Select files to commit and enter a commit message
        </p>

        {/* Content */}
        {success ? (
          <div className="modal-body" role="status" aria-live="polite">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Committed Successfully</h3>
              <p className="text-text-secondary mb-6">Revision {success.revision}</p>
              <button onClick={onClose} className="btn btn-primary" aria-label="Close and finish">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={gateSubmit}
            aria-label="Commit form"
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1">
              {/* Left panel - File list */}
              <div
                className="w-[340px] shrink-0 border-r border-border bg-bg-secondary/35 flex flex-col"
                role="region"
                aria-label="Files to commit"
              >
                {/* File filter */}
                <div className="border-b border-border bg-bg-tertiary/60 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-10 font-semibold uppercase tracking-caps text-text-muted">
                      Changed paths
                    </span>
                    <span className="font-mono text-10.5 text-text-faint">{committableCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="file-filter" className="sr-only">
                      Filter files by status
                    </label>
                    <select
                      id="file-filter"
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value as typeof fileFilter)}
                      className="input text-xs py-1 flex-1"
                      aria-label="Filter files"
                    >
                      <option value="all">All files</option>
                      <option value="modified">Modified</option>
                      <option value="added">Added/Unversioned</option>
                      <option value="deleted">Deleted</option>
                      <option value="changelist">Changelist</option>
                      <option value="external">Externals</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="btn-icon-sm"
                      title="Refresh"
                      aria-label="Refresh file list"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Select all/none */}
                <div
                  className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-11"
                  role="group"
                  aria-label="Selection controls"
                >
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="rounded-5 px-2 py-1 text-accent hover:bg-accent/10"
                    aria-label="Select all files"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="rounded-5 px-2 py-1 text-text-muted hover:bg-bg-tertiary hover:text-text"
                    aria-label="Deselect all files"
                  >
                    Select none
                  </button>
                  <span
                    className="ml-auto font-mono text-10.5 text-text-faint"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {selectedCount}/{committableCount}
                  </span>
                </div>

                {/* File list */}
                {isLoadingStatus ? (
                  <div
                    className="flex-1 flex items-center justify-center"
                    role="status"
                    aria-label="Loading files"
                  >
                    <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                    <span className="sr-only">Loading files...</span>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div
                    className="flex-1 flex items-center justify-center text-text-muted text-sm"
                    role="status"
                  >
                    No files to commit
                  </div>
                ) : (
                  <CommitFileList
                    files={filteredFiles}
                    selectedDiffFile={selectedDiffFile}
                    onSelectDiffFile={setSelectedDiffFile}
                    onToggleFile={handleToggleFile}
                    onRevertFile={handleRevertFile}
                  />
                )}
              </div>

              {/* Right panel - Message and diff */}
              <div
                className="flex-1 flex flex-col"
                role="region"
                aria-label="Commit message and diff"
              >
                {/* Commit message area */}
                <div className="border-b border-border bg-bg-secondary/20 p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <label
                      htmlFor="commit-message"
                      className="text-10 font-semibold uppercase tracking-caps text-text-muted"
                    >
                      Message{' '}
                      <span className="text-error" aria-label="required">
                        *
                      </span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      {/* Quick suggestions */}
                      {selectedCount > 0 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setShowSuggestions(!showSuggestions);
                              setShowTemplates(false);
                              setShowHistory(false);
                            }}
                            className="btn btn-sm text-xs bg-accent/10 text-accent hover:bg-accent/20 border-accent/30"
                            aria-expanded={showSuggestions}
                            aria-haspopup="menu"
                            aria-label="Quick commit message suggestions"
                          >
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            Suggest
                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                          </button>
                          {showSuggestions && (
                            <ul
                              className="absolute right-0 top-full mt-1 w-64 bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                              role="menu"
                              aria-label="Quick suggestions"
                            >
                              <li className="px-3 py-1.5 text-xs text-text-muted bg-bg-tertiary border-b border-border rounded-t-lg flex items-center gap-1">
                                <Wand2 className="w-3 h-3" />
                                Based on your changes
                              </li>
                              {aiSuggestions.map((suggestion, i) => (
                                <li key={i}>
                                  <button
                                    type="button"
                                    onClick={() => handleApplySuggestion(suggestion)}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-tertiary border-b border-border last:border-b-0"
                                    role="menuitem"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-text">
                                        {suggestion.prefix}: {suggestion.description}
                                      </span>
                                      <span className="text-accent text-[10px]">
                                        {Math.round(suggestion.confidence * 100)}%
                                      </span>
                                    </div>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Commit rules */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowRules(!showRules);
                            setShowTemplates(false);
                            setShowHistory(false);
                            setShowSuggestions(false);
                          }}
                          className="btn btn-secondary btn-sm text-xs"
                          aria-expanded={showRules}
                          aria-haspopup="dialog"
                          aria-label="Commit rules"
                        >
                          <Settings2 className="w-3 h-3" aria-hidden="true" />
                          Rules
                        </button>
                        {showRules && (
                          <div
                            className="absolute right-0 top-full mt-1 w-80 bg-bg-elevated border border-border rounded-lg shadow-lg z-10 p-3 space-y-3"
                            role="dialog"
                            aria-label="Commit rules"
                          >
                            <label className="block">
                              <span className="text-xs font-medium text-text-secondary">
                                Minimum message length
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={500}
                                value={rules.minMessageLength}
                                onChange={(e) =>
                                  updateRules({ minMessageLength: Number(e.target.value) })
                                }
                                className="input mt-1 w-full text-sm"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-sm text-text">
                              <input
                                type="checkbox"
                                checked={rules.requireIssueId}
                                onChange={(e) => updateRules({ requireIssueId: e.target.checked })}
                                className="checkbox"
                              />
                              Require issue ID
                            </label>
                            <label className="block">
                              <span className="text-xs font-medium text-text-secondary">
                                Issue ID pattern
                              </span>
                              <input
                                type="text"
                                value={rules.issueIdPattern}
                                onChange={(e) => handleIssuePatternChange(e.target.value)}
                                className="input mt-1 w-full text-sm font-mono"
                                placeholder="[A-Z]+-\\d+"
                              />
                            </label>
                            <div className="border-t border-border pt-3 space-y-3">
                              <div className="text-xs font-medium text-text-secondary">
                                Issue tracker
                              </div>
                              <label className="flex items-center gap-2 text-sm text-text">
                                <input
                                  type="checkbox"
                                  checked={issueTrackerConfig.enabled}
                                  onChange={(e) =>
                                    updateIssueTrackerConfig({ enabled: e.target.checked })
                                  }
                                  className="checkbox"
                                />
                                Link issue IDs in messages
                              </label>
                              <label className="block">
                                <span className="text-xs font-medium text-text-secondary">
                                  Issue URL template
                                </span>
                                <input
                                  type="url"
                                  value={issueTrackerConfig.issueUrlTemplate}
                                  onChange={(e) =>
                                    updateIssueTrackerConfig({
                                      issueUrlTemplate: e.target.value,
                                    })
                                  }
                                  className="input mt-1 w-full text-sm"
                                  placeholder="https://tracker.example.com/browse/{id}"
                                />
                              </label>
                              <p className="text-xs text-text-faint">
                                Use {'{id}'} or {'{issue}'} where the issue ID belongs.
                              </p>
                              {/* Provider presets (#74): derive the pattern and
                                  URL template from a Jira/GitHub base URL. */}
                              <IssueTrackerPresetPicker
                                workingCopyPath={workingCopyPath}
                                config={effectiveIssueTrackerConfig}
                                onApply={(updates) => updateIssueTrackerConfig(updates)}
                              />
                              {issuePatternFromProfile && (
                                <p className="text-xs text-text-faint">
                                  Issue pattern defaults to the repository profile (
                                  <span className="font-mono">{issuePatternFromProfile}</span>);
                                  edit the pattern above to override it.
                                </p>
                              )}
                            </div>
                            <p className="text-xs text-text-faint">
                              Rules and tracker settings are saved for this working copy.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Templates dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowTemplates(!showTemplates);
                            setShowHistory(false);
                            setShowSuggestions(false);
                            setShowTemplateManager(false);
                          }}
                          className="btn btn-secondary btn-sm text-xs"
                          aria-expanded={showTemplates}
                          aria-haspopup="menu"
                          aria-label="Insert commit template"
                        >
                          <FilePlus className="w-3 h-3" aria-hidden="true" />
                          Templates
                          <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        </button>
                        {showTemplates && (
                          <ul
                            className="absolute right-0 top-full mt-1 w-56 bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                            role="menu"
                            aria-label="Commit templates"
                          >
                            {/* Recommended template */}
                            {templateRecommendations.length > 0 &&
                              templateRecommendations[0].confidence > 0 && (
                                <li>
                                  <div className="px-3 py-1.5 text-xs text-accent bg-accent/10 border-b border-border flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    Recommended for your changes
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApplyRecommendation(templateRecommendations[0])
                                    }
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-tertiary bg-accent/5"
                                    role="menuitem"
                                  >
                                    <div className="font-medium text-text">
                                      {templateRecommendations[0].name}
                                    </div>
                                    <div className="text-text-muted text-[10px]">
                                      {templateRecommendations[0].reason}
                                    </div>
                                  </button>
                                  <div className="border-b border-border" />
                                </li>
                              )}
                            {templates.map((t) => (
                              <li key={t.id}>
                                <button
                                  type="button"
                                  onClick={() => handleTemplateSelect(t.id)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary first:rounded-t-lg last:rounded-b-lg"
                                  role="menuitem"
                                >
                                  {t.name}
                                </button>
                              </li>
                            ))}
                            <li className="border-t border-border">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowTemplates(false);
                                  setShowTemplateManager(true);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary rounded-b-lg"
                                role="menuitem"
                              >
                                Manage templates
                              </button>
                            </li>
                            <li
                              className="px-3 py-1.5 text-10 text-text-faint border-t border-border"
                              aria-hidden="true"
                            >
                              Variables: {'{{branch}} {{date}} {{issue}} {{files}}'} — substituted
                              when applied.
                            </li>
                          </ul>
                        )}
                        {showTemplateManager && (
                          <div className="absolute right-0 top-full mt-1 w-[520px] max-h-[420px] overflow-auto bg-bg-elevated border border-border rounded-lg shadow-lg z-20">
                            <Suspense fallback={<DiffPreviewLoader />}>
                              <CommitTemplateManager
                                repositoryPath={workingCopyPath}
                                onSelectTemplate={handleManagedTemplateSelect}
                              />
                            </Suspense>
                          </div>
                        )}
                      </div>

                      {/* History dropdown — per-working-copy recall first, then
                          the global history (#73a). */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowHistory(!showHistory);
                            setShowTemplates(false);
                            setShowSuggestions(false);
                          }}
                          className="btn btn-secondary btn-sm text-xs"
                          disabled={history.length === 0 && recentMessages.length === 0}
                          aria-expanded={showHistory}
                          aria-haspopup="menu"
                          aria-label="Insert from commit history"
                          aria-disabled={history.length === 0 && recentMessages.length === 0}
                        >
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          History
                          <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        </button>
                        {showHistory && (history.length > 0 || recentMessages.length > 0) && (
                          <ul
                            className="absolute right-0 top-full mt-1 w-72 max-h-64 overflow-auto bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                            role="menu"
                            aria-label="Recent commit messages"
                          >
                            {recentMessages.length > 0 && (
                              <li
                                className="px-3 py-1 text-9.5 font-semibold uppercase tracking-caps text-text-faint bg-bg-tertiary sticky top-0"
                                aria-hidden="true"
                              >
                                This working copy
                              </li>
                            )}
                            {recentMessages.slice(0, 20).map((entry) => (
                              <li key={`recent-${entry.timestamp}`}>
                                <button
                                  type="button"
                                  onClick={() => handleHistorySelect(entry.message)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-tertiary border-b border-border last:border-b-0"
                                  role="menuitem"
                                >
                                  <div className="truncate text-text">{entry.message}</div>
                                  <div className="text-text-faint text-xs mt-0.5">
                                    {new Date(entry.timestamp).toLocaleDateString()}
                                  </div>
                                </button>
                              </li>
                            ))}
                            {history.length > 0 && (
                              <li
                                className="px-3 py-1 text-9.5 font-semibold uppercase tracking-caps text-text-faint bg-bg-tertiary sticky top-0"
                                aria-hidden="true"
                              >
                                All working copies
                              </li>
                            )}
                            {history.slice(0, 10).map((h, i) => (
                              <li key={`global-${h.timestamp}-${i}`}>
                                <button
                                  type="button"
                                  onClick={() => handleHistorySelect(h.message)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-tertiary border-b border-border last:border-b-0"
                                  role="menuitem"
                                >
                                  <div className="truncate text-text">{h.message}</div>
                                  <div className="text-text-faint text-xs mt-0.5">
                                    {new Date(h.timestamp).toLocaleDateString()}
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedCount > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-9 border border-accent/20 bg-gradient-to-r from-accent/10 to-transparent px-3 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-7 bg-accent/15 text-accent">
                        {isGeneratingMessage ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="h-4 w-4" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-12.5 font-medium text-text">
                          Draft with AI
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${aiProviderAvailable ? 'bg-success' : 'bg-text-faint'}`}
                            aria-hidden="true"
                          />
                        </div>
                        <p className="truncate text-10.5 text-text-muted">
                          {isLoadingAiProviders
                            ? 'Checking provider…'
                            : aiProviderAvailable
                              ? `${aiProviderName}${aiModelName ? ` · ${aiModelName}` : ''} · selected diff only`
                              : aiProviderReason || 'Configure an AI provider in Settings'}
                        </p>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
                        <button
                          type="button"
                          onClick={handleReviewCommit}
                          className="btn btn-secondary btn-sm text-11.5"
                          disabled={isRunningAiAssistant || !aiProviderAvailable}
                          title="Review selected changes for risks and omissions"
                        >
                          <SearchCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={handlePlanCommit}
                          className="btn btn-secondary btn-sm text-11.5"
                          disabled={isRunningAiAssistant || !aiProviderAvailable}
                          title="Group selected changes into logical commits"
                        >
                          <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                          Plan
                        </button>
                        <button
                          type="button"
                          onClick={
                            isGeneratingMessage ? cancelMessageGeneration : handleGenerateMessage
                          }
                          className="btn btn-primary btn-sm min-w-[116px] text-11.5"
                          disabled={
                            !isGeneratingMessage && (isLoadingAiProviders || !aiProviderAvailable)
                          }
                          aria-label={
                            isGeneratingMessage
                              ? 'Cancel commit message generation'
                              : `Generate commit message with ${aiProviderName}`
                          }
                          aria-busy={isGeneratingMessage}
                        >
                          {isGeneratingMessage ? 'Cancel' : 'Generate draft'}
                        </button>
                        {isRunningAiAssistant && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm text-11.5"
                            onClick={cancelAiAssistant}
                          >
                            Cancel analysis
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Autocomplete textarea — native spellcheck underlines
                      suspect words; MessageGuide adds the length/word counts. */}
                  <AutoCompleteInput
                    value={message}
                    onChange={handleMessageChange}
                    suggestions={autocompleteOptions}
                    placeholder="Enter commit message...&#10;&#10;Start typing for suggestions or use the buttons above."
                    disabled={isSubmitting}
                    inputClassName="h-24 text-13 leading-relaxed"
                    showCategories={true}
                    spellCheck={true}
                    textareaRef={textareaRef}
                    minChars={1}
                    openOnFocus={false}
                    aria-label="Commit message"
                    id="commit-message"
                  />

                  <MessageGuide
                    message={message}
                    subjectMaxLength={profileSubjectMaxLength}
                    className="mt-1"
                  />

                  {message.trim() && enabledDraftTransformations.length > 0 && (
                    <DraftTransformationBar
                      transformations={enabledDraftTransformations}
                      disabled={isGeneratingMessage || isSubmitting || !aiProviderAvailable}
                      onTransform={handleTransformDraft}
                    />
                  )}

                  {showAiConsent && (
                    <div
                      className="mt-2 rounded border border-accent/30 bg-accent/5 p-3 text-xs"
                      role="dialog"
                      aria-label="Confirm commit message generation"
                    >
                      <p className="text-text-secondary">
                        Selected file paths and their bounded text diff will be sent to the
                        configured {aiProviderName} CLI. Binary content is omitted and possible
                        secrets are redacted. The result will remain editable and will never be
                        committed automatically.
                      </p>
                      {isPreparingAiPrompt ? (
                        <div className="mt-3 flex items-center gap-2 rounded-7 border border-border bg-bg-sunk px-3 py-4 text-text-muted">
                          <Loader2
                            className="h-4 w-4 animate-spin text-accent motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          Preparing the bounded, redacted prompt…
                        </div>
                      ) : aiPromptPreview ? (
                        <div className="mt-3 overflow-hidden rounded-7 border border-border bg-bg-sunk">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-10 text-text-faint">
                            <span className="font-medium uppercase tracking-caps text-accent">
                              Exact payload preview
                            </span>
                            <span>
                              {aiPromptPreview.provider}
                              {aiPromptPreview.model ? ` · ${aiPromptPreview.model}` : ''}
                            </span>
                            <span>{(aiPromptPreview.inputBytes / 1024).toFixed(1)} KiB</span>
                            {aiPromptPreview.redacted && (
                              <span className="text-warning">Secrets redacted</span>
                            )}
                            {aiPromptPreview.truncated && (
                              <span className="text-warning">Input truncated</span>
                            )}
                            {aiPromptPreview.includedHistoryMessages > 0 && (
                              <span>
                                {aiPromptPreview.includedHistoryMessages} history messages
                              </span>
                            )}
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-10.5 leading-relaxed text-text-secondary">
                            {aiPromptPreview.prompt}
                          </pre>
                        </div>
                      ) : null}
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm text-xs"
                          onClick={() => setShowAiConsent(false)}
                        >
                          Not now
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm text-xs"
                          onClick={() => void handleConfirmAiGeneration(true)}
                          disabled={isPreparingAiPrompt || !aiPromptPreview}
                        >
                          Always allow
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm text-xs"
                          onClick={() => void handleConfirmAiGeneration(false)}
                          disabled={isPreparingAiPrompt || !aiPromptPreview}
                        >
                          Send changes
                        </button>
                      </div>
                    </div>
                  )}

                  {aiError && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-error" role="alert">
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                      <span>{aiError}</span>
                    </div>
                  )}

                  {aiGenerationNotice && (
                    <div className="mt-2 text-xs text-text-muted" role="status" aria-live="polite">
                      {aiGenerationNotice}
                    </div>
                  )}

                  {aiReview && (
                    <section
                      className="mt-2 max-h-44 overflow-auto rounded-9 border border-border bg-bg-sunk/70 p-3"
                      aria-live="polite"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-11 font-semibold uppercase tracking-caps text-text-muted">
                            <SearchCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                            Pre-commit review
                          </div>
                          <p className="mt-1 text-12 text-text-secondary">{aiReview.summary}</p>
                        </div>
                        <span className="shrink-0 text-10 text-text-faint">
                          {aiReview.provider}
                          {aiReview.model ? ` · ${aiReview.model}` : ''} ·{' '}
                          {(aiReview.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      {aiReview.findings.length === 0 ? (
                        <p className="text-11.5 text-success">
                          No notable findings in the selected diff.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {aiReview.findings.map((finding) => (
                            <button
                              key={finding.id}
                              type="button"
                              onClick={() =>
                                finding.filePath && setSelectedDiffFile(finding.filePath)
                              }
                              className="flex w-full items-start gap-2 rounded-7 border border-border-muted bg-bg-secondary/70 px-2.5 py-2 text-left hover:border-accent/40"
                            >
                              <span
                                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${finding.severity === 'danger' ? 'bg-error' : finding.severity === 'warning' ? 'bg-warning' : 'bg-info'}`}
                                aria-hidden="true"
                              />
                              <span className="min-w-0">
                                <span className="block text-11.5 font-medium text-text">
                                  {finding.title}
                                </span>
                                <span className="block font-mono text-9 uppercase tracking-wider text-text-faint">
                                  {finding.severity} severity · {finding.category}
                                </span>
                                <span className="block text-10.5 text-text-muted">
                                  {finding.detail}
                                </span>
                                {finding.filePath && (
                                  <span className="block truncate font-mono text-9.5 text-text-faint">
                                    {finding.filePath}
                                    {finding.line > 0 ? `:${finding.line}` : ''}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {aiCommitPlan && (
                    <section
                      className="mt-2 max-h-52 overflow-auto rounded-9 border border-border bg-bg-sunk/70 p-3"
                      aria-live="polite"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-11 font-semibold uppercase tracking-caps text-text-muted">
                            <ListTree className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                            Logical commit plan
                          </div>
                          <p className="mt-1 text-12 text-text-secondary">{aiCommitPlan.summary}</p>
                        </div>
                        <span className="shrink-0 text-10 text-text-faint">
                          {aiCommitPlan.groups.length} groups ·{' '}
                          {(aiCommitPlan.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <div className="space-y-2">
                        {aiCommitPlan.groups.map((group) => (
                          <article
                            key={group.id}
                            className="rounded-7 border border-border-muted bg-bg-secondary/70 p-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="text-11.5 font-medium text-text">{group.title}</h4>
                                <p className="text-10.5 text-text-muted">{group.description}</p>
                                <p className="mt-1 truncate font-mono text-9.5 text-text-faint">
                                  {group.paths.length} file{group.paths.length === 1 ? '' : 's'} ·{' '}
                                  {group.suggestedMessage}
                                </p>
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm text-10.5"
                                  onClick={() => handleApplyCommitGroup(group.id)}
                                >
                                  Use group
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm text-10.5"
                                  onClick={() => void handleCreateGroupChangelist(group.id)}
                                >
                                  Changelist
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Validation warnings */}
                  {validationWarnings.length > 0 && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-warning">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <ul className="list-disc list-inside">
                        {validationWarnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {commitWarnings.length > 0 && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-warning">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <ul className="list-disc list-inside">
                        {commitWarnings.map((warning) => (
                          <li
                            key={warning.id}
                            className={
                              warning.severity === 'danger'
                                ? 'text-error'
                                : warning.severity === 'info'
                                  ? 'text-text-muted'
                                  : undefined
                            }
                          >
                            {warning.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ruleErrors.length > 0 && (
                    <div className="mt-2 flex items-start gap-2 text-xs text-error">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <ul className="list-disc list-inside">
                        {ruleErrors.map((ruleError, i) => (
                          <li key={i}>{ruleError}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {issueLinks.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-text-faint">Issues:</span>
                      {issueLinks.map((issue) =>
                        issue.url ? (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => handleOpenIssue(issue.url)}
                            className="inline-flex items-center gap-1 rounded border border-border bg-bg-secondary px-2 py-1 text-accent hover:bg-bg-tertiary"
                            title={issue.url}
                          >
                            {issue.id}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : (
                          <span
                            key={issue.id}
                            className="rounded border border-border bg-bg-secondary px-2 py-1 text-text-secondary"
                          >
                            {issue.id}
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {/* Pre-commit checklist (#75) — advisory only. Findings never
                      disable the submit button; the out-of-date gate further
                      below keeps its submit-blocking semantics untouched. */}
                  <PreCommitChecklist
                    files={checklistFiles}
                    disabled={isSubmitting}
                    className="mt-2"
                  />
                </div>

                {/* Diff preview with enhanced viewer */}
                <div
                  className="flex-1 overflow-hidden flex flex-col"
                  role="region"
                  aria-label="File diff preview"
                >
                  {selectedDiffFile ? (
                    diffData?.files && diffData.files.length > 0 ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-3 py-2">
                          <div
                            className="truncate text-xs text-text-muted"
                            title={selectedDiffFile}
                          >
                            {selectedDiffFile}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={aiExplanationMode}
                              onChange={(event) =>
                                setAiExplanationMode(event.target.value as typeof aiExplanationMode)
                              }
                              className="input h-7 py-0 text-10.5"
                              aria-label="Diff explanation type"
                            >
                              <option value="summary">Summarize file</option>
                              <option value="why">Why it changed</option>
                              <option value="risks">Risky lines</option>
                              <option value="questions">Review questions</option>
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm text-10.5"
                              onClick={() => void handleExplainDiff()}
                              disabled={!aiProviderAvailable || isRunningAiAssistant}
                            >
                              {isRunningAiAssistant ? (
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Lightbulb className="h-3.5 w-3.5" />
                              )}
                              Explain
                            </button>
                            <div className="flex items-center bg-bg rounded-md p-0.5">
                              <button
                                type="button"
                                onClick={() => setDiffViewMode('unified')}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-fast ${
                                  diffViewMode === 'unified'
                                    ? 'bg-accent text-white'
                                    : 'text-text-secondary hover:text-text'
                                }`}
                                aria-pressed={diffViewMode === 'unified'}
                                title="Unified diff view"
                              >
                                <AlignLeft className="w-3.5 h-3.5" />
                                Unified
                              </button>
                              <button
                                type="button"
                                onClick={() => setDiffViewMode('side-by-side')}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-fast ${
                                  diffViewMode === 'side-by-side'
                                    ? 'bg-accent text-white'
                                    : 'text-text-secondary hover:text-text'
                                }`}
                                aria-pressed={diffViewMode === 'side-by-side'}
                                title="Side-by-side diff view"
                              >
                                <Columns2 className="w-3.5 h-3.5" />
                                Split
                              </button>
                            </div>
                          </div>
                        </div>
                        {aiDiffExplanation && (
                          <section
                            className="border-b border-border bg-bg-secondary px-3 py-2.5 text-11.5"
                            aria-live="polite"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-text">{aiDiffExplanation.summary}</p>
                                {aiDiffExplanation.rationale && (
                                  <p className="mt-1 text-text-muted">
                                    {aiDiffExplanation.rationale}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 text-9.5 text-text-faint">
                                {aiDiffExplanation.cached
                                  ? 'Cached'
                                  : `${(aiDiffExplanation.durationMs / 1000).toFixed(1)}s`}
                              </span>
                            </div>
                            {(aiDiffExplanation.risks.length > 0 ||
                              aiDiffExplanation.reviewQuestions.length > 0) && (
                              <div className="mt-2 grid grid-cols-1 gap-3 text-10.5 text-text-secondary sm:grid-cols-2">
                                {aiDiffExplanation.risks.length > 0 && (
                                  <div>
                                    <span className="font-medium text-warning">Risks</span>
                                    <ul className="mt-1 list-disc pl-4">
                                      {aiDiffExplanation.risks.map((risk) => (
                                        <li key={risk}>{risk}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {aiDiffExplanation.reviewQuestions.length > 0 && (
                                  <div>
                                    <span className="font-medium text-accent">
                                      Review questions
                                    </span>
                                    <ul className="mt-1 list-disc pl-4">
                                      {aiDiffExplanation.reviewQuestions.map((question) => (
                                        <li key={question}>{question}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </section>
                        )}
                        <Suspense fallback={<DiffPreviewLoader />}>
                          {diffViewMode === 'unified' || getDiffLineCount(diffData) > 2000 ? (
                            <VirtualizedDiffViewer diff={diffData} className="flex-1 min-h-0" />
                          ) : (
                            <EnhancedDiffViewer
                              diff={diffData}
                              filePath={selectedDiffFile}
                              mode={diffViewMode}
                              onModeChange={setDiffViewMode}
                              className="flex-1 min-h-0"
                            />
                          )}
                        </Suspense>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-text-muted bg-bg-primary">
                        <div className="text-center">
                          <Eye className="w-8 h-8 mx-auto mb-2 text-text-faint" />
                          <p>No diff available</p>
                          <p className="text-xs text-text-faint mt-1">Binary file or unversioned</p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-bg-primary">
                      <div className="text-center text-text-muted">
                        <Eye className="w-8 h-8 mx-auto mb-2 text-text-faint" />
                        <p>Select a file to view changes</p>
                        <p className="text-xs text-text-faint mt-1">
                          Click on any file in the list to see its diff
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="mx-4 my-2 flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2"
                role="alert"
                aria-live="assertive"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Out-of-date check — holds the commit only when the repository
                is provably ahead for the selected paths. */}
            <OodCheckPanel
              phase={oodState.phase}
              incoming={oodState.incoming}
              error={oodState.error}
              selectedCount={selectedCount}
              onUpdateAndRetry={() => void updateAndRetry()}
              onCommitAnyway={commitAnyway}
              onCancel={cancelOodCheck}
              onSkipCheck={() => skipCheck()}
            />

            {/* Footer */}
            <div className="modal-footer bg-bg-secondary/80 py-3">
              <div
                className="flex flex-1 items-center gap-2 text-11.5 text-text-muted"
                aria-live="polite"
              >
                <ShieldCheck
                  className={`h-4 w-4 ${ruleErrors.length > 0 ? 'text-error' : 'text-success'}`}
                  aria-hidden="true"
                />
                {ruleErrors.length > 0
                  ? `${ruleErrors.length} commit rule${ruleErrors.length === 1 ? '' : 's'} need attention`
                  : `${selectedCount} file${selectedCount !== 1 ? 's' : ''} ready to commit`}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-secondary"
                disabled={isSubmitting}
                aria-label="Cancel commit"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  isSubmitting ||
                  !message.trim() ||
                  selectedCount === 0 ||
                  ruleErrors.length > 0 ||
                  oodState.phase === 'checking' ||
                  oodState.phase === 'updating' ||
                  oodState.phase === 'blocked'
                }
                aria-label={
                  isSubmitting
                    ? 'Committing changes...'
                    : `Commit ${selectedCount} file${selectedCount !== 1 ? 's' : ''}`
                }
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Committing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" aria-hidden="true" />
                    Commit {selectedCount} {selectedCount === 1 ? 'file' : 'files'}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
