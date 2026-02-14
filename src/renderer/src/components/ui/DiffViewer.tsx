import { useEffect, useState, useRef } from 'react'
import { X, FileText, AlertTriangle, Loader, Image as ImageIcon, ExternalLink } from 'lucide-react'
import type { SvnDiffResult, SvnDiffLine } from '@shared/types'
import { ImageDiffViewer, isImageFile } from './ImageDiffViewer'
import { useSettings } from '@renderer/hooks/useSettings'

interface DiffViewerProps {
  isOpen: boolean
  filePath: string
  onClose: () => void
}

export function DiffViewer({ isOpen, filePath, onClose }: DiffViewerProps) {
  const { settings } = useSettings()
  const [diff, setDiff] = useState<SvnDiffResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showImageDiff, setShowImageDiff] = useState(false)
  const [isOpeningExternal, setIsOpeningExternal] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  
  // Check if file is an image
  const isImage = isImageFile(filePath)
  
  // Check if external diff tool is configured
  const hasExternalDiffTool = settings.diffMerge.externalDiffTool && settings.diffMerge.externalDiffTool.trim() !== ''
  
  // Open in external diff tool
  const handleOpenExternal = async () => {
    if (!hasExternalDiffTool) return
    
    setIsOpeningExternal(true)
    try {
      // For working copy diff, we compare BASE vs working file
      // Export BASE revision to a temp location for comparison
      const tempPath = await window.api.app.getPath('temp')
      const baseFileName = `.svn-tmp-base-${Date.now()}-${filePath.split(/[/\\]/).pop()}`
      const basePath = `${tempPath}/${baseFileName}`
      
      // Export the BASE revision
      await window.api.svn.export(
        filePath,
        basePath,
        'BASE'
      )
      
      // Open external diff tool with BASE (left) vs working copy (right)
      const result = await window.api.external.openDiffTool(
        settings.diffMerge.externalDiffTool,
        basePath,
        filePath
      )
      
      if (!result.success) {
        setError(result.error || 'Failed to open external diff tool')
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to open external diff tool')
    } finally {
      setIsOpeningExternal(false)
    }
  }
  
  useEffect(() => {
    if (isOpen && filePath) {
      // If it's an image, show the image diff viewer
      if (isImage) {
        setShowImageDiff(true)
        setIsLoading(false)
        setDiff(null)
        return
      }
      
      setIsLoading(true)
      setError(null)
      setShowImageDiff(false)
      
      window.api.svn.diff(filePath)
        .then(result => {
          setDiff(result)
          setIsLoading(false)
        })
        .catch(err => {
          setError(err.message || 'Failed to get diff')
          setIsLoading(false)
        })
    }
  }, [isOpen, filePath, isImage])
  
  // Keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])
  
  if (!isOpen) return null
  
  // For image files, render ImageDiffViewer directly
  if (isImage && showImageDiff) {
    return (
      <ImageDiffViewer
        isOpen={isOpen}
        filePath={filePath}
        onClose={onClose}
      />
    )
  }
  
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[900px] max-w-[95vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <FileText className="w-5 h-5 text-accent" />
            Diff: {fileName}
          </h2>
          <div className="flex items-center gap-2">
            {hasExternalDiffTool && (
              <button 
                onClick={handleOpenExternal}
                disabled={isOpeningExternal || isLoading}
                className="btn btn-secondary text-sm"
                title={`Open in ${settings.diffMerge.externalDiffTool}`}
              >
                {isOpeningExternal ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                External
              </button>
            )}
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader className="w-8 h-8 text-accent animate-spin" />
                <span className="text-text-secondary">Loading diff...</span>
              </div>
            </div>
          )}
          
          {error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center p-8">
                <AlertTriangle className="w-10 h-10 text-warning" />
                <div>
                  <p className="text-text font-medium mb-1">Failed to load diff</p>
                  <p className="text-text-secondary text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}
          
          {diff && !isLoading && !error && (
            <>
              {diff.isBinary ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-center p-8">
                    {isImageFile(filePath) ? (
                      <>
                        <ImageIcon className="w-10 h-10 text-accent" />
                        <div>
                          <p className="text-text font-medium mb-1">Image File</p>
                          <p className="text-text-secondary text-sm mb-3">Visual comparison available</p>
                          <button 
                            onClick={() => setShowImageDiff(true)}
                            className="btn btn-primary"
                          >
                            <ImageIcon className="w-4 h-4" />
                            Open Visual Diff
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <FileText className="w-10 h-10 text-text-muted" />
                        <div>
                          <p className="text-text font-medium mb-1">Binary File</p>
                          <p className="text-text-secondary text-sm">Cannot display diff for binary files</p>
                          <button 
                            onClick={() => window.api.external.openFile(filePath)}
                            className="btn btn-secondary mt-3"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open Externally
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : !diff.hasChanges ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-center p-8">
                    <FileText className="w-10 h-10 text-svn-normal" />
                    <div>
                      <p className="text-text font-medium mb-1">No Changes</p>
                      <p className="text-text-secondary text-sm">This file has no local modifications</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div 
                  ref={contentRef}
                  className="flex-1 overflow-auto bg-bg font-mono text-sm"
                >
                  <DiffContent diff={diff} />
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Footer with stats */}
        {diff && diff.hasChanges && !diff.isBinary && (
          <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-t border-border flex items-center gap-4 text-sm">
            <span className="text-text-secondary">
              {diff.files.length} file{diff.files.length !== 1 ? 's' : ''} changed
            </span>
            <span className="text-svn-added">
              +{countLines(diff, 'added')} additions
            </span>
            <span className="text-svn-deleted">
              -{countLines(diff, 'removed')} deletions
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function countLines(diff: SvnDiffResult, type: 'added' | 'removed'): number {
  let count = 0
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === type) count++
      }
    }
  }
  return count
}

function DiffContent({ diff }: { diff: SvnDiffResult }) {
  return (
    <div className="min-w-max">
      {diff.files.map((file, fileIndex) => (
        <div key={fileIndex} className="mb-4">
          {/* File header */}
          <div className="diff-file-header sticky top-0 bg-bg-elevated px-4 py-2 border-b border-border z-10">
            <span className="text-text font-medium">
              {file.newPath || file.oldPath}
            </span>
            {file.oldPath !== file.newPath && (
              <span className="text-text-muted ml-2">
                (from {file.oldPath})
              </span>
            )}
          </div>
          
          {/* Hunks */}
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              {/* Hunk header */}
              <div className="diff-hunk-header bg-bg-tertiary px-4 py-1 text-text-muted text-xs">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              
              {/* Lines */}
              {hunk.lines.map((line, lineIndex) => (
                <DiffLine key={lineIndex} line={line} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DiffLine({ line }: { line: SvnDiffLine }) {
  const getLineClass = () => {
    switch (line.type) {
      case 'added':
        return 'diff-line-added'
      case 'removed':
        return 'diff-line-removed'
      case 'hunk':
        return 'diff-line-hunk'
      default:
        return 'diff-line-context'
    }
  }
  
  const getLineNumber = () => {
    if (line.type === 'added' && line.newLineNumber !== undefined) {
      return line.newLineNumber
    }
    if (line.type === 'removed' && line.oldLineNumber !== undefined) {
      return line.oldLineNumber
    }
    if (line.type === 'context') {
      return line.newLineNumber ?? line.oldLineNumber ?? ''
    }
    return ''
  }
  
  const getPrefix = () => {
    switch (line.type) {
      case 'added': return '+'
      case 'removed': return '-'
      case 'hunk': return ''
      default: return ' '
    }
  }
  
  return (
    <div className={`${getLineClass()} flex`}>
      {/* Line number */}
      <div className="diff-line-number w-12 flex-shrink-0 text-right pr-3 text-text-faint select-none">
        {getLineNumber()}
      </div>
      
      {/* Prefix */}
      <div className={`diff-line-prefix w-4 flex-shrink-0 ${
        line.type === 'added' ? 'text-svn-added' :
        line.type === 'removed' ? 'text-svn-deleted' :
        'text-text-muted'
      }`}>
        {getPrefix()}
      </div>
      
      {/* Content */}
      <div className="diff-line-content flex-1 whitespace-pre overflow-x-auto">
        {escapeHtml(line.content)}
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
