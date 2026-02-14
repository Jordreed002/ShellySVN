import { useState, useCallback } from 'react'

export type DragDropOperation = 'move' | 'copy'

interface DragDropState {
  isDragging: boolean
  isOver: boolean
  draggedPath: string | null
  dropTarget: string | null
  operation: DragDropOperation
}

interface UseDragDropOptions {
  onDrop?: (source: string, target: string, operation: DragDropOperation) => Promise<void>
  onDragStart?: (path: string) => void
  onDragEnd?: () => void
  validateDrop?: (source: string, target: string) => boolean | string
}

/**
 * Hook for handling drag and drop operations for files
 */
export function useFileDragDrop({
  onDrop,
  onDragStart,
  onDragEnd,
  validateDrop
}: UseDragDropOptions = {}) {
  const [state, setState] = useState<DragDropState>({
    isDragging: false,
    isOver: false,
    draggedPath: null,
    dropTarget: null,
    operation: 'move'
  })
  
  // Start dragging a file
  const handleDragStart = useCallback((path: string, e?: React.DragEvent) => {
    if (e) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', path)
    }
    
    setState(prev => ({
      ...prev,
      isDragging: true,
      draggedPath: path
    }))
    
    onDragStart?.(path)
  }, [onDragStart])
  
  // Handle drag over a potential drop target
  const handleDragOver = useCallback((targetPath: string, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    setState(prev => ({
      ...prev,
      isOver: true,
      dropTarget: targetPath
    }))
  }, [])
  
  // Handle leaving a drop target
  const handleDragLeave = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOver: false,
      dropTarget: null
    }))
  }, [])
  
  // Handle drop
  const handleDrop = useCallback(async (targetPath: string, e: React.DragEvent) => {
    e.preventDefault()
    
    const sourcePath = e.dataTransfer.getData('text/plain')
    
    if (!sourcePath || sourcePath === targetPath) {
      setState(prev => ({
        ...prev,
        isOver: false,
        dropTarget: null,
        isDragging: false,
        draggedPath: null
      }))
      return
    }
    
    // Validate drop if validator provided
    if (validateDrop) {
      const result = validateDrop(sourcePath, targetPath)
      if (result !== true) {
        console.warn('Invalid drop:', result)
        setState(prev => ({
          ...prev,
          isOver: false,
          dropTarget: null,
          isDragging: false,
          draggedPath: null
        }))
        return
      }
    }
    
    try {
      await onDrop?.(sourcePath, targetPath, state.operation)
    } catch (err) {
      console.error('Drop operation failed:', err)
    } finally {
      setState(prev => ({
        ...prev,
        isOver: false,
        dropTarget: null,
        isDragging: false,
        draggedPath: null
      }))
      
      onDragEnd?.()
    }
  }, [onDrop, validateDrop, state.operation, onDragEnd])
  
  // End dragging
  const handleDragEnd = useCallback(() => {
    setState(prev => ({
      ...prev,
      isDragging: false,
      draggedPath: null,
      isOver: false,
      dropTarget: null
    }))
    
    onDragEnd?.()
  }, [onDragEnd])
  
  // Set operation type (move or copy)
  const setOperation = useCallback((operation: DragDropOperation) => {
    setState(prev => ({ ...prev, operation }))
  }, [])
  
  return {
    state,
    handlers: {
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      onDragEnd: handleDragEnd
    },
    setOperation
  }
}

/**
 * Props for the DraggableFileRow component
 */
interface DraggableFileRowProps {
  path: string
  children: React.ReactNode
  onDrop?: (source: string, target: string) => void
  isDirectory?: boolean
  disabled?: boolean
}

/**
 * Wrapper component to make a file row draggable
 */
export function DraggableFileRow({ 
  path, 
  children, 
  onDrop, 
  isDirectory = false,
  disabled = false 
}: DraggableFileRowProps) {
  const [isOver, setIsOver] = useState(false)
  
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
    e.dataTransfer.setData('application/x-shellysvn-path', path)
  }
  
  const handleDragOver = (e: React.DragEvent) => {
    if (!isDirectory || disabled) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsOver(true)
  }
  
  const handleDragLeave = () => {
    setIsOver(false)
  }
  
  const handleDrop = (e: React.DragEvent) => {
    if (!isDirectory || disabled) return
    e.preventDefault()
    setIsOver(false)
    
    const sourcePath = e.dataTransfer.getData('text/plain')
    if (sourcePath && sourcePath !== path && onDrop) {
      onDrop(sourcePath, path)
    }
  }
  
  return (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        ${isOver ? 'bg-accent/20 border border-accent' : ''}
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab'}
      `}
    >
      {children}
    </div>
  )
}
