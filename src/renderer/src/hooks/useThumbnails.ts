import { useState, useEffect } from 'react'

// Check if file is an image that can be thumbnailed
export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext)
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
