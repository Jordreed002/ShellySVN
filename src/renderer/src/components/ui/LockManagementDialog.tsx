import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X, Lock, Unlock, AlertTriangle, CheckCircle, Loader2, FileText,
  User, Calendar, MessageSquare, Shield, ShieldAlert, ShieldCheck
} from 'lucide-react'
import { useFocusTrap } from '@renderer/hooks/useFocusTrap'
import type { SvnLockInfo } from '@shared/types'

interface LockManagementDialogProps {
  isOpen: boolean
  workingCopyPath: string
  selectedPath?: string
  onClose: () => void
  onRefresh?: () => void
}

/**
 * Formats an ISO date string to a human-readable format
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown'
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

/**
 * Truncates a path for display, keeping the filename visible
 */
function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path
  const filename = path.split(/[/\\]/).pop() || path
  const dir = path.substring(0, path.length - filename.length)
  if (filename.length >= maxLength - 3) return '...' + filename.slice(-(maxLength - 3))

  const availableLength = maxLength - filename.length - 4
  return dir.slice(0, availableLength) + '.../' + filename
}

export function LockManagementDialog({
  isOpen,
  workingCopyPath,
  selectedPath,
  onClose,
  onRefresh
}: LockManagementDialogProps) {
  const [selectedLock, setSelectedLock] = useState<SvnLockInfo | null>(null)
  const [actionInProgress, setActionInProgress] = useState<'steal' | 'break' | null>(null)
  const [showConfirmSteal, setShowConfirmSteal] = useState(false)
  const [showConfirmBreak, setShowConfirmBreak] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const queryClient = useQueryClient()

  // Focus trap for accessibility
  const modalRef = useFocusTrap({
    active: isOpen,
    onEscape: () => {
      if (!actionInProgress) onClose()
    },
    returnFocus: true
  })

  // Generate unique IDs for accessibility
  const dialogId = useMemo(() => `lock-dialog-${Math.random().toString(36).substring(2, 11)}`, [])
  const titleId = `${dialogId}-title`

  // Fetch all locks in the working copy
  const { data: locks = [], isLoading, refetch } = useQuery({
    queryKey: ['svn:lockList', workingCopyPath],
    queryFn: () => window.api.svn.lockList(workingCopyPath),
    enabled: isOpen && !!workingCopyPath
  })

  // Fetch lock info for selected path if provided
  const { data: selectedLockInfo } = useQuery({
    queryKey: ['svn:lockInfo', selectedPath],
    queryFn: () => window.api.svn.lockInfo(selectedPath!),
    enabled: isOpen && !!selectedPath
  })

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedLock(null)
      setActionInProgress(null)
      setShowConfirmSteal(false)
      setShowConfirmBreak(false)
      setSuccessMessage(null)
      setErrorMessage(null)
    }
  }, [isOpen])

  // Auto-select lock info for the selected path
  useEffect(() => {
    if (selectedLockInfo) {
      setSelectedLock(selectedLockInfo)
    } else if (selectedPath && locks.length > 0) {
      const lock = locks.find(l => l.path === selectedPath)
      if (lock) setSelectedLock(lock)
    }
  }, [selectedLockInfo, selectedPath, locks])

  const handleStealLock = async (lock: SvnLockInfo) => {
    setShowConfirmSteal(true)
    setSelectedLock(lock)
  }

  const handleBreakLock = async (lock: SvnLockInfo) => {
    setShowConfirmBreak(true)
    setSelectedLock(lock)
  }

  const confirmStealLock = async () => {
    if (!selectedLock) return

    setActionInProgress('steal')
    setErrorMessage(null)
    setShowConfirmSteal(false)

    try {
      const result = await window.api.svn.lockForce(selectedLock.path, 'Lock stolen via ShellySVN')
      if (result.success) {
        setSuccessMessage(`Lock stolen from ${selectedLock.owner}`)
        await refetch()
        queryClient.invalidateQueries({ queryKey: ['svn:status'] })
        onRefresh?.()
      } else {
        setErrorMessage(result.error || 'Failed to steal lock')
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to steal lock')
    } finally {
      setActionInProgress(null)
    }
  }

  const confirmBreakLock = async () => {
    if (!selectedLock) return

    setActionInProgress('break')
    setErrorMessage(null)
    setShowConfirmBreak(false)

    try {
      const result = await window.api.svn.unlockForce(selectedLock.path)
      if (result.success) {
        setSuccessMessage(`Lock broken for ${selectedLock.owner}`)
        setSelectedLock(null)
        await refetch()
        queryClient.invalidateQueries({ queryKey: ['svn:status'] })
        onRefresh?.()
      } else {
        setErrorMessage(result.error || 'Failed to break lock')
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to break lock')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleClose = () => {
    if (!actionInProgress) {
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
        className="modal w-[700px] max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        id={dialogId}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            <Lock className="w-5 h-5 text-warning" aria-hidden="true" />
            Lock Management
          </h2>
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            disabled={!!actionInProgress}
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex" style={{ height: '450px' }}>
          {/* Left panel - Lock list */}
          <div
            className="w-[280px] border-r border-border flex flex-col"
            role="region"
            aria-label="Locked files"
          >
            <div className="px-3 py-2 border-b border-border bg-bg-tertiary">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                  Locked Files ({locks.length})
                </span>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="btn-icon-sm"
                  title="Refresh"
                  aria-label="Refresh lock list"
                  disabled={isLoading}
                >
                  <Loader2 className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Lock list */}
            <div
              className="flex-1 overflow-auto"
              role="listbox"
              aria-label="Locked files"
            >
              {isLoading ? (
                <div
                  className="flex items-center justify-center h-20"
                  role="status"
                  aria-label="Loading locks"
                >
                  <Loader2 className="w-5 h-5 text-text-muted animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading locks...</span>
                </div>
              ) : locks.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center h-full text-text-muted p-4 text-center"
                  role="status"
                >
                  <Unlock className="w-8 h-8 mb-2 opacity-50" aria-hidden="true" />
                  <p className="text-sm">No locked files in this working copy</p>
                </div>
              ) : (
                locks.map((lock, index) => {
                  const filename = lock.path.split(/[/\\]/).pop() || lock.path
                  const isSelected = selectedLock?.path === lock.path

                  return (
                    <button
                      key={lock.path}
                      onClick={() => setSelectedLock(lock)}
                      disabled={!!actionInProgress}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 text-left transition-fast
                        ${isSelected ? 'bg-accent/10 border-l-2 border-accent' : 'hover:bg-bg-tertiary border-l-2 border-transparent'}
                      `}
                      role="option"
                      aria-selected={isSelected}
                      aria-posinset={index + 1}
                      aria-setsize={locks.length}
                    >
                      <Lock className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text truncate" title={lock.path}>
                          {filename}
                        </div>
                        <div className="text-xs text-text-muted truncate" title={lock.owner}>
                          by {lock.owner}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Right panel - Lock details */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            role="region"
            aria-label="Lock details"
          >
            {successMessage && (
              <div className="mx-4 mt-4 flex items-center gap-2 text-sm text-success bg-success/10 rounded p-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{successMessage}</span>
                <button
                  type="button"
                  onClick={() => setSuccessMessage(null)}
                  className="ml-auto text-success hover:text-success/80"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {errorMessage && (
              <div
                className="mx-4 mt-4 flex items-center gap-2 text-sm text-error bg-error/10 rounded p-2"
                role="alert"
                aria-live="assertive"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="ml-auto text-error hover:text-error/80"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {selectedLock ? (
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* File path */}
                <div className="bg-bg-tertiary rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-text-muted" aria-hidden="true" />
                    <span
                      className="text-sm text-text font-mono truncate"
                      title={selectedLock.path}
                    >
                      {truncatePath(selectedLock.path, 60)}
                    </span>
                  </div>
                </div>

                {/* Lock info card */}
                <div className="bg-bg-elevated border border-border rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-text flex items-center gap-2">
                    <Lock className="w-4 h-4 text-warning" aria-hidden="true" />
                    Lock Information
                  </h3>

                  {/* Owner */}
                  <div className="flex items-start gap-3">
                    <User className="w-4 h-4 text-text-muted mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-xs text-text-muted uppercase tracking-wider">Owner</div>
                      <div className="text-sm text-text font-medium">{selectedLock.owner}</div>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-text-muted mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-xs text-text-muted uppercase tracking-wider">Locked Since</div>
                      <div className="text-sm text-text">{formatDate(selectedLock.date)}</div>
                    </div>
                  </div>

                  {/* Comment */}
                  {selectedLock.comment && (
                    <div className="flex items-start gap-3">
                      <MessageSquare className="w-4 h-4 text-text-muted mt-0.5" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-text-muted uppercase tracking-wider">Comment</div>
                        <div className="text-sm text-text break-words">{selectedLock.comment}</div>
                      </div>
                    </div>
                  )}

                  {/* Token (if available) */}
                  {selectedLock.token && (
                    <div className="flex items-start gap-3">
                      <Shield className="w-4 h-4 text-text-muted mt-0.5" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-text-muted uppercase tracking-wider">Lock Token</div>
                        <div className="text-xs text-text-muted font-mono truncate" title={selectedLock.token}>
                          {selectedLock.token}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-secondary">Actions</h3>

                  <button
                    type="button"
                    onClick={() => handleStealLock(selectedLock)}
                    disabled={!!actionInProgress}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-warning/30 bg-warning/5 hover:bg-warning/10 transition-fast text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionInProgress === 'steal' ? (
                      <Loader2 className="w-5 h-5 text-warning animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="w-5 h-5 text-warning" aria-hidden="true" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-warning group-hover:text-warning">
                        {actionInProgress === 'steal' ? 'Stealing Lock...' : 'Steal Lock'}
                      </div>
                      <div className="text-xs text-text-muted">
                        Transfer the lock to yourself (requires lock permission)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleBreakLock(selectedLock)}
                    disabled={!!actionInProgress}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-error/30 bg-error/5 hover:bg-error/10 transition-fast text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionInProgress === 'break' ? (
                      <Loader2 className="w-5 h-5 text-error animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="w-5 h-5 text-error" aria-hidden="true" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-error group-hover:text-error">
                        {actionInProgress === 'break' ? 'Breaking Lock...' : 'Break Lock'}
                      </div>
                      <div className="text-xs text-text-muted">
                        Remove the lock entirely (requires admin permission)
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted">
                <div className="text-center">
                  <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
                  <p className="text-sm">Select a locked file to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer" role="contentinfo">
          <div className="flex-1 text-sm text-text-faint">
            {locks.length} locked file{locks.length !== 1 ? 's' : ''} in working copy
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="btn btn-secondary"
            disabled={!!actionInProgress}
          >
            Close
          </button>
        </div>

        {/* Confirmation dialogs */}
        {showConfirmSteal && selectedLock && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="steal-confirm-title"
          >
            <div className="bg-bg-elevated rounded-lg shadow-xl w-[400px] p-4">
              <h3 id="steal-confirm-title" className="text-lg font-medium text-text mb-2 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-warning" aria-hidden="true" />
                Confirm Steal Lock
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                You are about to steal the lock from <strong className="text-text">{selectedLock.owner}</strong>.
                They will lose their lock and any unsaved changes may be affected.
              </p>
              <div className="bg-warning/10 border border-warning/20 rounded p-3 mb-4">
                <p className="text-xs text-warning">
                  This action should only be performed when the lock owner is unavailable and you need to make urgent changes.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmSteal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmStealLock}
                  className="btn btn-warning"
                >
                  <ShieldAlert className="w-4 h-4" />
                  Steal Lock
                </button>
              </div>
            </div>
          </div>
        )}

        {showConfirmBreak && selectedLock && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="break-confirm-title"
          >
            <div className="bg-bg-elevated rounded-lg shadow-xl w-[400px] p-4">
              <h3 id="break-confirm-title" className="text-lg font-medium text-text mb-2 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-error" aria-hidden="true" />
                Confirm Break Lock
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                You are about to break the lock held by <strong className="text-text">{selectedLock.owner}</strong>.
                This will remove the lock without transferring it to anyone.
              </p>
              <div className="bg-error/10 border border-error/20 rounded p-3 mb-4">
                <p className="text-xs text-error">
                  This is a destructive action. The lock owner will lose their lock immediately.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmBreak(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBreakLock}
                  className="btn btn-danger"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Break Lock
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
