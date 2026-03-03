import { Undo2, AlertTriangle, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function RevertResolveStep({ onNext, onPrevious, onSkip, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-warning/20 flex items-center justify-center flex-shrink-0">
          <Undo2 className="w-6 h-6 text-warning" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Undo & Resolve</h2>
          <p className="text-text-secondary mt-1">
            Made a mistake? Need to resolve conflicts? These tools will help you recover.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ActionCard
          icon={Undo2}
          title="Revert Changes"
          description="Discard local modifications and restore the repository version"
          shortcut={['Ctrl', 'R']}
          color="text-warning"
          bgColor="bg-warning/10"
        />
        <ActionCard
          icon={AlertTriangle}
          title="Resolve Conflicts"
          description="When updates conflict with your changes, resolve them interactively"
          color="text-error"
          bgColor="bg-error/10"
        />
      </div>

      <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
        <h4 className="text-sm font-medium text-text mb-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-warning" />
          Conflict Resolution Options
        </h4>
        <div className="space-y-2">
          <ConflictOption
            icon={CheckCircle}
            title="Accept Mine"
            description="Keep your local changes"
            color="text-svn-added"
          />
          <ConflictOption
            icon={CheckCircle}
            title="Accept Theirs"
            description="Use the repository version"
            color="text-svn-modified"
          />
          <ConflictOption
            icon={AlertTriangle}
            title="Merge Manually"
            description="Edit the file to combine changes"
            color="text-warning"
          />
        </div>
      </div>

      <div className="p-4 bg-warning/10 rounded-lg border border-warning/30">
        <p className="text-sm text-text">
          <strong>Warning:</strong> Reverting changes is permanent. Make sure you have backups of any
          uncommitted work you want to keep.
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
  color,
  bgColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  shortcut?: string[]
  color: string
  bgColor: string
}) {
  return (
    <div className={`p-4 ${bgColor} rounded-lg border border-border`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${color} flex-shrink-0 mt-0.5`} />
        <div>
          <h3 className="text-sm font-medium text-text">{title}</h3>
          <p className="text-xs text-text-secondary mt-1">{description}</p>
          {shortcut && (
            <div className="flex items-center gap-1 mt-2">
              {shortcut.map((key, i) => (
                <span key={i} className="flex items-center">
                  <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono text-text">
                    {key}
                  </kbd>
                  {i < shortcut.length - 1 && <span className="text-text-muted mx-0.5">+</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConflictOption({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  color: string
}) {
  return (
    <div className="flex items-center gap-3 p-2 bg-bg-secondary rounded border border-border">
      <Icon className={`w-4 h-4 ${color}`} />
      <div>
        <span className="text-sm font-medium text-text">{title}</span>
        <span className="text-xs text-text-secondary ml-2">- {description}</span>
      </div>
    </div>
  )
}
