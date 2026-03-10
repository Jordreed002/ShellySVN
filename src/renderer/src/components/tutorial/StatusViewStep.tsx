import { FileText, Circle, AlertTriangle, Plus, Minus, HelpCircle } from 'lucide-react';
import type { TutorialStepProps } from './types';

export function StatusViewStep({
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
          <FileText className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Understanding File Status</h2>
          <p className="text-text-secondary mt-1">
            ShellySVN uses color-coded indicators to show the status of each file in your working
            copy.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatusItem color="bg-svn-normal" label="Normal" description="No local changes" />
        <StatusItem color="bg-svn-added" label="Added" description="Scheduled for addition" />
        <StatusItem color="bg-svn-modified" label="Modified" description="Local changes detected" />
        <StatusItem color="bg-svn-deleted" label="Deleted" description="Scheduled for deletion" />
        <StatusItem color="bg-svn-conflict" label="Conflict" description="Needs resolution" />
        <StatusItem
          color="bg-svn-unversioned"
          label="Unversioned"
          description="Not under SVN control"
        />
      </div>

      <div className="p-4 bg-bg-tertiary rounded-lg border border-border">
        <h4 className="text-sm font-medium text-text mb-2 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-accent" />
          Status Indicators
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <Circle className="w-2 h-2 fill-svn-modified text-svn-modified" />
            <span>Colored dots show file status</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-warning" />
            <span>Warning icons indicate conflicts</span>
          </div>
          <div className="flex items-center gap-2">
            <Plus className="w-3 h-3 text-svn-added" />
            <span>Plus icon for added files</span>
          </div>
          <div className="flex items-center gap-2">
            <Minus className="w-3 h-3 text-svn-deleted" />
            <span>Minus icon for deleted files</span>
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

function StatusItem({
  color,
  label,
  description,
}: {
  color: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-lg border border-border">
      <div className={`w-3 h-3 rounded-full ${color}`} />
      <div>
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="text-xs text-text-secondary">{description}</div>
      </div>
    </div>
  );
}
