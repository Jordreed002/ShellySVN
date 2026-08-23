import { describe, expect, it } from 'vitest';
import {
  isChildUrl,
  isSvnRepoUrl,
  joinRepoUrl,
  normalizeRepoUrl,
  parentRepoUrl,
  parseRepoUrlIdentity,
  repoUrlEquals,
} from '../svn-url';

describe('normalizeRepoUrl', () => {
  it('lowercases scheme and host while preserving the path case', () => {
    expect(normalizeRepoUrl('SVN://SVN.Example.COM/Repo/Trunk')).toBe('svn://svn.example.com/Repo/Trunk');
    expect(normalizeRepoUrl('HTTPS://Example.com/Repo')).toBe('https://example.com/Repo');
  });

  it('elides default ports but keeps custom ones', () => {
    expect(normalizeRepoUrl('svn://h:3690/repo')).toBe('svn://h/repo');
    expect(normalizeRepoUrl('http://h:80/repo')).toBe('http://h/repo');
    expect(normalizeRepoUrl('https://h:443/repo')).toBe('https://h/repo');
    expect(normalizeRepoUrl('svn://h:4000/repo')).toBe('svn://h:4000/repo');
    expect(normalizeRepoUrl('http://[::1]:3690/svn/repo')).toBe('http://[::1]:3690/svn/repo');
  });

  it('preserves IPv6 brackets and compresses long literals', () => {
    expect(normalizeRepoUrl('svn://[::1]:3690/svn/répo')).toBe('svn://[::1]/svn/r%C3%A9po');
    expect(normalizeRepoUrl('svn://[0:0:0:0:0:0:0:1]/repo')).toBe('svn://[::1]/repo');
  });

  it('converts IDN hosts to punycode and accepts already-punycode hosts', () => {
    expect(normalizeRepoUrl('svn://höst/repo')).toBe('svn://xn--hst-sna/repo');
    expect(normalizeRepoUrl('svn://xn--hst-sna/repo')).toBe('svn://xn--hst-sna/repo');
    expect(normalizeRepoUrl('svn+ssh://bob@wörterbuch.example/Ünicode')).toBe(
      'svn+ssh://bob@xn--wrterbuch-07a.example/%C3%9Cnicode'
    );
  });

  it('NFC-normalizes and percent-encodes unicode path segments exactly once', () => {
    expect(normalizeRepoUrl('svn://h/é')).toBe('svn://h/%C3%A9');
    expect(normalizeRepoUrl('svn://h/%C3%A9')).toBe('svn://h/%C3%A9');
    expect(normalizeRepoUrl('svn://h/é')).toBe('svn://h/%C3%A9'); // NFD input canonicalizes to NFC
    expect(normalizeRepoUrl('svn://h/Répo Dir')).toBe('svn://h/R%C3%A9po%20Dir');
    expect(normalizeRepoUrl('svn://h/R%C3%A9po%20Dir')).toBe('svn://h/R%C3%A9po%20Dir');
  });

  it('keeps %2F encoded inside a path segment and escapes literal percents', () => {
    // A file literally named `a%20b.txt` must be addressed as `a%2520b.txt`;
    // leaving the percent raw would make SVN resolve `a b.txt` instead.
    expect(normalizeRepoUrl('svn://h/trunk/a%2520b.txt')).toBe('svn://h/trunk/a%2520b.txt');
    expect(normalizeRepoUrl('svn://h/a%2Fb')).toBe('svn://h/a%2Fb');
  });

  it('strips trailing slashes and collapses duplicate slashes', () => {
    expect(normalizeRepoUrl('svn://h/repo/trunk/')).toBe('svn://h/repo/trunk');
    expect(normalizeRepoUrl('svn://h/repo//trunk///')).toBe('svn://h/repo/trunk');
  });

  it('preserves Windows drive-letter file URLs, userinfo, and peg revisions', () => {
    expect(normalizeRepoUrl('file:///C:/svn/repo')).toBe('file:///C:/svn/repo');
    expect(normalizeRepoUrl('svn+ssh://bob@h/repo')).toBe('svn+ssh://bob@h/repo');
    expect(normalizeRepoUrl('https://example.test/svn/repo/trunk@41')).toBe(
      'https://example.test/svn/repo/trunk@41'
    );
  });

  it('passes working-copy paths and non-SVN URLs through unchanged', () => {
    expect(normalizeRepoUrl('C:\\wc\\trunk')).toBe('C:\\wc\\trunk');
    expect(normalizeRepoUrl('/home/alice/wc')).toBe('/home/alice/wc');
    expect(normalizeRepoUrl('not a url')).toBe('not a url');
    expect(normalizeRepoUrl('ftp://h/repo')).toBe('ftp://h/repo');
  });
});

