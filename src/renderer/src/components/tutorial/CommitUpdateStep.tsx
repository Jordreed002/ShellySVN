import { Upload, Download, RefreshCw, ArrowRight } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function CommitUpdateStep({ onNext, onPrevious, onSkip, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Sync Your Changes</h2>
          <p className="text-text-secondary mt-1">
            The core workflow of Subversion: updating from and committing to the repository.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <WorkflowCard
          icon={Download}
          title="Update"
          description="Download the latest changes from the repository to your working copy. Always update before committing to avoid conflicts."
          shortcut={['Ctrl', 'U']}
          color="bg-svn-added"
        />
        <div className="flex justify-center">
          <ArrowRight className="w-5 h-5 text-text-muted rotate-90" />
        </div>
        <WorkflowCard
          icon={Upload}
          title="Commit"
          description="Send your local changes to the repository. Write clear commit messages to document your changes."
          shortcut={['Ctrl', 'S']}
          color="bg-svn-modified"
        />
      </div>

      <div className="p-4 bg-warning/10 rounded-lg border border-warning/30">
        <h4 className="text-sm font-medium text-text flex items-center gap-2 mb-2">
          <RefreshCw className="w-4 h-4 text-warning" />
          Best Practice
        </h4>
        <p className="text-xs text-text-secondary">
          Always <strong>update before you commit</strong>. This helps you catch and resolve conflicts early,
          and ensures you're working with the latest code.
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

function WorkflowCard({
  icon: Icon,
  title,
  description,
  shortcut,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  shortcut?: string[]
  color: string
}) {
  return (
    <div className="flex items-start gap-4 p-4 bg-bg-secondary rounded-lg border border-border">
      <div className={`w-10 h-10 rounded-lg ${color}/20 flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-medium text-text">{title}</h3>
          {shortcut && (
            <div className="flex items-center gap-1">
              {shortcut.map((key, i) => (
                <span key={i} className="flex items-center">
                  <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-2xs font-mono text-text">
                    {key}
                  </kbd>
                  {i < shortcut.length - 1 && <span className="text-text-muted mx-0.5">+</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
    </div>
  )
}
