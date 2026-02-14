import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  X, Shield, CheckCircle, AlertCircle, Loader2, RefreshCw, 
  Info, Terminal, FolderSync, Image
} from 'lucide-react'

interface ShellIntegrationDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface ShellStatus {
  registered: boolean
  platform: 'windows' | 'macos' | 'linux'
  iconOverlaysEnabled: boolean
  contextMenuEnabled: boolean
  needsAdmin: boolean
}

export function ShellIntegrationDialog({ isOpen, onClose }: ShellIntegrationDialogProps) {
  const queryClient = useQueryClient()
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Get current shell integration status
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['shell:status'],
    queryFn: async (): Promise<ShellStatus> => {
      const result = await window.api.store.get<ShellStatus>('shell:status')
      return result || {
        registered: false,
        platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
        iconOverlaysEnabled: false,
        contextMenuEnabled: false,
        needsAdmin: process.platform === 'win32'
      }
    },
    enabled: isOpen
  })
  
  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async () => {
      setIsRegistering(true)
      setError(null)
      
      // This would call the shell integration IPC
      // For now, we'll just save the preference
      const newStatus: ShellStatus = {
        ...status!,
        registered: true,
        iconOverlaysEnabled: true,
        contextMenuEnabled: true
      }
      
      await window.api.store.set('shell:status', newStatus)
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shell:status'] })
      setIsRegistering(false)
    },
    onError: (err) => {
      setError((err as Error).message || 'Failed to register shell integration')
      setIsRegistering(false)
    }
  })
  
  // Unregister mutation
  const unregisterMutation = useMutation({
    mutationFn: async () => {
      setIsRegistering(true)
      setError(null)
      
      const newStatus: ShellStatus = {
        ...status!,
        registered: false,
        iconOverlaysEnabled: false,
        contextMenuEnabled: false
      }
      
      await window.api.store.set('shell:status', newStatus)
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shell:status'] })
      setIsRegistering(false)
    },
    onError: (err) => {
      setError((err as Error).message || 'Failed to unregister shell integration')
      setIsRegistering(false)
    }
  })
  
  if (!isOpen) return null
  
  const isWindows = status?.platform === 'windows'
  const isMac = status?.platform === 'macos'
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal w-[550px]" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Shield className="w-5 h-5 text-accent" />
            Shell Integration
          </h2>
          <button onClick={onClose} className="btn-icon-sm">
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="modal-body space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : (
            <>
              {/* Status */}
              <div className={`rounded-lg p-4 ${status?.registered ? 'bg-success/10 border border-success/30' : 'bg-bg-tertiary border border-border'}`}>
                <div className="flex items-center gap-3">
                  {status?.registered ? (
                    <CheckCircle className="w-6 h-6 text-success" />
                  ) : (
                    <AlertCircle className="w-6 h-6 text-text-muted" />
                  )}
                  <div>
                    <p className="font-medium text-text">
                      {status?.registered ? 'Shell Integration Active' : 'Shell Integration Not Active'}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {status?.registered 
                        ? 'Icon overlays and context menus are enabled'
                        : 'Register to enable icon overlays and context menus'
                      }
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Platform info */}
              {isWindows && (
                <div className="bg-info/10 border border-info/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-info">
                      <p className="font-medium">Windows Integration</p>
                      <ul className="mt-1 text-info/80 space-y-0.5">
                        <li>• Icon overlays show SVN status on files/folders</li>
                        <li>• Right-click context menu for SVN operations</li>
                        <li>• Requires native shell extension (separate build)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              {isMac && (
                <div className="bg-info/10 border border-info/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-info">
                      <p className="font-medium">macOS Integration</p>
                      <ul className="mt-1 text-info/80 space-y-0.5">
                        <li>• Finder Sync extension for icon badges</li>
                        <li>• Context menu in Finder</li>
                        <li>• Requires separate app extension target</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Features */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-text">Available Features</h4>
                
                <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Image className="w-5 h-5 text-accent" />
                    <div className="flex-1">
                      <p className="text-sm text-text">Icon Overlays</p>
                      <p className="text-xs text-text-faint">Show SVN status on file icons</p>
                    </div>
                    {status?.iconOverlaysEnabled && (
                      <CheckCircle className="w-4 h-4 text-success" />
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-accent" />
                    <div className="flex-1">
                      <p className="text-sm text-text">Context Menu</p>
                      <p className="text-xs text-text-faint">SVN commands in right-click menu</p>
                    </div>
                    {status?.contextMenuEnabled && (
                      <CheckCircle className="w-4 h-4 text-success" />
                    )}
                  </div>
                </div>
              </div>
              
              {/* Requirements */}
              {status?.needsAdmin && !status?.registered && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-warning">
                      <p className="font-medium">Administrator Rights Required</p>
                      <p className="mt-1 text-warning/80">
                        Windows shell integration requires administrator rights to register the shell extension DLL.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {error && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-sm text-error">
                  {error}
                </div>
              )}
              
              {/* Build instructions */}
              <div className="text-xs text-text-faint bg-bg-secondary rounded-lg p-3">
                <p className="font-medium mb-1">Building Shell Extensions:</p>
                <p>Windows: Run build-shell-extension.bat in resources/shell</p>
                <p>macOS: Build FinderSync target in Xcode</p>
              </div>
            </>
          )}
        </div>
        
        {/* Footer */}
        <div className="modal-footer">
          <button onClick={() => refetch()} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          
          {status?.registered ? (
            <button
              onClick={() => unregisterMutation.mutate()}
              disabled={isRegistering}
              className="btn btn-secondary"
            >
              {isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderSync className="w-4 h-4" />
              )}
              Unregister
            </button>
          ) : (
            <button
              onClick={() => registerMutation.mutate()}
              disabled={isRegistering}
              className="btn btn-primary"
            >
              {isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              Register
            </button>
          )}
          
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
