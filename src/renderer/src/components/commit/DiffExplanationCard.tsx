/**
 * The AI's answer about the selected file's diff.
 *
 * It used to render as a full-bleed band wedged between the diff toolbar and
 * the diff itself — unlabelled, undismissable, and pushing the code it was
 * describing off screen. Now it is an inset card that names the question it
 * answered, collapses to its one-line summary, and can be dismissed, so the
 * diff keeps the room it needs.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb, X } from 'lucide-react';
import type { AiDiffExplanationResult } from '@shared/types';
import { explanationModeLabel } from './CommitDiffToolbar';

interface DiffExplanationCardProps {
  explanation: AiDiffExplanationResult;
  onDismiss: () => void;
}

export function DiffExplanationCard({ explanation, onDismiss }: DiffExplanationCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  /* A fresh answer always arrives open, even if the last one was collapsed. */
  useEffect(() => setCollapsed(false), [explanation]);

  const hasDetail =
    Boolean(explanation.rationale) ||
    explanation.risks.length > 0 ||
    explanation.reviewQuestions.length > 0;

  return (
    <section
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-9 border border-accent/25 bg-accent/[0.06]"
      aria-live="polite"
      aria-label="AI explanation of this file's changes"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="btn-icon-sm p-0.5 text-accent"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show explanation detail' : 'Hide explanation detail'}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
        )}
        <span className="shrink-0 text-10 font-bold uppercase tracking-caps text-accent">
          {explanationModeLabel(explanation.mode)}
        </span>
        <span className="min-w-0 flex-1 truncate text-10.5 text-text-faint">
          {explanation.provider}
          {explanation.model ? ` · ${explanation.model}` : ''} ·{' '}
          {explanation.cached ? 'cached' : `${(explanation.durationMs / 1000).toFixed(1)}s`}
          {explanation.truncated ? ' · diff truncated' : ''}
          {explanation.redacted ? ' · secrets redacted' : ''}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="btn-icon-sm p-0.5"
          aria-label="Dismiss explanation"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-44 overflow-y-auto px-2.5 pb-2.5">
        <p className="text-11.5 font-medium leading-relaxed text-text">{explanation.summary}</p>
        {!collapsed && (
          <>
            {explanation.rationale && (
              <p className="mt-1 text-11 leading-relaxed text-text-muted">
                {explanation.rationale}
              </p>
            )}
            {(explanation.risks.length > 0 || explanation.reviewQuestions.length > 0) && (
              <div className="mt-2 grid grid-cols-1 gap-3 text-10.5 text-text-secondary sm:grid-cols-2">
                {explanation.risks.length > 0 && (
                  <div>
                    <span className="text-10 font-bold uppercase tracking-caps text-warning">
                      Risks
                    </span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {explanation.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {explanation.reviewQuestions.length > 0 && (
                  <div>
                    <span className="text-10 font-bold uppercase tracking-caps text-accent">
                      Review questions
                    </span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {explanation.reviewQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
