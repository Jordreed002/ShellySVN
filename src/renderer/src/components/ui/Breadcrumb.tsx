import { ChevronRight, Home, Folder, HardDrive } from 'lucide-react'

interface BreadcrumbItem {
  name: string
  path: string
  isRoot?: boolean
}

interface BreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
  className?: string
  maxItems?: number
}

export function Breadcrumb({ 
  path, 
  onNavigate, 
  className = '',
  maxItems = 6
}: BreadcrumbProps) {
  // Handle special DRIVES:// path
  if (path === 'DRIVES://') {
    return (
      <nav className={`breadcrumb ${className}`} aria-label="Breadcrumb">
        <ol className="flex items-center gap-1">
          <li>
            <span className="flex items-center gap-1.5 px-1.5 py-0.5 breadcrumb-current">
              <HardDrive className="w-4 h-4" />
              <span>This PC</span>
            </span>
          </li>
        </ol>
      </nav>
    )
  }
  
  // Detect path separator
  const separator = path.includes('\\') ? '\\' : '/'
  
  // Parse path into segments
  const segments = path.split(separator).filter(Boolean)
  
  // Build breadcrumb items
  const items: BreadcrumbItem[] = []
  let currentPath = path.startsWith('/') ? '' : (segments.length > 0 && segments[0].endsWith(':') ? '' : '')
  
  segments.forEach((segment, index) => {
    // Handle Windows drive letter
    if (separator === '\\' && segment.endsWith(':')) {
      currentPath = segment + '\\'
    } else {
      currentPath = currentPath ? currentPath + separator + segment : separator + segment
    }
    
    items.push({
      name: segment,
      path: currentPath,
      isRoot: index === 0
    })
  })
  
  // Handle truncation for long paths
  const shouldTruncate = items.length > maxItems
  const visibleItems = shouldTruncate 
    ? [items[0], ...items.slice(-(maxItems - 1))]
    : items
  
  return (
    <nav className={`breadcrumb ${className}`} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1">
        {/* Root / Home button */}
        <li>
          <button
            onClick={() => onNavigate('DRIVES://')}
            className="breadcrumb-item px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-fast"
            title="Go to drives"
          >
            <Home className="w-4 h-4" />
          </button>
        </li>
        
        {items.length > 0 && (
          <li className="breadcrumb-separator">
            <ChevronRight className="w-3.5 h-3.5" />
          </li>
        )}
        
        {/* Render items */}
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1
          const showEllipsis = shouldTruncate && index === 1
          
          return (
            <li key={item.path} className="flex items-center gap-1">
              {showEllipsis && (
                <>
                  <span className="text-text-muted px-1">...</span>
                  <ChevronRight className="w-3.5 h-3.5 breadcrumb-separator" />
                </>
              )}
              
              <button
                onClick={() => !isLast && onNavigate(item.path)}
                className={`
                  flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-fast
                  ${isLast 
                    ? 'breadcrumb-current cursor-default' 
                    : 'breadcrumb-item hover:bg-bg-tertiary'
                  }
                `}
                disabled={isLast}
                title={item.path}
              >
                {index === 0 && !shouldTruncate ? (
                  <Folder className="w-4 h-4 text-accent flex-shrink-0" />
                ) : null}
                <span className="truncate max-w-[120px]">{item.name}</span>
              </button>
              
              {!isLast && (
                <ChevronRight className="w-3.5 h-3.5 breadcrumb-separator" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// Compact breadcrumb for title bar
export function BreadcrumbCompact({ 
  path, 
  onNavigate,
  className = '' 
}: BreadcrumbProps) {
  const segments = path.split('/').filter(Boolean)
  const repoName = segments[0] || 'Repository'
  const currentFolder = segments[segments.length - 1] || repoName
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Folder className="w-4 h-4 text-accent" />
      <button 
        onClick={() => onNavigate('/' + segments[0])}
        className="text-text font-medium hover:text-accent transition-fast"
      >
        {repoName}
      </button>
      {segments.length > 1 && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-text-faint" />
          <span className="text-text-secondary">
            {segments.length > 2 ? '... / ' : ''}
            {currentFolder}
          </span>
        </>
      )}
    </div>
  )
}
