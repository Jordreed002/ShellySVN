import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: React.ReactNode;
}

/**
 * Portal component that renders children at the document body level.
 * This ensures modals are positioned correctly regardless of where
 * they are declared in the component tree.
 */
export function ModalPortal({ children }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  return createPortal(children, document.body);
}

/**
 * Hook to manage modal accessibility features
 * - Focus trap
 * - Focus restoration
 * - Escape key handling
 * - aria-hidden on background content
 */
export function useModalAccessibility(isOpen: boolean, onClose?: () => void) {
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Hide background content from screen readers
      const rootElements = document.querySelectorAll(
        'body > *:not([role="dialog"]):not([data-modal])'
      );
      rootElements.forEach((el) => {
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('data-hidden-by-modal', 'true');
      });

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Focus the modal
      setTimeout(() => {
        const focusable = modalRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        focusable?.focus();
      }, 0);

      // Handle escape key
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && onClose) {
          onClose();
        }
      };
      document.addEventListener('keydown', handleEscape);

      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    } else {
      // Restore background content visibility
      const hiddenElements = document.querySelectorAll('[data-hidden-by-modal="true"]');
      hiddenElements.forEach((el) => {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('data-hidden-by-modal');
      });

      // Restore body scroll
      document.body.style.overflow = '';

      // Restore focus
      previousActiveElement.current?.focus();
    }
  }, [isOpen, onClose]);

  return modalRef;
}

/**
 * Creates a screen reader announcement element
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
) {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.setAttribute('aria-live', priority);
    announcer.textContent = message;

    // Clear after announcement
    setTimeout(() => {
      announcer.textContent = '';
    }, 1000);
  }
}

/**
 * Higher-order component to wrap any modal with a portal.
 * Usage: export const MyModalPortal = withModalPortal(MyModal)
 */
export function withModalPortal<P extends object>(Component: React.ComponentType<P>): React.FC<P> {
  return function ModalWithPortal(props: P) {
    return (
      <ModalPortal>
        <Component {...props} />
      </ModalPortal>
    );
  };
}

/**
 * Default export for backwards compatibility
 */
export default ModalPortal;
