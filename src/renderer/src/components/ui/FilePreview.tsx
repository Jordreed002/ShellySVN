import { useState, useEffect, useMemo, memo } from 'react'
import { X, FileText, FileImage, FileCode, File, Copy, Check, ChevronRight } from 'lucide-react'

interface FilePreviewProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
  onOpen?: () => void
  className?: string
}

export const FilePreview = memo(function FilePreview({ 
  filePath, 
  isOpen, 
  onClose, 
  onOpen,
  className = '' 
}: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fileType = useMemo(() => {
    if (!filePath) return null
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp'].includes(ext)) {
      return 'image'
    }
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'swift', 'kt', 'php', 'vue', 'svelte'].includes(ext)) {
      return 'code'
    }
    if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'config'].includes(ext)) {
      return 'config'
    }
    if (['md', 'txt', 'rst', 'log'].includes(ext)) {
      return 'text'
    }
    return 'unknown'
  }, [filePath])

  useEffect(() => {
    if (!filePath || !isOpen || fileType === 'image') {
      setContent(null)
      return
    }

    const loadContent = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await window.api.fs.readFile(filePath)
        if (result.success && result.content) {
          setContent(result.content)
        } else {
          setError(result.error || 'Failed to read file')
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setIsLoading(false)
      }
    }

    loadContent()
  }, [filePath, isOpen, fileType])

  const handleCopy = async () => {
    if (content) {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const filename = filePath ? filePath.split(/[/\\]/).pop() || filePath : 'Preview'

  // Memoize truncated content for performance
  const displayContent = useMemo(() => {
    if (!content) return null
    // Limit to 30KB for better performance
    if (content.length > 30000) {
      return content.slice(0, 30000) + '\n\n... (content truncated)'
    }
    return content
  }, [content])

  return (
    <div 
      className={`
        flex flex-col bg-bg-secondary border-l border-border
        transition-[width] duration-150 ease-out overflow-hidden
        will-change-[width] h-full min-h-0 flex-shrink-0
        ${isOpen ? 'w-80' : 'w-0'}
        ${className}
      `}
    >
      {/* Collapsed state - show toggle button */}
      {!isOpen && onOpen && (
        <button
          onClick={onOpen}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-2 bg-bg-tertiary border border-border rounded-l hover:bg-bg-elevated transition-fast"
          title="Open preview panel"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
      
      {/* Header */}
      <div className={`
        flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border
        ${isOpen ? 'opacity-100' : 'opacity-0'}
      `}>
        <div className="flex items-center gap-2 min-w-0">
          {fileType === 'image' && <FileImage className="w-4 h-4 text-accent flex-shrink-0" />}
          {fileType === 'code' && <FileCode className="w-4 h-4 text-accent flex-shrink-0" />}
          {fileType === 'config' && <FileText className="w-4 h-4 text-warning flex-shrink-0" />}
          {fileType === 'text' && <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />}
          {fileType === 'unknown' && <File className="w-4 h-4 text-text-muted flex-shrink-0" />}
          <span className="text-sm font-medium text-text truncate">{filename}</span>
        </div>
        <div className="flex items-center gap-1">
          {content && (
            <button
              onClick={handleCopy}
              className="btn-icon-sm"
              title="Copy content"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={onClose}
            className="btn-icon-sm"
            title="Close preview"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {!filePath ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <File className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-sm text-text-muted">Select a file to preview</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <File className="w-12 h-12 text-error mb-3" />
            <p className="text-sm text-error">{error}</p>
          </div>
        ) : fileType === 'image' ? (
          <div className="flex items-center justify-center h-full">
            <img
              src={`file://${filePath}`}
              alt={filename}
              className="max-w-full max-h-full object-contain rounded"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
                setError('Failed to load image')
              }}
            />
          </div>
        ) : displayContent ? (
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
            {displayContent}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <File className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-sm text-text-muted">No content available</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-bg-tertiary border-t border-border text-xs text-text-muted truncate">
        {filePath || 'No file selected'}
      </div>
    </div>
  )
})
