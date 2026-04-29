import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { CodeHighlighter, detectLanguage } from '../src/components/ui/CodeHighlighter';

describe('CodeHighlighter language resilience', () => {
  it('falls back to text for unknown file extensions', () => {
    expect(detectLanguage('README.unknownext')).toBe('text');
    expect(detectLanguage('no-extension')).toBe('text');
  });

  it('renders large unknown-language content without throwing', () => {
    const largeContent = Array.from({ length: 2_000 }, (_, index) => `unknown line ${index}`).join(
      '\n'
    );

    const startedAt = performance.now();
    const { container } = render(
      <CodeHighlighter code={largeContent} language="text" showLineNumbers={false} />
    );
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1000);
    expect(screen.getByText('unknown line 0')).toBeInTheDocument();
    expect(container.textContent).toContain('unknown line 1999');
  });
});
