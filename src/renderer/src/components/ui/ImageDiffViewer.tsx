import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Image as ImageIcon, AlertTriangle, Loader, RotateCw, Move, Columns, Rows, Maximize2 } from 'lucide-react'

interface ImageDiffViewerProps {
  isOpen: boolean
  filePath: string
  oldRevision?: string
  onClose: () => void
}

type ViewMode = 'side-by-side' | 'overlay' | 'swipe' | 'difference'
type ZoomLevel = 'fit' | '100' | '200' | '400'

export function ImageDiffViewer({ isOpen, filePath, oldRevision, onClose }: ImageDiffViewerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [oldImage, setOldImage] = useState<string | null>(null)
  const [newImage, setNewImage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side')
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('fit')
  const [customZoom, setCustomZoom] = useState(100)
  const [overlayOpacity, setOverlayOpacity] = useState(50)
  const [swipePosition, setSwipePosition] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const [rotation, setRotation] = useState({ old: 0, new: 0 })
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  
  const containerRef = useRef<HTMLDivElement>(null)
  const oldImageRef = useRef<HTMLImageElement>(null)
  const newImageRef = useRef<HTMLImageElement>(null)

  // Load images
  useEffect(() => {
    if (isOpen && filePath) {
      setIsLoading(true)
      setError(null)
      
      const loadImage = async (path: string, _revision?: string): Promise<string> => {
        try {
          // Get file content as base64 data URL
          const result = await window.api.fs.readFile(path)
          if (result.success && result.content) {
            // Check if it's already a data URL or needs conversion
            if (result.content.startsWith('data:')) {
              return result.content
            }
            // Assume it's base64 encoded
            const ext = path.split('.').pop()?.toLowerCase() || 'png'
            const mimeTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'bmp': 'image/bmp',
              'webp': 'image/webp',
              'svg': 'image/svg+xml',
              'ico': 'image/x-icon',
              'tiff': 'image/tiff',
              'tif': 'image/tiff'
            }
            const mimeType = mimeTypes[ext] || 'image/png'
            return `data:${mimeType};base64,${result.content}`
          }
          throw new Error('Failed to read file')
        } catch (err) {
          throw new Error(`Failed to load image: ${(err as Error).message}`)
        }
      }

      // For now, load current file as new image
      // In a full implementation, we'd also load the BASE revision
      Promise.all([
        loadImage(filePath),
        oldRevision ? loadImage(filePath, oldRevision) : Promise.resolve(null)
      ])
        .then(([newImg, oldImg]) => {
          setNewImage(newImg)
          setOldImage(oldImg)
          setIsLoading(false)
        })
        .catch(err => {
          setError(err.message || 'Failed to load images')
          setIsLoading(false)
        })
    }
  }, [isOpen, filePath, oldRevision])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case '1':
          setViewMode('side-by-side')
          break
        case '2':
          setViewMode('overlay')
          break
        case '3':
          setViewMode('swipe')
          break
        case '4':
          setViewMode('difference')
          break
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setCustomZoom(prev => Math.min(prev + 25, 400))
          }
          break
        case '-':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setCustomZoom(prev => Math.max(prev - 25, 25))
          }
          break
        case '0':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            setZoomLevel('fit')
            setCustomZoom(100)
            setPanPosition({ x: 0, y: 0 })
          }
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Handle swipe dragging
  const handleSwipeMouseDown = useCallback((e: React.MouseEvent) => {
    if (viewMode !== 'swipe') return
    setIsDragging(true)
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 100
      setSwipePosition(Math.max(0, Math.min(100, x)))
    }
  }, [viewMode])

  const handleSwipeMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || viewMode !== 'swipe') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 100
      setSwipePosition(Math.max(0, Math.min(100, x)))
    }
  }, [isDragging, viewMode])

  const handleSwipeMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Handle panning
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel !== 'fit' || customZoom > 100) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y })
    }
  }, [zoomLevel, customZoom, panPosition])

  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    setPanPosition({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    })
  }, [isPanning, panStart])

  const handlePanMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleZoomPreset = (level: ZoomLevel) => {
    setZoomLevel(level)
    if (level === 'fit') {
      setCustomZoom(100)
      setPanPosition({ x: 0, y: 0 })
    } else {
      const num = parseInt(level, 10)
      setCustomZoom(num)
    }
  }

  const handleRotate = (target: 'old' | 'new') => {
    setRotation(prev => ({
      ...prev,
      [target]: (prev[target] + 90) % 360
    }))
  }

  const resetView = () => {
    setZoomLevel('fit')
    setCustomZoom(100)
    setOverlayOpacity(50)
    setSwipePosition(50)
    setRotation({ old: 0, new: 0 })
    setPanPosition({ x: 0, y: 0 })
  }

  if (!isOpen) return null

  const fileName = filePath.split(/[/\\]/).pop() || filePath

  const getZoomStyle = (): React.CSSProperties => {
    if (zoomLevel === 'fit') {
      return {
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain' as const
      }
    }
    return {
      transform: `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)`,
      transformOrigin: 'center center',
      cursor: isPanning ? 'grabbing' : 'grab'
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[1200px] max-w-[98vw] h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <h2 className="modal-title">
            <ImageIcon className="w-5 h-5 text-accent" />
            Image Diff: {fileName}
          </h2>
          <div className="flex items-center gap-2">
            {/* View Mode Buttons */}
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`btn-icon-sm ${viewMode === 'side-by-side' ? 'bg-accent/20 text-accent' : ''}`}
                title="Side by Side (1)"
              >
                <Columns className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('overlay')}
                className={`btn-icon-sm ${viewMode === 'overlay' ? 'bg-accent/20 text-accent' : ''}`}
                title="Overlay (2)"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('swipe')}
                className={`btn-icon-sm ${viewMode === 'swipe' ? 'bg-accent/20 text-accent' : ''}`}
                title="Swipe (3)"
              >
                <Columns className="w-4 h-4" />
              </button>
            </div>
            
            {/* Zoom Controls */}
            <div className="flex items-center gap-1 border-l border-border pl-2 mr-2">
              <button
                onClick={() => handleZoomPreset('fit')}
                className={`btn-icon-sm text-xs px-2 ${zoomLevel === 'fit' ? 'bg-accent/20 text-accent' : ''}`}
                title="Fit (Ctrl+0)"
              >
                Fit
              </button>
              <button
                onClick={() => handleZoomPreset('100')}
                className={`btn-icon-sm text-xs px-2 ${zoomLevel === '100' ? 'bg-accent/20 text-accent' : ''}`}
              >
                100%
              </button>
              <button
                onClick={() => handleZoomPreset('200')}
                className={`btn-icon-sm text-xs px-2 ${zoomLevel === '200' ? 'bg-accent/20 text-accent' : ''}`}
              >
                200%
              </button>
            </div>
            
            <button onClick={resetView} className="btn-icon-sm" title="Reset View">
              <RotateCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="btn-icon-sm">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4">
          {viewMode === 'overlay' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">Opacity:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-24 accent-accent"
              />
              <span className="text-xs text-text-muted w-8">{overlayOpacity}%</span>
            </div>
          )}
          
          {viewMode === 'swipe' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">Drag to compare</span>
              <span className="text-xs text-text-muted">({Math.round(swipePosition)}%)</span>
            </div>
          )}
          
          {customZoom > 100 && (
            <div className="flex items-center gap-2 ml-auto">
              <Move className="w-3 h-3 text-text-muted" />
              <span className="text-xs text-text-muted">Drag to pan</span>
            </div>
          )}
          
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-text-muted">
              Zoom: {zoomLevel === 'fit' ? 'Fit' : `${customZoom}%`}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader className="w-8 h-8 text-accent animate-spin" />
                <span className="text-text-secondary">Loading images...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center p-8">
                <AlertTriangle className="w-10 h-10 text-warning" />
                <div>
                  <p className="text-text font-medium mb-1">Failed to load images</p>
                  <p className="text-text-secondary text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && newImage && (
            <div 
              ref={containerRef}
              className="flex-1 overflow-auto bg-bg-tertiary flex items-center justify-center p-4"
              onMouseMove={(e) => {
                handleSwipeMouseMove(e)
                handlePanMouseMove(e)
              }}
              onMouseUp={() => {
                handleSwipeMouseUp()
                handlePanMouseUp()
              }}
              onMouseLeave={() => {
                handleSwipeMouseUp()
                handlePanMouseUp()
              }}
              style={{ cursor: viewMode === 'swipe' ? 'col-resize' : isPanning ? 'grabbing' : 'default' }}
            >
              {viewMode === 'side-by-side' && (
                <div className="flex items-center justify-center gap-4 w-full h-full">
                  {/* Old Image (Left) */}
                  <div className="flex-1 flex flex-col items-center justify-center h-full border border-border rounded-lg bg-bg overflow-hidden">
                    <div className="w-full bg-bg-secondary px-3 py-2 border-b border-border flex items-center justify-between">
                      <span className="text-xs text-text-secondary font-medium">Original (BASE)</span>
                      <button
                        onClick={() => handleRotate('old')}
                        className="btn-icon-sm"
                        title="Rotate"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </div>
                    <div 
                      className="flex-1 flex items-center justify-center p-2 overflow-auto"
                      onMouseDown={handlePanMouseDown}
                    >
                      {oldImage ? (
                        <img
                          ref={oldImageRef}
                          src={oldImage}
                          alt="Original"
                          style={{
                            ...getZoomStyle(),
                            transform: `rotate(${rotation.old}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                          }}
                          className="max-w-full max-h-full"
                          draggable={false}
                        />
                      ) : (
                        <div className="text-text-muted text-sm">No previous version</div>
                      )}
                    </div>
                  </div>

                  {/* New Image (Right) */}
                  <div className="flex-1 flex flex-col items-center justify-center h-full border border-border rounded-lg bg-bg overflow-hidden">
                    <div className="w-full bg-bg-secondary px-3 py-2 border-b border-border flex items-center justify-between">
                      <span className="text-xs text-text-secondary font-medium">Modified (WORKING)</span>
                      <button
                        onClick={() => handleRotate('new')}
                        className="btn-icon-sm"
                        title="Rotate"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </div>
                    <div 
                      className="flex-1 flex items-center justify-center p-2 overflow-auto"
                      onMouseDown={handlePanMouseDown}
                    >
                      <img
                        ref={newImageRef}
                        src={newImage}
                        alt="Modified"
                        style={{
                          ...getZoomStyle(),
                          transform: `rotate(${rotation.new}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                        }}
                        className="max-w-full max-h-full"
                        draggable={false}
                      />
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'overlay' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div 
                    className="relative max-w-full max-h-full"
                    onMouseDown={handlePanMouseDown}
                  >
                    {/* Base image */}
                    <img
                      src={newImage}
                      alt="Modified"
                      style={{
                        ...getZoomStyle(),
                        transform: `rotate(${rotation.new}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                      }}
                      className="max-w-full max-h-[calc(90vh-200px)]"
                      draggable={false}
                    />
                    {/* Overlay image */}
                    {oldImage && (
                      <img
                        src={oldImage}
                        alt="Original"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          opacity: overlayOpacity / 100,
                          ...getZoomStyle(),
                          transform: `rotate(${rotation.old}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                        }}
                        className="max-w-full max-h-[calc(90vh-200px)] pointer-events-none"
                        draggable={false}
                      />
                    )}
                  </div>
                </div>
              )}

              {viewMode === 'swipe' && (
                <div 
                  className="relative w-full h-full overflow-hidden"
                  onMouseDown={handleSwipeMouseDown}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* New image (background) */}
                    <img
                      src={newImage}
                      alt="Modified"
                      style={{
                        ...getZoomStyle(),
                        transform: `rotate(${rotation.new}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                      }}
                      className="max-w-full max-h-full"
                      draggable={false}
                    />
                  </div>
                  
                  {/* Old image (clipped foreground) */}
                  {oldImage && (
                    <div 
                      className="absolute inset-0 overflow-hidden"
                      style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img
                          src={oldImage}
                          alt="Original"
                          style={{
                            ...getZoomStyle(),
                            transform: `rotate(${rotation.old}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                          }}
                          className="max-w-full max-h-full"
                          draggable={false}
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Swipe handle */}
                  <div 
                    className="absolute top-0 bottom-0 w-1 bg-accent cursor-col-resize z-10"
                    style={{ left: `${swipePosition}%` }}
                  >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-accent rounded-full flex items-center justify-center shadow-lg">
                      <Rows className="w-4 h-4 text-white rotate-90" />
                    </div>
                  </div>
                  
                  {/* Labels */}
                  <div className="absolute top-2 left-2 bg-bg/80 px-2 py-1 rounded text-xs text-text-secondary">
                    Original
                  </div>
                  <div className="absolute top-2 right-2 bg-bg/80 px-2 py-1 rounded text-xs text-text-secondary">
                    Modified
                  </div>
                </div>
              )}

              {viewMode === 'difference' && (
                <div className="flex items-center justify-center w-full h-full">
                  <div 
                    className="relative max-w-full max-h-full"
                    onMouseDown={handlePanMouseDown}
                  >
                    {/* Blend mode: difference */}
                    <div className="relative">
                      <img
                        src={newImage}
                        alt="Modified"
                        style={{
                          ...getZoomStyle(),
                          transform: `rotate(${rotation.new}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                        }}
                        className="max-w-full max-h-[calc(90vh-200px)]"
                        draggable={false}
                      />
                      {oldImage && (
                        <img
                          src={oldImage}
                          alt="Original"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            mixBlendMode: 'difference',
                            ...getZoomStyle(),
                            transform: `rotate(${rotation.old}deg) ${zoomLevel !== 'fit' ? `scale(${customZoom / 100}) translate(${panPosition.x}px, ${panPosition.y}px)` : ''}`
                          }}
                          className="max-w-full max-h-[calc(90vh-200px)] pointer-events-none"
                          draggable={false}
                        />
                      )}
                    </div>
                    
                    <div className="absolute bottom-2 left-2 bg-bg/80 px-2 py-1 rounded text-xs text-text-secondary">
                      Difference mode - White areas show changes
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isLoading && !error && newImage && (
          <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-t border-border flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-text-secondary">
                {oldImage ? '2 versions' : '1 version (new file)'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Shortcuts: 1-4 view modes, Ctrl+/- zoom, Ctrl+0 reset</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Utility function to check if a file is an image based on extension
 */
export function isImageFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif']
  return imageExtensions.includes(ext)
}
