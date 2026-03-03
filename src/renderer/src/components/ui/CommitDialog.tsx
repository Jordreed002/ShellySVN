import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, Upload, AlertCircle, CheckCircle, Eye,
  ChevronDown, Clock, FilePlus, RotateCcw, RefreshCw, Loader2
} from 'lucide-react'
import { useCommitMessageHistory, useCommitTemplates } from '@renderer/hooks/useCommitMessageHistory'
import { useFocusTrap } from '@renderer/hooks/useFocusTrap'
import type { SvnStatusChar } from '@shared/types'

interface CommitFile {
  path: string
  status: SvnStatusChar
  isDirectory: boolean
  selected: boolean
}

interface CommitDialogProps {
  isOpen: boolean
  workingCopyPath: string
  onClose: () => void
  onSubmit: (paths: string[], message: string) => Promise<{ success: boolean; message?: string; revision?: number }>
}

const STATUS_CONFIG: Record<SvnStatusChar, { label: string; color: string }> = {
  ' ': { label: 'Normal', color: 'text-text-muted' },
  'A': { label: 'Added', color: 'text-success' },
  'C': { label: 'Conflicted', color: 'text-warning' },
  'D': { label: 'Deleted', color: 'text-error' },
  'I': { label: 'Ignored', color: 'text-text-faint' },
  'M': { label: 'Modified', color: 'text-accent' },
  'R': { label: 'Replaced', color: 'text-accent' },
  'X': { label: 'External', color: 'text-info' },
  '?': { label: 'Unversioned', color: 'text-text-secondary' },
  '!': { label: 'Missing', color: 'text-error' },
  '~': { label: 'Obstructed', color: 'text-warning' },
}

