import { useSettings } from '@renderer/hooks/useSettings'
import { GitBranch, Folder, Clock, Activity } from 'lucide-react'

/**
 * Status bar component that shows at the bottom of the app
 * Respects the showStatusBar setting from user preferences
 */
export function StatusBar() {
  const { settings } = useSettings()
  
  // Don't render if status bar is disabled in settings
  if (!settings?.showStatusBar) {
    return null
  }
  
  return (
    <footer className="status-bar">
      {/* Left side - repository info */}
      <div className="flex items-center gap-4">
        <div className="activity-indicator">
          <Activity className="w-3 h-3" />
          <span>Ready</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-text-muted">
          <GitBranch className="w-3 h-3" />
          <span>No repository selected</span>
        </div>
      </div>
      
      {/* Right side - system info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-text-muted">
          <Folder className="w-3 h-3" />
          <span>0 files</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-text-muted">
          <Clock className="w-3 h-3" />
          <span>Idle</span>
        </div>
      </div>
    </footer>
  )
}
