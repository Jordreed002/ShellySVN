/**
 * The rule these tests exist to defend: local status is a working-copy fact.
 * If `mergeEntries` ever attaches a status outside a checkout, the UI starts
 * claiming the server knows about edits it cannot possibly know about.
 */

import { describe, it, expect } from 'vitest';
import type {
  SvnExternalsResult,
  SvnRepoEntry,
  SvnStatusEntry,
  SvnStatusResult,
} from '@shared/types';

import {
  containsPath,
  deriveMixedRevisions,
  deriveProblems,
  isMixedRevision,
  mergeEntries,
  parseExternalsProperty,
  presenceFromCheckouts,
  resolveScope,
  summariseRollup,
} from '../adapters';

const listEntry = (over: Partial<SvnRepoEntry> = {}): SvnRepoEntry => ({
  name: 'svn.ts',
  path: 'clients/acme/trunk/src/svn.ts',
  url: 'svn://example/atlas/clients/acme/trunk/src/svn.ts',
  kind: 'file',
  revision: 4802,
  author: 'jordan',
  date: '2026-07-20T10:00:00Z',
  ...over,
});

const statusEntry = (over: Partial<SvnStatusEntry> = {}): SvnStatusEntry => ({
  path: 'clients/acme/trunk/src/svn.ts',
  status: 'M',
  isDirectory: false,
  ...over,
});

describe('resolveScope', () => {
  const roots = ['clients/acme/trunk'];

  it('is a working copy at the checkout root', () => {
    expect(resolveScope('clients/acme/trunk', roots)).toBe('working-copy');
  });

  it('is a working copy beneath the checkout root', () => {
    expect(resolveScope('clients/acme/trunk/src', roots)).toBe('working-copy');
  });

  it('is a repository listing elsewhere', () => {
    expect(resolveScope('clients/globex', roots)).toBe('repository');
  });

  it('does not treat a sibling with a shared prefix as inside the checkout', () => {
    expect(resolveScope('clients/acme/trunk-archive', roots)).toBe('repository');
  });

  it('treats a checkout of the whole repository as containing every path', () => {
    expect(resolveScope('clients/acme-corp', [''])).toBe('working-copy');
  });
});

describe('mergeEntries', () => {
  it('attaches local status inside a working copy', () => {
    const [entry] = mergeEntries({
      entries: [listEntry()],
      repoPath: 'clients/acme/trunk/src',
      scope: 'working-copy',
      statusByPath: new Map([['clients/acme/trunk/src/svn.ts', statusEntry()]]),
    });

    expect(entry.status).toBe('M');
  });

  it('refuses to attach local status outside a working copy', () => {
    const [entry] = mergeEntries({
      entries: [listEntry()],
      repoPath: 'clients/globex',
      scope: 'repository',
      // Even when status is supplied, scope wins.
      statusByPath: new Map([['clients/acme/trunk/src/svn.ts', statusEntry()]]),
    });

    expect(entry.status).toBeUndefined();
    expect(entry.rollup).toBeUndefined();
    expect(entry.lock).toBeUndefined();
  });

  it('keeps repository facts in both scopes', () => {
    const [entry] = mergeEntries({
      entries: [listEntry()],
      repoPath: 'clients/globex',
      scope: 'repository',
    });

    expect(entry.revision).toBe(4802);
    expect(entry.author).toBe('jordan');
  });

  it('marks presence only when something is actually on disk', () => {
    const entries = mergeEntries({
      entries: [
        listEntry({ name: 'acme', path: 'clients/acme', kind: 'dir' }),
        listEntry({ name: 'globex', path: 'clients/globex', kind: 'dir' }),
      ],
      repoPath: 'clients',
      scope: 'repository',
      presenceByPath: new Map([
        ['clients/acme', 'sparse' as const],
        ['clients/globex', 'none' as const],
      ]),
    });

    // Mark the exception, not the rule: the checked-out one is labelled,
    // the absent one carries nothing.
    expect(entries[0].presence).toBe('sparse');
    expect(entries[1].presence).toBeUndefined();
  });

  it('carries external pegging through', () => {
    const [entry] = mergeEntries({
      entries: [listEntry({ name: 'vendor', path: 'clients/acme/trunk/vendor', kind: 'dir' })],
      repoPath: 'clients/acme/trunk',
      scope: 'working-copy',
      externalPaths: new Map([['clients/acme/trunk/vendor', { pegged: false }]]),
    });

    expect(entry.isExternal).toBe(true);
    expect(entry.externalPegged).toBe(false);
  });

  it('rolls up child changes for directories only', () => {
    const [dir, file] = mergeEntries({
      entries: [
        listEntry({ name: 'src', path: 'clients/acme/trunk/src', kind: 'dir' }),
        listEntry(),
      ],
      repoPath: 'clients/acme/trunk',
      scope: 'working-copy',
      statusByPath: new Map([
        [
          'clients/acme/trunk/src',
          statusEntry({ path: 'clients/acme/trunk/src', isDirectory: true, childChangeCount: 6 }),
        ],
        ['clients/acme/trunk/src/svn.ts', statusEntry()],
      ]),
    });

    expect(dir.rollup?.modified).toBe(6);
    expect(file.rollup).toBeUndefined();
  });
});

