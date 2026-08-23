// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  getNetworkOptionsForUrl: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForUrl: mockState.getNetworkOptionsForUrl,
}));

import { editRevprop, getRevprop, type RevpropConfirmation } from '../svn-revprop';

const REPO_URL = 'https://example.test/svn/repo';

const CONFIRMATION = {
  confirmed: true,
  acknowledgedServerLogging: true,
} as const;

// Malformed confirmations can still arrive over IPC; simulate them without
// fighting the literal-true types.
const unsafeConfirmation = (value: unknown) => value as RevpropConfirmation;

describe('svn-revprop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockResolvedValue('new message');
    mockState.getNetworkOptionsForUrl.mockResolvedValue({ trustSslFailures: false });
  });

  it('getRevprop reads a revision property', async () => {
    mockState.runSvnText.mockResolvedValueOnce('original message');

    await expect(getRevprop(REPO_URL, 42, 'svn:log')).resolves.toEqual({
      value: 'original message',
    });

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['propget', '--revprop', '-r', '42', 'svn:log', '--', REPO_URL],
      { trustSslFailures: false }
    );
  });

  it('getRevprop returns a structured error and never throws', async () => {
    mockState.runSvnText.mockRejectedValueOnce(new Error('svn: E170013: Unable to connect'));

    await expect(getRevprop(REPO_URL, 'HEAD', 'svn:author')).resolves.toMatchObject({
      error: 'svn: E170013: Unable to connect',
      errorCode: 'E170013',
      commandError: { category: 'network', retryable: true },
    });
  });

  it('editRevprop rejects without a confirmation token', async () => {
    await expect(
      editRevprop(REPO_URL, 42, 'svn:log', 'rewritten')
    ).resolves.toMatchObject({
      success: false,
      reason: 'CONFIRMATION_REQUIRED',
      url: REPO_URL,
      revision: '42',
      propName: 'svn:log',
    });
    await expect(
      editRevprop(
        REPO_URL,
        42,
        'svn:log',
        'rewritten',
        unsafeConfirmation({ confirmed: false, acknowledgedServerLogging: true })
      )
    ).resolves.toMatchObject({ success: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('editRevprop rejects when server logging is not acknowledged', async () => {
    await expect(
      editRevprop(REPO_URL, 42, 'svn:log', 'rewritten', unsafeConfirmation({ confirmed: true }))
    ).resolves.toMatchObject({
      success: false,
      reason: 'SERVER_LOGGING_NOT_ACKNOWLEDGED',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('editRevprop validates target, revision, property name, and value', async () => {
    await expect(
      editRevprop('trunk', 42, 'svn:log', 'x', CONFIRMATION)
    ).resolves.toMatchObject({ success: false, reason: 'INVALID_URL' });

    await expect(
      editRevprop(REPO_URL, 'r42', 'svn:log', 'x', CONFIRMATION)
    ).resolves.toMatchObject({ success: false, reason: 'INVALID_REVISION' });

    await expect(
      editRevprop(REPO_URL, 42, '-force', 'x', CONFIRMATION)
    ).resolves.toMatchObject({ success: false, reason: 'INVALID_PROPERTY_NAME' });

    await expect(
      editRevprop(REPO_URL, 42, 'svn:log', 'value\u0000', CONFIRMATION)
    ).resolves.toMatchObject({ success: false, reason: 'INVALID_VALUE' });

    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('editRevprop executes svn propset --revprop with exact arguments', async () => {
    const result = await editRevprop(REPO_URL, 42, 'svn:log', 'rewritten message', CONFIRMATION);

    expect(result).toEqual({
      success: true,
      url: REPO_URL,
      revision: '42',
      propName: 'svn:log',
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['propset', '--revprop', '-r', '42', 'svn:log', 'rewritten message', '--', REPO_URL],
      { trustSslFailures: false }
    );
  });

  it('editRevprop normalizes numeric and HEAD revisions', async () => {
    await editRevprop(REPO_URL, 'head', 'svn:author', 'alice', CONFIRMATION);

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['propset', '--revprop', '-r', 'HEAD', 'svn:author', 'alice', '--', REPO_URL],
      { trustSslFailures: false }
    );
  });

  it('editRevprop reports a hook-disabled repository as a structured failure', async () => {
    mockState.runSvnText.mockRejectedValueOnce(
      new Error(
        "svn: E165006: Repository 'https://example.test/svn/repo' has not been enabled to accept revision propchanges"
      )
    );

    await expect(
      editRevprop(REPO_URL, 42, 'svn:log', 'rewritten', CONFIRMATION)
    ).resolves.toMatchObject({
      success: false,
      reason: 'SVN_ERROR',
      errorCode: 'E165006',
      commandError: expect.objectContaining({ command: 'propset --revprop', target: REPO_URL }),
    });
  });
});
