import { useEffect, useCallback, useRef, useState, type RefObject } from 'react'

/**
 * Direction for navigation
 */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right' | 'home' | 'end'

/**
 * Options for keyboard navigation
 */
export interface KeyboardNavigationOptions<T = unknown> {
  /** Whether navigation is enabled */
  enabled?: boolean
  /** Number of items to navigate */
  itemCount: number
  /** Current focused index (controlled) */
  focusedIndex?: number
  /** Called when focused index changes */
  onFocusedIndexChange?: (index: number) => void
  /** Called when an item is selected (Enter/Space) */
  onSelect?: (index: number, item?: T) => void
  /** Called when Escape is pressed */
  onEscape?: () => void
  /** Called when Tab is pressed (return false to prevent default) */
  onTab?: (shiftKey: boolean) => boolean | void
  /** Whether to wrap around at boundaries */
  wrap?: boolean
  /** Orientation of the list */
  orientation?: 'horizontal' | 'vertical' | 'both'
  /** Number of columns (for grid navigation) */
  columns?: number
  /** Get item data by index */
  getItem?: (index: number) => T | undefined
  /** Scroll element into view */
  scrollIntoView?: boolean
  /** Container element for scrolling */
  containerRef?: RefObject<HTMLElement | null>
}

/**
 * Key mappings for navigation
 */
const NAVIGATION_KEYS: Record<string, NavigationDirection | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end'
}

/**
 * Hook for keyboard navigation within lists, grids, and trees.
 * Implements WCAG 2.1 keyboard accessibility requirements.
 *
 * @example
 * ```tsx
 * function List({ items }) {
 *   const { focusedIndex, handleKeyDown, focusedRef } = useKeyboardNavigation({
 *     itemCount: items.length,
 *     onSelect: (index) => console.log('Selected:', items[index]),
 *     onEscape: () => console.log('Escape pressed')
 *   })
 *
 *   return (
 *     <ul role="listbox" onKeyDown={handleKeyDown}>
 *       {items.map((item, index) => (
 *         <li
 *           key={item.id}
 *           ref={focusedIndex === index ? focusedRef : null}
 *           role="option"
 *           aria-selected={focusedIndex === index}
 *         >
 *           {item.name}
 *         </li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */
export function useKeyboardNavigation<T = unknown>(
  options: KeyboardNavigationOptions<T>
): {
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  handleKeyDown: (event: React.KeyboardEvent) => void
  focusedRef: RefObject<HTMLElement | null>
  focusFirst: () => void
  focusLast: () => void
  focusNext: () => void
  focusPrevious: () => void
} {
  const {
    enabled = true,
    itemCount,
    focusedIndex: controlledFocusedIndex,
    onFocusedIndexChange,
    onSelect,
    onEscape,
    onTab,
    wrap = true,
    orientation = 'vertical',
    columns = 1,
    getItem,
    scrollIntoView = true,
    containerRef
  } = options

  const focusedRef = useRef<HTMLElement | null>(null)
  const [internalFocusedIndex, setInternalFocusedIndex] = useState(0)

  // Use controlled or internal state
  const focusedIndex = controlledFocusedIndex ?? internalFocusedIndex

  // Update focused index
  const setFocusedIndex = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, itemCount - 1))

    if (onFocusedIndexChange) {
      onFocusedIndexChange(clampedIndex)
    } else {
      setInternalFocusedIndex(clampedIndex)
    }
  }, [itemCount, onFocusedIndexChange])

  // Navigation helpers
  const focusFirst = useCallback(() => setFocusedIndex(0), [setFocusedIndex])
  const focusLast = useCallback(() => setFocusedIndex(itemCount - 1), [setFocusedIndex, itemCount])

  const focusNext = useCallback(() => {
    setFocusedIndex(prev => {
      if (prev >= itemCount - 1) {
        return wrap ? 0 : prev
      }
      return prev + 1
    })
  }, [itemCount, wrap, setFocusedIndex])

  const focusPrevious = useCallback(() => {
    setFocusedIndex(prev => {
      if (prev <= 0) {
        return wrap ? itemCount - 1 : prev
      }
      return prev - 1
    })
  }, [itemCount, wrap, setFocusedIndex])

  // Scroll focused element into view
  useEffect(() => {
    if (!scrollIntoView || !focusedRef.current) return

    focusedRef.current.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth'
    })
  }, [focusedIndex, scrollIntoView])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!enabled || itemCount === 0) return

    const direction = NAVIGATION_KEYS[event.key]

    // Handle selection keys
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(focusedIndex, getItem?.(focusedIndex))
      return
    }

    // Handle Escape
    if (event.key === 'Escape') {
      event.preventDefault()
      onEscape?.()
      return
    }

    // Handle Tab
    if (event.key === 'Tab') {
      const shouldContinue = onTab?.(event.shiftKey)
      if (shouldContinue === false) {
        event.preventDefault()
      }
      return
    }

    // Handle navigation keys
    if (direction) {
      event.preventDefault()

      switch (direction) {
        case 'up':
          if (orientation === 'vertical' || orientation === 'both') {
            if (columns > 1) {
              // Grid navigation: move up one row
              setFocusedIndex(prev => {
                const newIndex = prev - columns
                return newIndex >= 0 ? newIndex : (wrap ? prev : 0)
              })
            } else {
              focusPrevious()
            }
          }
          break

        case 'down':
          if (orientation === 'vertical' || orientation === 'both') {
            if (columns > 1) {
              // Grid navigation: move down one row
              setFocusedIndex(prev => {
                const newIndex = prev + columns
                return newIndex < itemCount ? newIndex : (wrap ? prev : itemCount - 1)
              })
            } else {
              focusNext()
            }
          }
          break

        case 'left':
          if (orientation === 'horizontal' || orientation === 'both') {
            focusPrevious()
          }
          break

        case 'right':
          if (orientation === 'horizontal' || orientation === 'both') {
            focusNext()
          }
          break

        case 'home':
          focusFirst()
          break

        case 'end':
          focusLast()
          break
      }
    }
  }, [
    enabled,
    itemCount,
    focusedIndex,
    orientation,
    columns,
    wrap,
    onSelect,
    onEscape,
    onTab,
    getItem,
    setFocusedIndex,
    focusFirst,
    focusLast,
    focusNext,
    focusPrevious
  ])

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    focusedRef,
    focusFirst,
    focusLast,
    focusNext,
    focusPrevious
  }
}

