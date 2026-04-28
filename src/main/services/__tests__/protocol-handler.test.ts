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

import { parseDeepLink } from '../protocol-handler';

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
});