describe('deriveMixedRevisions', () => {
  it('reports the span across the working copy', () => {
    const entries = [
      statusEntry({ revision: 4744 }),
      statusEntry({ revision: 4838 }),
      statusEntry({ revision: 4802 }),
    ];
    expect(deriveMixedRevisions(entries, 4821)).toEqual({ lowest: 4744, highest: 4838 });
  });

  it('falls back to BASE when nothing carries a revision', () => {
    expect(deriveMixedRevisions([statusEntry({ revision: undefined })], 4821)).toEqual({
      lowest: 4821,
      highest: 4821,
    });
  });

  it('recognises a single-revision working copy as not mixed', () => {
    expect(isMixedRevision({ mixedRevisions: { lowest: 4821, highest: 4821 } })).toBe(false);
    expect(isMixedRevision({ mixedRevisions: { lowest: 4744, highest: 4838 } })).toBe(true);
  });
});

describe('summariseRollup', () => {
  it('counts replaced entries as modified and keeps conflicts separate', () => {
    const rollup = summariseRollup([
      statusEntry({ status: 'M' }),
      statusEntry({ status: 'R' }),
      statusEntry({ status: 'A' }),
      statusEntry({ status: 'C' }),
      statusEntry({ status: '?' }),
    ]);

    expect(rollup).toEqual({ modified: 2, added: 1, deleted: 0, conflicted: 1 });
  });

  /*
   * A pending delete is the whole content of "1 change" in the status bar. The
   * band was built from this rollup and ignored `D`, so the same working copy
   * said "0 local changes" in one place and "1 change" in another.
   */
  it('counts scheduled deletions and missing items as changes', () => {
    const rollup = summariseRollup([statusEntry({ status: 'D' }), statusEntry({ status: '!' })]);

    expect(rollup).toEqual({ modified: 0, added: 0, deleted: 2, conflicted: 0 });
  });
});

