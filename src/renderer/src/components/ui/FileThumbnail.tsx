import { useState, useEffect } from 'react'
import { 
  File, 
  FileCode, 
  FileImage, 
  FileText, 
  FileArchive,
  FileSpreadsheet,
  FileJson,
  Folder
} from 'lucide-react'

interface FileThumbnailProps {
  filePath: string
  isDirectory: boolean
  size?: number
  className?: string
  showPreview?: boolean
}

// File type to icon mapping
function getFileIcon(filename: string, isDirectory: boolean) {
  if (isDirectory) return Folder
  
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    // Images
    'png': FileImage,
    'jpg': FileImage,
    'jpeg': FileImage,
    'gif': FileImage,
    'webp': FileImage,
    'ico': FileImage,
    'svg': FileImage,
    'bmp': FileImage,
    // Code
    'js': FileCode,
    'jsx': FileCode,
    'ts': FileCode,
    'tsx': FileCode,
    'py': FileCode,
    'rb': FileCode,
    'go': FileCode,
    'rs': FileCode,
    'java': FileCode,
    'c': FileCode,
    'cpp': FileCode,
    'h': FileCode,
    'cs': FileCode,
    'swift': FileCode,
    'kt': FileCode,
    'php': FileCode,
    'vue': FileCode,
    'svelte': FileCode,
    // Data
    'json': FileJson,
    'xml': FileJson,
    'yaml': FileJson,
    'yml': FileJson,
    'toml': FileJson,
    // Documents
    'md': FileText,
    'txt': FileText,
    'pdf': FileText,
    'doc': FileText,
    'docx': FileText,
    'rtf': FileText,
    // Spreadsheets
    'csv': FileSpreadsheet,
    'xls': FileSpreadsheet,
    'xlsx': FileSpreadsheet,
    // Archives
    'zip': FileArchive,
    'tar': FileArchive,
    'gz': FileArchive,
    'rar': FileArchive,
    '7z': FileArchive,
  }
  
  return iconMap[ext] || File
}

// Check if file is an image that can be thumbnailed
function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)
}

export function FileThumbnail({ 
  filePath, 
  isDirectory, 
  size = 16, 
  className = '',
  showPreview = true
}: FileThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  
  const filename = filePath.split(/[/\\]/).pop() || filePath
  const Icon = getFileIcon(filename, isDirectory)
  const isImage = isImageFile(filename)
  
  // Load thumbnail for images
  useEffect(() => {
    if (!isImage || !showPreview || isDirectory) {
      setThumbnailUrl(null)
      return
    }
    
    setLoading(true)
    setError(false)
    
    // Use IPC to read image as base64 (avoids file:// protocol security issues)
    window.api.fs.readImageAsBase64(filePath)
      .then(result => {
        if (result.success && result.data) {
          setThumbnailUrl(result.data)
        } else {
          setError(true)
        }
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [filePath, isImage, showPreview, isDirectory])
  
  // For directories or non-image files, show icon
  if (isDirectory || !isImage || !showPreview) {
    return (
      <Icon 
        className={`${className} ${isDirectory ? 'text-accent' : 'text-text-muted'}`}
        style={{ width: size, height: size }}
      />
    )
  }
  
  // Loading state
  if (loading) {
    return (
      <div 
        className={`animate-pulse bg-bg-tertiary rounded ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  
  // Error state - fall back to icon
  if (error || !thumbnailUrl) {
    return (
      <FileImage 
        className={`text-text-muted ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  
  // Show thumbnail
  return (
    <img 
      src={thumbnailUrl}
      alt={filename}
      className={`rounded-sm object-contain ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  )
}

// Hook to preload multiple thumbnails
export function useThumbnails(filePaths: string[], maxSize: number = 16) {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  
  useEffect(() => {
    const newThumbnails = new Map<string, string>()
    const imagePaths = filePaths.filter(p => isImageFile(p))
    
    if (imagePaths.length === 0) {
      setThumbnails(newThumbnails)
      return
    }
    
    let loaded = 0
    const total = imagePaths.length
    
    imagePaths.forEach(path => {
      window.api.fs.readImageAsBase64(path)
        .then(result => {
          if (result.success && result.data) {
            newThumbnails.set(path, result.data)
          }
          loaded++
          if (loaded === total) {
            setThumbnails(new Map(newThumbnails))
          }
        })
        .catch(() => {
          loaded++
          if (loaded === total) {
            setThumbnails(new Map(newThumbnails))
          }
        })
    })
  }, [filePaths.join(','), maxSize])
  
  return thumbnails
}
