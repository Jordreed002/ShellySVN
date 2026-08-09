// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * macOS-focused coverage for `setupProtocolHandler`.
 *
 * On darwin the app claims the `shellysvn://` protocol directly and receives
 * links through the macOS-only `open-url` event; on Windows/Linux it instead
 * contests a single-instance lock and reads the URL from `second-instance` /
 * `argv`. These tests lock the darwin wiring and the platform boundary so a
 * future refactor cannot silently move the protocol claim off the macOS guard.
 */

const mockSetAsDefaultProtocolClient = vi.hoisted(() => vi.fn());
const mockRequestSingleInstanceLock = vi.hoisted(() => vi.fn(() => true));
const mockOn = vi.hoisted(() => vi.fn());
const mockWhenReady = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockQuit = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    setAsDefaultProtocolClient: mockSetAsDefaultProtocolClient,
    requestSingleInstanceLock: mockRequestSingleInstanceLock,
    on: mockOn,
    whenReady: mockWhenReady,
    quit: mockQuit,
  },
}));

import {
  registerDeepLinkHandler,
  setupProtocolHandler,
  unregisterDeepLinkHandler,
} from '../protocol-handler';

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

describe('protocol handler: macOS (darwin) registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  it('claims the shellysvn:// protocol as the default handler on macOS', () => {
    setupProtocolHandler();

    expect(mockSetAsDefaultProtocolClient).toHaveBeenCalledWith('shellysvn');
  });

  it('does not contest the single-instance lock (Windows/Linux path only)', () => {
    setupProtocolHandler();

    expect(mockRequestSingleInstanceLock).not.toHaveBeenCalled();
    expect(mockQuit).not.toHaveBeenCalled();
  });

  it('registers an open-url listener that prevents default and dispatches the link', () => {
    setupProtocolHandler();

    const openUrlCall = mockOn.mock.calls.find((call) => call[0] === 'open-url');
    expect(openUrlCall).toBeDefined();
    const handler = openUrlCall![1] as (event: { preventDefault: () => void }, url: string) => void;

    const seen: string[] = [];
    const listener = (link: { action: string }) => seen.push(link.action);
    registerDeepLinkHandler('open', listener);

    try {
      const preventDefault = vi.fn();
      handler({ preventDefault }, 'shellysvn://open?path=/Users/test/wc');

      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(['open']);
    } finally {
      unregisterDeepLinkHandler('open', listener);
    }
  });
});

describe('protocol handler: platform boundary vs Windows/Linux', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestSingleInstanceLock.mockReturnValue(true);
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  it('on Windows delegates to the single-instance lock instead of the macOS protocol claim', () => {
    setPlatform('win32');
    setupProtocolHandler();

    expect(mockSetAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(mockRequestSingleInstanceLock).toHaveBeenCalledTimes(1);
  });

  it('on Windows/Linux quits when another instance already holds the lock', () => {
    mockRequestSingleInstanceLock.mockReturnValue(false);
    setPlatform('linux');
    setupProtocolHandler();

    expect(mockQuit).toHaveBeenCalled();
  });
});
