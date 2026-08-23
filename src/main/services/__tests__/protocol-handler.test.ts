import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    setAsDefaultProtocolClient: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
  },
}));

import {
  deepLinks,
  generateDeepLink,
  parseDeepLink,
  processDeepLink,
  registerDeepLinkHandler,
  unregisterDeepLinkHandler,
} from '../protocol-handler';
import type { DeepLink } from '../protocol-handler';

describe('protocol handler deep-link parsing', () => {
  it('parses supported deep links and marks mutating actions for confirmation', () => {
    const link = parseDeepLink(
      'shellysvn://checkout?url=https%3A%2F%2Fsvn.example.com%2Frepo&path=C%3A%5Cwc'
    );

    expect(link).toMatchObject({
      action: 'checkout',
      url: 'https://svn.example.com/repo',
      path: 'C:\\wc',
      requiresConfirmation: true,
    });
  });

  it('rejects unsupported actions and repository URL protocols', () => {
    expect(parseDeepLink('shellysvn://delete?path=C%3A%5Cwc')).toBeNull();
    expect(parseDeepLink('shellysvn://checkout?url=file%3A%2F%2F%2FC%3A%2Fsecret')).toBeNull();
  });

  it('rejects missing required paths and oversized input', () => {
    expect(parseDeepLink('shellysvn://commit')).toBeNull();
    expect(parseDeepLink(`shellysvn://open?path=${'a'.repeat(5000)}`)).toBeNull();
  });

  it('round-trips generated repository URLs and local paths exactly once', () => {
    const repositoryUrl = 'https://svn.example.com/repo with spaces/trunk?a=1&b=two%20words';
    const localPath = 'C:\\Working Copies\\café @ 2x';

    expect(parseDeepLink(deepLinks.checkout(repositoryUrl, localPath))).toMatchObject({
      action: 'checkout',
      url: repositoryUrl,
      path: localPath,
    });
    expect(parseDeepLink(deepLinks.export(repositoryUrl, localPath))).toMatchObject({
      action: 'export',
      url: repositoryUrl,
      path: localPath,
    });
    expect(
      parseDeepLink(generateDeepLink('log', { path: localPath, revision: '42' }))
    ).toMatchObject({
      action: 'log',
      path: localPath,
      params: { path: localPath, revision: '42' },
    });
  });
});

describe('protocol handler deep-link hardening', () => {
  it('rejects params the action never accepts', () => {
    expect(parseDeepLink('shellysvn://open?path=/wc&cmd=calc')).toBeNull();
    expect(parseDeepLink('shellysvn://commit?path=/wc&url=https://svn.example.com/repo')).toBeNull();
    expect(parseDeepLink('shellysvn://checkout?url=https://svn.example.com/repo&revision=1')).toBeNull();
  });

  it('rejects duplicate params as ambiguous input', () => {
    expect(parseDeepLink('shellysvn://diff?path=/wc/f&revision=1&revision=2')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=/wc/a&path=/wc/b')).toBeNull();
  });

  it('accepts only numeric revisions (or the HEAD keyword)', () => {
    expect(parseDeepLink('shellysvn://log?path=/wc/f&revision=1234')).toMatchObject({
      action: 'log',
      params: { revision: '1234' },
    });
    expect(parseDeepLink('shellysvn://log?path=/wc/f&revision=HEAD')).toMatchObject({
      params: { revision: 'HEAD' },
    });
    expect(parseDeepLink('shellysvn://log?path=/wc/f&revision=abc')).toBeNull();
    expect(parseDeepLink('shellysvn://log?path=/wc/f&revision=1%3Brm%20-rf%20%2F')).toBeNull();
    expect(parseDeepLink('shellysvn://log?path=/wc/f&revision=12345678901')).toBeNull();
  });

  it('rejects relative, option-like, and control-character paths', () => {
    expect(parseDeepLink('shellysvn://open?path=relative/wc')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=--rev')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=%2Fwc%0Ainjected')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=%2Fwc%1B%5B31m')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=C%3A%5Cwc%00')).toBeNull();
  });

  it('rejects control characters in repository URLs even with an allowed protocol', () => {
    expect(parseDeepLink('shellysvn://checkout?url=https%3A%2F%2Fsvn.example.com%0D%0Ax')).toBeNull();
  });

  it('rejects unexpected outer URL structure (userinfo, port, path, fragment)', () => {
    expect(parseDeepLink('shellysvn://user@open?path=/wc')).toBeNull();
    expect(parseDeepLink('shellysvn://open:8080?path=/wc')).toBeNull();
    expect(parseDeepLink('shellysvn://open/extra?path=/wc')).toBeNull();
    expect(parseDeepLink('shellysvn://open?path=/wc#fragment')).toBeNull();
  });

  it('never surfaces non-allowlisted params on a parsed link', () => {
    const link = parseDeepLink('shellysvn://update?path=/wc');
    expect(link?.params).toEqual({ path: '/wc' });
  });
});

describe('protocol handler dispatch', () => {
  it('dispatches validated links to registered handlers only', () => {
    const seen: DeepLink[] = [];
    const listener = (link: DeepLink) => seen.push(link);
    registerDeepLinkHandler('open', listener);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(processDeepLink('shellysvn://open?path=/wc')).toBe(true);
      expect(seen).toEqual([
        { action: 'open', params: { path: '/wc' }, path: '/wc', requiresConfirmation: false },
      ]);

      seen.length = 0;
      expect(processDeepLink('shellysvn://open?path=relative&evil=1')).toBe(false);
      expect(processDeepLink('shellysvn://delete?path=/wc')).toBe(false);
      expect(seen).toEqual([]);

      // Rejections log a controlled warning without echoing the raw URL.
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
      unregisterDeepLinkHandler('open', listener);
    }
  });

  it('logs a sanitized, truncated snippet when rejecting a malformed link', () => {
    const listener = vi.fn();
    registerDeepLinkHandler('open', listener);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // The literal newline is stripped by the URL parser (keeping the link
      // invalid via its relative path), but must still be neutralized before
      // the raw URL reaches the log.
      const url = `shellysvn://ope\nn?path=${'a'.repeat(300)}`;
      expect(processDeepLink(url)).toBe(false);
      expect(listener).not.toHaveBeenCalled();

      const logged = warnSpy.mock.calls[0]?.[1] as string;
      expect(logged).toContain('\uFFFD'); // control character replaced, not echoed
      expect(logged.length).toBeLessThanOrEqual(129); // 128 chars + ellipsis
    } finally {
      warnSpy.mockRestore();
      unregisterDeepLinkHandler('open', listener);
    }
  });
});
