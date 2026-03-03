import { CheckCircle, Rocket, Settings, BookOpen } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function CompleteStep({ onNext, onPrevious, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-success/20 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-success" />
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-text">You're All Set!</h2>
          <p className="text-text-secondary mt-2">
            You've completed the tutorial. You're ready to start using ShellySVN.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <NextStepCard
          icon={Rocket}
          title="Get Started"
          description="Open a working copy or checkout a new one"
        />
        <NextStepCard
          icon={Settings}
          title="Customize"
          description="Configure settings to match your workflow"
        />
        <NextStepCard
          icon={BookOpen}
          title="Learn More"
          description="Check out the documentation for advanced features"
        />
      </div>

      <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
        <h4 className="text-sm font-medium text-text mb-3">Quick Tips</h4>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5">*</span>
            <span>Right-click on files for context-sensitive actions</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5">*</span>
            <span>Use changelists to organize related changes</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5">*</span>
            <span>Monitor your working copies for incoming changes</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5">*</span>
            <span>Set up external diff/merge tools in Settings</span>
          </li>
        </ul>
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
          <button onClick={onPrevious} className="btn btn-secondary">
            Review Tutorial
          </button>
          <button
            onClick={onNext}
            className="btn btn-primary"
            data-testid="complete-tutorial-btn"
          >
            Start Using ShellySVN
          </button>
        </div>
      </div>
    </div>
  )
}

function NextStepCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="p-4 bg-bg-secondary rounded-lg border border-border text-center">
      <Icon className="w-6 h-6 text-accent mx-auto mb-2" />
      <h3 className="text-sm font-medium text-text">{title}</h3>
      <p className="text-xs text-text-secondary mt-1">{description}</p>
    </div>
  )
}
