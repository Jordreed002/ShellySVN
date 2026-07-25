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

import { deepLinks, generateDeepLink, parseDeepLink } from '../protocol-handler';

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
    expect(parseDeepLink(generateDeepLink('log', { path: localPath, revision: '42' }))).toMatchObject(
      {
        action: 'log',
        path: localPath,
        params: { path: localPath, revision: '42' },
      }
    );
  });
});
