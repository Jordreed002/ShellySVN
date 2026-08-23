import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  isTopDialog,
  lockBodyScroll,
  useDialogRegistration,
} from '@renderer/lib/dialogStack';
import { useDialogGeometry } from '@renderer/hooks/useDialogGeometry';

/**
 * DialogBase — shared modal shell for the hand-rolled dialog layer (#42, #40).
 *
 * What every dialog gets for free:
 *
 * - Traps Tab / Shift+Tab inside the dialog (focus cannot escape to the page).
 * - Escape closes ONLY the top-most dialog (module-level dialog stack in
 *   `lib/dialogStack.ts`); nested dialogs never close their parent.
 * - Restores focus to the element that had focus when the dialog opened.
 * - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the heading,
 *   and initial focus on that heading.
 * - Locks background scroll for as long as at least one dialog is open.
 *
 * Opt-in extras:
 *
 * - `draggable` / `resizable` — move the panel by its header, resize from the
 *   bottom-right corner. With a stable `dialogId` the last size/position is
 *   restored on reopen and kept fully on screen (`useDialogGeometry`).
 *
 * Migrating an existing `.modal-overlay` dialog:
 *
 * ```tsx
 * // before
 * <div className="modal-overlay" onClick={onClose}>
 *   <div className="modal w-[500px]" onClick={(e) => e.stopPropagation()}>
 *     <div className="modal-header"><h2 className="modal-title">…</h2></div>
 *     …
 *
 * // after
 * <DialogBase isOpen={isOpen} onClose={onClose} title="…" className="w-[500px]">
 *   …body/footer children unchanged…
 * </DialogBase>
 * ```
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

function getFocusableDialogElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Whether Escape for this dialog should be honored right now: focus must be
 * inside the dialog (or on the page body). When focus sits in another surface
 * (e.g. the command palette opened above the dialog), that surface keeps the
 * Escape for itself.
 */
function focusBelongsToDialog(container: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  return !!container && container.contains(active);
}

export interface DialogBaseProps {
  isOpen: boolean;
  /** Called when the dialog requests to close (Escape, overlay click, X button). */
  onClose: () => void;
  /** Dialog heading; rendered inside the `h2.modal-title` that labels the dialog. */
  title: ReactNode;
  children: ReactNode;
  /**
   * Stable identity: used for the dialog stack and, when geometry is enabled,
   * as the persistence key for size/position. Falls back to a generated id.
   */
  dialogId?: string;
  /** Extra content rendered in the header between the title and the close button. */
  headerExtras?: ReactNode;
  /** Panel classes, e.g. `w-[500px]` or `max-h-[85vh] flex flex-col`. */
  className?: string;
  overlayClassName?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  closeButtonLabel?: string;
  /** Element focused when the dialog opens. Defaults to the heading. */
  initialFocus?: 'heading' | 'first-control';
  /** Return focus to the trigger element when the dialog closes. Default true. */
  restoreFocus?: boolean;
  /** Lock background scroll while open. Default true. */
  lockScroll?: boolean;
  /** Move the panel by dragging its header; persisted per `dialogId`. */
  draggable?: boolean;
  /** Resize the panel from a corner handle; persisted per `dialogId`. */
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** id of an element that describes the dialog (`aria-describedby`). */
  ariaDescribedBy?: string;
}

export function DialogBase({
  isOpen,
  onClose,
  title,
  children,
  dialogId,
  headerExtras,
  className = '',
  overlayClassName = '',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  closeButtonLabel = 'Close dialog',
  initialFocus = 'heading',
  restoreFocus = true,
  lockScroll = true,
  draggable = false,
  resizable = false,
  minWidth,
  minHeight,
  ariaDescribedBy,
}: DialogBaseProps) {
  const generatedId = useId();
  const stackId = dialogId ?? `dialog-${generatedId}`;
  const titleId = `${stackId}-title`;

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Latest callbacks/flags for the document-level key handler.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useDialogRegistration(stackId, isOpen);

  const { panelStyle, handleHeaderPointerDown, handleResizeHandlePointerDown } = useDialogGeometry(
    stackId,
    { active: isOpen, draggable, resizable, minWidth, minHeight, panelRef }
  );

  const focusInitialElement = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const alreadyFocused = document.activeElement;
    if (alreadyFocused instanceof HTMLElement && panel.contains(alreadyFocused)) return;
    if (initialFocusRef.current === 'first-control') {
      // Skip the utility close button: the first meaningful control lives in
      // the dialog body.
      getFocusableDialogElements(panel).find((el) => !el.hasAttribute('data-dialog-close'))?.focus();
      return;
    }
    (headingRef.current ?? panel).focus();
  }, []);

  // Record the trigger element, focus the dialog, and restore focus on close.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Let the portal paint before moving focus.
    const focusTimer = window.setTimeout(focusInitialElement, 0);
    return () => {
      window.clearTimeout(focusTimer);
      const trigger = returnFocusRef.current;
      if (restoreFocus && trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    };
  }, [isOpen, restoreFocus, focusInitialElement]);

  // Reference-counted background scroll lock (survives nested dialogs).
  useEffect(() => {
    if (!isOpen || !lockScroll) return;
    return lockBodyScroll();
  }, [isOpen, lockScroll]);

  // Focus trap + Escape for the top-most dialog only.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      // A dialog that is not top-most never intercepts keyboard input; the
      // top-most dialog (possibly a nested one) owns Tab and Escape.
      if (!isTopDialog(stackId)) return;

      if (event.key === 'Tab') {
        const focusable = getFocusableDialogElements(panel);
        if (focusable.length === 0) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const insidePanel = panel.contains(active);
        if (event.shiftKey) {
          if (!insidePanel || active === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (!insidePanel || active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        if (!focusBelongsToDialog(panel)) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, stackId]);

  if (!isOpen) return null;

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleHeaderPointerDownEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    handleHeaderPointerDown?.(event);
  };

  const dialog = (
    <div
      className={`modal-overlay ${overlayClassName}`.trim()}
      onClick={handleOverlayClick}
      role="presentation"
      data-dialog-portal={stackId}
    >
      <div
        ref={panelRef}
        className={`modal ${resizable || draggable ? 'flex flex-col ' : ''}${className}`.trim()}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={ariaDescribedBy}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={`modal-header flex-shrink-0 ${draggable ? 'cursor-move' : ''}`.trim()}
          onPointerDown={handleHeaderPointerDownEvent}
        >
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="modal-title outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-md"
          >
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {headerExtras}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="btn-icon-sm"
                aria-label={closeButtonLabel}
                data-dialog-close
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {children}

        {resizable && (
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
            data-dialog-resize-handle
            aria-hidden="true"
            onPointerDown={(event) => handleResizeHandlePointerDown?.(event)}
          >
            <svg viewBox="0 0 16 16" className="h-full w-full text-text-faint/60">
              <path
                d="M14 5 L5 14 M14 10 L10 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export default DialogBase;
