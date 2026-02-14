import type { SvnStatusChar } from '@shared/types'
import { 
  Check, 
  Plus, 
  AlertTriangle, 
  Trash2, 
  EyeOff, 
  FileEdit, 
  RefreshCw, 
  Link, 
  HelpCircle, 
  FileX, 
  AlertCircle 
} from 'lucide-react'

interface StatusIconConfig {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bgColor: string
  label: string
}

const STATUS_CONFIG: Record<SvnStatusChar, StatusIconConfig> = {
  ' ': { 
    icon: Check, 
    color: 'text-svn-normal', 
    bgColor: 'bg-svn-normal/20',
    label: 'Normal' 
  },
  'A': { 
    icon: Plus, 
    color: 'text-svn-added', 
    bgColor: 'bg-svn-added/20',
    label: 'Added' 
  },
  'C': { 
    icon: AlertTriangle, 
    color: 'text-svn-conflict', 
    bgColor: 'bg-svn-conflict/20',
    label: 'Conflicted' 
  },
  'D': { 
    icon: Trash2, 
    color: 'text-svn-deleted', 
    bgColor: 'bg-svn-deleted/20',
    label: 'Deleted' 
  },
  'I': { 
    icon: EyeOff, 
    color: 'text-svn-ignored', 
    bgColor: 'bg-svn-ignored/20',
    label: 'Ignored' 
  },
  'M': { 
    icon: FileEdit, 
    color: 'text-svn-modified', 
    bgColor: 'bg-svn-modified/20',
    label: 'Modified' 
  },
  'R': { 
    icon: RefreshCw, 
    color: 'text-svn-replaced', 
    bgColor: 'bg-svn-replaced/20',
    label: 'Replaced' 
  },
  'X': { 
    icon: Link, 
    color: 'text-svn-external', 
    bgColor: 'bg-svn-external/20',
    label: 'External' 
  },
  '?': { 
    icon: HelpCircle, 
    color: 'text-svn-unversioned', 
    bgColor: 'bg-svn-unversioned/20',
    label: 'Unversioned' 
  },
  '!': { 
    icon: FileX, 
    color: 'text-svn-missing', 
    bgColor: 'bg-svn-missing/20',
    label: 'Missing' 
  },
  '~': { 
    icon: AlertCircle, 
    color: 'text-svn-obstructed', 
    bgColor: 'bg-svn-obstructed/20',
    label: 'Obstructed' 
  }
}

interface StatusIconProps {
  status: SvnStatusChar
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

export function StatusIcon({ 
  status, 
  size = 'md', 
  showLabel = false,
  className = '' 
}: StatusIconProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' ']
  const Icon = config.icon
  
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  }
  
  const containerSizes = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-7 h-7'
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div 
        className={`
          ${containerSizes[size]} 
          ${config.bgColor} 
          rounded 
          flex items-center justify-center
          flex-shrink-0
          ${status === 'C' ? 'animate-pulse-subtle' : ''}
        `}
        title={config.label}
      >
        <Icon className={`${sizeClasses[size]} ${config.color}`} />
      </div>
      {showLabel && (
        <span className={`text-xs font-medium ${config.color}`}>
          {config.label}
        </span>
      )}
    </div>
  )
}

// Compact status dot for table columns
export function StatusDot({ 
  status, 
  className = '' 
}: { 
  status: SvnStatusChar
  className?: string 
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' ']
  
  const dotColors: Record<SvnStatusChar, string> = {
    ' ': 'bg-svn-normal',
    'A': 'bg-svn-added',
    'C': 'bg-svn-conflict animate-pulse-subtle',
    'D': 'bg-svn-deleted',
    'I': 'bg-svn-ignored',
    'M': 'bg-svn-modified',
    'R': 'bg-svn-replaced',
    'X': 'bg-svn-external',
    '?': 'bg-svn-unversioned',
    '!': 'bg-svn-missing',
    '~': 'bg-svn-obstructed'
  }
  
  return (
    <div 
      className={`
        w-2.5 h-2.5 rounded-full flex-shrink-0
        ${dotColors[status]}
        ${className}
      `}
      title={config.label}
    />
  )
}

// Status badge for compact display
export function StatusBadge({ 
  status,
  className = '' 
}: { 
  status: SvnStatusChar
  className?: string 
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[' ']
  const Icon = config.icon
  
  return (
    <span 
      className={`
        inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium
        ${config.bgColor} ${config.color}
        ${className}
      `}
      title={config.label}
    >
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
    </span>
  )
}

export { STATUS_CONFIG }
