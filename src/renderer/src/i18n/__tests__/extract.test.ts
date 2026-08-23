/**
 * String extractor (#134): deterministic POT-like JSON from fixture source
 * text — JSX text nodes, configured string-literal props, line numbers,
 * key slugification, collision suffixes, skips, and cross-file occurrence
 * merging. The fixtures stand in for the repo scan a future `scripts/`
 * pipeline (Track A) will perform; the extractor itself is pure.
 */

import { describe, expect, it } from 'vitest';
import { extractMessages } from '../extract';
import type { ExtractedMessage, ExtractionResult } from '../extract';

/** Fixture mirroring the shapes the renderer actually renders. */
const TOOLBAR_FIXTURE = [
  "import React from 'react';",
  '',
  'export function Toolbar({ onRefresh }) {',
  '  return (',
  '    <div className="toolbar">',
  '      <h1>Working Copy</h1>',
  `      <button title="Refresh the working copy" aria-label='Refresh'>Refresh</button>`,
  '      <a href="https://example.com/docs">Docs</a>',
  '      <p>Every letter counts,',
  '        even across lines.</p>',
  '      <span> </span><b>42</b>',
  '    </div>',
  '  );',
  '}',
].join('\n');

function messageFor(result: ExtractionResult, key: string): ExtractedMessage | undefined {
  return result.messages.find((message) => message.key === key);
}

describe('extractMessages', () => {
  const result = extractMessages([{ file: 'src/Toolbar.tsx', content: TOOLBAR_FIXTURE }]);

  it('extracts JSX text nodes with collapsed whitespace and correct lines', () => {
    expect(messageFor(result, 'working.copy')).toEqual({
      key: 'working.copy',
      text: 'Working Copy',
      occurrences: [{ file: 'src/Toolbar.tsx', line: 6 }],
    });
    // Multi-line JSX text collapses to one candidate anchored at its first line.
    expect(messageFor(result, 'every.letter.counts.even.across.lines')).toEqual({
      key: 'every.letter.counts.even.across.lines',
      text: 'Every letter counts, even across lines.',
      occurrences: [{ file: 'src/Toolbar.tsx', line: 9 }],
    });
    expect(messageFor(result, 'docs')).toMatchObject({ text: 'Docs', occurrences: [{ line: 8 }] });
  });

  it('extracts configured string-literal props (double and single quoted)', () => {
    expect(messageFor(result, 'refresh.the.working.copy')).toEqual({
      key: 'refresh.the.working.copy',
      text: 'Refresh the working copy',
      occurrences: [{ file: 'src/Toolbar.tsx', line: 7 }],
    });
    // The aria-label literal and the button's JSX text are the same string:
    // one candidate, occurrences deduped per file:line.
    expect(messageFor(result, 'refresh')).toEqual({
      key: 'refresh',
      text: 'Refresh',
      occurrences: [{ file: 'src/Toolbar.tsx', line: 7 }],
    });
  });

  it('skips non-UI literals: className values, letterless text, URLs', () => {
    const texts = result.messages.map((message) => message.text);
    expect(texts).not.toContain('toolbar'); // not a configured prop
    expect(texts).not.toContain('42'); // no letters
    expect(texts).not.toContain(' '); // whitespace only
    expect(texts).not.toContain('https://example.com/docs'); // href expression value

    const skipped = extractMessages([
      { file: 'a.tsx', content: '<a title="https://translate.example">Link</a>' },
    ]);
    expect(skipped.messages.map((message) => message.text)).toEqual(['Link']); // URL prop skipped
  });

  it('merges the same text across files and sorts deterministically', () => {
    const merged = extractMessages([
      { file: 'src/B.tsx', content: '<p>Refresh</p>' },
      { file: 'src/A.tsx', content: '<p>Refresh</p>' },
    ]);
    expect(merged.files).toEqual(['src/A.tsx', 'src/B.tsx']);
    expect(messageFor(merged, 'refresh')?.occurrences).toEqual([
      { file: 'src/A.tsx', line: 1 },
      { file: 'src/B.tsx', line: 1 },
    ]);
    // Byte-stable: repeated runs serialize identically (no timestamps).
    expect(JSON.stringify(merged)).toBe(
      JSON.stringify(
        extractMessages([
          { file: 'src/B.tsx', content: '<p>Refresh</p>' },
          { file: 'src/A.tsx', content: '<p>Refresh</p>' },
        ])
      )
    );
  });

  it('suffixes different texts that slug to the same key, in first-seen order', () => {
    const collided = extractMessages([
      { file: 'c.tsx', content: '<p>Commit!</p><p>commit</p>' },
    ]);
    expect(collided.messages).toEqual([
      { key: 'commit', text: 'Commit!', occurrences: [{ file: 'c.tsx', line: 1 }] },
      { key: 'commit-2', text: 'commit', occurrences: [{ file: 'c.tsx', line: 1 }] },
    ]);
  });

  it('honors custom prop lists', () => {
    const custom = extractMessages(
      [{ file: 's.tsx', content: '<input placeholder="Search everything" title="Ignored" />' }],
      { props: ['placeholder'] }
    );
    expect(custom.messages.map((message) => message.text)).toEqual(['Search everything']);
  });

  it('emits a POT-like JSON document shape', () => {
    expect(result.version).toBe(1);
    expect(result.sourceLocale).toBe('en');
    expect(result.files).toEqual(['src/Toolbar.tsx']);
    const keys = result.messages.map((message) => message.key);
    expect(keys).toEqual(keys.toSorted((a, b) => a.localeCompare(b)));
  });
});
