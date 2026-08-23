import { describe, expect, it } from 'vitest';

import {
  ACCEPT_MODE_CATALOG,
  POSTPONE_MODE_INFO,
  acceptModeLabel,
  acceptModeOutcome,
  applicableAcceptModes,
  isModeApplicable,
  normalizeWizardResolution,
  toSvnResolveArg,
} from '../conflictAcceptModes';

describe('accept-mode catalog', () => {
  it('covers the full svn resolve --accept set', () => {
    expect(Object.keys(ACCEPT_MODE_CATALOG).toSorted()).toEqual(
      ['base', 'mine-conflict', 'mine-full', 'theirs-conflict', 'theirs-full', 'working'].toSorted()
    );
  });

  it('gives every mode a non-empty plain-language consequence', () => {
    for (const info of Object.values(ACCEPT_MODE_CATALOG)) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.consequence.length).toBeGreaterThan(20);
      expect(info.outcome.length).toBeGreaterThan(0);
      expect(info.appliesTo.length).toBeGreaterThan(0);
    }
    expect(POSTPONE_MODE_INFO.consequence.length).toBeGreaterThan(20);
  });

  it('marks side-picking modes destructive and working/postpone safe', () => {
    expect(ACCEPT_MODE_CATALOG['mine-full'].destructive).toBe(true);
    expect(ACCEPT_MODE_CATALOG['theirs-full'].destructive).toBe(true);
    expect(ACCEPT_MODE_CATALOG.base.destructive).toBe(true);
    expect(ACCEPT_MODE_CATALOG.working.destructive).toBe(false);
    expect(POSTPONE_MODE_INFO.destructive).toBe(false);
  });
});

describe('applicableAcceptModes', () => {
  it('offers all six svn modes for text conflicts', () => {
    expect(applicableAcceptModes('text').map((mode) => mode.value)).toEqual([
      'mine-full',
      'theirs-full',
      'mine-conflict',
      'theirs-conflict',
      'base',
      'working',
    ]);
  });

  it('offers binary conflicts the whole-file modes only', () => {
    expect(applicableAcceptModes('binary').map((mode) => mode.value)).toEqual([
      'mine-full',
      'theirs-full',
      'base',
      'working',
    ]);
  });

  it('excludes base from tree conflicts but keeps the section modes', () => {
    const values = applicableAcceptModes('tree').map((mode) => mode.value);
    expect(values).toContain('mine-conflict');
    expect(values).toContain('theirs-conflict');
    expect(values).not.toContain('base');
    expect(values).toContain('working');
  });

  it('offers property conflicts every mode svn accepts for props', () => {
    const values = applicableAcceptModes('property').map((mode) => mode.value);
    expect(values).toEqual([
      'mine-full',
      'theirs-full',
      'mine-conflict',
      'theirs-conflict',
      'base',
      'working',
    ]);
  });
});

describe('isModeApplicable', () => {
  it('accepts postpone everywhere', () => {
    for (const kind of ['text', 'property', 'tree', 'binary'] as const) {
      expect(isModeApplicable('postpone', kind)).toBe(true);
    }
  });

  it('rejects base for tree conflicts', () => {
    expect(isModeApplicable('base', 'tree')).toBe(false);
    expect(isModeApplicable('base', 'text')).toBe(true);
  });
});

describe('toSvnResolveArg', () => {
  it('passes accept arguments through', () => {
    for (const arg of ['base', 'mine-full', 'theirs-full', 'mine-conflict', 'theirs-conflict', 'working'] as const) {
      expect(toSvnResolveArg(arg)).toBe(arg);
    }
  });

  it('returns undefined for postpone — leaving it unresolved is not an svn call', () => {
    expect(toSvnResolveArg('postpone')).toBeUndefined();
  });
});

describe('normalizeWizardResolution', () => {
  it('maps the historical merged/custom aliases onto working', () => {
    expect(normalizeWizardResolution('merged')).toBe('working');
    expect(normalizeWizardResolution('custom')).toBe('working');
    expect(normalizeWizardResolution('mine-full')).toBe('mine-full');
    expect(normalizeWizardResolution('postpone')).toBe('postpone');
  });
});

describe('labels and outcomes', () => {
  it('resolves aliases for display', () => {
    expect(acceptModeLabel('merged')).toBe(acceptModeLabel('working'));
    expect(acceptModeLabel('postpone')).toBe(POSTPONE_MODE_INFO.label);
    expect(acceptModeOutcome('merged')).toBe(ACCEPT_MODE_CATALOG.working.outcome);
    expect(acceptModeOutcome('postpone')).toBe(POSTPONE_MODE_INFO.outcome);
  });
});
