import type { AiPromptPreviewResult } from '@shared/types';
import { AlertTriangle, Check, Copy, Loader2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';

interface AiPromptPreviewDialogProps {
  preview: AiPromptPreviewResult;
  title: string;
  isSending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AiPromptPreviewDialog({
  preview,
  title,
  isSending = false,
  onCancel,
  onConfirm,
}: AiPromptPreviewDialogProps) {
  const [copied, setCopied] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: isSending ? undefined : onCancel,
    returnFocus: false,
    preventScroll: true,
    initialFocus: '[data-ai-preview-primary="true"]',
  });

  useEffect(
    () => () => {
      returnFocusRef.current?.focus({ preventScroll: true });
    },
    []
  );

  return (
    <div
      className="modal-overlay z-[80] overflow-y-auto overscroll-contain p-4"
      role="presentation"
      onClick={isSending ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        className="modal m-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-prompt-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header bg-bg-secondary/90">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-9 border border-accent/20 bg-accent/10 text-accent">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ai-prompt-preview-title" className="text-16 font-semibold text-text">
                {title}
              </h2>
              <p className="text-10.5 text-text-muted">
                Review exactly what will leave this machine.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon-sm"
            onClick={onCancel}
            disabled={isSending}
            aria-label="Close prompt preview"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
          {[
            ['Provider', `${preview.provider}${preview.model ? ` · ${preview.model}` : ''}`],
            ['Payload', `${(preview.inputBytes / 1024).toFixed(1)} KiB`],
            ['Redaction', preview.redacted ? 'Applied' : 'Not needed'],
            ['Truncation', preview.truncated ? 'Applied' : 'Full input'],
          ].map(([label, value]) => (
            <div key={label} className="bg-bg-secondary px-3 py-2">
              <div className="text-9.5 uppercase tracking-caps text-text-faint">{label}</div>
              <div className="mt-0.5 truncate text-11.5 text-text-secondary" title={value}>
                {value}
              </div>
            </div>
          ))}
        </div>
        {(preview.omittedBinaryFiles.length > 0 || preview.includedHistoryMessages > 0) && (
          <div className="flex items-center gap-3 border-b border-border bg-warning/5 px-4 py-2 text-10.5 text-warning">
            <AlertTriangle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            {preview.omittedBinaryFiles.length > 0 && (
              <span>
                {preview.omittedBinaryFiles.length} binary file
                {preview.omittedBinaryFiles.length === 1 ? '' : 's'} omitted
              </span>
            )}
            {preview.includedHistoryMessages > 0 && (
              <span>{preview.includedHistoryMessages} recent messages included</span>
            )}
          </div>
        )}
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg-sunk p-4 font-mono text-11 leading-relaxed text-text-secondary">
          {preview.prompt}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-bg-secondary px-4 py-3">
          <button
            type="button"
            className="btn btn-secondary btn-sm text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(preview.prompt);
              setCopied(true);
            }}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy prompt'}
            <span className="sr-only" aria-live="polite">
              {copied ? 'Prompt copied to clipboard' : ''}
            </span>
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={isSending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirm}
              disabled={isSending}
              data-ai-preview-primary="true"
              aria-busy={isSending}
            >
              {isSending ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {isSending ? 'Sending…' : 'Send to provider'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
