import { describe, expect, it } from 'vitest';

import {
  describeRequiredPlaceholders,
  expandArgumentTemplate,
  extractPlaceholders,
  validateArgumentTemplate,
  validateExternalTool,
} from '../externalToolTemplates';

describe('template placeholder extraction', () => {
  it('finds every braced token', () => {
    expect(extractPlaceholders('{mine} --swap {theirs}')).toEqual(['mine', 'theirs']);
    expect(extractPlaceholders('no placeholders')).toEqual([]);
    expect(extractPlaceholders('{Mine} {9bad} {}')).toEqual(['Mine']);
  });
});

describe('template validation per kind', () => {
  it('accepts a complete diff template', () => {
    const result = validateArgumentTemplate('diff', '{mine} {theirs}');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts diff aliases {left}/{right}', () => {
    expect(validateArgumentTemplate('diff', '{left} {right}').valid).toBe(true);
  });

  it('requires both sides for diff tools', () => {
    const missingTheirs = validateArgumentTemplate('diff', '{mine} only');
    expect(missingTheirs.valid).toBe(false);
    expect(missingTheirs.missing).toEqual([['theirs', 'right']]);
    expect(missingTheirs.errors[0]).toContain('{theirs}');

    const empty = validateArgumentTemplate('diff', '');
    expect(empty.valid).toBe(false);
    expect(empty.missing).toHaveLength(2);
  });

  it('requires mine, theirs, and merged for merge tools (base optional)', () => {
    expect(validateArgumentTemplate('merge', '{mine} {theirs} {merged}').valid).toBe(true);
    const noBase = validateArgumentTemplate('merge', '{mine} {theirs} {merged}');
    expect(noBase.warnings).toEqual([]);

    const missing = validateArgumentTemplate('merge', '{mine} {theirs}');
    expect(missing.valid).toBe(false);
    expect(missing.missing).toEqual([['merged']]);
  });

  it('warns about unknown placeholders without failing validation', () => {
    const result = validateArgumentTemplate('diff', '{mine} {theirs} {revision}');
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual(['revision']);
    expect(result.warnings[0]).toContain('{revision}');
  });

  it('describes the required placeholders for the UI', () => {
    expect(describeRequiredPlaceholders('diff')).toBe('{mine} or {left} + {theirs} or {right}');
    expect(describeRequiredPlaceholders('merge')).toContain('{merged}');
    expect(describeRequiredPlaceholders('merge')).toContain('optional');
  });
});

describe('template expansion', () => {
  it('splits on whitespace and substitutes placeholders', () => {
    expect(
      expandArgumentTemplate('--left {mine} --right {theirs} --output {merged}', {
        mine: '/a',
        theirs: '/b',
        merged: '/c',
      })
    ).toEqual(['--left', '/a', '--right', '/b', '--output', '/c']);
  });

  it('keeps quoted segments as single arguments', () => {
    expect(expandArgumentTemplate('-t "{mine}" "{theirs}"', { mine: '/path with spaces/a', theirs: '/b' })).toEqual([
      '-t',
      '/path with spaces/a',
      '/b',
    ]);
  });

  it('passes unresolved placeholders through literally', () => {
    expect(expandArgumentTemplate('{unknown} {mine}', { mine: '/a' })).toEqual(['{unknown}', '/a']);
  });
});

describe('tool entry validation', () => {
  it('validates the whole tool: name, executable, and template', () => {
    expect(
      validateExternalTool({
        id: 't',
        name: 'BC',
        executablePath: '/usr/bin/bcomp',
        kind: 'diff',
        argumentTemplate: '{mine} {theirs}',
        createdAt: 0,
      }).valid
    ).toBe(true);

    const broken = validateExternalTool({
      id: 't',
      name: '  ',
      executablePath: '',
      kind: 'merge',
      argumentTemplate: '{mine}',
      createdAt: 0,
    });
    expect(broken.valid).toBe(false);
    expect(broken.nameError).toBeDefined();
    expect(broken.executableError).toBeDefined();
    expect(broken.errors.join(' ')).toContain('{theirs}');
    expect(broken.errors.join(' ')).toContain('{merged}');
  });
});
