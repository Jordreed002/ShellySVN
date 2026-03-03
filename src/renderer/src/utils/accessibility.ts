import type { CSSProperties } from 'react'

/**
 * Accessibility utility functions and constants
 * Implements WCAG 2.1 AA compliance helpers
 */

/**
 * Key codes for keyboard event handling
 */
export const KeyCodes = {
  TAB: 'Tab',
  ENTER: 'Enter',
  ESCAPE: 'Escape',
  SPACE: ' ',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
  DELETE: 'Delete',
  BACKSPACE: 'Backspace'
} as const

/**
 * Check if an element is focusable
 */
export function isFocusable(element: HTMLElement): boolean {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ')

  if (!element.matches(selector)) return false

  const style = window.getComputedStyle(element)
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         element.offsetParent !== null
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
  ))

  return elements.filter(isFocusable)
}

/**
 * Get the first and last focusable elements in a container
 */
export function getFocusEdges(container: HTMLElement): {
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
 * Announce a message to screen readers using ARIA live region
 */
export function announce(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  let announcer = document.getElementById('sr-announcer')

  if (!announcer) {
    announcer = document.createElement('div')
    announcer.id = 'sr-announcer'
    announcer.setAttribute('role', 'status')
    announcer.setAttribute('aria-live', 'polite')
    announcer.setAttribute('aria-atomic', 'true')
    announcer.className = 'sr-only'
    announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `
    document.body.appendChild(announcer)
  }

  announcer.setAttribute('aria-live', priority)
  announcer.textContent = message

  // Clear after announcement
  setTimeout(() => {
    announcer.textContent = ''
  }, 1000)
}

/**
 * Generate a unique ID for ARIA attributes
 */
let idCounter = 0
export function generateAriaId(prefix = 'aria'): string {
  return `${prefix}-${++idCounter}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Common ARIA role types
 */
export const AriaRoles = {
  ALERT: 'alert',
  ALERTDIALOG: 'alertdialog',
  BANNER: 'banner',
  BUTTON: 'button',
  CHECKBOX: 'checkbox',
  COMBOBOX: 'combobox',
  DIALOG: 'dialog',
  GRID: 'grid',
  GRIDCELL: 'gridcell',
  GROUP: 'group',
  LINK: 'link',
  LISTBOX: 'listbox',
  LISTITEM: 'listitem',
  MENU: 'menu',
  MENUBAR: 'menubar',
  MENUITEM: 'menuitem',
  MENUITEMCHECKBOX: 'menuitemcheckbox',
  MENUITEMRADIO: 'menuitemradio',
  NAVIGATION: 'navigation',
  OPTION: 'option',
  PROGRESSBAR: 'progressbar',
  RADIO: 'radio',
  RADIOGROUP: 'radiogroup',
  REGION: 'region',
  ROW: 'row',
  SEARCH: 'search',
  SLIDER: 'slider',
  SPINBUTTON: 'spinbutton',
  STATUS: 'status',
  SWITCH: 'switch',
  TAB: 'tab',
  TABLIST: 'tablist',
  TABPANEL: 'tabpanel',
  TEXTBOX: 'textbox',
  TOOLBAR: 'toolbar',
  TOOLTIP: 'tooltip',
  TREE: 'tree',
  TREEGRID: 'treegrid',
  TREEITEM: 'treeitem'
} as const

/**
 * Create accessible click handler that works with keyboard
 */
export function createAccessibleClickHandler(
  onClick: () => void,
  options: { preventDefault?: boolean } = {}
): {
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  role: string
  tabIndex: number
} {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === KeyCodes.ENTER || e.key === KeyCodes.SPACE) {
      if (options.preventDefault !== false) {
        e.preventDefault()
      }
      onClick()
    }
  }

  return {
    onClick,
    onKeyDown: handleKeyDown,
    role: 'button',
    tabIndex: 0
  }
}

/**
 * Check if the user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Check if the user prefers high contrast
 */
export function prefersHighContrast(): boolean {
  return window.matchMedia('(prefers-contrast: more)').matches
}

/**
 * Subscribe to accessibility preference changes
 */
export function subscribeToAccessibilityChanges(callback: {
  onReducedMotionChange?: (prefers: boolean) => void
  onHighContrastChange?: (prefers: boolean) => void
}): () => void {
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const highContrastQuery = window.matchMedia('(prefers-contrast: more)')

  const handleReducedMotion = (e: MediaQueryListEvent) => {
    callback.onReducedMotionChange?.(e.matches)
  }

  const handleHighContrast = (e: MediaQueryListEvent) => {
    callback.onHighContrastChange?.(e.matches)
  }

  reducedMotionQuery.addEventListener('change', handleReducedMotion)
  highContrastQuery.addEventListener('change', handleHighContrast)

  return () => {
    reducedMotionQuery.removeEventListener('change', handleReducedMotion)
    highContrastQuery.removeEventListener('change', handleHighContrast)
  }
}

/**
 * Get accessible name for an element
 */
export function getAccessibleName(element: HTMLElement): string {
  // Check aria-label
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label')!
  }

  // Check aria-labelledby
  if (element.getAttribute('aria-labelledby')) {
    const labelledBy = document.getElementById(element.getAttribute('aria-labelledby')!)
    if (labelledBy) {
      return labelledBy.textContent || ''
    }
  }

  // Check for associated label
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`)
    if (label) {
      return label.textContent || ''
    }
  }

  // Check for parent label
  const parentLabel = element.closest('label')
  if (parentLabel) {
    return parentLabel.textContent || ''
  }

  // Fall back to text content
  return element.textContent || ''
}

/**
 * Skip to main content - creates or focuses skip link target
 */
export function skipToMainContent(): void {
  const main = document.querySelector('main') || document.querySelector('[role="main"]')
  if (main instanceof HTMLElement) {
    main.setAttribute('tabindex', '-1')
    main.focus()
  }
}

/**
 * Visually hidden styles for screen reader only content
 */
export const visuallyHiddenStyles: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
}

/**
 * CSS class for visually hidden content
 */
export const VISUALLY_HIDDEN_CLASS = 'sr-only'
