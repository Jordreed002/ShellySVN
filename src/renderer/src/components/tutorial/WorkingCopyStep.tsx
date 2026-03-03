import { FolderOpen, FolderPlus, Clock, ChevronRight } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function WorkingCopyStep({ onNext, onPrevious, onSkip, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Working with Copies</h2>
          <p className="text-text-secondary mt-1">
            A working copy is your local checkout of a Subversion repository. Let's learn how to open and manage them.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <ActionCard
          icon={FolderOpen}
          title="Open Existing Working Copy"
          description="Browse to a folder that's already been checked out from SVN"
          shortcut={['Ctrl', 'O']}
        />
        <ActionCard
          icon={FolderPlus}
          title="Checkout New Working Copy"
          description="Download a fresh copy from a repository URL"
          shortcut={['Ctrl', 'Shift', 'O']}
        />
        <ActionCard
          icon={Clock}
          title="Recent Repositories"
          description="Quickly access your recently opened working copies from the welcome screen"
        />
      </div>

      <div className="p-4 bg-accent/10 rounded-lg border border-accent/30">
        <p className="text-sm text-text">
          <strong>Tip:</strong> You can drag and drop folders onto the welcome screen to open them directly.
        </p>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentStep ? 'bg-accent' : i < currentStep ? 'bg-accent/50' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onSkip} className="btn btn-ghost text-sm">
            Skip Tutorial
          </button>
          <button onClick={onPrevious} className="btn btn-secondary">
            Back
          </button>
          <button onClick={onNext} className="btn btn-primary">
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionCard({
  icon: Icon,
  title,
  description,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  shortcut?: string[]
}) {
  return (
    <div className="flex items-center gap-4 p-4 bg-bg-secondary rounded-lg border border-border hover:border-accent/50 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-text-secondary" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
      </div>
      {shortcut && (
        <div className="flex items-center gap-1">
          {shortcut.map((key, i) => (
            <span key={i} className="flex items-center">
              <kbd className="px-2 py-0.5 bg-bg-tertiary border border-border rounded text-xs font-mono text-text">
                {key}
              </kbd>
              {i < shortcut.length - 1 && <span className="text-text-muted mx-0.5">+</span>}
            </span>
          ))}
        </div>
      )}
      <ChevronRight className="w-4 h-4 text-text-muted" />
    </div>
  )
}
