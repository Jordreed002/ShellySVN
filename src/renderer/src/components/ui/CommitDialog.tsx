import {
  X,
  Upload,
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
} from 'lucide-react';
import { AutoCompleteInput } from './AutoCompleteInput';
import { EnhancedDiffViewer } from './EnhancedDiffViewer';
import type { SvnStatusChar } from '@shared/types';
import { useCommitDialogController } from '../commit/useCommitDialogController';

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
};

export function CommitDialog({ isOpen, workingCopyPath, onClose, onSubmit }: CommitDialogProps) {
  const {
    message,
    setMessage,
    isSubmitting,
    error,
    success,
    selectedDiffFile,
    setSelectedDiffFile,
    showTemplates,
    setShowTemplates,
    showHistory,
    setShowHistory,
    fileFilter,
    setFileFilter,
    diffViewMode,
    setDiffViewMode,
    showSuggestions,
    setShowSuggestions,
    showRules,
    setShowRules,
    validationWarnings,
    history,
    templates,
    issueTrackerConfig,
    updateIssueTrackerConfig,
    rules,
    isLoadingStatus,
    aiSuggestions,
    templateRecommendations,
    autocompleteOptions,
    diffData,
    filteredFiles,
    selectedCount,
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
    handleHistorySelect,
    handleApplySuggestion,
    handleApplyRecommendation,
    handleIssuePatternChange,
    handleOpenIssue,
    handleSubmit,
    handleClose,
  } = useCommitDialogController({ isOpen, workingCopyPath, onClose, onSubmit });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} role="presentation">
      <div
        ref={modalRef}
        className="modal w-[900px] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        id={dialogId}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            <Upload className="w-5 h-5 text-accent" aria-hidden="true" />
            Commit Changes
          </h2>
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
          <form onSubmit={handleSubmit} aria-label="Commit form">
            <div className="flex" style={{ height: '500px' }}>
              {/* Left panel - File list */}
              <div
                className="w-[350px] border-r border-border flex flex-col"
                role="region"
                aria-label="Files to commit"
              >
                {/* File filter */}
                <div className="px-3 py-2 border-b border-border bg-bg-tertiary">
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
                  className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs"
                  role="group"
                  aria-label="Selection controls"
                >
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-accent hover:underline"
                    aria-label="Select all files"
                  >
                    Select all
                  </button>
                  <span className="text-text-faint" aria-hidden="true">
                    |
                  </span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-accent hover:underline"
                    aria-label="Deselect all files"
                  >
                    Select none
                  </button>
                  <span className="text-text-faint ml-auto" aria-live="polite" aria-atomic="true">
                    {selectedCount}/{files.length} selected
                  </span>
                </div>

                {/* File list */}
                <div
                  className="flex-1 overflow-auto"
                  role="listbox"
                  aria-label="Files to commit"
                  aria-multiselectable="true"
                >
                  {isLoadingStatus ? (
                    <div
                      className="flex items-center justify-center h-20"
                      role="status"
                      aria-label="Loading files"
                    >
                      <Loader2
                        className="w-5 h-5 text-text-muted animate-spin"
                        aria-hidden="true"
                      />
                      <span className="sr-only">Loading files...</span>
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="text-center py-8 text-text-muted text-sm" role="status">
                      No files to commit
                    </div>
                  ) : (
                    filteredFiles.map((file) => {
                      const statusInfo = STATUS_CONFIG[file.status];
                      const filename = file.path.split(/[/\\]/).pop();

                      return (
                        <div
                          key={file.path}
                          className={`flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary cursor-pointer group ${
                            selectedDiffFile === file.path ? 'bg-accent/10' : ''
                          }`}
                          onClick={() => setSelectedDiffFile(file.path)}
                          role="option"
                          aria-selected={file.selected}
                        >
                          <input
                            type="checkbox"
                            checked={file.selected}
                            onChange={() => handleToggleFile(file.path)}
                            onClick={(e) => e.stopPropagation()}
                            className="checkbox"
                            aria-label={`${file.selected ? 'Deselect' : 'Select'} ${filename}`}
                          />
                          <span
                            className={`text-xs font-mono ${statusInfo.color}`}
                            aria-label={statusInfo.label}
                            title={statusInfo.label}
                          >
                            {file.status}
                          </span>
                          <span className="flex-1 text-sm truncate text-text" title={file.path}>
                            {filename}
                          </span>
                          {file.status !== '?' && file.status !== 'A' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevertFile(file.path);
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
                    })
                  )}
                </div>
              </div>

              {/* Right panel - Message and diff */}
              <div
                className="flex-1 flex flex-col"
                role="region"
                aria-label="Commit message and diff"
              >
                {/* Commit message area */}
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label
                      htmlFor="commit-message"
                      className="text-sm font-medium text-text-secondary"
                    >
                      Message{' '}
                      <span className="text-error" aria-label="required">
                        *
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      {/* AI Suggestions */}
                      {aiSuggestions.length > 0 && (
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
                            aria-label="AI-powered suggestions"
                          >
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            Suggest
                            <ChevronDown className="w-3 h-3" aria-hidden="true" />
                          </button>
                          {showSuggestions && (
                            <ul
                              className="absolute right-0 top-full mt-1 w-64 bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                              role="menu"
                              aria-label="AI suggestions"
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
                                onChange={(e) =>
                                  updateRules({ requireIssueId: e.target.checked })
                                }
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
                          </ul>
                        )}
                      </div>

                      {/* History dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowHistory(!showHistory);
                            setShowTemplates(false);
                            setShowSuggestions(false);
                          }}
                          className="btn btn-secondary btn-sm text-xs"
                          disabled={history.length === 0}
                          aria-expanded={showHistory}
                          aria-haspopup="menu"
                          aria-label="Insert from commit history"
                          aria-disabled={history.length === 0}
                        >
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          History
                          <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        </button>
                        {showHistory && history.length > 0 && (
                          <ul
                            className="absolute right-0 top-full mt-1 w-72 max-h-48 overflow-auto bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                            role="menu"
                            aria-label="Recent commit messages"
                          >
                            {history.slice(0, 10).map((h, i) => (
                              <li key={i}>
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

                  {/* Autocomplete textarea */}
                  <AutoCompleteInput
                    value={message}
                    onChange={setMessage}
                    suggestions={autocompleteOptions}
                    placeholder="Enter commit message...&#10;&#10;Start typing for suggestions or use the buttons above."
                    disabled={isSubmitting}
                    inputClassName="h-28 text-sm"
                    showCategories={true}
                    minChars={0}
                    aria-label="Commit message"
                    id="commit-message"
                  />

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
                </div>

                {/* Diff preview with enhanced viewer */}
                <div
                  className="flex-1 overflow-hidden flex flex-col"
                  role="region"
                  aria-label="File diff preview"
                >
                  {selectedDiffFile ? (
                    diffData?.files && diffData.files.length > 0 ? (
                      <EnhancedDiffViewer
                        diff={diffData}
                        filePath={selectedDiffFile}
                        mode={diffViewMode}
                        onModeChange={setDiffViewMode}
                        className="h-full"
                      />
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

            {/* Footer */}
            <div className="modal-footer">
              <div className="flex-1 text-sm text-text-faint" aria-live="polite">
                {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
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
                  isSubmitting || !message.trim() || selectedCount === 0 || ruleErrors.length > 0
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
                    Commit ({selectedCount})
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
