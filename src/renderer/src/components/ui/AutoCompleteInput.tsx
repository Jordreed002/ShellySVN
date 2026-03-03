import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronUp, ChevronDown, ArrowRight } from 'lucide-react'

export interface AutocompleteOption {
  value: string
  label?: string
  description?: string
  category?: string
}

interface AutoCompleteInputProps {
  value: string
  onChange: (value: string) => void
  onSuggestionSelect?: (suggestion: string) => void
  suggestions: AutocompleteOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  inputClassName?: string
  maxHeight?: number
  minChars?: number
  showCategories?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  id?: string
}

export function AutoCompleteInput({
  value,
  onChange,
  onSuggestionSelect,
  suggestions,
  placeholder = 'Type to search...',
  disabled = false,
  className = '',
  inputClassName = '',
  maxHeight = 200,
  minChars = 0,
  showCategories = false,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id
}: AutoCompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isNavigating, setIsNavigating] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Filter suggestions based on input
  const filteredSuggestions = useMemo(() => {
    if (value.length < minChars) return []

    const lowerValue = value.toLowerCase()
    return suggestions.filter(s =>
      s.value.toLowerCase().includes(lowerValue) ||
      (s.label?.toLowerCase().includes(lowerValue)) ||
      (s.description?.toLowerCase().includes(lowerValue))
    )
  }, [value, suggestions, minChars])

  // Group suggestions by category if enabled
  const groupedSuggestions = useMemo(() => {
    if (!showCategories) {
      return { '': filteredSuggestions }
    }

    const groups: Record<string, AutocompleteOption[]> = {}
    for (const suggestion of filteredSuggestions) {
      const category = suggestion.category || 'Suggestions'
      if (!groups[category]) {
        groups[category] = []
      }
      groups[category].push(suggestion)
    }
    return groups
  }, [filteredSuggestions, showCategories])

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredSuggestions.length])

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && isOpen && filteredSuggestions.length > 0) {
      const highlightedElement = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, isOpen, filteredSuggestions.length])

  // Handle input focus
  const handleFocus = useCallback(() => {
    if (value.length >= minChars && filteredSuggestions.length > 0) {
      setIsOpen(true)
    }
  }, [value.length, minChars, filteredSuggestions.length])

  // Handle input blur
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Delay closing to allow click on suggestions
    setTimeout(() => {
      if (!listRef.current?.contains(document.activeElement)) {
        setIsOpen(false)
      }
    }, 150)
  }, [])

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setIsNavigating(false)

    if (newValue.length >= minChars) {
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }, [onChange, minChars])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || filteredSuggestions.length === 0) {
      // Open dropdown on arrow down
      if (e.key === 'ArrowDown' && value.length >= minChars) {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setIsNavigating(true)
        setHighlightedIndex(prev =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        )
        break

      case 'ArrowUp':
        e.preventDefault()
        setIsNavigating(true)
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        )
        break

      case 'Enter':
        if (!e.shiftKey) {
          e.preventDefault()
          const selected = filteredSuggestions[highlightedIndex]
          if (selected) {
            handleSelect(selected)
          }
        }
        break

      case 'Tab':
        if (filteredSuggestions.length > 0) {
          e.preventDefault()
          const selected = filteredSuggestions[highlightedIndex]
          if (selected) {
            handleSelect(selected)
          }
        }
        break

      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setIsNavigating(false)
        break
    }
  }, [isOpen, filteredSuggestions, highlightedIndex, value.length, minChars])

  // Handle suggestion selection
  const handleSelect = useCallback((option: AutocompleteOption) => {
    onChange(option.value)
    setIsOpen(false)
    setIsNavigating(false)
    onSuggestionSelect?.(option.value)
    inputRef.current?.focus()
  }, [onChange, onSuggestionSelect])

  // Handle mouse enter on suggestion
  const handleMouseEnter = useCallback((index: number) => {
    if (!isNavigating) {
      setHighlightedIndex(index)
    }
  }, [isNavigating])

  // Generate unique ID for accessibility
  const listId = useMemo(() => `autocomplete-list-${id || Math.random().toString(36).substring(2, 11)}`, [id])

  return (
    <div className={`relative ${className}`}>
      <textarea
        ref={inputRef}
        id={id}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`input resize-none ${inputClassName}`}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
        aria-activedescendant={isOpen && filteredSuggestions.length > 0 ? `${listId}-${highlightedIndex}` : undefined}
        rows={4}
      />

      {/* Suggestion indicator */}
      {filteredSuggestions.length > 0 && !isOpen && (
        <div className="absolute right-2 bottom-2 flex items-center gap-1 text-text-faint text-xs">
          <span>{filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? 's' : ''}</span>
          <ChevronDown className="w-3 h-3" />
        </div>
      )}

      {/* Dropdown */}
      {isOpen && filteredSuggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-dropdown overflow-auto"
          style={{ maxHeight }}
        >
          {Object.entries(groupedSuggestions).map(([category, items]) => (
            <li key={category} className={showCategories && category ? '' : undefined}>
              {showCategories && category && items.length > 0 && (
                <div className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-bg-tertiary border-b border-border">
                  {category}
                </div>
              )}
              {items.map((option, idx) => {
                const globalIndex = filteredSuggestions.indexOf(option)
                const isHighlighted = globalIndex === highlightedIndex

                return (
                  <button
                    key={`${option.value}-${globalIndex}`}
                    type="button"
                    role="option"
                    id={`${listId}-${globalIndex}`}
                    aria-selected={isHighlighted}
                    data-index={globalIndex}
                    className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-fast flex items-start gap-2 ${
                      isHighlighted
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:text-text hover:bg-bg-tertiary'
                    }`}
                    onClick={() => handleSelect(option)}
                    onMouseEnter={() => handleMouseEnter(globalIndex)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">
                        {option.label || option.value}
                      </div>
                      {option.description && (
                        <div className="text-xs text-text-muted truncate">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {isHighlighted && (
                      <ArrowRight className="w-4 h-4 flex-shrink-0 text-accent mt-0.5" />
                    )}
                  </button>
                )
              })}
            </li>
          ))}

          {/* Keyboard navigation hint */}
          <li className="px-3 py-1.5 text-xs text-text-faint border-t border-border bg-bg-tertiary/50 flex items-center justify-between">
            <span>
              <ChevronUp className="w-3 h-3 inline mx-0.5" />
              <ChevronDown className="w-3 h-3 inline mx-0.5" />
              to navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-bg rounded text-[10px]">Tab</kbd>
              <kbd className="px-1 py-0.5 bg-bg rounded text-[10px] ml-1">Enter</kbd>
              {' '}to select
            </span>
          </li>
        </ul>
      )}

      {/* Empty state */}
      {isOpen && filteredSuggestions.length === 0 && value.length >= minChars && (
        <div className="absolute z-50 w-full mt-1 px-3 py-4 text-center text-sm text-text-muted bg-bg-elevated border border-border rounded-lg shadow-dropdown">
          No suggestions available
        </div>
      )}
    </div>
  )
}

/**
 * Simple text input variant for single-line autocomplete
 */
export function AutoCompleteTextInput({
  value,
  onChange,
  onSuggestionSelect,
  suggestions,
  placeholder = 'Type to search...',
  disabled = false,
  className = '',
  inputClassName = '',
  maxHeight = 200,
  minChars = 0,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id
}: Omit<AutoCompleteInputProps, 'showCategories'>) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Filter suggestions based on input
  const filteredSuggestions = useMemo(() => {
    if (value.length < minChars) return []

    const lowerValue = value.toLowerCase()
    return suggestions.filter(s =>
      s.value.toLowerCase().includes(lowerValue) ||
      (s.label?.toLowerCase().includes(lowerValue))
    ).slice(0, 10) // Limit to 10 for performance
  }, [value, suggestions, minChars])

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredSuggestions.length])

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && isOpen && filteredSuggestions.length > 0) {
      const highlightedElement = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, isOpen, filteredSuggestions.length])

  // Handle input focus
  const handleFocus = useCallback(() => {
    if (value.length >= minChars && filteredSuggestions.length > 0) {
      setIsOpen(true)
    }
  }, [value.length, minChars, filteredSuggestions.length])

  // Handle input blur
  const handleBlur = useCallback(() => {
    setTimeout(() => setIsOpen(false), 150)
  }, [])

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    if (newValue.length >= minChars) {
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }, [onChange, minChars])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || filteredSuggestions.length === 0) {
      if (e.key === 'ArrowDown' && value.length >= minChars) {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        )
        break

      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        )
        break

      case 'Enter':
      case 'Tab':
        e.preventDefault()
        const selected = filteredSuggestions[highlightedIndex]
        if (selected) {
          onChange(selected.value)
          setIsOpen(false)
          onSuggestionSelect?.(selected.value)
        }
        break

      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }, [isOpen, filteredSuggestions, highlightedIndex, onChange, onSuggestionSelect, value.length, minChars])

  // Handle suggestion selection
  const handleSelect = useCallback((option: AutocompleteOption) => {
    onChange(option.value)
    setIsOpen(false)
    onSuggestionSelect?.(option.value)
    inputRef.current?.focus()
  }, [onChange, onSuggestionSelect])

  const listId = useMemo(() => `autocomplete-list-${id || Math.random().toString(36).substring(2, 11)}`, [id])

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`input ${inputClassName}`}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-autocomplete="list"
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
        aria-activedescendant={isOpen && filteredSuggestions.length > 0 ? `${listId}-${highlightedIndex}` : undefined}
      />

      {/* Dropdown */}
      {isOpen && filteredSuggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-dropdown overflow-auto"
          style={{ maxHeight }}
        >
          {filteredSuggestions.map((option, index) => (
            <li key={`${option.value}-${index}`}>
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={index === highlightedIndex}
                data-index={index}
                className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-fast ${
                  index === highlightedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:text-text hover:bg-bg-tertiary'
                }`}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <div className="truncate">{option.label || option.value}</div>
                {option.description && (
                  <div className="text-xs text-text-muted truncate">{option.description}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AutoCompleteInput