/**
 * Hook for type-ahead navigation (typing to filter/select in a list)
 */
export function useTypeAheadNavigation<T>(
  options: {
    itemCount: number
    getItemLabel: (index: number, item: T) => string
    onSelect?: (index: number, item: T) => void
    delay?: number
    enabled?: boolean
  }
): {
  handleKeyDown: (event: React.KeyboardEvent) => boolean
  searchTerm: string
  resetSearch: () => void
} {
  const {
    itemCount,
    getItemLabel,
    onSelect,
    delay = 500,
    enabled = true
  } = options

  const [searchTerm, setSearchTerm] = useState('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetSearch = useCallback(() => {
    setSearchTerm('')
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Auto-reset search after delay
  useEffect(() => {
    if (searchTerm) {
      timeoutRef.current = setTimeout(resetSearch, delay)
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [searchTerm, delay, resetSearch])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!enabled) return false

    // Only handle printable characters
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return false
    }

    const char = event.key.toLowerCase()
    const newSearchTerm = searchTerm + char
    setSearchTerm(newSearchTerm)

    // Find matching item
    for (let i = 0; i < itemCount; i++) {
      // This assumes items are accessible - may need adjustment based on use case
      const label = getItemLabel(i, undefined as T).toLowerCase()
      if (label.startsWith(newSearchTerm)) {
        onSelect?.(i, undefined as T)
        return true
      }
    }

    // If no match with accumulated term, try just the new character
    if (searchTerm.length > 0) {
      for (let i = 0; i < itemCount; i++) {
        const label = getItemLabel(i, undefined as T).toLowerCase()
        if (label.startsWith(char)) {
          setSearchTerm(char)
          onSelect?.(i, undefined as T)
          return true
        }
      }
    }

    return false
  }, [enabled, itemCount, searchTerm, getItemLabel, onSelect])

  return {
    handleKeyDown,
    searchTerm,
    resetSearch
  }
}

/**
 * Hook for roving tabindex pattern (WCAG 2.1)
 * Only one element in a group is tabbable at a time
 */
export function useRovingTabIndex(
  options: {
    itemCount: number
    focusedIndex?: number
    onFocusedIndexChange?: (index: number) => void
    enabled?: boolean
  }
): {
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  getTabIndex: (index: number) => number
  handleKeyDown: (event: React.KeyboardEvent) => void
  handleFocus: (index: number) => void
} {
  const { itemCount, focusedIndex: controlledFocusedIndex, onFocusedIndexChange, enabled = true } = options

  const [internalFocusedIndex, setInternalFocusedIndex] = useState(0)
  const focusedIndex = controlledFocusedIndex ?? internalFocusedIndex

  const setFocusedIndex = useCallback((index: number) => {
    if (!enabled) return
    const clampedIndex = Math.max(0, Math.min(index, itemCount - 1))

    if (onFocusedIndexChange) {
      onFocusedIndexChange(clampedIndex)
    } else {
      setInternalFocusedIndex(clampedIndex)
    }
  }, [enabled, itemCount, onFocusedIndexChange])

  const getTabIndex = useCallback((index: number) => {
    if (!enabled) return -1
    return index === focusedIndex ? 0 : -1
  }, [enabled, focusedIndex])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!enabled) return

    const direction = NAVIGATION_KEYS[event.key]
    if (!direction) return

    event.preventDefault()

    switch (direction) {
      case 'up':
      case 'left':
        setFocusedIndex(focusedIndex > 0 ? focusedIndex - 1 : itemCount - 1)
        break
      case 'down':
      case 'right':
        setFocusedIndex(focusedIndex < itemCount - 1 ? focusedIndex + 1 : 0)
        break
      case 'home':
        setFocusedIndex(0)
        break
      case 'end':
        setFocusedIndex(itemCount - 1)
        break
    }
  }, [enabled, focusedIndex, itemCount, setFocusedIndex])

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index)
  }, [setFocusedIndex])

  return {
    focusedIndex,
    setFocusedIndex,
    getTabIndex,
    handleKeyDown,
    handleFocus
  }
}

export default useKeyboardNavigation
