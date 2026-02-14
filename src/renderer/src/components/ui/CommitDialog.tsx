import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  X, Upload, AlertCircle, CheckCircle, Eye, 
  ChevronDown, Clock, FilePlus, RotateCcw, RefreshCw, Loader2
} from 'lucide-react'
import { useCommitMessageHistory, useCommitTemplates } from '@renderer/hooks/useCommitMessageHistory'
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
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal w-[900px] max-h-[90vh]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Upload className="w-5 h-5 text-accent" />
            Commit Changes
          </h2>
          <button 
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={isSubmitting}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        {success ? (
          <div className="modal-body">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-medium text-text mb-2">Committed Successfully</h3>
              <p className="text-text-secondary mb-6">
                Revision {success.revision}
              </p>
              <button
                onClick={onClose}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex" style={{ height: '500px' }}>
              {/* Left panel - File list */}
              <div className="w-[350px] border-r border-border flex flex-col">
                {/* File filter */}
                <div className="px-3 py-2 border-b border-border bg-bg-tertiary">
                  <div className="flex items-center gap-2">
                    <select
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value as typeof fileFilter)}
                      className="input text-xs py-1 flex-1"
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
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                
                {/* Select all/none */}
                <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-accent hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-text-faint">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-accent hover:underline"
                  >
                    Select none
                  </button>
                  <span className="text-text-faint ml-auto">
                    {selectedCount}/{files.length} selected
                  </span>
                </div>
                
                {/* File list */}
                <div className="flex-1 overflow-auto">
                  {isLoadingStatus ? (
                    <div className="flex items-center justify-center h-20">
                      <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="text-center py-8 text-text-muted text-sm">
                      No files to commit
                    </div>
                  ) : (
                    filteredFiles.map((file) => {
                      const statusInfo = STATUS_CONFIG[file.status]
                      const filename = file.path.split(/[/\\]/).pop()
                      
                      return (
                        <div
                          key={file.path}
                          className={`flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary cursor-pointer group ${
                            selectedDiffFile === file.path ? 'bg-accent/10' : ''
                          }`}
                          onClick={() => setSelectedDiffFile(file.path)}
                        >
                          <input
                            type="checkbox"
                            checked={file.selected}
                            onChange={() => handleToggleFile(file.path)}
                            onClick={(e) => e.stopPropagation()}
                            className="checkbox"
                          />
                          <span className={`text-xs font-mono ${statusInfo.color}`}>
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
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
              
              {/* Right panel - Message and diff */}
              <div className="flex-1 flex flex-col">
                {/* Commit message area */}
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-text-secondary">
                      Message <span className="text-error">*</span>
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
                        >
                          <FilePlus className="w-3 h-3" />
                          Templates
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {showTemplates && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-bg-elevated border border-border rounded-lg shadow-lg z-10">
                            {templates.map(t => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleTemplateSelect(t.id)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-tertiary first:rounded-t-lg last:rounded-b-lg"
                              >
                                {t.name}
                              </button>
                            ))}
                          </div>
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
                        >
                          <Clock className="w-3 h-3" />
                          History
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {showHistory && history.length > 0 && (
                          <div className="absolute right-0 top-full mt-1 w-72 max-h-48 overflow-auto bg-bg-elevated border border-border rounded-lg shadow-lg z-10">
                            {history.slice(0, 10).map((h, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleHistorySelect(h.message)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-bg-tertiary border-b border-border last:border-b-0"
                              >
                                <div className="truncate text-text">{h.message}</div>
                                <div className="text-text-faint text-xs mt-0.5">
                                  {new Date(h.timestamp).toLocaleDateString()}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Enter commit message...&#10;&#10;You can use templates for structured messages."
                    className="input h-28 resize-none text-sm"
                    disabled={isSubmitting}
                  />
                </div>
                
                {/* Diff preview */}
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="px-4 py-2 border-b border-border bg-bg-tertiary flex items-center gap-2">
                    <Eye className="w-4 h-4 text-text-muted" />
                    <span className="text-sm text-text-secondary">
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
                      <pre className="whitespace-pre">
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
                      <div className="flex items-center justify-center h-full text-text-muted">
                        No diff available (binary file or unversioned)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Error */}
            {error && (
              <div className="mx-4 my-2 flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            
            {/* Footer */}
            <div className="modal-footer">
              <div className="flex-1 text-sm text-text-faint">
                {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-secondary"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !message.trim() || selectedCount === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Committing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
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