describe('deriveProblems', () => {
  const emptyStatus: SvnStatusResult = { path: '/wc', entries: [], revision: 4821 };

  it('reports a conflict as blocking', () => {
    const problems = deriveProblems({
      status: { path: '/wc', entries: [statusEntry({ status: 'C' })], revision: 4821 },
      externals: undefined,
      localPath: '/wc',
    });

    expect(problems[0].kind).toBe('text-conflict');
    expect(problems[0].severity).toBe('blocking');
    expect(problems[0].command).toContain('svn resolve');
  });

  it('reports needing cleanup with the exact command', () => {
    const problems = deriveProblems({
      status: emptyStatus,
      externals: undefined,
      localPath: '/wc/brand-system',
      needsCleanup: true,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('needs-cleanup');
    expect(problems[0].command).toBe('svn cleanup "/wc/brand-system"');
  });

  it('flags a floating external but leaves a pegged one alone', () => {
    const externals: SvnExternalsResult = {
      externals: [
        { name: 'vendor', url: '^/vendor/plex-fonts', path: 'trunk/vendor' },
        { name: 'fonts', url: '^/vendor/fonts', path: 'trunk/fonts', pegRevision: 4831 },
      ],
    };

    const problems = deriveProblems({ status: emptyStatus, externals, localPath: '/wc' });

    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('floating-external');
    expect(problems[0].path).toBe('trunk/vendor');
  });

  it('reports being behind the server as advisory, not blocking', () => {
    const problems = deriveProblems({
      status: emptyStatus,
      externals: undefined,
      localPath: '/wc',
      incomingRevisions: 17,
    });

    const behind = problems.find((p) => p.kind === 'out-of-date');
    expect(behind?.severity).toBe('advisory');
    expect(behind?.title).toBe('17 revisions behind');
    expect(behind?.command).toBe('svn update "/wc"');
  });

  it('says nothing when the working copy is current', () => {
    const problems = deriveProblems({
      status: emptyStatus,
      externals: undefined,
      localPath: '/wc',
      incomingRevisions: 0,
    });

    expect(problems.some((p) => p.kind === 'out-of-date')).toBe(false);
  });

  it('marks a capped incoming count as approximate', () => {
    const problems = deriveProblems({
      status: emptyStatus,
      externals: undefined,
      localPath: '/wc',
      incomingRevisions: 100,
      incomingCapped: true,
    });

    expect(problems.find((p) => p.kind === 'out-of-date')?.title).toBe('100+ revisions behind');
  });

  it('only calls a lock stale once it is genuinely old', () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    const freshProblems = deriveProblems({
      status: {
        path: '/wc',
        entries: [statusEntry({ status: 'M', lock: { owner: 'devon', comment: '', date: fresh } })],
        revision: 4821,
      },
      externals: undefined,
      localPath: '/wc',
    });
    const staleProblems = deriveProblems({
      status: {
        path: '/wc',
        entries: [statusEntry({ status: 'M', lock: { owner: 'devon', comment: '', date: old } })],
        revision: 4821,
      },
      externals: undefined,
      localPath: '/wc',
    });

    expect(freshProblems.some((p) => p.kind === 'stale-lock')).toBe(false);
    expect(staleProblems.some((p) => p.kind === 'stale-lock')).toBe(true);
  });
});

describe('containsPath', () => {
  it('does not mistake a name prefix for containment', () => {
    // The case a monorepo makes routine: two clients whose names share a prefix.
    expect(containsPath('clients/acme', 'clients/acme-corp/website')).toBe(false);
    expect(containsPath('clients/acme', 'clients/acme/website')).toBe(true);
  });

  it('treats the repository root as containing everything', () => {
    expect(containsPath('', 'clients/acme-corp')).toBe(true);
  });

  it('contains itself', () => {
    expect(containsPath('clients/acme', 'clients/acme')).toBe(true);
  });
});

describe('presenceFromCheckouts', () => {
  it('marks nothing when no checkouts are known', () => {
    expect(presenceFromCheckouts([]).size).toBe(0);
  });

  it('marks the checkout root as fully present and its ancestors as partly', () => {
    const presence = presenceFromCheckouts(['clients/acme-corp/website/trunk']);

    expect(presence.get('clients/acme-corp/website/trunk')).toBe('full');
    expect(presence.get('clients')).toBe('sparse');
    expect(presence.get('clients/acme-corp')).toBe('sparse');
    expect(presence.get('clients/acme-corp/website')).toBe('sparse');
  });

  it('marks the exception, not the rule', () => {
    const presence = presenceFromCheckouts(['clients/acme-corp/website/trunk']);

    // Everything with nothing on disk beneath it stays unlabelled.
    expect(presence.has('internal')).toBe(false);
    expect(presence.has('archive')).toBe(false);
    // Including a sibling whose name merely shares a prefix.
    expect(presence.has('clients/acme')).toBe(false);
  });

  it('lets a checkout root win over being an ancestor of another checkout', () => {
    const presence = presenceFromCheckouts(['clients', 'clients/acme-corp/website/trunk']);

    expect(presence.get('clients')).toBe('full');
    expect(presence.get('clients/acme-corp')).toBe('sparse');
  });

  it('marks nothing for a checkout of the whole repository', () => {
    // Every path is inside it; resolveScope says so far more directly.
    expect(presenceFromCheckouts(['']).size).toBe(0);
  });
});

describe('parseExternalsProperty', () => {
  it('reads the modern syntax and spots a peg revision', () => {
    const externals = parseExternalsProperty(
      '-r4831 ^/vendor/fonts fonts\n^/vendor/plex-fonts vendor',
      'clients/acme/trunk'
    );

    expect(externals.get('clients/acme/trunk/fonts')).toEqual({ pegged: true });
    // No -r and no @rev: this one floats, which is a reproducibility problem.
    expect(externals.get('clients/acme/trunk/vendor')).toEqual({ pegged: false });
  });

  it('reads the pre-1.5 syntax, where the local path comes first', () => {
    const externals = parseExternalsProperty('vendor -r 4831 http://svn.example.com/lib', 'trunk');
    expect(externals.get('trunk/vendor')).toEqual({ pegged: true });
  });

  it('treats an @rev on the URL as pegged', () => {
    const externals = parseExternalsProperty('^/vendor/fonts@4831 fonts', 'trunk');
    expect(externals.get('trunk/fonts')).toEqual({ pegged: true });
  });

  it('ignores comments and blank lines', () => {
    const externals = parseExternalsProperty('# fonts, pinned for the rebrand\n\n^/a b', '');
    expect([...externals.keys()]).toEqual(['b']);
  });

  it('accepts every relative-URL form Subversion allows', () => {
    const externals = parseExternalsProperty(
      ['^/a one', '//svn.example.com/b two', '/repos/c three', '../d four'].join('\n'),
      'trunk'
    );

    expect([...externals.keys()]).toEqual(['trunk/one', 'trunk/two', 'trunk/three', 'trunk/four']);
  });

  it('refuses a local path that escapes the directory', () => {
    expect(parseExternalsProperty('^/a ../escape', 'trunk').size).toBe(0);
  });
});
