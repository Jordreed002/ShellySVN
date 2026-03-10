import { History, GitCommit, User, Calendar, MessageSquare } from 'lucide-react';
import type { TutorialStepProps } from './types';

export function LogHistoryStep({
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
          <History className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">History & Log</h2>
          <p className="text-text-secondary mt-1">
            Browse the commit history to see who changed what and when.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <LogEntry
          revision={42}
          author="john.doe"
          date="Today, 2:30 PM"
          message="Fix login validation bug"
          files={3}
        />
        <LogEntry
          revision={41}
          author="jane.smith"
          date="Today, 11:15 AM"
          message="Add new dashboard feature"
          files={8}
          isExpanded
        />
        <LogEntry
          revision={40}
          author="john.doe"
          date="Yesterday, 4:45 PM"
          message="Update dependencies"
          files={2}
        />
      </div>

      <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
        <h4 className="text-sm font-medium text-text mb-3">Log View Features</h4>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono">
              Ctrl+L
            </kbd>
            <span>Open log view</span>
          </div>
          <div className="flex items-center gap-2">
            <GitCommit className="w-3 h-3" />
            <span>Click revision to see changes</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-3 h-3" />
            <span>Filter by date range</span>
          </div>
          <div className="flex items-center gap-2">
            <User className="w-3 h-3" />
            <span>Filter by author</span>
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

function LogEntry({
  revision,
  author,
  date,
  message,
  files,
  isExpanded,
}: {
  revision: number;
  author: string;
  date: string;
  message: string;
  files: number;
  isExpanded?: boolean;
}) {
  return (
    <div
      className={`p-3 bg-bg-secondary rounded-lg border border-border ${isExpanded ? 'ring-1 ring-accent/50' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs font-mono rounded">
            r{revision}
          </span>
          <span className="text-sm font-medium text-text">{author}</span>
        </div>
        <span className="text-xs text-text-secondary">{date}</span>
      </div>
      <p className="text-sm text-text-secondary mb-2">{message}</p>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {files} files changed
        </span>
        {isExpanded && <span className="text-accent">Viewing changes...</span>}
      </div>
    </div>
  );
}
