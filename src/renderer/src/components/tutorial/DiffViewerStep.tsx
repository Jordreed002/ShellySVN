import { FileDiff, Eye, Plus, Minus, ArrowLeft, ArrowRight } from 'lucide-react'
import type { TutorialStepProps } from './types'

export function DiffViewerStep({ onNext, onPrevious, onSkip, currentStep, totalSteps }: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
          <FileDiff className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Viewing Differences</h2>
          <p className="text-text-secondary mt-1">
            The diff viewer shows you exactly what changed between versions of a file.
          </p>
        </div>
      </div>

      <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border">
          <span className="text-sm font-medium text-text">example.txt</span>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>Base (r10)</span>
            <ArrowRight className="w-3 h-3" />
            <span>Working Copy</span>
          </div>
        </div>
        <div className="font-mono text-sm">
          <div className="px-4 py-1 bg-bg-secondary/50 text-text-muted border-y border-border">
            <span className="text-text-faint mr-4">1</span>
            <span className="text-text-secondary">This line unchanged</span>
          </div>
          <div className="px-4 py-1 bg-svn-deleted/20 border-l-2 border-svn-deleted">
            <span className="text-text-faint mr-4">2</span>
            <Minus className="w-3 h-3 inline mr-2 text-svn-deleted" />
            <span className="text-svn-deleted">This line was removed</span>
          </div>
          <div className="px-4 py-1 bg-svn-added/20 border-l-2 border-svn-added">
            <span className="text-text-faint mr-4"></span>
            <Plus className="w-3 h-3 inline mr-2 text-svn-added" />
            <span className="text-svn-added">This line was added</span>
          </div>
          <div className="px-4 py-1 bg-bg-secondary/50 text-text-muted border-y border-border">
            <span className="text-text-faint mr-4">3</span>
            <span className="text-text-secondary">Another unchanged line</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 bg-bg-secondary rounded-lg border border-border">
          <Eye className="w-5 h-5 text-accent mx-auto mb-2" />
          <div className="text-xs text-text">Double-click a file to view diff</div>
        </div>
        <div className="p-3 bg-bg-secondary rounded-lg border border-border">
          <kbd className="px-2 py-0.5 bg-bg-tertiary border border-border rounded text-xs font-mono text-text mb-2 inline-block">
            Ctrl+D
          </kbd>
          <div className="text-xs text-text">Keyboard shortcut</div>
        </div>
        <div className="p-3 bg-bg-secondary rounded-lg border border-border">
          <ArrowLeft className="w-5 h-5 text-text-secondary mx-auto mb-2" />
          <div className="text-xs text-text">Navigate between changes</div>
        </div>
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
