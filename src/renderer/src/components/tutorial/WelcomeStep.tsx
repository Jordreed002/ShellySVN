import { FolderOpen, GitBranch, Zap, Shield } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function WelcomeStep({ onNext, onSkip, isFirstStep, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-accent/20 flex items-center justify-center">
            <svg className="w-12 h-12 text-accent" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M24 4C13 4 4 13 4 24C4 35 13 44 24 44C35 44 44 35 44 24C44 13 35 4 24 4Z"
                fill="currentColor"
                fillOpacity="0.2"
              />
              <path
                d="M16 16C16 16 20 12 24 12C28 12 32 16 32 20C32 24 28 28 24 28C20 28 18 26 18 24C18 22 20 20 22 20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
                opacity="0.6"
              />
              <path d="M24 20V32" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
              <path d="M18 24H30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
            </svg>
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-text">Welcome to ShellySVN</h2>
          <p className="text-text-secondary mt-2">A modern Subversion client built for professionals</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FeatureCard
          icon={FolderOpen}
          title="Intuitive Interface"
          description="Browse and manage your working copies with ease"
        />
        <FeatureCard
          icon={GitBranch}
          title="Full SVN Support"
          description="Complete support for all Subversion operations"
        />
        <FeatureCard
          icon={Zap}
          title="Fast Performance"
          description="Optimized for large repositories"
        />
        <FeatureCard
          icon={Shield}
          title="Secure"
          description="Your credentials are safely stored"
        />
      </div>

      <div className="flex items-center justify-between pt-4">
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
          <button onClick={onNext} className="btn btn-primary">
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
      <Icon className="w-5 h-5 text-accent mb-2" />
      <h3 className="text-sm font-medium text-text">{title}</h3>
      <p className="text-xs text-text-secondary mt-1">{description}</p>
    </div>
  )
}
