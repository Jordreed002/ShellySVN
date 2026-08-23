import { useMemo, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { renderAiMarkdown } from '@renderer/features/ai-review-center/lib/sanitizeAiMarkdown';

export interface AiRichTextProps {
  /** AI-produced markdown. Sanitized through the allowlist before it touches the DOM. */
  markdown: string;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Render an "AI" attribution chip demarcating the block as model output. */
  showAttribution?: boolean;
  /** Treat the text as a single inline run (no block wrapper, no chip). */
  inline?: boolean;
  style?: CSSProperties;
  'aria-label'?: string;
}

const CONTENT_CLASS =
  '[&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-2 [&_code]:font-mono [&_code]:text-11 [&_h3]:mt-2 [&_h3]:text-12 [&_h3]:font-semibold [&_h4]:mt-2 [&_h4]:text-12 [&_h4]:font-semibold [&_h5]:mt-1 [&_h5]:text-11.5 [&_h5]:font-semibold [&_h6]:mt-1 [&_h6]:text-11.5 [&_h6]:font-semibold [&_li]:mt-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mt-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:mt-1 [&_pre]:overflow-x-auto [&_pre]:bg-bg-tertiary [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-10.5 [&_ul]:list-disc [&_ul]:pl-4';

/**
 * The one way AI-produced rich text reaches the DOM (#19): markdown-lite is
 * rendered by the sanitizer util and injected only after the allowlist walk,
 * inside a visually demarcated "AI output" block.
 */
export function AiRichText({
  markdown,
  className = '',
  showAttribution = false,
  inline = false,
  style,
  'aria-label': ariaLabel,
}: AiRichTextProps) {
  const html = useMemo(() => renderAiMarkdown(markdown), [markdown]);

  if (inline) {
    return (
      <span
        className={`ai-richtext ${CONTENT_CLASS} ${className}`}
        style={style}
        aria-label={ariaLabel}
        data-sanitized="ai"
        // Sanitized allowlist output — see renderAiMarkdown.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div
      className={`ai-richtext border-l-2 border-accent/40 bg-accent/[0.04] px-2.5 py-2 text-11.5 leading-relaxed text-text-secondary ${className}`}
      style={style}
      aria-label={ariaLabel}
      data-sanitized="ai"
    >
      {showAttribution && (
        <span className="mb-1.5 flex items-center gap-1 font-mono text-8.5 uppercase tracking-[0.15em] text-text-faint">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          AI output · advisory
        </span>
      )}
      {/* Sanitized allowlist output — see renderAiMarkdown. */}
      <div className={CONTENT_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
