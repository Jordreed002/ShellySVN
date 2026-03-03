import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '@renderer/hooks/useFocusTrap'

/**
 * AccessibleDialog - A WCAG 2.1 AA compliant dialog component
 *
 * Features:
 * - Focus trap
 * - Escape key to close
 * - Click outside to close
 * - Proper ARIA attributes
 * - Focus restoration
 * - Screen reader announcements
 */
export interface AccessibleDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when dialog requests to close */
  onClose: () => void
  /** Dialog title (required for accessibility) */
  title: ReactNode
  /** Optional description for screen readers */
  description?: string
  /** Whether clicking outside should close the dialog */
  closeOnOverlayClick?: boolean
  /** Whether pressing Escape should close the dialog */
  closeOnEscape?: boolean
  /** Size of the dialog */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Additional CSS classes */
  className?: string
  /** Dialog content */
  children: ReactNode
  /** Whether to show the close button */
  showCloseButton?: boolean
  /** Accessible label for close button */
  closeButtonLabel?: string
  /** Whether the dialog is modal (blocks interaction with background) */
  modal?: boolean
  /** Called when dialog opens */
  onOpen?: () => void
  /** Called when dialog closes */
  onCloseComplete?: () => void
}

const sizeClasses: Record<string, string> = {
  sm: 'w-[400px] max-w-[90vw]',
  md: 'w-[600px] max-w-[90vw]',
  lg: 'w-[800px] max-w-[90vw]',
  xl: 'w-[1000px] max-w-[90vw]',
  full: 'w-[95vw] max-w-[95vw]'
}

export function AccessibleDialog({
  isOpen,
  onClose,
  title,
  description,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  size = 'md',
  className = '',
  children,
  showCloseButton = true,
  closeButtonLabel = 'Close dialog',
  modal = true,
  onOpen,
  onCloseComplete
}: AccessibleDialogProps) {
  const [dialogId] = useState(() => `dialog-${Math.random().toString(36).substr(2, 9)}`)
  const titleId = `${dialogId}-title`
  const descriptionId = description ? `${dialogId}-description` : undefined
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Focus trap
  const containerRef = useFocusTrap({
    active: isOpen,
    onEscape: closeOnEscape ? onClose : undefined,
    returnFocus: true
  })

  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose()
    }
  }, [closeOnOverlayClick, onClose])

  // Manage aria-hidden on background content
  useEffect(() => {
    if (isOpen && modal) {
      // Store current focus
      previousActiveElement.current = document.activeElement as HTMLElement

      // Hide background content from screen readers
      const rootElements = document.querySelectorAll(
        'body > *:not([role="dialog"]):not([data-portal])'
      )
      rootElements.forEach(el => {
        if (!el.contains(containerRef.current)) {
          el.setAttribute('aria-hidden', 'true')
          el.setAttribute('data-hidden-by-dialog', 'true')
        }
      })

      // Prevent body scroll
      document.body.style.overflow = 'hidden'

      // Call onOpen callback
      onOpen?.()

      return () => {
        // Restore background content visibility
        const hiddenElements = document.querySelectorAll('[data-hidden-by-dialog="true"]')
        hiddenElements.forEach(el => {
          el.removeAttribute('aria-hidden')
          el.removeAttribute('data-hidden-by-dialog')
        })

        // Restore body scroll
        document.body.style.overflow = ''

        // Call onCloseComplete callback
        onCloseComplete?.()
      }
    }
  }, [isOpen, modal, onOpen, onCloseComplete])

  // Announce dialog to screen readers
  useEffect(() => {
    if (isOpen && title) {
      const titleText = typeof title === 'string' ? title : 'Dialog opened'
      // Small delay to ensure focus trap has run
      setTimeout(() => {
        const announcer = document.getElementById('sr-announcer')
        if (announcer) {
          announcer.setAttribute('aria-live', 'assertive')
          announcer.textContent = `${titleText} dialog opened`
          setTimeout(() => {
            announcer.textContent = ''
          }, 1000)
        }
      }, 100)
    }
  }, [isOpen, title])

  if (!isOpen) return null

  const dialog = (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      role="presentation"
      style={{ zIndex: 1000 }}
    >
      <div
        ref={containerRef}
        className={`modal ${sizeClasses[size]} ${className}`}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
        data-portal
      >
        {/* Header */}
        <div className="modal-header">
          <h2
            id={titleId}
            className="modal-title"
          >
            {title}
          </h2>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="btn-icon-sm"
              aria-label={closeButtonLabel}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Screen reader description */}
        {description && (
          <p id={descriptionId} className="sr-only">
            {description}
          </p>
        )}

        {/* Content */}
        {children}
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}

/**
 * AccessibleDialogBody - The main content area of a dialog
 */
export function AccessibleDialogBody({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`modal-body ${className}`}>
      {children}
    </div>
  )
}

/**
 * AccessibleDialogFooter - The footer area with actions
 */
export function AccessibleDialogFooter({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`modal-footer ${className}`} role="contentinfo">
      {children}
    </div>
  )
}

/**
 * AccessibleConfirmationDialog - A simple confirmation dialog
 */
export interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  isLoading?: boolean
}

export function AccessibleConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isLoading = false
}: ConfirmationDialogProps) {
  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
    >
      <AccessibleDialogBody>
        <p className="text-text-secondary">{message}</p>
      </AccessibleDialogBody>
      <AccessibleDialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-secondary"
          disabled={isLoading}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  )
}

export default AccessibleDialog
