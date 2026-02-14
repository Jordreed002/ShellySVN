import { useState, useCallback, useRef, useEffect } from 'react'

export type DragDropOperation = 'move' | 'copy' | 'link'
export type DropEffect = 'none' | 'copy' | 'move' | 'link'

interface DragDropState {
  isDragging: boolean
  isOver: boolean
  draggedPaths: string[]
  dropTarget: string | null
  operation: DragDropOperation
  dropEffect: DropEffect
  isValidDrop: boolean
  dragType: 'internal' | 'external' | null
}

interface UseDragDropOptions {
  onDrop?: (sources: string[], target: string, operation: DragDropOperation) => Promise<void>
  onDragStart?: (paths: string[]) => void
  onDragEnd?: () => void
  validateDrop?: (sources: string[], target: string) => boolean | string
  allowExternalFiles?: boolean
  onExternalFilesDrop?: (files: File[], target: string) => Promise<void>
}

interface DropZoneConfig {
  acceptedTypes?: string[]
  showDropIndicator?: boolean
}

/**
 * Enhanced hook for handling drag and drop operations for files
 */
export function useFileDragDrop({
  onDrop,
  onDragStart,
  onDragEnd,
  validateDrop,
  allowExternalFiles = true,
  onExternalFilesDrop
}: UseDragDropOptions = {}) {
  const [state, setState] = useState<DragDropState>({
    isDragging: false,
    isOver: false,
    draggedPaths: [],
    dropTarget: null,
    operation: 'move',
    dropEffect: 'move',
    isValidDrop: false,
    dragType: null
  })
  
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  
  // Create custom drag image
  useEffect(() => {
    return () => {
      if (dragImageRef.current && document.body.contains(dragImageRef.current)) {
        document.body.removeChild(dragImageRef.current)
      }
    }
  }, [])
  
  // Create drag preview element
  const createDragPreview = useCallback((paths: string[]): HTMLDivElement => {
    if (dragImageRef.current && document.body.contains(dragImageRef.current)) {
      document.body.removeChild(dragImageRef.current)
    }
    
    const preview = document.createElement('div')
    preview.className = 'fixed -top-full left-0 bg-bg-elevated border border-accent rounded-lg px-3 py-2 shadow-lg z-[9999]'
    preview.style.pointerEvents = 'none'
    
    const count = paths.length
    if (count === 1) {
      const name = paths[0].split(/[/\\]/).pop()
      preview.textContent = name || paths[0]
    } else {
      preview.textContent = `${count} items`
    }
    
    document.body.appendChild(preview)
    dragImageRef.current = preview
    
    return preview
  }, [])
  
  // Start dragging files
  const handleDragStart = useCallback((paths: string | string[], e?: React.DragEvent) => {
    const pathArray = Array.isArray(paths) ? paths : [paths]
    
    if (e) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', pathArray.join('\n'))
      e.dataTransfer.setData('application/x-shellysvn-paths', JSON.stringify(pathArray))
      
      // Set custom drag image
      const preview = createDragPreview(pathArray)
      e.dataTransfer.setDragImage(preview, 0, 0)
    }
    
    setState(prev => ({
      ...prev,
      isDragging: true,
      draggedPaths: pathArray,
      dragType: 'internal'
    }))
    
    onDragStart?.(pathArray)
  }, [onDragStart, createDragPreview])
  
  // Handle drag over a potential drop target
  const handleDragOver = useCallback((targetPath: string, e: React.DragEvent, _config?: DropZoneConfig) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Determine drag type
    const internalPaths = e.dataTransfer.types.includes('application/x-shellysvn-paths')
    const hasFiles = e.dataTransfer.types.includes('Files')
    
    if (!internalPaths && !hasFiles) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    
    // Check for modifier keys
    let dropEffect: DropEffect = 'move'
    let operation: DragDropOperation = 'move'
    
    if (e.ctrlKey || e.metaKey) {
      dropEffect = 'copy'
      operation = 'copy'
    } else if (e.altKey) {
      dropEffect = 'link'
      operation = 'link'
    }
    
    e.dataTransfer.dropEffect = dropEffect
    
    // Validate drop
    let isValidDrop = true
    
    if (internalPaths && validateDrop) {
      try {
        const pathsData = e.dataTransfer.getData('application/x-shellysvn-paths')
        const paths = pathsData ? JSON.parse(pathsData) : []
        const result = validateDrop(paths, targetPath)
        isValidDrop = result === true
      } catch {
        isValidDrop = false
      }
    }
    
    setState(prev => ({
      ...prev,
      isOver: true,
      dropTarget: targetPath,
      dropEffect,
      operation,
      isValidDrop,
      dragType: internalPaths ? 'internal' : 'external'
    }))
  }, [validateDrop])
  
  // Handle leaving a drop target
  const handleDragLeave = useCallback((e?: React.DragEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    
    setState(prev => ({
      ...prev,
      isOver: false,
      dropTarget: null,
      isValidDrop: false
    }))
  }, [])
  
  // Handle drop
  const handleDrop = useCallback(async (targetPath: string, e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const internalPathsData = e.dataTransfer.getData('application/x-shellysvn-paths')
    const isInternal = !!internalPathsData
    
    try {
      if (isInternal) {
        // Internal file drag-drop
        const sourcePaths: string[] = JSON.parse(internalPathsData)
        
        // Filter out dropping onto self
        const validPaths = sourcePaths.filter(p => {
          const parent = p.split(/[/\\]/).slice(0, -1).join(p.includes('\\') ? '\\' : '/')
          return p !== targetPath && parent !== targetPath && !targetPath.startsWith(p + (p.includes('\\') ? '\\' : '/'))
        })
        
        if (validPaths.length === 0) {
          setState(prev => ({
            ...prev,
            isOver: false,
            dropTarget: null,
            isDragging: false,
            draggedPaths: [],
            dragType: null
          }))
          return
        }
        
        // Validate drop
        if (validateDrop) {
          const result = validateDrop(validPaths, targetPath)
          if (result !== true) {
            console.warn('Invalid drop:', result)
            setState(prev => ({
              ...prev,
              isOver: false,
              dropTarget: null,
              isDragging: false,
              draggedPaths: [],
              dragType: null
            }))
            return
          }
        }
        
        await onDrop?.(validPaths, targetPath, state.operation)
      } else if (allowExternalFiles && e.dataTransfer.files.length > 0 && onExternalFilesDrop) {
        // External files dropped
        const files = Array.from(e.dataTransfer.files)
        await onExternalFilesDrop(files, targetPath)
      }
    } catch (err) {
      console.error('Drop operation failed:', err)
    } finally {
      setState(prev => ({
        ...prev,
        isOver: false,
        dropTarget: null,
        isDragging: false,
        draggedPaths: [],
        dragType: null,
        isValidDrop: false
      }))
      
      onDragEnd?.()
    }
  }, [onDrop, validateDrop, state.operation, onDragEnd, allowExternalFiles, onExternalFilesDrop])
  
  // End dragging
  const handleDragEnd = useCallback(() => {
    // Clean up drag preview
    if (dragImageRef.current && document.body.contains(dragImageRef.current)) {
      document.body.removeChild(dragImageRef.current)
      dragImageRef.current = null
    }
    
    setState(prev => ({
      ...prev,
      isDragging: false,
      draggedPaths: [],
      isOver: false,
      dropTarget: null,
      dragType: null,
      isValidDrop: false
    }))
    
    onDragEnd?.()
  }, [onDragEnd])
  
  // Set operation type
  const setOperation = useCallback((operation: DragDropOperation) => {
    setState(prev => ({ 
      ...prev, 
      operation,
      dropEffect: operation === 'copy' ? 'copy' : operation === 'link' ? 'link' : 'move'
    }))
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
 * Wrapper component to make a file row draggable
 */
interface DraggableFileRowProps {
  path: string
  children: React.ReactNode
  onDrop?: (sources: string[], target: string, operation: DragDropOperation) => void
  isDirectory?: boolean
  disabled?: boolean
  selectedPaths?: Set<string>
  className?: string
}

export function DraggableFileRow({ 
  path, 
  children, 
  onDrop, 
  isDirectory = false,
  disabled = false,
  selectedPaths,
  className = ''
}: DraggableFileRowProps) {
  const [isOver, setIsOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  
  const handleDragStart = (e: React.DragEvent) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    
    // Include all selected paths if this is part of a selection
    const pathsToDrag = selectedPaths?.has(path) ? Array.from(selectedPaths) : [path]
    
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pathsToDrag.join('\n'))
    e.dataTransfer.setData('application/x-shellysvn-paths', JSON.stringify(pathsToDrag))
    
    setIsDragging(true)
  }
  
  const handleDragEnd = () => {
    setIsDragging(false)
  }
  
  const handleDragOver = (e: React.DragEvent) => {
    if (!isDirectory || disabled) return
    e.preventDefault()
    e.stopPropagation()
    
    // Check if dragging over self
    try {
      const pathsData = e.dataTransfer.getData('application/x-shellysvn-paths')
      if (pathsData) {
        const paths: string[] = JSON.parse(pathsData)
        if (paths.includes(path)) return
      }
    } catch {
      // Ignore parse errors
    }
    
    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move'
    setIsOver(true)
  }
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
  }
  
  const handleDrop = async (e: React.DragEvent) => {
    if (!isDirectory || disabled) return
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    
    const pathsData = e.dataTransfer.getData('application/x-shellysvn-paths')
    if (pathsData) {
      const sourcePaths: string[] = JSON.parse(pathsData)
      // Filter out self
      const validPaths = sourcePaths.filter(p => p !== path)
      if (validPaths.length > 0 && onDrop) {
        const operation = e.ctrlKey || e.metaKey ? 'copy' : 'move'
        onDrop(validPaths, path, operation)
      }
    }
  }
  
  return (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        ${className}
        ${isOver ? 'bg-accent/20 ring-2 ring-accent ring-inset' : ''}
        ${isDragging ? 'opacity-50' : ''}
        ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
      `}
    >
      {children}
    </div>
  )
}

/**
 * Drop zone component for receiving external files
 */
interface DropZoneProps {
  onDrop: (files: File[], targetPath: string) => Promise<void>
  targetPath: string
  children: React.ReactNode
  acceptedTypes?: string[]
  className?: string
  disabled?: boolean
}

export function DropZone({
  onDrop,
  targetPath,
  children,
  acceptedTypes = [],
  className = '',
  disabled = false
}: DropZoneProps) {
  const [isOver, setIsOver] = useState(false)
  const [isValid, setIsValid] = useState(false)
  
  const checkFileType = useCallback((file: File): boolean => {
    if (acceptedTypes.length === 0) return true
    
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    return acceptedTypes.some(type => {
      if (type.startsWith('.')) {
        return ext === type.slice(1).toLowerCase()
      }
      if (type.includes('/')) {
        return file.type.match(type.replace('*', '.*')) !== null
      }
      return ext === type.toLowerCase()
    })
  }, [acceptedTypes])
  
  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    
    const hasValidFiles = Array.from(e.dataTransfer.files).some(checkFileType)
    
    e.dataTransfer.dropEffect = hasValidFiles ? 'copy' : 'none'
    setIsOver(true)
    setIsValid(hasValidFiles)
  }
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    setIsValid(false)
  }
  
  const handleDrop = async (e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    setIsValid(false)
    
    const files = Array.from(e.dataTransfer.files).filter(checkFileType)
    if (files.length > 0) {
      await onDrop(files, targetPath)
    }
  }
  
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative
        ${className}
        ${isOver && isValid ? 'bg-accent/10 ring-2 ring-accent ring-dashed' : ''}
        ${isOver && !isValid ? 'bg-error/10 ring-2 ring-error ring-dashed' : ''}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {children}
      {isOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80 pointer-events-none z-10">
          <div className={`
            px-4 py-2 rounded-lg text-sm font-medium
            ${isValid ? 'bg-accent text-white' : 'bg-error text-white'}
          `}>
            {isValid ? 'Drop to add files' : 'Invalid file type'}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Helper to perform SVN move/copy operations
 */
export async function performSvnOperation(
  sources: string[],
  target: string,
  operation: DragDropOperation
): Promise<boolean> {
  const api = window.api
  
  for (const source of sources) {
    const fileName = source.split(/[/\\]/).pop() || source
    const destination = target + (target.endsWith('/') || target.endsWith('\\') ? '' : '/') + fileName
    
    try {
      if (operation === 'copy') {
        await api.svn.copy(source, destination, `Copy from ${source}`)
      } else if (operation === 'move') {
        await api.svn.move(source, destination)
      } else if (operation === 'link') {
        // SVN externals - not implemented yet
        console.log('Creating external link not implemented yet')
      }
    } catch (err) {
      console.error(`Failed to ${operation} ${source} to ${destination}:`, err)
      return false
    }
  }
  
  return true
}
