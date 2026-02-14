import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSettings } from '@renderer/hooks/useSettings'
import { 
  FolderOpen, 
  GitBranch, 
  Clock, 
  ChevronRight,
  Upload,
  Download,
  RefreshCw,
  FileEdit,
  Turtle
} from 'lucide-react'
import { AddRepoModal } from './AddRepoModal'
import { CheckoutDialog } from './ui/CheckoutDialog'

// Shell/Turtle SVG Logo for ShellySVN
function ShellLogo({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Shell base */}
      <path 
        d="M24 4C13 4 4 13 4 24C4 35 13 44 24 44C35 44 44 35 44 24C44 13 35 4 24 4Z" 
        fill="url(#shell-gradient)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Shell spiral pattern */}
      <path 
        d="M16 16C16 16 20 12 24 12C28 12 32 16 32 20C32 24 28 28 24 28C20 28 18 26 18 24C18 22 20 20 22 20" 
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      {/* Turtle pattern segments */}
      <path d="M24 20V32" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <path d="M18 24H30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <path d="M19 19L29 29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <path d="M29 19L19 29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <defs>
        <linearGradient id="shell-gradient" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function WelcomeScreen() {
  const navigate = useNavigate()
  const { settings, addRecentRepo } = useSettings()
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false)
  const [isCheckoutDialogOpen, setIsCheckoutDialogOpen] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  
  const handleOpenWorkingCopy = useCallback(async (path: string) => {
    // Save to recent repos
    await addRecentRepo(path)
    // Navigate to the file explorer
    navigate({ to: '/files', search: { path } })
  }, [navigate, addRecentRepo])
  
  const handleCheckout = useCallback((url: string, _path: string) => {
    // Open the checkout dialog with the URL pre-filled
    setCheckoutUrl(url)
    setIsCheckoutDialogOpen(true)
  }, [])
  
  const handleCheckoutComplete = useCallback((path: string) => {
    // Navigate to the newly checked out working copy
    handleOpenWorkingCopy(path)
  }, [handleOpenWorkingCopy])
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])
  
  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const items = e.dataTransfer.items
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.()
        if (entry?.isDirectory) {
          const path = (entry as FileSystemDirectoryEntry).fullPath
          // Try to verify it's a working copy
          try {
            await window.api.svn.info(path)
            handleOpenWorkingCopy(path)
          } catch {
            console.log('Not a valid SVN working copy')
          }
        }
      }
    }
  }, [handleOpenWorkingCopy])
  
  const recentRepos = settings?.recentRepositories || []
  
  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl space-y-8 animate-fade-in">
          {/* Logo & Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 blur-2xl bg-accent/20 rounded-full" />
                <ShellLogo className="w-20 h-20 text-accent relative" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-text tracking-tight">
                ShellySVN
              </h1>
              <p className="text-text-secondary mt-2">
                A modern Subversion client for professionals
              </p>
            </div>
          </div>
          
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              drop-zone cursor-pointer transition-all duration-300
              ${isDragOver ? 'drop-zone-active scale-[1.02]' : ''}
            `}
            onClick={() => setIsAddRepoModalOpen(true)}
          >
            <div className="flex flex-col items-center gap-3">
              <div className={`
                w-16 h-16 rounded-xl bg-bg-tertiary flex items-center justify-center
                transition-all duration-300
                ${isDragOver ? 'bg-accent/20 scale-110' : ''}
              `}>
                <FolderOpen className={`w-8 h-8 transition-colors ${isDragOver ? 'text-accent' : 'text-text-muted'}`} />
              </div>
              <div>
                <p className="text-lg font-medium text-text">
                  {isDragOver ? 'Drop to Open' : 'Open Working Copy'}
                </p>
                <p className="text-sm text-text-secondary mt-1">
                  Drag a folder here or click to browse
                </p>
              </div>
            </div>
          </div>
          
          {/* Quick Actions */}
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setIsAddRepoModalOpen(true)}
              className="btn btn-secondary gap-2"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
            <button
              onClick={() => setIsCheckoutDialogOpen(true)}
              className="btn btn-primary gap-2"
            >
              <GitBranch className="w-4 h-4" />
              Checkout
            </button>
          </div>
          
          {/* Recent Repositories */}
          {recentRepos.length > 0 && (
            <div className="space-y-3 animate-slide-up" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Clock className="w-4 h-4" />
                <span>Recent Repositories</span>
              </div>
              <div className="grid gap-2">
                {recentRepos.slice(0, 5).map((repo, index) => {
                  const name = repo.split('/').pop() || repo
                  return (
                    <button
                      key={repo}
                      onClick={() => handleOpenWorkingCopy(repo)}
                      className="flex items-center gap-3 px-4 py-3 bg-bg-secondary rounded-lg border border-border hover:border-accent/50 hover:bg-bg-tertiary transition-all duration-200 group text-left"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <FolderOpen className="w-5 h-5 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text truncate">{name}</p>
                        <p className="text-xs text-text-muted truncate">{repo}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Feature Highlights */}
      <div className="border-t border-border bg-bg-secondary/50">
        <div className="max-w-4xl mx-auto px-8 py-6">
          <div className="grid grid-cols-4 gap-6">
            <FeatureItem
              icon={Download}
              title="Update"
              description="Get latest changes"
            />
            <FeatureItem
              icon={Upload}
              title="Commit"
              description="Push your changes"
            />
            <FeatureItem
              icon={RefreshCw}
              title="Revert"
              description="Discard local edits"
            />
            <FeatureItem
              icon={FileEdit}
              title="Diff"
              description="Compare revisions"
            />
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="border-t border-border px-8 py-3 flex items-center justify-between text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <Turtle className="w-3.5 h-3.5" />
          <span>ShellySVN bundles Subversion 1.14.x</span>
        </div>
        <span>No external dependencies required</span>
      </div>
      
      {/* Add Repo Modal */}
      <AddRepoModal
        isOpen={isAddRepoModalOpen}
        onClose={() => setIsAddRepoModalOpen(false)}
        onOpenRepo={handleOpenWorkingCopy}
        onCheckout={handleCheckout}
        recentRepos={recentRepos}
      />
      
      {/* Checkout Dialog */}
      <CheckoutDialog
        isOpen={isCheckoutDialogOpen}
        onClose={() => setIsCheckoutDialogOpen(false)}
        onComplete={handleCheckoutComplete}
        initialUrl={checkoutUrl}
      />
    </div>
  )
}

function FeatureItem({ 
  icon: Icon, 
  title, 
  description 
}: { 
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-text-secondary" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </div>
  )
}
