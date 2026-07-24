import { describe, expect, it } from 'vitest';
import { appendPathReference, buildPathAutocompleteOptions } from '../commitAutocomplete';

describe('commitAutocomplete', () => {
  it('appends a path reference to an existing message', () => {
    expect(appendPathReference('Fix checkout', '/repo/src/file.ts')).toBe(
      'Fix checkout /repo/src/file.ts'
    );
  });

  it('preserves trailing whitespace when appending a path reference', () => {
    expect(appendPathReference('Fix checkout ', '/repo/src/file.ts')).toBe(
      'Fix checkout /repo/src/file.ts'
    );
  });

  it('builds changed-path autocomplete options', () => {
    expect(
      buildPathAutocompleteOptions('Fix checkout', [{ path: '/repo/src/file.ts', status: 'M' }])
    ).toEqual([
      {
        value: 'Fix checkout /repo/src/file.ts',
        label: '/repo/src/file.ts',
        description: 'Modified path',
        category: 'Changed Paths',
      },
    ]);
  });

  it('does not suggest paths already present in the message', () => {
    expect(
      buildPathAutocompleteOptions('Fix /repo/src/file.ts', [
        { path: '/repo/src/file.ts', status: 'M' },
      ])
    ).toEqual([]);
  });
});
