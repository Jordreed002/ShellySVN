import { Wand2 } from 'lucide-react';
import type { AiDraftTransformation } from '@shared/types';

const LABELS: Record<AiDraftTransformation, string> = {
  shorter: 'Shorter',
  'add-body': 'Add body',
  'remove-body': 'Remove body',
  imperative: 'Imperative',
  'match-style': 'Match style',
  'include-issues': 'Include issues',
  'explain-motivation': 'Explain why',
  regenerate: 'Regenerate',
};

interface DraftTransformationBarProps {
  transformations: AiDraftTransformation[];
  disabled: boolean;
  onTransform: (transformation: AiDraftTransformation) => void;
}

export function DraftTransformationBar({
  transformations,
  disabled,
  onTransform,
}: DraftTransformationBarProps) {
  if (transformations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="AI draft transformations">
      <span className="mr-1 inline-flex items-center gap-1 font-mono text-9 uppercase tracking-wider text-text-faint">
        <Wand2 className="h-3 w-3 text-accent" aria-hidden="true" />
        Refine
      </span>
      {transformations.map((transformation) => (
        <button
          key={transformation}
          type="button"
          className="rounded-6 border border-border bg-bg-secondary px-2 py-1 text-9.5 text-text-muted transition-fast hover:border-accent/40 hover:text-accent disabled:opacity-45"
          onClick={() => onTransform(transformation)}
          disabled={disabled}
          title={`${LABELS[transformation]} with AI; the result stays editable`}
        >
          {LABELS[transformation]}
        </button>
      ))}
    </div>
  );
}
