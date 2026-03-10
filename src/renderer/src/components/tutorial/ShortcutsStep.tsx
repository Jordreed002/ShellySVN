import { Keyboard, HelpCircle } from 'lucide-react';
import type { TutorialStepProps } from './types';

export function ShortcutsStep({
  onNext,
  onPrevious,
  onSkip,
  currentStep,
  totalSteps,
}: TutorialStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
          <Keyboard className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Keyboard Shortcuts</h2>
          <p className="text-text-secondary mt-1">
            Work faster with keyboard shortcuts. Here are the most important ones to remember.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ShortcutGroup title="Navigation">
          <Shortcut keys={['Ctrl', 'P']} description="Command palette" />
          <Shortcut keys={['Ctrl', 'F']} description="Search files" />
          <Shortcut keys={['?']} description="Show all shortcuts" />
        </ShortcutGroup>
        <ShortcutGroup title="SVN Actions">
          <Shortcut keys={['Ctrl', 'U']} description="Update working copy" />
          <Shortcut keys={['Ctrl', 'S']} description="Commit changes" />
          <Shortcut keys={['Ctrl', 'R']} description="Revert changes" />
          <Shortcut keys={['Ctrl', 'D']} description="View diff" />
          <Shortcut keys={['Ctrl', 'L']} description="View log" />
        </ShortcutGroup>
        <ShortcutGroup title="Selection">
          <Shortcut keys={['Ctrl', 'A']} description="Select all" />
          <Shortcut keys={['Esc']} description="Clear selection" />
          <Shortcut keys={['Del']} description="Delete selected" />
        </ShortcutGroup>
        <ShortcutGroup title="View">
          <Shortcut keys={['F5']} description="Refresh" />
          <Shortcut keys={['Ctrl', 'B']} description="Toggle sidebar" />
          <Shortcut keys={['Ctrl', ',']} description="Open settings" />
        </ShortcutGroup>
      </div>

      <div className="p-4 bg-accent/10 rounded-lg border border-accent/30">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-5 h-5 text-accent" />
          <div>
            <p className="text-sm text-text">
              Press{' '}
              <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-xs font-mono mx-1">
                ?
              </kbd>{' '}
              at any time to see the full keyboard shortcuts reference.
            </p>
          </div>
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
  );
}

function ShortcutGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 bg-bg-secondary rounded-lg border border-border">
      <h4 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">
        {title}
      </h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Shortcut({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{description}</span>
      <div className="flex items-center gap-0.5">
        {keys.map((key, i) => (
          <span key={i} className="flex items-center">
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-2xs font-mono text-text">
              {key}
            </kbd>
            {i < keys.length - 1 && <span className="text-text-muted mx-0.5">+</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
