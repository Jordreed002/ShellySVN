import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Loader2, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import type { AiConflictProposalResult } from '@shared/types';
import { AiRichText } from './AiRichText';
import { AiPrivacyNotice } from './AiPrivacyNotice';
import { ErrorPanel } from '../ui/ErrorPanel';
import {
  aiErrorMessage,
  isAiConsentErrorCode,
  isAiSecretErrorCode,
  parseAiErrorCode,
} from '@renderer/features/ai-review-center/lib/aiErrorCodes';
import {
  readAiConsent,
  writeAiConsent,
} from '@renderer/features/ai-review-center/lib/aiConsent';

export interface ConflictAiContents {
  baseContent: string;
  mineContent: string;
  theirsContent: string;
  /** Fingerprint of the loaded sources, for the wizard's stale-proposal check. */
  fingerprint: string;
}

export interface ConflictAiExplainerProps {
  workingCopyPath: string;
  filePath: string;
  /** Lazily loads base/mine/theirs only once the user asks for an explanation. */
  loadContents: () => Promise<ConflictAiContents>;
  /** Lets the wizard record proposal metadata for its stale marker. */
  onProposalMetadata?: (metadata: {
    confidence: number;
    unresolvedQuestions: string[];
    sourceFingerprint: string;
  }) => void;
}

type ConsentState = 'checking' | 'unset' | 'on' | 'off';

