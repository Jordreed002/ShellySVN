import { useState, useEffect, useRef } from 'react'
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
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
    
    // Use file:// protocol for local files
    const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`
    
    const img = new Image()
    img.onload = () => {
      // Create thumbnail using canvas
      const canvas = canvasRef.current
      if (!canvas) {
        setLoading(false)
        return
      }
      
      const maxSize = size * 2 // Render at 2x for crispness
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      
      canvas.width = width
      canvas.height = height
      
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height)
        setThumbnailUrl(canvas.toDataURL('image/png'))
      }
      setLoading(false)
    }
    
    img.onerror = () => {
      setError(true)
      setLoading(false)
    }
    
    img.src = fileUrl
    
    return () => {
      img.src = ''
    }
  }, [filePath, isImage, showPreview, size, isDirectory])
  
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
    <>
      <canvas ref={canvasRef} className="hidden" />
      <img 
        src={thumbnailUrl}
        alt={filename}
        className={`rounded-sm object-contain ${className}`}
        style={{ width: size, height: size }}
        loading="lazy"
      />
    </>
  )
}

// Hook to preload multiple thumbnails
export function useThumbnails(filePaths: string[], maxSize: number = 16) {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  
  useEffect(() => {
    const newThumbnails = new Map<string, string>()
    let loaded = 0
    const total = filePaths.filter(p => isImageFile(p)).length
    
    if (total === 0) {
      setThumbnails(newThumbnails)
      return
    }
    
    filePaths.forEach(path => {
      if (!isImageFile(path)) return
      
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          newThumbnails.set(path, canvas.toDataURL('image/png'))
        }
        
        loaded++
        if (loaded === total) {
          setThumbnails(new Map(newThumbnails))
        }
      }
      img.onerror = () => {
        loaded++
        if (loaded === total) {
          setThumbnails(new Map(newThumbnails))
        }
      }
      img.src = `file:///${path.replace(/\\/g, '/')}`
    })
  }, [filePaths.join(','), maxSize])
  
  return thumbnails
}
