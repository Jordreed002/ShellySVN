import { describe, expect, it } from 'vitest';

import { detectLanguage } from '../detectLanguage';

/**
 * Drives syntax-highlighting language selection in the diff/blame/file viewers
 * (J3 cat, J7 diff/blame). A wrong language only degrades highlighting, but a
 * throw or a miss on common types degrades every file the user opens.
 */
describe('detectLanguage', () => {
  it.each([
    ['app.ts', 'typescript'],
    ['App.tsx', 'tsx'],
    ['script.js', 'javascript'],
    ['node.mjs', 'javascript'],
    ['styles.css', 'css'],
    ['theme.scss', 'scss'],
    ['page.html', 'html'],
    ['data.json', 'json'],
    ['config.yaml', 'yaml'],
    ['stack.yml', 'yaml'],
    ['Cargo.rs', 'rust'], // uppercase extension is normalized
    ['main.py', 'python'],
    ['Gemfile.rb', 'ruby'],
    ['main.go', 'go'],
    ['View.swift', 'swift'],
    ['query.sql', 'sql'],
    ['schema.graphql', 'graphql'],
    ['README.md', 'markdown'],
    ['notes.txt', 'text'],
  ])('maps %s to %s', (path, expected) => {
    expect(detectLanguage(path)).toBe(expected);
  });

  it('returns "text" for unknown extensions', () => {
    expect(detectLanguage('file.unknownext')).toBe('text');
  });

  it('recognizes dotless build filenames and falls back to text otherwise', () => {
    // A dotless filename's whole name is used as the lookup key.
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('LICENSE')).toBe('text');
  });

  it('handles dotted filenames by looking only at the final segment', () => {
    // '.d.ts' style — only the last extension segment is considered.
    expect(detectLanguage('types.d.ts')).toBe('typescript');
    expect(detectLanguage('foo.test.ts')).toBe('typescript');
  });

  it('is case-insensitive on the extension', () => {
    expect(detectLanguage('a.TS')).toBe('typescript');
    expect(detectLanguage('a.JSX')).toBe('jsx');
  });
});