function newOperationId(): string {
  return `conflict-explain-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * "Explain this conflict with AI" panel (#111). Lazy (nothing loads until the
 * user clicks), consent-gated per working copy (#113), and cancellable via
 * AbortController + `window.api.ai.cancel`. Proposal text renders through the
 * sanitizer with explicit AI attribution; failures reuse ErrorPanel, and
 * consent/secret error codes get the actionable privacy notice (#18).
 */
export function ConflictAiExplainer({
  workingCopyPath,
  filePath,
  loadContents,
  onProposalMetadata,
}: ConflictAiExplainerProps) {
  const [consent, setConsent] = useState<ConsentState>('checking');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AiConflictProposalResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [copied, setCopied] = useState(false);
  /** Progressive assistant text from `onAiStream` deltas, when the provider streams. */
  const [streamedText, setStreamedText] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    setConsent('checking');
    readAiConsent(workingCopyPath)
      .then((entry) => {
        if (active) setConsent(entry ? (entry.aiEnabled ? 'on' : 'off') : 'unset');
      })
      .catch(() => {
        if (active) setConsent('unset');
      });
    return () => {
      active = false;
    };
  }, [workingCopyPath]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const explain = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    // Local abort races the IPC promise so Cancel is effective even if the
    // main process never settles (hung provider).
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new DOMException('The AI explanation was cancelled.', 'AbortError')),
        { once: true }
      );
    });
    // Progressive rendering (#streaming): subscribe to deltas for this
    // operation when the surface exposes onAiStream. CLI providers emit only
    // the terminal event, so an empty stream must still render fine.
    const operationId = newOperationId();
    let streamed = '';
    let unsubscribe: (() => void) | null = null;
    const onAiStream = (
      window.api.ai as { onAiStream?: typeof window.api.ai.onAiStream } | undefined
    )?.onAiStream;
    if (typeof onAiStream === 'function') {
      try {
        unsubscribe = onAiStream((event) => {
          if (event.operationId !== operationId || !event.delta) return;
          streamed += event.delta;
          setStreamedText(streamed);
        });
      } catch {
        unsubscribe = null;
      }
    }
    try {
      const contents = await Promise.race([loadContents(), abortPromise]);
      const response = await Promise.race([
        window.api.ai.proposeConflictResolution(
          {
            operationId,
            filePath,
            baseContent: contents.baseContent,
            mineContent: contents.mineContent,
            theirsContent: contents.theirsContent,
          },
          { signal: controller.signal }
        ),
        abortPromise,
      ]);
      setResult(response);
      onProposalMetadata?.({
        confidence: response.confidence,
        unresolvedQuestions: response.unresolvedQuestions,
        sourceFingerprint: contents.fingerprint,
      });
    } catch (explainError) {
      if (!controller.signal.aborted) {
        setError(explainError instanceof Error ? explainError : new Error(String(explainError)));
      }
    } finally {
      unsubscribe?.();
      setStreamedText('');
      setIsLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [filePath, isLoading, loadContents, onProposalMetadata]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const chooseConsent = useCallback(
    async (aiEnabled: boolean) => {
      try {
        await writeAiConsent(workingCopyPath, aiEnabled);
        setConsent(aiEnabled ? 'on' : 'off');
        if (aiEnabled) void explain();
      } catch {
        setError(new Error('Could not save the consent choice. Try again.'));
      }
    },
    [explain, workingCopyPath]
  );

  const errorCode = parseAiErrorCode(error);
  const consentBlocked = isAiConsentErrorCode(errorCode);
  const secretBlocked = isAiSecretErrorCode(errorCode);

  const copyProposal = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.proposedMergedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (consent === 'checking') {
    return (
      <section aria-label="AI conflict explainer" className="border border-border bg-bg-secondary p-3">
        <p className="text-11 text-text-faint" role="status">
          Checking AI consent for this working copy…
        </p>
      </section>
    );
  }

  if (consent === 'off' || consent === 'unset') {
    const off = consent === 'off';
    return (
      <section aria-label="AI conflict explainer" className="border border-border bg-bg-secondary p-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h4 className="text-12 font-semibold">Explain this conflict with AI</h4>
            <p className="mt-1 text-10.5 leading-relaxed text-text-muted">
              {off
                ? 'AI is currently disabled for this working copy. The conflict base/mine/theirs text is only sent to your configured provider after you opt in.'
                : 'No AI choice is recorded for this working copy yet. Opting in lets ShellySVN send the conflict text (base, mine, theirs) to your configured provider.'}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm gap-1"
                onClick={() => void chooseConsent(true)}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {off ? 'Re-enable AI and explain' : 'Enable AI and explain'}
              </button>
              {!off && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void chooseConsent(false)}
                >
                  Keep AI off
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="AI conflict explainer" className="border border-border bg-bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
        <h4 className="text-12 font-semibold">Explain this conflict with AI</h4>
        <span className="border border-border bg-bg px-1.5 py-0.5 font-mono text-8 uppercase tracking-[0.15em] text-text-muted">
          advisory
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isLoading ? (
            <button type="button" className="btn btn-secondary btn-sm gap-1" onClick={cancel}>
              <XCircle className="h-3 w-3" aria-hidden="true" />
              Cancel
            </button>
          ) : (
            result && (
              <button
                type="button"
                className="btn btn-secondary btn-sm gap-1"
                onClick={() => void explain()}
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Regenerate
              </button>
            )
          )}
        </div>
      </div>

      {!result && !isLoading && !error && (
        <div className="mt-2">
          <p className="text-10.5 leading-relaxed text-text-muted">
            Asks your configured provider to explain the conflict and propose a merged result. The
            proposal is a suggestion — review it before applying anything.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-2 gap-1"
            onClick={() => void explain()}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Explain this conflict with AI
          </button>
        </div>
      )}

      {isLoading && (
        <div className="mt-3 space-y-2" role="status">
          <div className="flex items-center gap-2 text-11 text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {streamedText
              ? 'Streaming the explanation as it arrives…'
              : 'Loading conflict sources and asking the provider…'}
          </div>
          {streamedText && (
            <AiRichText
              markdown={streamedText}
              aria-label="Streaming explanation (AI output)"
            />
          )}
        </div>
      )}

      {error && (consentBlocked || secretBlocked) && (
        <div className="mt-3 space-y-2">
          <AiPrivacyNotice
            title={
              secretBlocked
                ? 'The privacy scanner stopped this request'
                : 'AI is not enabled for this working copy'
            }
            actionLabel="Review consent choice"
            onAction={() => {
              setError(null);
              setConsent('unset');
            }}
          >
            {secretBlocked
              ? 'The conflict text looked like it might contain a credential or secret, so nothing was sent to the provider. Resolve or remove the sensitive content, or review your consent choice.'
              : 'Nothing was sent. Per-working-copy consent is required before any conflict text can leave this machine.'}
          </AiPrivacyNotice>
        </div>
      )}

      {error && !consentBlocked && !secretBlocked && (
        <div className="mt-3">
          <ErrorPanel
            variant="banner"
            title="AI explanation failed"
            message={aiErrorMessage(error)}
            onRetry={() => void explain()}
            isRetrying={isLoading}
          />
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 font-mono text-9 text-text-faint">
            <span>
              {result.provider}
              {result.model ? `/${result.model}` : ''}
            </span>
            <span aria-label={`Confidence ${Math.round(result.confidence * 100)} percent`}>
              {Math.round(result.confidence * 100)}% confidence
            </span>
            <span>{(result.durationMs / 1000).toFixed(1)}s</span>
            {result.redacted && <span>redacted</span>}
          </div>
          <AiRichText
            markdown={result.explanation}
            showAttribution
            aria-label="Conflict explanation (AI output)"
          />
          {result.likelyIntent && (
            <AiRichText
              markdown={`**Likely intent:** ${result.likelyIntent}`}
              aria-label="Likely intent (AI output)"
            />
          )}
          {result.unresolvedQuestions.length > 0 && (
            <div className="border border-warning/40 bg-warning/5 p-2.5">
              <h5 className="font-mono text-9 uppercase tracking-wider text-warning">
                Unresolved questions
              </h5>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-10.5 text-text-secondary">
                {result.unresolvedQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h5 className="font-mono text-9 uppercase tracking-wider text-text-faint">
                Proposed merged text
              </h5>
              <button
                type="button"
                className="btn btn-secondary btn-sm ml-auto gap-1"
                onClick={() => void copyProposal()}
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {/* Rendered as a text node: React escapes it; nothing is interpreted. */}
            <pre className="mt-1 max-h-56 overflow-auto border border-border bg-bg p-2 font-mono text-10.5 text-text-secondary">
              {result.proposedMergedText}
            </pre>
          </div>
          <p className="text-9.5 text-text-faint">
            AI output is advisory. Review and apply changes yourself — the wizard never commits AI
            text automatically.
          </p>
        </div>
      )}
    </section>
  );
}
