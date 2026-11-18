import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle, Info, X } from 'lucide-react';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';

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
 *
 * Visually this is the same `.modal` / `.modal-header` / `.modal-body` /
 * `.modal-footer` shell `DialogBase` renders, so the two dialog families look
 * like one system: a compact header with a small inline glyph (tinted only for
 * warning/danger), a sentence-case title and an optional description, a
 * scrolling body, and a footer where a muted note sits left of the actions.
 */
export interface AccessibleDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Called when dialog requests to close */
  onClose: () => void;
  /** Dialog title (required for accessibility) */
  title: ReactNode;
  /**
   * What the dialog is for, in one sentence. Wired to `aria-describedby` and
   * shown under the title.
   */
  description?: string;
  /** Icon for the header tile. Defaults to an informational glyph. */
  icon?: React.ComponentType<{ className?: string }>;
  /**
   * Colour of the header tile. Use `warning` or `danger` when the dialog is
   * about something that is wrong or destructive — an accent-tinted tile above
   * "2 things need attention" reads as neutral information, which under-states
   * it. Purely visual: the meaning stays in the title and body text.
   */
  tone?: 'accent' | 'warning' | 'danger';
  /** Whether clicking outside should close the dialog */
  closeOnOverlayClick?: boolean;
  /** Whether pressing Escape should close the dialog */
  closeOnEscape?: boolean;
  /** Size of the dialog */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Additional CSS classes */
  className?: string;
  /** Dialog content */
  children: ReactNode;
  /** Whether to show the close button */
  showCloseButton?: boolean;
  /** Accessible label for close button */
  closeButtonLabel?: string;
  /** Whether the dialog is modal (blocks interaction with background) */
  modal?: boolean;
  /** Called when dialog opens */
  onOpen?: () => void;
  /** Called when dialog closes */
  onCloseComplete?: () => void;
}

/** Header-glyph tints. Neutral by default; colour only when it carries meaning. */
const HEADER_TONE: Record<'accent' | 'warning' | 'danger', string> = {
  accent: 'text-text-muted',
  warning: 'text-svn-modified',
  danger: 'text-svn-conflict',
};

const sizeClasses: Record<string, string> = {
  sm: 'w-[400px] max-w-[90vw]',
  md: 'w-[600px] max-w-[90vw]',
  lg: 'w-[800px] max-w-[90vw]',
  xl: 'w-[1000px] max-w-[90vw]',
  full: 'w-[95vw] max-w-[95vw]',
};

export function AccessibleDialog({
  isOpen,
  onClose,
  title,
  description,
  icon: HeaderIcon = Info,
  tone = 'accent',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  size = 'md',
  className = '',
  children,
  showCloseButton = true,
  closeButtonLabel = 'Close dialog',
  modal = true,
  onOpen,
  onCloseComplete,
}: AccessibleDialogProps) {
  const [dialogId] = useState(() => `dialog-${Math.random().toString(36).slice(2, 11)}`);
  const titleId = `${dialogId}-title`;
  const descriptionId = description ? `${dialogId}-description` : undefined;
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus trap
  const containerRef = useFocusTrap({
    active: isOpen,
    onEscape: closeOnEscape ? onClose : undefined,
    returnFocus: true,
  });

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  // Manage aria-hidden on background content
  useEffect(() => {
    if (isOpen && modal) {
      // Store current focus
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Hide background content from screen readers
      const rootElements = document.querySelectorAll(
        'body > *:not([role="dialog"]):not([data-portal])'
      );
      rootElements.forEach((el) => {
        if (!el.contains(containerRef.current)) {
          el.setAttribute('aria-hidden', 'true');
          el.setAttribute('data-hidden-by-dialog', 'true');
        }
      });

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Call onOpen callback
      onOpen?.();

      return () => {
        // Restore background content visibility
        const hiddenElements = document.querySelectorAll('[data-hidden-by-dialog="true"]');
        hiddenElements.forEach((el) => {
          el.removeAttribute('aria-hidden');
          el.removeAttribute('data-hidden-by-dialog');
        });

        // Restore body scroll
        document.body.style.overflow = '';

        // Call onCloseComplete callback
        onCloseComplete?.();
      };
    }
    return undefined;
  }, [isOpen, modal, onOpen, onCloseComplete]);

  // Announce dialog to screen readers
  useEffect(() => {
    if (isOpen && title) {
      const titleText = typeof title === 'string' ? title : 'Dialog opened';
      // Small delay to ensure focus trap has run
      setTimeout(() => {
        const announcer = document.getElementById('sr-announcer');
        if (announcer) {
          announcer.setAttribute('aria-live', 'assertive');
          announcer.textContent = `${titleText} dialog opened`;
          setTimeout(() => {
            announcer.textContent = '';
          }, 1000);
        }
      }, 100);
    }
  }, [isOpen, title]);

  if (!isOpen) return null;

  const dialog = (
    <div
      className="modal-overlay grid overflow-y-auto p-4"
      onClick={handleOverlayClick}
      role="presentation"
      style={{ zIndex: 1000 }}
    >
      <div
        ref={containerRef}
        className={`modal m-auto flex max-h-[88vh] flex-col overflow-hidden ${sizeClasses[size]} ${className}`}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
        data-portal
      >
        {/* Header — small glyph, title, and what the dialog is for */}
        <div className="modal-header relative flex-none items-start justify-start gap-2.5 pr-12">
          <HeaderIcon
            className={`mt-[3px] h-4 w-4 flex-shrink-0 ${HEADER_TONE[tone]}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="modal-title text-14 font-semibold leading-snug text-text">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-12.5 leading-relaxed text-text-secondary">
                {description}
              </p>
            )}
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="btn-icon-sm absolute right-3 top-3"
              aria-label={closeButtonLabel}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Content */}
        {children}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

/**
 * AccessibleDialogBody - The main content area of a dialog
 */
export function AccessibleDialogBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`modal-body min-h-0 flex-1 overflow-auto ${className}`}>
      {children}
    </div>
  );
}

/**
 * AccessibleDialogFooter - The footer area with actions.
 *
 * A recessed surface: a muted note may sit on the left (give it `mr-auto`), the
 * actions collect on the right.
 */
export function AccessibleDialogFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`modal-footer flex flex-none items-center justify-end gap-2 text-12.5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * AccessibleConfirmationDialog - A simple confirmation dialog
 */
export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  isLoading?: boolean;
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
  isLoading = false,
}: ConfirmationDialogProps) {
  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      icon={variant === 'danger' ? AlertTriangle : HelpCircle}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
    >
      <AccessibleDialogBody>
        <p className="text-13 leading-relaxed text-text-secondary">{message}</p>
      </AccessibleDialogBody>
      <AccessibleDialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-secondary btn-sm"
          disabled={isLoading}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`btn btn-sm ${
            variant === 'danger' ? 'btn-danger' : 'btn-primary'
          }`}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? 'Processing...' : confirmLabel}
        </button>
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default AccessibleDialog;
