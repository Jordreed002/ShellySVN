import { useEffect, useCallback, useRef, type RefObject } from 'react'

/**
 * Options for the useFocusTrap hook
 */
export interface FocusTrapOptions {
  /** Whether the focus trap is active */
  active?: boolean
  /** Initial element to focus when trap activates */
  initialFocus?: string | RefObject<HTMLElement | null>
  /** Element to return focus to when trap deactivates */
  returnFocus?: boolean | string | RefObject<HTMLElement | null>
  /** Whether to allow focus to escape with Tab/Shift+Tab */
  allowOutsideClick?: boolean
  /** Called when focus attempts to escape */
  onEscape?: () => void
  /** Whether to prevent scroll on focus */
  preventScroll?: boolean
}

/**
 * Get all focusable elements within a container
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ')

  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector))

  // Filter out elements that are not visible
  return elements.filter(el => {
    const style = window.getComputedStyle(el)
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           el.offsetParent !== null
  })
}

/**
 * Get the first and last focusable elements
 */
function getFocusEdges(container: HTMLElement): {
  first: HTMLElement | null
  last: HTMLElement | null
} {
  const focusable = getFocusableElements(container)
  return {
    first: focusable[0] || null,
    last: focusable[focusable.length - 1] || null
  }
}

/**
 * Hook to trap focus within a container element (for modals, dialogs, etc.)
 * Implements WCAG 2.1 focus management requirements
 *
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose }) {
 *   const containerRef = useFocusTrap({
 *     active: isOpen,
 *     onEscape: onClose,
 *     returnFocus: true
 *   })
 *
 *   return isOpen ? (
 *     <div ref={containerRef} role="dialog" aria-modal="true">
 *       <button onClick={onClose}>Close</button>
 *       {/* other content *\/}
 *     </div>
 *   ) : null
 * }
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: FocusTrapOptions = {}
): RefObject<T | null> {
  const {
    active = true,
    initialFocus,
    returnFocus = true,
    allowOutsideClick = false,
    onEscape,
    preventScroll = false
  } = options

  const containerRef = useRef<T>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isInitializedRef = useRef(false)

  // Handle keyboard navigation within trap
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!containerRef.current || !active) return

    // Handle Escape key
    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape?.()
      return
    }

    // Handle Tab key for focus trapping
    if (event.key === 'Tab') {
      const { first, last } = getFocusEdges(containerRef.current)

      if (!first || !last) {
        event.preventDefault()
        return
      }

      // If there's only one focusable element, keep focus there
      if (first === last) {
        event.preventDefault()
        first.focus()
        return
      }

      // Handle Tab (forward) and Shift+Tab (backward)
      if (event.shiftKey) {
        // Shift+Tab: if on first element, go to last
        if (document.activeElement === first || !containerRef.current.contains(document.activeElement)) {
          event.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if on last element, go to first
        if (document.activeElement === last || !containerRef.current.contains(document.activeElement)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
  }, [active, onEscape])

  // Handle clicks outside the trap
  const handleOutsideClick = useCallback((event: MouseEvent) => {
    if (!containerRef.current || !active || allowOutsideClick) return

    const target = event.target as Node
    if (!containerRef.current.contains(target)) {
      event.preventDefault()
      event.stopPropagation()

      // Refocus the container
      const { first } = getFocusEdges(containerRef.current)
      first?.focus()
    }
  }, [active, allowOutsideClick])

  // Initialize focus trap
  useEffect(() => {
    if (!active || !containerRef.current) {
      // When deactivating, return focus
      if (!active && returnFocus && previousFocusRef.current && isInitializedRef.current) {
        previousFocusRef.current.focus({ preventScroll })
      }
      isInitializedRef.current = false
      return
    }

    // Store the previously focused element
    if (!isInitializedRef.current) {
      previousFocusRef.current = document.activeElement as HTMLElement
    }
    isInitializedRef.current = true

    // Set initial focus
    const setInitialFocus = () => {
      if (!containerRef.current) return

      let elementToFocus: HTMLElement | null = null

      if (initialFocus) {
        if (typeof initialFocus === 'string') {
          elementToFocus = containerRef.current.querySelector(initialFocus)
        } else if ('current' in initialFocus) {
          elementToFocus = initialFocus.current
        }
      }

      // Fall back to first focusable element
      if (!elementToFocus) {
        const { first } = getFocusEdges(containerRef.current)
        elementToFocus = first
      }

      if (elementToFocus) {
        elementToFocus.focus({ preventScroll })
      }
    }

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(setInitialFocus, 0)

    // Add event listeners
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('click', handleOutsideClick, true)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('click', handleOutsideClick, true)
    }
  }, [active, initialFocus, returnFocus, preventScroll, handleKeyDown, handleOutsideClick])

  return containerRef
}

/**
 * Hook to manage focus within a container without strict trapping.
 * Useful for sidebars, menus, etc. where some focus escape is allowed.
 */
export function useFocusManagement<T extends HTMLElement = HTMLDivElement>(
  options: {
    active?: boolean
    initialFocus?: string | RefObject<HTMLElement | null>
    restoreFocus?: boolean
  } = {}
): RefObject<T | null> {
  const { active = true, initialFocus, restoreFocus = true } = options
  const containerRef = useRef<T>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) {
      if (!active && restoreFocus && previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
      return
    }

    // Store previous focus
    previousFocusRef.current = document.activeElement as HTMLElement

    // Set initial focus
    let elementToFocus: HTMLElement | null = null

    if (initialFocus) {
      if (typeof initialFocus === 'string') {
        elementToFocus = containerRef.current.querySelector(initialFocus)
      } else if ('current' in initialFocus) {
        elementToFocus = initialFocus.current
      }
    }

    if (!elementToFocus) {
      const { first } = getFocusEdges(containerRef.current)
      elementToFocus = first
    }

    elementToFocus?.focus()

  }, [active, initialFocus, restoreFocus])

  return containerRef
}

export default useFocusTrap
