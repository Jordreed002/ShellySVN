/**
 * The top bar's repository pill: what it may claim, and where it must stop.
 *
 * The bug this covers is a lie of omission — the pill read "No repository" while
 * the repository browser was open, because the only identity it looked at was a
 * working-copy path. The fix widens the sources, so the interesting cases are
 * the ones where a source is *nearly* good enough: a URL from a repository the
 * user has never checked out (host known, name unknowable without asking the
 * server) and a checkout whose `svn info` has not answered yet (folder known,
 * repository name not).
 */

import { describe, expect, it } from 'vitest';

import { describeRepositoryPill } from '../layout/repositoryPill';

const ATLAS = { url: 'svn://svn.lineindustries.com/atlas', name: 'atlas' };

describe('describeRepositoryPill', () => {
  it('names the repository and its host from the working copy', () => {
    const pill = describeRepositoryPill({
      repositoryRoot: 'svn://svn.lineindustries.com/atlas',
      workingCopyPath: '/wc/acme-corp',
    });

    expect(pill.label).toBe('atlas');
    expect(pill.host).toBe('svn.lineindustries.com');
    expect(pill.ariaLabel).toBe('Repository atlas on svn.lineindustries.com — switch repository');
    expect(pill.title).toBe('svn://svn.lineindustries.com/atlas — /wc/acme-corp');
  });

  it('names a browsed URL from a repository the user has checked out', () => {
    const pill = describeRepositoryPill({
      browsedUrl: 'svn://svn.lineindustries.com/atlas/clients/acme-corp/trunk',
      knownRoots: [ATLAS],
    });

    expect(pill.label).toBe('atlas');
    expect(pill.host).toBe('svn.lineindustries.com');
  });

  it('does not bind a browsed URL to a root it merely shares a prefix with', () => {
    const pill = describeRepositoryPill({
      browsedUrl: 'svn://svn.lineindustries.com/atlas-archive/trunk',
      knownRoots: [ATLAS],
    });

    expect(pill.label).toBe('svn.lineindustries.com');
    expect(pill.host).toBeNull();
  });

  it('falls back to the host for an unknown repository, rather than guessing a name', () => {
    const pill = describeRepositoryPill({
      browsedUrl: 'https://svn.example.com/other/trunk/src',
    });

    // `trunk`/`src` are directories inside the repository, never its name.
    expect(pill.label).toBe('svn.example.com');
    expect(pill.ariaLabel).toBe('Browsing a repository on svn.example.com — switch repository');
  });

  it('says it is showing a working copy while `svn info` is still in flight', () => {
    const pill = describeRepositoryPill({ workingCopyPath: '/wc/acme-corp/' });

    expect(pill.label).toBe('acme-corp');
    expect(pill.ariaLabel).toBe('Working copy acme-corp — switch repository');
  });

  it('does not name a root-served repository after its host', () => {
    const pill = describeRepositoryPill({
      repositoryRoot: 'svn://svn.example.com',
      workingCopyPath: '/wc/thing',
    });

    expect(pill.label).toBe('svn.example.com');
    expect(pill.host).toBeNull();
  });

  it('reports the empty state when nothing is open', () => {
    const pill = describeRepositoryPill({});

    expect(pill.label).toBe('No repository');
    expect(pill.ariaLabel).toBe('No repository open — open the command palette to pick one');
  });
});