describe('repoUrlEquals', () => {
  it('round-trips encoding variants to equality', () => {
    expect(repoUrlEquals('svn://h/%C3%A9', 'svn://h/é')).toBe(true);
    expect(repoUrlEquals('svn://h/trunk', 'svn://h/trunk/')).toBe(true);
    expect(repoUrlEquals('svn://h/R%C3%A9po%20Dir', 'svn://h/Répo Dir')).toBe(true);
    expect(repoUrlEquals('svn://h/repo', 'svn://h:3690/repo')).toBe(true);
  });

  it('treats IPv6 and IDN spellings of the same host as equal', () => {
    expect(repoUrlEquals('svn://[::1]/repo', 'svn://[0:0:0:0:0:0:0:1]:3690/repo')).toBe(true);
    expect(repoUrlEquals('svn://höst/repo', 'svn://xn--hst-sna/repo')).toBe(true);
    expect(repoUrlEquals('svn+ssh://bob@h/repo', 'svn+ssh://h/repo')).toBe(true);
  });

  it('keeps path case sensitivity and distinct decoded names distinct', () => {
    expect(repoUrlEquals('svn://h/Trunk', 'svn://h/trunk')).toBe(false);
    expect(repoUrlEquals('svn://h/a%2520b.txt', 'svn://h/a%20b.txt')).toBe(false);
    expect(repoUrlEquals('svn://h/repo', 'svn://h/repo/trunk')).toBe(false);
    expect(repoUrlEquals('svn://h/repo', 'svn://other/repo')).toBe(false);
  });
});

describe('isChildUrl', () => {
  it('requires a strict segment prefix within the same repository authority', () => {
    expect(isChildUrl('svn://h/repo', 'svn://h/repo/trunk')).toBe(true);
    expect(isChildUrl('svn://h/repo/', 'svn://h:3690/repo/trunk/src')).toBe(true);
    expect(isChildUrl('svn://h/repo', 'svn://h/repo')).toBe(false);
    expect(isChildUrl('svn://h/repo', 'svn://h/repository')).toBe(false);
    expect(isChildUrl('svn://h/repo', 'https://h/repo/trunk')).toBe(false);
  });

  it('compares decoded, NFC-normalized segments', () => {
    expect(isChildUrl('svn://h/Répo Dir', 'svn://h/R%C3%A9po%20Dir/trunk')).toBe(true);
    expect(isChildUrl('svn://h/repo', 'svn://h/repo/a%2Fb')).toBe(true); // %2F stays one segment
  });
});

describe('joinRepoUrl', () => {
  it('encodes decoded segment names exactly once', () => {
    expect(joinRepoUrl('svn://h/repo', 'Répo Dir')).toBe('svn://h/repo/R%C3%A9po%20Dir');
    expect(joinRepoUrl('svn://h/repo/', 'trunk')).toBe('svn://h/repo/trunk');
    expect(joinRepoUrl('svn://h/repo', 'a%20b.txt')).toBe('svn://h/repo/a%2520b.txt');
    expect(joinRepoUrl('svn://h/repo', 'branches/x')).toBe('svn://h/repo/branches/x');
  });

  it('round-trips list output names into canonical SVN URLs', () => {
    const listed = ['Répo Dir', 'Ünicode File.txt', 'a%20b.txt', 'trunk'];
    for (const name of listed) {
      const url = joinRepoUrl('svn://h/repo/trunk', name);
      expect(url).toBe(normalizeRepoUrl(url));
      expect(repoUrlEquals(url, joinRepoUrl('svn://h:3690/repo/trunk/', name))).toBe(true);
    }
  });

  it('falls back to plain joining for non-URL bases', () => {
    expect(joinRepoUrl('svn://h/repo', '')).toBe('svn://h/repo');
  });
});

describe('parentRepoUrl', () => {
  it('removes the last encoded segment and preserves the rest verbatim', () => {
    expect(parentRepoUrl('svn://h/repo/trunk/Feature%20Folder')).toBe('svn://h/repo/trunk');
    expect(parentRepoUrl('svn://h/repo/trunk')).toBe('svn://h/repo');
    expect(parentRepoUrl('svn://h/repo')).toBe('svn://h');
    expect(parentRepoUrl('svn://h')).toBe('svn://h');
    expect(parentRepoUrl('svn+ssh://bob@h/repo/trunk')).toBe('svn+ssh://bob@h/repo');
  });
});

describe('parseRepoUrlIdentity', () => {
  it('exposes punycode-ready hosts, IPv6 literals, and effective ports', () => {
    const idn = parseRepoUrlIdentity('svn://HÖST/repo');
    expect(idn?.host).toBe('xn--hst-sna');
    expect(idn?.isIpv6).toBe(false);
    expect(idn?.port).toBe(3690);
    expect(idn?.emittedPort).toBeNull();

    const ipv6 = parseRepoUrlIdentity('svn://[0:0:0:0:0:0:0:1]:4000/repo');
    expect(ipv6?.host).toBe('[::1]');
    expect(ipv6?.isIpv6).toBe(true);
    expect(ipv6?.port).toBe(4000);
    expect(ipv6?.emittedPort).toBe(4000);

    const ssh = parseRepoUrlIdentity('svn+ssh://bob@h/repo/trunk');
    expect(ssh?.userinfo).toBe('bob');
    expect(ssh?.segments).toEqual(['repo', 'trunk']);
    expect(ssh?.path).toBe('/repo/trunk');
  });

  it('returns null for working-copy paths and unsupported schemes', () => {
    expect(parseRepoUrlIdentity('C:\\wc')).toBeNull();
    expect(parseRepoUrlIdentity('/home/alice/wc')).toBeNull();
    expect(parseRepoUrlIdentity('ftp://h/repo')).toBeNull();
    expect(parseRepoUrlIdentity('svn://h/repo')).not.toBeNull();
    expect(isSvnRepoUrl('svn+ssh://h/repo')).toBe(true);
    expect(isSvnRepoUrl('file:///C:/svn/repo')).toBe(true);
    expect(isSvnRepoUrl('relative/path')).toBe(false);
  });
});
