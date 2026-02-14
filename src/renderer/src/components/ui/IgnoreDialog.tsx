import { useState } from 'react'
import { X, Eye, Minus, Plus, AlertCircle } from 'lucide-react'

interface IgnoreDialogProps {
  isOpen: boolean
  onClose: () => void
  path: string
  fileName?: string
  onApply?: (patterns: string[]) => void
}

const COMMON_IGNORE_PATTERNS = [
  { pattern: '*.log', description: 'Log files' },
  { pattern: '*.tmp', description: 'Temporary files' },
  { pattern: 'node_modules', description: 'Node.js modules' },
  { pattern: '.env', description: 'Environment files' },
  { pattern: '.DS_Store', description: 'macOS metadata' },
  { pattern: 'Thumbs.db', description: 'Windows thumbnails' },
  { pattern: '*.swp', description: 'Vim swap files' },
  { pattern: '.idea', description: 'IntelliJ IDEA config' },
  { pattern: '.vscode', description: 'VS Code config' },
  { pattern: 'dist', description: 'Build output' },
  { pattern: 'build', description: 'Build output' },
  { pattern: 'coverage', description: 'Test coverage' },
]

export function IgnoreDialog({ isOpen, onClose, path, fileName, onApply }: IgnoreDialogProps) {
  const [patterns, setPatterns] = useState<string[]>([])
  const [newPattern, setNewPattern] = useState('')
  const [ignoreType, setIgnoreType] = useState<'file' | 'extension' | 'pattern'>('file')
  const [error, setError] = useState<string | null>(null)
  
  if (!isOpen) return null
  
  const handleAddPattern = () => {
    if (!newPattern.trim()) {
      setError('Pattern cannot be empty')
      return
    }
    
    if (patterns.includes(newPattern.trim())) {
      setError('Pattern already added')
      return
    }
    
    setPatterns([...patterns, newPattern.trim()])
    setNewPattern('')
    setError(null)
  }
  
  const handleRemovePattern = (index: number) => {
    setPatterns(patterns.filter((_, i) => i !== index))
  }
  
  const handleAddQuickPattern = (pattern: string) => {
    if (!patterns.includes(pattern)) {
      setPatterns([...patterns, pattern])
    }
  }
  
  const handleApply = () => {
    if (onApply) {
      onApply(patterns)
    }
    onClose()
  }
  
  const generatePatternFromFileName = () => {
    if (!fileName) return ''
    
    switch (ignoreType) {
      case 'file':
        return fileName
      case 'extension':
        const ext = fileName.split('.').pop()
        return ext ? `*.${ext}` : fileName
      case 'pattern':
        return newPattern
      default:
        return ''
    }
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[500px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Eye className="w-5 h-5 text-accent" />
            Add to Ignore List
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {/* Quick options if a file is selected */}
          {fileName && (
            <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-text">Ignore this file by:</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setIgnoreType('file')}
                  className={`btn btn-sm ${ignoreType === 'file' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Exact name ({fileName})
                </button>
                <button
                  onClick={() => setIgnoreType('extension')}
                  className={`btn btn-sm ${ignoreType === 'extension' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Extension (*.{fileName.split('.').pop()})
                </button>
                <button
                  onClick={() => setIgnoreType('pattern')}
                  className={`btn btn-sm ${ignoreType === 'pattern' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Custom pattern
                </button>
              </div>
            </div>
          )}
          
          {/* Custom pattern input */}
          <div>
            <label className="text-sm font-medium text-text-secondary mb-1.5 block">
              Add pattern
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ignoreType !== 'pattern' ? generatePatternFromFileName() : newPattern}
                onChange={(e) => {
                  setIgnoreType('pattern')
                  setNewPattern(e.target.value)
                }}
                placeholder="*.log, node_modules, .env"
                className="input flex-1"
              />
              <button
                onClick={handleAddPattern}
                className="btn btn-primary"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            {error && (
              <p className="text-xs text-error mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
          
          {/* Patterns to add */}
          {patterns.length > 0 && (
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1.5 block">
                Patterns to add:
              </label>
              <div className="flex flex-wrap gap-2">
                {patterns.map((pattern, index) => (
                  <div
                    key={pattern}
                    className="flex items-center gap-1 bg-bg-tertiary rounded-full px-3 py-1"
                  >
                    <span className="text-sm">{pattern}</span>
                    <button
                      onClick={() => handleRemovePattern(index)}
                      className="text-text-muted hover:text-error"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Quick patterns */}
          <div>
            <label className="text-sm font-medium text-text-secondary mb-1.5 block">
              Quick add common patterns:
            </label>
            <div className="flex flex-wrap gap-1">
              {COMMON_IGNORE_PATTERNS.map(({ pattern, description }) => (
                <button
                  key={pattern}
                  onClick={() => handleAddQuickPattern(pattern)}
                  disabled={patterns.includes(pattern)}
                  className={`text-xs px-2 py-1 rounded transition-fast ${
                    patterns.includes(pattern)
                      ? 'bg-bg-elevated text-text-faint'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-elevated'
                  }`}
                  title={description}
                >
                  {pattern}
                </button>
              ))}
            </div>
          </div>
          
          {/* Info */}
          <div className="text-xs text-text-faint">
            <p>Patterns will be added to the <code className="text-text-secondary">svn:ignore</code> property of:</p>
            <p className="font-mono mt-1 text-text-secondary truncate">{path}</p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="btn btn-primary"
            disabled={patterns.length === 0}
          >
            <Eye className="w-4 h-4" />
            Ignore {patterns.length} pattern{patterns.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
