import { useState, useCallback } from 'react'
import { ArrowRight, ArrowLeft, X, RefreshCw } from 'lucide-react'

interface DualPaneViewProps {
  leftPath: string
  rightPath: string
  onCopyLeftToRight?: () => void
  onCopyRightToLeft?: () => void
  onSyncPaths?: () => void
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  onToggle?: () => void
}

export function DualPaneView({
  leftPath,
  rightPath,
  onCopyLeftToRight,
  onCopyRightToLeft,
  onSyncPaths,
  leftContent,
  rightContent,
  onToggle
}: DualPaneViewProps) {
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Dual-pane toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary border-b border-border">
        <button
          onClick={onToggle}
          className="btn btn-secondary btn-sm gap-1.5"
          title="Close dual-pane view"
        >
          <X className="w-3.5 h-3.5" />
          <span>Close Dual Pane</span>
        </button>
        
        <div className="toolbar-divider" />
        
        <button
          onClick={onCopyLeftToRight}
          className="btn-icon-sm"
          title="Copy selected files from left to right"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        
        <button
          onClick={onCopyRightToLeft}
          className="btn-icon-sm"
          title="Copy selected files from right to left"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        
        <button
          onClick={onSyncPaths}
          className="btn-icon-sm"
          title="Sync both panes to same path"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        
        <div className="flex-1" />
        
        <div className="text-xs text-text-muted">
          <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-text-faint">Tab</kbd>
          <span className="ml-1">to switch panes</span>
        </div>
      </div>
      
      {/* Panes */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane */}
        <div 
          className={`flex-1 flex flex-col border-r border-border ${focusedPane === 'left' ? 'ring-1 ring-accent/30' : ''}`}
          onClick={() => setFocusedPane('left')}
        >
          <div className="px-3 py-2 bg-bg-secondary border-b border-border text-xs font-medium text-text-secondary truncate">
            {leftPath}
          </div>
          <div className="flex-1 overflow-hidden">
            {leftContent}
          </div>
        </div>
        
        {/* Right Pane */}
        <div 
          className={`flex-1 flex flex-col ${focusedPane === 'right' ? 'ring-1 ring-accent/30' : ''}`}
          onClick={() => setFocusedPane('right')}
        >
          <div className="px-3 py-2 bg-bg-secondary border-b border-border text-xs font-medium text-text-secondary truncate">
            {rightPath}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightContent}
          </div>
        </div>
      </div>
    </div>
  )
}

// Hook for dual-pane state management
export function useDualPane(initialPath: string) {
  const [isDualPane, setIsDualPane] = useState(false)
  const [leftPath, setLeftPath] = useState(initialPath)
  const [rightPath, setRightPath] = useState(initialPath)
  const [leftSelection, setLeftSelection] = useState<Set<string>>(new Set())
  const [rightSelection, setRightSelection] = useState<Set<string>>(new Set())
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  
  const toggleDualPane = useCallback(() => {
    setIsDualPane(prev => !prev)
  }, [])
  
  const syncPaths = useCallback((sourcePath: string) => {
    setLeftPath(sourcePath)
    setRightPath(sourcePath)
  }, [])
  
  const copyFiles = useCallback(async (sourcePath: string, targetPath: string, files: Set<string>) => {
    if (files.size === 0) {
      setCopyStatus('No files selected')
      setTimeout(() => setCopyStatus(null), 2000)
      return
    }
    
    setCopyStatus(`Copying ${files.size} file(s)...`)
    
    try {
      let copied = 0
      let failed = 0
      
      // Use SVN copy for versioned files, regular copy otherwise
      for (const file of files) {
        const fileName = file.split(/[/\\]/).pop() || file
        const sourceFile = `${sourcePath}/${fileName}`
        const targetFile = `${targetPath}/${fileName}`
        
        // Check if both paths are in SVN working copies
        const sourceVersioned = await window.api.fs.isVersioned(sourcePath)
        const targetVersioned = await window.api.fs.isVersioned(targetPath)
        
        if (sourceVersioned && targetVersioned) {
          // Use SVN copy to preserve history
          const result = await window.api.svn.copy(sourceFile, targetFile, `Copy ${fileName}`)
          if (result.success) {
            copied++
          } else {
            failed++
          }
        } else {
          // For non-versioned files, use filesystem copy
          const result = await window.api.fs.copyFile(sourceFile, targetFile)
          if (result.success) {
            copied++
          } else {
            failed++
          }
        }
      }
      
      if (failed > 0) {
        setCopyStatus(`Copied ${copied} file(s), ${failed} failed`)
      } else {
        setCopyStatus(`Copied ${copied} file(s) successfully`)
      }
    } catch (err) {
      setCopyStatus(`Copy failed: ${(err as Error).message}`)
    }
    
    setTimeout(() => setCopyStatus(null), 3000)
  }, [])
  
  const copyLeftToRight = useCallback(() => {
    copyFiles(leftPath, rightPath, leftSelection)
  }, [leftPath, rightPath, leftSelection, copyFiles])
  
  const copyRightToLeft = useCallback(() => {
    copyFiles(rightPath, leftPath, rightSelection)
  }, [leftPath, rightPath, rightSelection, copyFiles])
  
  return {
    isDualPane,
    setIsDualPane,
    toggleDualPane,
    leftPath,
    setLeftPath,
    rightPath,
    setRightPath,
    syncPaths,
    copyLeftToRight,
    copyRightToLeft,
    leftSelection,
    setLeftSelection,
    rightSelection,
    setRightSelection,
    copyStatus
  }
}
