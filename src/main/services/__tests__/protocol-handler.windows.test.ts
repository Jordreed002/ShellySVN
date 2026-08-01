// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Windows/Linux-focused coverage for `setupProtocolHandler`.
 *
 * On non-darwin the app does not get an `open-url` event; instead it contests a
 * single-instance lock, and a second launch forwards its command line to the
 * primary instance via the `second-instance` event. The URL is extracted there
 * (or from the launch `argv`) and dispatched. These tests pin that wiring.
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
const ORIGINAL_ARGV = process.argv;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

function setArgv(argv: string[]): void {
  Object.defineProperty(process, 'argv', { configurable: true, value: argv });
}

function secondInstanceHandler(): ((event: unknown, commandLine: string[]) => void) | undefined {
  const call = mockOn.mock.calls.find((entry) => entry[0] === 'second-instance');
  return call?.[1] as ((event: unknown, commandLine: string[]) => void) | undefined;
}

describe('protocol handler: Windows (win32) registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    setPlatform('win32');
    setArgv(['electron']);
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    setArgv(ORIGINAL_ARGV);
  });

  it('does not claim the shellysvn:// protocol (macOS path only)', () => {
    setupProtocolHandler();
    expect(mockSetAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('registers a second-instance listener that forwards the shellysvn:// URL', () => {
    setupProtocolHandler();

    const handler = secondInstanceHandler();
    expect(handler).toBeDefined();

    const seen: string[] = [];
    const listener = (link: { action: string; path?: string }) => seen.push(link.action);
    registerDeepLinkHandler('open', listener);
    try {
      handler!({}, ['C:\\Program Files\\ShellySVN\\ShellySVN.exe', 'shellysvn://open?path=C:\\wc']);
      expect(seen).toEqual(['open']);
    } finally {
      unregisterDeepLinkHandler('open', listener);
    }
  });

  it('ignores a second instance whose command line has no shellysvn:// URL', () => {
    setupProtocolHandler();

    const handler = secondInstanceHandler();
    const seen: string[] = [];
    const listener = (link: { action: string }) => seen.push(link.action);
    registerDeepLinkHandler('open', listener);
    try {
      handler!({}, ['C:\\Program Files\\ShellySVN\\ShellySVN.exe', '--flag', 'C:\\path.txt']);
      expect(seen).toEqual([]);
    } finally {
      unregisterDeepLinkHandler('open', listener);
    }
  });

  it('quits without registering second-instance when it loses the lock', () => {
    mockRequestSingleInstanceLock.mockReturnValue(false);
    setupProtocolHandler();

    expect(mockQuit).toHaveBeenCalledTimes(1);
    expect(secondInstanceHandler()).toBeUndefined();
  });
});

describe('protocol handler: Windows command-line argv launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    setArgv(ORIGINAL_ARGV);
  });

  it('dispatches a shellysvn:// URL present in the launch argv once the app is ready', async () => {
    setArgv(['C:\\Program Files\\ShellySVN\\ShellySVN.exe', 'shellysvn://log?path=C:\\wc']);
    setupProtocolHandler();

    const seen: string[] = [];
    const listener = (link: { action: string }) => seen.push(link.action);
    registerDeepLinkHandler('log', listener);
    try {
      // whenReady() is mocked resolved; flush the .then() microtask.
      await Promise.resolve();
      await Promise.resolve();
      expect(seen).toEqual(['log']);
    } finally {
      unregisterDeepLinkHandler('log', listener);
    }
  });
});