export function CommitDialog({ isOpen, workingCopyPath, onClose, onSubmit }: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ revision: number } | null>(null)
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [fileFilter, setFileFilter] = useState<'all' | 'modified' | 'added' | 'deleted'>('all')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { history, addMessage } = useCommitMessageHistory()
  const { templates, applyTemplate } = useCommitTemplates()

  // Focus trap for accessibility
  const modalRef = useFocusTrap({
    active: isOpen && !success,
    onEscape: () => {
      if (!isSubmitting) onClose()
    },
    initialFocus: () => textareaRef.current,
    returnFocus: true
  })

  // Generate unique IDs for accessibility
  const dialogId = useMemo(() => `commit-dialog-${Math.random().toString(36).substr(2, 9)}`, [])
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  
  // Fetch status to get files
  const { data: statusData, isLoading: isLoadingStatus, refetch } = useQuery({
    queryKey: ['svn:status', workingCopyPath],
    queryFn: () => window.api.svn.status(workingCopyPath),
    enabled: isOpen && !!workingCopyPath
  })
  
  // Process files into commitable list
  const [files, setFiles] = useState<CommitFile[]>([])
  
  useEffect(() => {
    if (statusData?.entries) {
      const commitableStatuses: SvnStatusChar[] = ['M', 'A', 'D', 'R', 'C', '?']
      const commitFiles = statusData.entries
        .filter(e => commitableStatuses.includes(e.status))
        .map(e => ({
          path: e.path,
          status: e.status,
          isDirectory: e.isDirectory,
          selected: e.status !== '?' // Auto-select versioned changes
        }))
      setFiles(commitFiles)
    }
  }, [statusData])
  
  // Fetch diff for selected file
  const { data: diffData } = useQuery({
    queryKey: ['svn:diff', selectedDiffFile],
    queryFn: () => window.api.svn.diff(selectedDiffFile!),
    enabled: !!selectedDiffFile
  })
  
  // Filtered files
  const filteredFiles = useMemo(() => {
    if (fileFilter === 'all') return files
    const filterMap: Record<string, SvnStatusChar[]> = {
      modified: ['M', 'R'],
      added: ['A', '?'],
      deleted: ['D']
    }
    return files.filter(f => filterMap[fileFilter]?.includes(f.status))
  }, [files, fileFilter])
  
  const selectedFiles = files.filter(f => f.selected)
  const selectedCount = selectedFiles.length
  
  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setMessage('')
      setError(null)
      setSuccess(null)
      setIsSubmitting(false)
      setSelectedDiffFile(null)
      setShowTemplates(false)
      setShowHistory(false)
      setFileFilter('all')
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen])
  
  const handleToggleFile = (path: string) => {
    setFiles(prev => prev.map(f => 
      f.path === path ? { ...f, selected: !f.selected } : f
    ))
  }
  
  const handleSelectAll = () => {
    setFiles(prev => prev.map(f => ({ ...f, selected: true })))
  }
  
  const handleDeselectAll = () => {
    setFiles(prev => prev.map(f => ({ ...f, selected: false })))
  }
  
  const handleRevertFile = async (path: string) => {
    try {
      await window.api.svn.revert([path])
      refetch()
    } catch (err) {
      console.error('Revert failed:', err)
    }
  }
  
  const handleTemplateSelect = (templateId: string) => {
    setMessage(applyTemplate(templateId))
    setShowTemplates(false)
    textareaRef.current?.focus()
  }
  
  const handleHistorySelect = (msg: string) => {
    setMessage(msg)
    setShowHistory(false)
    textareaRef.current?.focus()
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim()) {
      setError('Please enter a commit message')
      return
    }
    
    if (selectedCount === 0) {
      setError('Please select at least one file to commit')
      return
    }
    
    setIsSubmitting(true)
    setError(null)
    
    const pathsToCommit = selectedFiles.map(f => f.path)
    const result = await onSubmit(pathsToCommit, message.trim())
    
    if (result.success) {
      // Save to history
      addMessage(message.trim(), workingCopyPath)
      setSuccess({ revision: result.revision || 0 })
    } else {
      setError(result.message || 'Commit failed')
      setIsSubmitting(false)
    }
  }
  
  const handleClose = () => {
    if (!isSubmitting) {
      onClose()
    }
  }
  
  if (!isOpen) return null

  return (
    <div
      className="modal-overlay"
      onClick={handleClose}
      role="presentation"
    >
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
              <p className="text-text-secondary mb-6">
                Revision {success.revision}
              </p>
              <button
                onClick={onClose}
                className="btn btn-primary"
                aria-label="Close and finish"
              >
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
                    <label htmlFor="file-filter" className="sr-only">Filter files by status</label>
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
                <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs" role="group" aria-label="Selection controls">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-accent hover:underline"
                    aria-label="Select all files"
                  >
                    Select all
                  </button>
                  <span className="text-text-faint" aria-hidden="true">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-accent hover:underline"
                    aria-label="Deselect all files"
                  >
                    Select none
                  </button>
                  <span
                    className="text-text-faint ml-auto"
                    aria-live="polite"
                    aria-atomic="true"
                  >
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
                      <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                      <span className="sr-only">Loading files...</span>
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div
                      className="text-center py-8 text-text-muted text-sm"
                      role="status"
                    >
                      No files to commit
                    </div>
                  ) : (
                    filteredFiles.map((file, index) => {
                      const statusInfo = STATUS_CONFIG[file.status]
                      const filename = file.path.split(/[/\\]/).pop()

                      return (
                        <div
                          key={file.path}
                          className={`flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary cursor-pointer group ${
                            selectedDiffFile === file.path ? 'bg-accent/10' : ''
                          }`}
                          onClick={() => setSelectedDiffFile(file.path)}
                          role="option"
                          aria-selected={file.selected}
                          aria-posinset={index + 1}
                          aria-setsize={filteredFiles.length}
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
                                e.stopPropagation()
                                handleRevertFile(file.path)
                              }}
                              className="btn-icon-sm opacity-0 group-hover:opacity-100"
                              title="Revert this file"
                              aria-label={`Revert ${filename}`}
                            >
                              <RotateCcw className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right panel - Message and diff */}
              <div className="flex-1 flex flex-col" role="region" aria-label="Commit message and diff">
                {/* Commit message area */}
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="commit-message" className="text-sm font-medium text-text-secondary">
                      Message <span className="text-error" aria-label="required">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Templates dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowTemplates(!showTemplates)
                            setShowHistory(false)
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
                            className="absolute right-0 top-full mt-1 w-48 bg-bg-elevated border border-border rounded-lg shadow-lg z-10"
                            role="menu"
                            aria-label="Commit templates"
                          >
                            {templates.map(t => (
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
                            setShowHistory(!showHistory)
                            setShowTemplates(false)
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
                  <textarea
                    id="commit-message"
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Enter commit message...&#10;&#10;You can use templates for structured messages."
                    className="input h-28 resize-none text-sm"
                    disabled={isSubmitting}
                    aria-required="true"
                    aria-invalid={!message.trim() && isSubmitting}
                    aria-describedby={!message.trim() ? 'message-error' : undefined}
                  />
                </div>

                {/* Diff preview */}
                <div className="flex-1 overflow-hidden flex flex-col" role="region" aria-label="File diff preview">
                  <div className="px-4 py-2 border-b border-border bg-bg-tertiary flex items-center gap-2">
                    <Eye className="w-4 h-4 text-text-muted" aria-hidden="true" />
                    <span className="text-sm text-text-secondary" aria-live="polite">
                      {selectedDiffFile ? (
                        <>
                          Diff: <span className="font-mono text-text">
                            {selectedDiffFile.split(/[/\\]/).pop()}
                          </span>
                        </>
                      ) : (
                        'Select a file to see diff'
                      )}
                    </span>
                  </div>
                  
                  <div className="flex-1 overflow-auto bg-bg-primary p-2 font-mono text-xs">
                    {!selectedDiffFile ? (
                      <div className="flex items-center justify-center h-full text-text-muted">
                        Select a file from the list to view changes
                      </div>
                    ) : diffData?.files && diffData.files.length > 0 ? (
                      <pre className="whitespace-pre" role="region" aria-label="File differences">
                        {diffData.files.map((file, i) => (
                          <div key={i}>
                            <div className="text-info">Index: {file.newPath}</div>
                            {file.hunks.map((hunk, j) => (
                              <div key={j}>
                                <div className="text-accent">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</div>
                                {hunk.lines.map((line, k) => (
                                  <div
                                    key={k}
                                    className={
                                      line.type === 'added' ? 'bg-success/20 text-success' :
                                      line.type === 'removed' ? 'bg-error/20 text-error' :
                                      'text-text-faint'
                                    }
                                    role="text"
                                    aria-label={
                                      line.type === 'added' ? `Added: ${line.content}` :
                                      line.type === 'removed' ? `Removed: ${line.content}` :
                                      line.content
                                    }
                                  >
                                    {line.content}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </pre>
                    ) : (
                      <div className="flex items-center justify-center h-full text-text-muted" role="status">
                        No diff available (binary file or unversioned)
                      </div>
                    )}
                  </div>
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
            <div className="modal-footer" role="contentinfo">
              <div
                className="flex-1 text-sm text-text-faint"
                aria-live="polite"
              >
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
                disabled={isSubmitting || !message.trim() || selectedCount === 0}
                aria-label={isSubmitting ? 'Committing changes...' : `Commit ${selectedCount} file${selectedCount !== 1 ? 's' : ''}`}
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
  )
}
