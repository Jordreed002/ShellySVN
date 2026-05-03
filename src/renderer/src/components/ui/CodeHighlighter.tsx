import { memo, useMemo } from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
export { detectLanguage } from '../../utils/detectLanguage';

interface CodeHighlighterProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

export const CodeHighlighter = memo(function CodeHighlighter({
  code,
  language = 'text',
  showLineNumbers = true,
  maxHeight = '100%',
  className = '',
}: CodeHighlighterProps) {
  // Custom style adjustments for the theme
  const customStyle = useMemo(
    () => ({
      margin: 0,
      padding: '1rem',
      background: 'transparent',
      fontSize: '0.75rem',
      lineHeight: '1.5',
      maxHeight,
      overflow: 'auto' as const,
    }),
    [maxHeight]
  );

  // Use light theme (could be made configurable with app theme)
  const style = oneLight;

  return (
    <div className={`code-highlighter ${className}`}>
      <SyntaxHighlighter
        language={language}
        style={style}
        showLineNumbers={showLineNumbers}
        customStyle={customStyle}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          },
        }}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          color: '#94a3b8',
          userSelect: 'none',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});
